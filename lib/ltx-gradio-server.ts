/**
 * Helpers SERVER-ONLY pra falar com a Space Gradio do LTX-Video.
 * Não importar no client (usa fetch streaming + envs com tokens).
 */

import { LTX_API_PREFIX, LTX_SPACE_HOST } from './ltx-video';

const BASE = `https://${LTX_SPACE_HOST}`;

/** Pool de tokens HF pra rotação de quota ZeroGPU. */
export function hfTokens(): string[] {
  const raw =
    process.env.HF_TOKENS ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_TOKEN ||
    '';
  return raw
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function pickToken(index: number): {
  token: string | null;
  index: number;
  total: number;
} {
  const pool = hfTokens();
  if (pool.length === 0) return { token: null, index: 0, total: 0 };
  const i = ((index % pool.length) + pool.length) % pool.length;
  return { token: pool[i], index: i, total: pool.length };
}

function browserHeaders(token: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    Origin: BASE,
    Referer: `${BASE}/`,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Enfileira uma geração. Retorna o event_id da fila Gradio. */
export async function ltxQueue(
  fn: string,
  data: unknown[],
  token: string | null,
): Promise<{ ok: true; eventId: string } | { ok: false; error: string; status: number }> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${LTX_API_PREFIX}/call/${fn}`, {
      method: 'POST',
      headers: { ...browserHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  } catch (e) {
    return {
      ok: false,
      status: 502,
      error: e instanceof Error ? e.message : 'fetch falhou',
    };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 400) || `HTTP ${res.status}`,
    };
  }
  let eventId = '';
  try {
    eventId = (JSON.parse(text) as { event_id?: string }).event_id ?? '';
  } catch {
    /* ignore */
  }
  if (!eventId) {
    return { ok: false, status: 502, error: `sem event_id: ${text.slice(0, 200)}` };
  }
  return { ok: true, eventId };
}

type PollResult =
  | { status: 'done'; videoUrl: string; seed: number | null }
  | { status: 'error'; error: string; retryable: boolean }
  | { status: 'pending' };

function isQuotaError(msg: string): boolean {
  return /quota|gpu|exceed|rate.?limit|too many|429|unauthor|login|token/i.test(
    msg,
  );
}

function absUrl(u: string): string {
  if (!u) return u;
  if (u.startsWith('http')) return u;
  if (u.startsWith('/')) return `${BASE}${u}`;
  return `${BASE}${LTX_API_PREFIX}/file=${u}`;
}

function extractVideoUrl(payload: unknown): string | null {
  // payload esperado: [ videoObj, seed ]
  const arr = Array.isArray(payload) ? payload : [payload];
  const v = arr[0] as
    | { video?: { url?: string; path?: string }; url?: string; path?: string }
    | string
    | null;
  if (!v) return null;
  if (typeof v === 'string') return absUrl(v);
  if (v.video?.url) return absUrl(v.video.url);
  if (v.video?.path) return absUrl(v.video.path);
  if (v.url) return absUrl(v.url);
  if (v.path) return absUrl(v.path);
  return null;
}

/**
 * Conecta no stream SSE do resultado e lê por no máximo `budgetMs`.
 * Reconectável: se não terminar nesse tempo, devolve `pending` e o client
 * chama de novo com o mesmo eventId (Gradio mantém o resultado na fila).
 */
export async function ltxPoll(
  fn: string,
  eventId: string,
  token: string | null,
  budgetMs = 45_000,
): Promise<PollResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), budgetMs);
  try {
    const res = await fetch(
      `${BASE}${LTX_API_PREFIX}/call/${fn}/${eventId}`,
      { headers: browserHeaders(token), signal: ctrl.signal },
    );
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      return {
        status: 'error',
        error: t.slice(0, 300) || `HTTP ${res.status}`,
        retryable: isQuotaError(t) || res.status === 429 || res.status === 401,
      };
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let curEvent = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('event:')) {
          curEvent = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();

        if (curEvent === 'complete') {
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            /* ignore */
          }
          const url = extractVideoUrl(parsed);
          const seed =
            Array.isArray(parsed) && typeof parsed[1] === 'number'
              ? (parsed[1] as number)
              : null;
          if (url) return { status: 'done', videoUrl: url, seed };
          return {
            status: 'error',
            error: `resposta sem vídeo: ${dataStr.slice(0, 200)}`,
            retryable: false,
          };
        }
        if (curEvent === 'error') {
          return {
            status: 'error',
            error: dataStr.slice(0, 300) || 'erro na Space',
            retryable: isQuotaError(dataStr) || dataStr === 'null',
          };
        }
        // 'generating' / 'heartbeat' -> continua lendo
      }
    }
    // stream fechou sem 'complete' dentro do orçamento
    return { status: 'pending' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ctrl.signal.aborted) return { status: 'pending' };
    return { status: 'error', error: msg, retryable: isQuotaError(msg) };
  } finally {
    clearTimeout(timer);
  }
}

/** Sobe um frame (PNG/JPG) pra Space e devolve o path temporário no servidor dela. */
export async function ltxUpload(
  file: Blob,
  filename: string,
  token: string | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  try {
    const fd = new FormData();
    fd.append('files', file, filename);
    const res = await fetch(`${BASE}${LTX_API_PREFIX}/upload`, {
      method: 'POST',
      headers: browserHeaders(token),
      body: fd,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, error: text.slice(0, 300) };
    const arr = JSON.parse(text) as string[];
    if (!Array.isArray(arr) || !arr[0]) {
      return { ok: false, error: `upload sem path: ${text.slice(0, 200)}` };
    }
    return { ok: true, path: arr[0] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
