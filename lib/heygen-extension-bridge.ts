/**
 * Bridge entre DARKO LAB <-> Chrome Extension HeyGen Auto.
 *
 * Protocolo (window.postMessage):
 *
 * Page → Extension:
 *   { source: 'darkolab', type: 'HG_PING' }
 *   { source: 'darkolab', type: 'HG_GENERATE', requestId, payload: { copy, avatarId, voiceId, motor } }
 *
 * Extension → Page:
 *   { source: 'darkolab-ext', type: 'HG_PONG', version: '1.x.x' }
 *   { source: 'darkolab-ext', type: 'HG_PROGRESS', requestId, stage, percent? }
 *   { source: 'darkolab-ext', type: 'HG_RESULT', requestId, videoUrl }
 *   { source: 'darkolab-ext', type: 'HG_ERROR', requestId, error }
 *
 * Alem disso, a extension faz o download da MP4 final via fetch dentro do
 * proprio contexto autenticado do HeyGen e devolve a URL CDN. O DARKO LAB
 * baixa via /api/mind-ads/proxy (CORS-safe whitelist HeyGen CDN).
 */

export type ExtensionStatus =
  | { connected: true; version: string }
  | { connected: false };

export type HeygenJobPayload = {
  copy?: string;          // modo texto: copy a falar
  audioBase64?: string;   // modo audio: arquivo de audio em base64 (audio.mp3 / audio.wav)
  audioFilename?: string; // nome do arquivo (ex: "parte1.mp3")
  avatarId: string;
  voiceId?: string;
  motor: 'III' | 'IV' | 'V';
  partLabel?: string;
};

type Pending = {
  resolve: (videoUrl: string) => void;
  reject: (e: Error) => void;
  onProgress?: (stage: string, percent?: number) => void;
};

const pending = new Map<string, Pending>();

let listenerInstalled = false;

function installListener() {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('message', (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.source !== 'darkolab-ext') return;

    const requestId = String(data.requestId ?? '');
    if (!requestId) return;
    const p = pending.get(requestId);
    if (!p) return;

    if (data.type === 'HG_PROGRESS') {
      p.onProgress?.(String(data.stage ?? ''), data.percent);
    } else if (data.type === 'HG_RESULT') {
      pending.delete(requestId);
      p.resolve(String(data.videoUrl ?? ''));
    } else if (data.type === 'HG_ERROR') {
      pending.delete(requestId);
      p.reject(new Error(String(data.error ?? 'Erro na extension.')));
    }
  });
}

/**
 * Detecta se a extension esta instalada + ativa.
 * Retorna em ate 700ms.
 */
export function detectExtension(): Promise<ExtensionStatus> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ connected: false });
      return;
    }
    let resolved = false;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data &&
        ev.data.source === 'darkolab-ext' &&
        ev.data.type === 'HG_PONG'
      ) {
        resolved = true;
        window.removeEventListener('message', handler);
        resolve({ connected: true, version: String(ev.data.version ?? '?') });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ source: 'darkolab', type: 'HG_PING' }, '*');
    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler);
        resolve({ connected: false });
      }
    }, 700);
  });
}

/**
 * Envia uma job de geracao pra extension. Resolve com URL do MP4 quando
 * pronto. SEM TIMEOUT — extension/HeyGen decide quando termina.
 */
export function generateAvatarPart(
  payload: HeygenJobPayload,
  onProgress?: (stage: string, percent?: number) => void,
): Promise<string> {
  installListener();
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sem window — bridge so funciona client-side.'));
      return;
    }
    const requestId = `hg_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    pending.set(requestId, { resolve, reject, onProgress });
    window.postMessage(
      {
        source: 'darkolab',
        type: 'HG_GENERATE',
        requestId,
        payload,
      },
      '*',
    );
  });
}

/**
 * Pinga a extensao e pede pra ela checar se a sessao HeyGen esta valida
 * (faz uma chamada leve pro endpoint de user info do HeyGen com cookies).
 *
 * Retorna { ok, detail }. Se ok=true, gerar via extensao deve funcionar.
 */
export function testHeygenSession(): Promise<{
  ok: boolean;
  detail?: string;
}> {
  installListener();
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ ok: false, detail: 'Sem window.' });
      return;
    }
    const requestId = `test_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data?.source === 'darkolab-ext' &&
        ev.data?.type === 'HG_TEST_RESULT' &&
        ev.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        resolve({
          ok: !!ev.data.ok,
          detail: ev.data.detail ?? '',
        });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage(
      { source: 'darkolab', type: 'HG_TEST_SESSION', requestId },
      '*',
    );
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({
        ok: false,
        detail: 'Extensao nao respondeu em 8s.',
      });
    }, 8000);
  });
}

/**
 * Cancela uma job em andamento (best-effort — extension pode estar com a
 * geracao no HeyGen ja em progresso e nao da pra abortar).
 */
export function cancelAvatarJob(requestId: string) {
  const p = pending.get(requestId);
  if (p) {
    pending.delete(requestId);
    p.reject(new Error('Cancelado pelo usuario.'));
  }
  if (typeof window !== 'undefined') {
    window.postMessage(
      { source: 'darkolab', type: 'HG_CANCEL', requestId },
      '*',
    );
  }
}

/* ===================== Audio helper ===================== */

/**
 * Le um arquivo de audio e retorna base64 (sem prefixo data:).
 * Usado pelo modo audio do HeyGen Auto Avatar.
 */
export async function audioFileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

/* ===================== Copy splitter ===================== */

/**
 * Divide a copy em partes pra cada take ter ATE ~maxSec segundos quando
 * falado a 150 wpm (taxa media de avatar HeyGen). Nao corta no meio de
 * frase — sempre quebra em ponto/exclamacao/interrogacao OU em quebra de
 * paragrafo.
 *
 * Algoritmo:
 *   1. Quebra por paragrafos (\n\n)
 *   2. Pra cada paragrafo, se ultrapassa maxSec, quebra em sentencas
 *   3. Junta sentencas pequenas consecutivas ate atingir minSec ou estourar
 *
 * Resultado: lista de partes ordenadas, cada uma 1 take do avatar.
 */
export function splitCopyIntoParts(
  copy: string,
  opts: { maxSec?: number; minSec?: number; wpm?: number } = {},
): string[] {
  const maxSec = opts.maxSec ?? 20;
  const minSec = opts.minSec ?? 4;
  const wpm = opts.wpm ?? 150;

  const wordsToSec = (text: string) => (countWords(text) / wpm) * 60;

  const paragraphs = copy
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const parts: string[] = [];

  for (const para of paragraphs) {
    if (wordsToSec(para) <= maxSec) {
      parts.push(para);
      continue;
    }
    // Paragrafo longo demais — quebra em sentencas
    const sentences = splitSentences(para);
    let buf = '';
    for (const s of sentences) {
      const candidate = buf ? buf + ' ' + s : s;
      if (wordsToSec(candidate) > maxSec && buf.length > 0) {
        parts.push(buf);
        buf = s;
      } else {
        buf = candidate;
      }
    }
    if (buf) parts.push(buf);
  }

  // Pos-processo: junta partes muito curtas com a anterior
  const merged: string[] = [];
  for (const p of parts) {
    if (
      merged.length > 0 &&
      wordsToSec(p) < minSec &&
      wordsToSec(merged[merged.length - 1] + ' ' + p) <= maxSec
    ) {
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + p;
    } else {
      merged.push(p);
    }
  }

  return merged;
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function splitSentences(s: string): string[] {
  // Quebra em pontuacao final (. ! ?) seguida de espaco ou fim
  const out: string[] = [];
  const re = /[^.!?]+[.!?]+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[0].trim());
    last = m.index + m[0].length;
  }
  const tail = s.slice(last).trim();
  if (tail) out.push(tail);
  return out.filter((x) => x.length > 0);
}
