/**
 * HeyGen API direta — engenharia reversa da extensão @euojeff.daily.
 *
 * Faz requests REAIS pra api2.heygen.com via proxy do content-script da aba
 * HeyGen (precisa do user logado em app.heygen.com numa aba qualquer). O
 * proxy resolve CORS + cookies de sessão.
 *
 * Endpoints validados em produção:
 *   /v2/avatar_group.private.list   - lista grupos
 *   /v2/avatar_group/look.list      - looks por grupo
 *   /v2/avatar/shortcut/submit      - CRIA VIDEO (engine III/IV/V)
 *   /v1/file/url.get                - signed S3 URL pra upload
 *   /v1/file.upload                 - registra upload
 *   /v1/asset.get                   - pega asset por id
 *   /v1/audio/fast_asr              - speech-to-text
 *   /v1/pacific/account.get         - conta
 *   /v1/avatar/video_generate/limits - quotas
 *   /v1/project/items?limit=30      - lista videos
 *   /v1/pacific/video.update        - renomeia video
 */

import { sleepUnthrottled } from './unthrottled-clock';

const API_BASE = 'https://api2.heygen.com';

/** Versao MINIMA do content-script da extensao que essa lib precisa.
 *  Cada vez que mudamos protocolo proxy (campos novos), bumpamos isso. */
export const REQUIRED_EXT_VERSION = '4.0.11';

/** Compara "4.0.10" vs "4.0.9" → true se atual >= minima */
function isExtVersionOk(actual: string | undefined): boolean {
  if (!actual) return false;
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(actual);
  const b = parse(REQUIRED_EXT_VERSION);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}

type ApiReq = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  bodyText?: string;
  bodyBase64?: string;
  bodyType?: string;
};
type ApiRes = {
  status: number;
  ok: boolean;
  body: any;
};

/**
 * Faz fetch via proxy do content-script HeyGen (cookies + Origin valido).
 * page → bridge.js → background.js → heygen-content.js → fetch real.
 */
export function heygenApiFetch(req: ApiReq): Promise<ApiRes> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({ status: 0, ok: false, body: { message: 'Sem window.' } });
      return;
    }
    const requestId = `api_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const handler = (ev: MessageEvent) => {
      if (
        ev.data?.source === 'darkolab-ext' &&
        ev.data?.type === 'HG_API_RESULT' &&
        ev.data?.requestId === requestId
      ) {
        window.removeEventListener('message', handler);
        clearTimeout(timeoutId);
        resolve({
          status: ev.data.status ?? 0,
          ok: !!ev.data.ok,
          body: ev.data.body ?? null,
        });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage(
      { source: 'darkolab', type: 'HG_API_FETCH', requestId, req },
      '*',
    );
    const timeoutId = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ status: 0, ok: false, body: { message: 'Timeout 90s aguardando proxy HeyGen.' } });
    }, 90000);
  });
}

/**
 * Lê o ID do WORKSPACE/SPACE ATIVO da sessão HeyGen (via account.get pelo
 * proxy). Serve pra deixar o cache de avatares ciente do space — assim a
 * lista nunca mostra avatar de um workspace que não é o ativo (raiz do erro
 * "Avatar group not accessible in space"). FAIL-SAFE: qualquer falha (sem
 * extensão, campo ausente, timeout) → null, e o chamador segue como antes.
 * Tenta vários nomes de campo porque o shape exato do space_info não é
 * documentado (descoberto por engenharia-reversa). */
export async function getActiveSpaceId(): Promise<string | null> {
  try {
    const r = await heygenApiFetch({
      url: 'https://api2.heygen.com/v1/pacific/account.get?include_ff=true',
      method: 'GET',
    });
    if (!r.ok) return null;
    const d: any = r.body?.data ?? {};
    const si: any = d.space_info ?? {};
    const id =
      si.space_id ?? si.id ?? si.current_space_id ?? si.active_space_id ??
      d.space_id ?? d.current_space_id ?? d.active_space_id ?? null;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/* ============= JSON helpers ============= */

async function jsonCall(method: ApiReq['method'], path: string, body?: any): Promise<{ status: number; ok: boolean; body: any }> {
  const req: ApiReq = { url: API_BASE + path, method, headers: {} };
  if (body !== undefined) {
    req.headers!['Content-Type'] = 'application/json';
    req.bodyText = JSON.stringify(body);
  }
  const r = await heygenApiFetch(req);
  return { status: r.status, ok: r.ok && r.body?.code === 100, body: r.body };
}

function unwrap(r: { ok: boolean; status: number; body: any }) {
  if (!r.ok) {
    throw new Error(
      `API ${r.status}: ${r.body?.message || r.body?.msg || 'erro desconhecido'}`,
    );
  }
  return r.body.data;
}

/* ============= Retry transitorio (anti-INCOMPLETO) =============
 * Quando varias tasks disparam juntas, TODAS passam pelo MESMO proxy do
 * content-script de UMA aba HeyGen. Sob carga, chamadas individuais batem em
 * timeout (90s do proxy), 429 (rate-limit) ou 5xx (gateway sobrecarregado).
 * SEM retry, um unico blip numa parte deixava a parte sem video → montagem
 * "INCOMPLETA" → "clica RETOMAR". O withRetry abaixo cura esses blips na
 * fonte, com backoff exponencial + jitter, ANTES de virar falha definitiva.
 * (Mesmo padrao que blindou o upload do lipsync — ver project_lipsync_upload_retries.) */

/** Erro TRANSITORIO (se cura sozinho no retry):
 *   - status 0   = timeout do proxy (90s) ou rede caiu
 *   - 408/425/429 = too-early / rate-limit (servidor REJEITOU antes de processar)
 *   - 5xx        = gateway/servidor sobrecarregado (pico quando N tasks disparam juntas)
 *   - mensagens de rede/fetch/proxy
 * NAO inclui 4xx de validacao (400/401/403/404/410) — esses NUNCA se curam
 * (avatar invalido, voz inexistente, endpoint aposentado) e re-tentar so perde tempo. */
/** ESGOTAMENTO de cota/crédito/limite DIÁRIO do HeyGen — TERMINAL: retry NÃO
 *  cura (só o reset diário ou outra conta resolve), tem que aparecer pro user.
 *  CRÍTICO: o limite diário vem com status 429 e mensagem "Your Video Generation
 *  usage has exceeded the maximum daily limit." — sem casar isso, o 429 era
 *  tratado como rate-limit transitório e re-tentado à toa (user reportou
 *  2026-06-23: VAs falhando = na verdade cota diária estourada). */
export function isQuotaError(msg?: string): boolean {
  const m = (msg || '').toLowerCase();
  return /quota|insufficient|saldo|cr[eé]ditos?\b|credit|maximum daily|daily limit|daily quota|usage has exceeded|exceeded the maximum|limit reached|usage limit/.test(m);
}

/** AVATAR/LOOK de OUTRO workspace (space) que o ativo — TERMINAL: re-tentar NÃO
 *  cura (a look não está no space ativo; só trocar o workspace ativo no HeyGen,
 *  ou mover o avatar, resolve). Reconhece os 2 formatos do HeyGen: "not
 *  accessible in space" (grupo) e "avatar look not found ... space_id" (look).
 *  Usado pra NÃO desperdiçar as 3 tentativas num avatar impossível de gerar no
 *  space atual e marcar a falha clara na hora (Retomar inteligente). */
export function isSpaceMismatchError(msg?: string): boolean {
  const m = (msg || '').toLowerCase();
  return (
    m.includes('not accessible in space') ||
    (m.includes('avatar group') && m.includes('not accessible')) ||
    m.includes('avatar look not found') ||
    (m.includes('look not found') && m.includes('space_id')) ||
    (m.includes('outro workspace') && m.includes('space'))
  );
}

export function isTransientFailure(status: number | undefined, msg?: string): boolean {
  // Cota/limite DIÁRIO é TERMINAL mesmo vindo como 429 → checa ANTES da regra
  // "429 = transitório" (senão o limite diário era re-tentado em loop).
  if (isQuotaError(msg)) return false;
  if (status === 0 || status === 408 || status === 425 || status === 429) return true;
  if (status != null && status >= 500 && status <= 599) return true;
  const m = (msg || '').toLowerCase();
  return /timeout|failed to fetch|fetch failed|network|networkerror|load failed|connection|econn|socket|proxy heygen|rate.?limit|too many|overload|temporar|unavailable|try again|503|502|504/.test(m);
}

/** Tenta extrair o status HTTP embutido na mensagem de Error que os helpers
 *  lancam (ex: "API 502:", "(status 0)", "status 429"). -1 se nao achar. */
function statusFromError(e: unknown): number {
  const msg = (e as Error)?.message || '';
  const mm = msg.match(/status\s*(\d{1,3})|\((\d{1,3})\)|API\s+(\d{1,3})/i);
  if (mm) return parseInt(mm[1] || mm[2] || mm[3], 10);
  return -1;
}

/** Roda `fn` com retry exponencial + jitter. So re-tenta quando o erro e
 *  transitorio (shouldRetry). Espera ~base * 2^(n-1) com jitter entre tentativas.
 *  Lanca o ULTIMO erro se esgotar as tentativas ou se o erro nao for transitorio. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    tries?: number;
    baseDelayMs?: number;
    label?: string;
    /** Default: classifica pelo status/mensagem (isTransientFailure). */
    shouldRetry?: (e: unknown, attempt: number) => boolean;
  } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const base = opts.baseDelayMs ?? 800;
  const label = opts.label || 'op';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = opts.shouldRetry
        ? opts.shouldRetry(e, attempt)
        : isTransientFailure(statusFromError(e), (e as Error)?.message);
      if (attempt >= tries || !transient) break;
      const wait = Math.round(base * Math.pow(2, attempt - 1) * (0.7 + Math.random() * 0.6));
      console.warn(`[heygen withRetry] ${label}: tentativa ${attempt}/${tries} falhou (${(e as Error)?.message?.slice(0, 90)}) — re-tentando em ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

/* ============= ENGINES ============= */

export type EngineKey = 'iii' | 'iv' | 'v';

export const ENGINES: Record<EngineKey, {
  label: string;
  source_type: string;
  default_resolution: '720p' | '1080p';
  supports_motion_prompt: boolean;
  settings: (avatarId: string) => Record<string, any>;
}> = {
  iii: {
    label: 'Avatar III',
    source_type: 'avatar_video_shortcut_modal',
    default_resolution: '720p',
    supports_motion_prompt: false,
    settings: () => ({ use_avatar_iv_model: false, use_unlimited_mode: true }),
  },
  iv: {
    label: 'Avatar IV',
    source_type: 'avatar_video_shortcut_modal_with_avatar_iv',
    default_resolution: '1080p',
    supports_motion_prompt: true,
    settings: () => ({
      use_avatar_iv_model: true,
      model: '4.3_turbo_edge',
      resolution: '1080p',
      alpha: 0.5,
    }),
  },
  v: {
    label: 'Avatar V',
    source_type: 'avatar_video_shortcut_modal_with_avatar_iv',
    default_resolution: '1080p',
    supports_motion_prompt: true,
    settings: (avatarId: string) => ({
      use_avatar_iv_model: true,
      model: 'tokyo_v2_1_pde',
      resolution: '1080p',
      cross_ref_avatar_id: avatarId,
    }),
  },
};

/* ============= Account / quotas ============= */

export async function getAccount() {
  return unwrap(await jsonCall('GET', '/v1/pacific/account.get'));
}

export async function getLimits() {
  return unwrap(await jsonCall('GET', '/v1/avatar/video_generate/limits'));
}

/* ============= Upload audio (4 passos) ============= */

async function getSignedUploadUrl(contentType: string): Promise<{ id: string; url: string }> {
  const ct = encodeURIComponent(contentType || 'audio/wav');
  return unwrap(
    await jsonCall('GET', `/v1/file/url.get?file_type=audio&content_type=${ct}`),
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error || new Error('FileReader error'));
    r.readAsDataURL(file);
  });
}

async function putToS3(signedUrl: string, file: File): Promise<void> {
  const b64 = await fileToBase64(file);
  const r = await heygenApiFetch({
    url: signedUrl,
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'audio/wav',
      'x-amz-server-side-encryption': 'AES256',
    },
    bodyBase64: b64,
    bodyType: file.type || 'audio/wav',
  });
  if (!r.ok) {
    throw new Error(
      `S3 PUT falhou (${r.status}): ${r.body?._text || r.body?.message || ''}`,
    );
  }
}

async function registerUpload(uploadId: string, file: File) {
  const body = {
    name: file.name,
    id: uploadId,
    file_type: 'audio',
    content_type: file.type || 'audio/wav',
    filename: file.name,
    properties: { audio_source: 'voice_recording' },
  };
  return unwrap(await jsonCall('POST', '/v1/file.upload', body));
}

async function getAsset(assetId: string) {
  return unwrap(await jsonCall('GET', `/v1/asset.get?id=${assetId}`));
}

async function pollAssetReady(
  assetId: string,
  { timeoutMs = 120000, intervalMs = 1000, onTick }: { timeoutMs?: number; intervalMs?: number; onTick?: (data: any) => void } = {},
) {
  const t0 = Date.now();
  let lastStatus: number | undefined;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const data = await getAsset(assetId);
      onTick?.(data);
      lastStatus = data?.file_meta?.status;
      if (data?.file_meta?.status === 2 && data?.file_meta?.meta?.audios?.mp3) {
        return data;
      }
      if (data?.file_meta?.status === 3) {
        throw new Error('HeyGen rejeitou o audio (transcode falhou).');
      }
    } catch (e) {
      if (Date.now() - t0 > timeoutMs - intervalMs) throw e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timeout ${Math.round(timeoutMs / 1000)}s esperando transcode${lastStatus !== undefined ? ` (ultimo status: ${lastStatus})` : ''}`,
  );
}

async function fastAsr(audioMp3Url: string): Promise<{ duration: number; words: any[]; text: string }> {
  const r = await jsonCall('POST', '/v1/audio/fast_asr', { url: audioMp3Url });
  const data = unwrap(r);
  return {
    duration: data?.data?.duration ?? 0,
    words: data?.data?.words ?? [],
    text: data?.data?.text ?? '',
  };
}

export type UploadedAudio = {
  audio_url: string;
  duration: number;
  words: any[];
  text: string;
  asset_id: string;
};

/**
 * Upload de audio File pro HeyGen + transcode + ASR.
 * Retorna tudo necessario pra createVideo audio_data.
 */
export async function uploadAudio(
  file: File,
  { onStep }: { onStep?: (step: string, info: any) => void } = {},
): Promise<UploadedAudio> {
  onStep?.('url', { name: file.name, size: file.size });
  const { id: uploadId, url: signedUrl } = await getSignedUploadUrl(file.type);

  onStep?.('put', { uploadId });
  await putToS3(signedUrl, file);

  onStep?.('register', { uploadId });
  const reg = await registerUpload(uploadId, file);
  const assetId = reg.id;

  onStep?.('poll', { assetId });
  const sizeMB = (file.size || 0) / (1024 * 1024);
  const transcodeTimeout = Math.min(300000, 60000 + Math.round(sizeMB * 1000));
  const asset = await pollAssetReady(assetId, {
    timeoutMs: transcodeTimeout,
    onTick: (a) => onStep?.('poll', { status: a?.file_meta?.status }),
  });
  const audioUrl = asset.file_meta.meta.audios.mp3;

  onStep?.('asr', {});
  const { duration, words, text } = await fastAsr(audioUrl);

  return { audio_url: audioUrl, duration, words, text, asset_id: assetId };
}

/* ============= Lookup do default voice do avatar ============= */

/**
 * Descobre a voz default do avatar consultando endpoints internos da
 * HeyGen na ordem mais provavel. Retorna null se nada for encontrado.
 */
export async function getAvatarDefaultVoice(
  avatarId: string,
): Promise<string | null> {
  const tries: { path: string; pick: (d: any) => string | null | undefined }[] =
    [
      {
        path: `/v2/avatar/details?id=${encodeURIComponent(avatarId)}`,
        pick: (d) =>
          d?.default_voice_id ??
          d?.default_voice?.voice_id ??
          d?.voice_id ??
          d?.avatar?.default_voice_id ??
          null,
      },
      {
        path: `/v1/avatar.detail?id=${encodeURIComponent(avatarId)}`,
        pick: (d) =>
          d?.default_voice_id ??
          d?.default_voice?.voice_id ??
          d?.voice_id ??
          null,
      },
      {
        path: `/v2/avatar_group.detail?id=${encodeURIComponent(avatarId)}`,
        pick: (d) =>
          d?.default_voice_id ??
          d?.default_voice?.voice_id ??
          d?.voice_id ??
          null,
      },
    ];
  for (const t of tries) {
    try {
      const r = await jsonCall('GET', t.path);
      if (r.ok) {
        const v = t.pick(r.body?.data);
        if (v && typeof v === 'string') return v;
      }
    } catch {
      /* tenta proximo */
    }
  }
  // Ultimo fallback: 1a voz da conta do user
  try {
    const r = await jsonCall('GET', '/v2/voice.list?limit=1');
    if (r.ok) {
      const v =
        r.body?.data?.list?.[0]?.voice_id ??
        r.body?.data?.voices?.[0]?.voice_id ??
        r.body?.data?.[0]?.voice_id ??
        null;
      if (v && typeof v === 'string') return v;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/* ============= Vozes da CONTA ATIVA (sessão, não API key) ============= */

export type StockVoice = { id: string; name: string; language: string | null; gender: string | null; custom?: boolean };

let _stockVoicesCache: { at: number; voices: StockVoice[] } | null = null;

/** Heurística de voz CUSTOM/clonada (a voz do PRÓPRIO user, ex: @drrafaelsiqueira1,
 *  voz nativa clonada junto com um Avatar IV/V). A HeyGen varia o shape: cobre as
 *  flags conhecidas + o padrão "@handle" do nome do clone (material original). */
function isCustomVoice(v: any, name: string): boolean {
  return (
    v?.is_custom === true ||
    v?.is_clone === true ||
    v?.custom === true ||
    /clone|custom|instant/i.test(String(v?.voice_type ?? v?.type ?? '')) ||
    name.trim().startsWith('@')
  );
}

function parseVoiceRow(v: any): StockVoice | null {
  const id = v?.voice_id || v?.id;
  if (!id) return null;
  const name = (v?.display_name || '').trim() || v?.voice_name || v?.name || String(id);
  return {
    id: String(id),
    name,
    language: v?.language ?? v?.locale ?? null,
    gender: v?.gender ?? null,
    custom: isCustomVoice(v, name),
  };
}

/** Lista as vozes STOCK da CONTA ATIVA (sessão) via /v1/voice.list, pelo proxy da
 *  extensão (mesma conta dos avatares). NUNCA usa /api/heygen/voices (API key FIXA
 *  = conta ERRADA quando o user troca de conta no HeyGen).
 *
 *  As vozes CUSTOM (clonadas/@username) NÃO vêm por voice.list — elas chegam pelos
 *  looks dos avatares (look.voiceId) e o nome é resolvido por getVoiceName(). Ver
 *  o CompactVoiceSelector.
 *
 *  Cache de 5min (catálogo stable; o proxy de sessão garante conta certa). */
export async function listStockVoices(): Promise<StockVoice[]> {
  if (_stockVoicesCache && Date.now() - _stockVoicesCache.at < 5 * 60 * 1000) {
    return _stockVoicesCache.voices;
  }
  // /v1/voice.list = catálogo STOCK da conta ativa (~2300). As CUSTOM (clonadas)
  // NÃO vêm por voice.list (só stock) — elas chegam pelos looks dos avatares
  // (look.voiceId) + getVoiceName() pra resolver o nome. (api2 /v2/voice.list e
  // /v2/voices dão 404 — confirmado por probe na sessão.)
  const endpoints = ['/v1/voice.list?limit=2000', '/v1/voice.list'];
  for (const path of endpoints) {
    try {
      const r = await jsonCall('GET', path);
      const arr: any[] = r?.body?.data?.voices || r?.body?.data?.list || [];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const seen = new Set<string>();
      const out: StockVoice[] = [];
      for (const v of arr) {
        const row = parseVoiceRow(v);
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
      }
      if (out.length === 0) continue;
      // Custom (a voz do user) primeiro — fica no topo, fácil de achar.
      out.sort((a, b) => (a.custom === b.custom ? 0 : a.custom ? -1 : 1));
      _stockVoicesCache = { at: Date.now(), voices: out };
      return out;
    } catch {
      /* tenta o próximo endpoint */
    }
  }
  return _stockVoicesCache?.voices || [];
}

const _voiceNameCache = new Map<string, string>();

/** Resolve o display_name de uma voz pelo voice_id, via /v1/voice.get pela SESSÃO
 *  ativa (proxy da extensão). Usado pra nomear vozes CLONADAS que vêm no look do
 *  avatar SEM voiceName (ex: a voz nativa @username de um Avatar IV — o look traz
 *  voiceId mas voiceName=null, então o picker descartava a voz). Cache em memória.
 *  Retorna null se não resolver (o chamador cai num fallback, ex: nome do avatar). */
export async function getVoiceName(voiceId: string): Promise<string | null> {
  if (!voiceId) return null;
  const cached = _voiceNameCache.get(voiceId);
  if (cached) return cached;
  try {
    const r = await jsonCall('GET', `/v1/voice.get?voice_id=${encodeURIComponent(voiceId)}`);
    const v = r?.body?.data?.voice;
    const name = (v?.display_name || '').trim() || (v?.voice_name || '').trim() || '';
    if (name) { _voiceNameCache.set(voiceId, name); return name; }
  } catch {
    /* fallback no chamador */
  }
  return null;
}

/* ============= TTS pra modo TEXTO ============= */

/**
 * @deprecated MORTO desde jun/2026 — a HeyGen aposentou o endpoint interno
 * `/v2/online/text_to_speech.stream` (410 "This endpoint is no longer
 * available"), e TODO TTS standalone (404). O modo texto agora usa o TTS
 * server-side NATIVO via `createVideoWithText` (audio_type `tts_pending` no
 * submit). NAO reusar esta funcao — fica so como registro do shape antigo.
 * Ver [[project_heygen_tts_410]].
 *
 * Gera audio TTS via HeyGen (text → audio bytes). Retorna File de audio
 * que pode ser passado pra uploadAudio() depois.
 */
export async function ttsToFile(text: string, voiceId: string): Promise<File> {
  const r = await heygenApiFetch({
    url: API_BASE + '/v2/online/text_to_speech.stream',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyText: JSON.stringify({ text, voice_id: voiceId, text_type: 'text' }),
  });
  if (!r.ok) {
    throw new Error(`TTS falhou (${r.status}): ${r.body?.message ?? r.body?.msg ?? r.body?._text ?? r.body?._rawPreview ?? ''}`);
  }
  // 1) audio_url extraido pelo proxy de chunks ndjson (mais robusto que
  //    decodar chunks — URL e signed CDN, garantia de bytes integros)
  if (r.body?._audioUrl) {
    const ar = await fetch(r.body._audioUrl);
    if (ar.ok) {
      const buf = await ar.arrayBuffer();
      return new File([new Uint8Array(buf)], 'tts.mp3', { type: 'audio/mpeg' });
    }
    console.warn('[DARKO LAB] _audioUrl fetch falhou, caindo pra _bytesBase64');
  }
  // 2) Bytes assemblados pelo proxy (binario direto OU ndjson decodado)
  const binBase64 = r.body?._bytesBase64;
  if (binBase64) {
    const bytes = Uint8Array.from(atob(binBase64), (c) => c.charCodeAt(0));
    const mime = (r.body?._contentType || '').includes('audio') ? r.body._contentType : 'audio/mpeg';
    return new File([bytes], 'tts.mp3', { type: mime });
  }
  // 3) Legado: JSON com audio_bytes (base64) ou audio_url
  const audioBytes = r.body?.audio_bytes ?? r.body?.data?.audio_bytes;
  if (audioBytes) {
    const bytes = Uint8Array.from(atob(audioBytes), (c) => c.charCodeAt(0));
    return new File([bytes], 'tts.mp3', { type: 'audio/mpeg' });
  }
  const audioUrl = r.body?.audio_url ?? r.body?.data?.audio_url ?? r.body?.data?.url;
  if (audioUrl) {
    const ar = await fetch(audioUrl);
    const buf = await ar.arrayBuffer();
    return new File([new Uint8Array(buf)], 'tts.mp3', { type: 'audio/mpeg' });
  }
  // 4) Diagnostico detalhado: se proxy decodou ndjson mas sem audio reconhecido,
  //    mostra primeiro chunk pro debug.
  const ndjson = r.body?._ndjson;
  if (Array.isArray(ndjson) && ndjson.length > 0) {
    const sample = JSON.stringify(ndjson[0]).slice(0, 300);
    throw new Error(`TTS ndjson ${ndjson.length} chunks sem campo audio reconhecido. Primeiro: ${sample}`);
  }
  const keys = Object.keys(r.body ?? {}).join(',') || '(vazio)';
  const ct = r.body?._contentType || '?';
  const preview = r.body?._text ?? r.body?._rawPreview ?? '';
  const previewStr = preview ? ` preview="${String(preview).slice(0, 200)}"` : '';
  throw new Error(`TTS sem audio (status ${r.status}, ct=${ct}, keys=${keys})${previewStr}`);
}

/* ============= Criar video ============= */

export type CreateVideoParams = {
  title: string;
  avatarId: string;
  engine: EngineKey;
  audio: UploadedAudio;
  orientation?: 'portrait' | 'landscape' | 'square';
  resolution?: '720p' | '1080p';
  motionPrompt?: string;
  /** VA de avatar: ativa "Voice Mirroring" — avatar fala com a propria
   *  voz mas com timing/conteudo espelhando o audio uploaded. HeyGen
   *  aceita varias nomenclaturas; mandamos todas pra robustez. */
  voiceMirroring?: boolean;
  /** Voice ID HeyGen pra usar como Mirror Voice (sobrescreve voz default
   *  do avatar). Combinado com voiceMirroring:true, o HeyGen sintetiza
   *  o video falando com ESSA voz, usando o audio uploaded como timing
   *  reference. Sem isso, HeyGen usa voz default do avatar. */
  voiceId?: string;
};

/** Converte erro de submit do HeyGen em mensagem CLARA e acionável quando
 *  reconhece o caso. Hoje cobre o erro de WORKSPACE/SPACE: o avatar pertence a
 *  OUTRO space do HeyGen (acontece em conta com Teams/múltiplos spaces, quando
 *  o space ATIVO na sessão não é o dono do avatar — típico no Retomar, em que o
 *  avatar foi salvo num space e a sessão agora está noutro). Pra qualquer outro
 *  erro, devolve o texto original + "(status N)" — PRESERVANDO o que o
 *  withRetry/isQuotaError já classificam (não muda comportamento, só o texto). */
function describeSubmitError(status: number, rawMsg: string): string {
  const raw = rawMsg || '?';
  const m = raw.toLowerCase();
  // Mesma raiz (avatar/look de OUTRO workspace que o ativo), em 2 formatos do
  // HeyGen: "avatar group ... not accessible in space" (grupo) e "avatar look
  // not found ... space_id ... 404" (a look específica não está no space ativo —
  // típico de VA com avatares em workspaces diferentes; as 1as partes vêm da
  // recuperação e só as partes NOVAS batem no 404).
  const spaceMismatch =
    m.includes('not accessible in space') ||
    (m.includes('avatar group') && m.includes('not accessible')) ||
    m.includes('avatar look not found') ||
    (m.includes('look not found') && m.includes('space_id')) ||
    (m.includes('look') && m.includes('not found') && status === 404);
  if (spaceMismatch) {
    return (
      'O avatar dessa parte está em OUTRO workspace (space) do HeyGen — por isso ' +
      'o disparo falhou. No HeyGen, deixe ATIVO o workspace dono desse avatar (ou ' +
      'mova o avatar pro mesmo workspace dos outros), recarregue a biblioteca de ' +
      'avatares e clique Retomar. ' +
      `[HeyGen status ${status}: ${raw}]`
    );
  }
  return `${raw} (status ${status})`;
}

export async function createVideo(params: CreateVideoParams): Promise<{ video_id: string; avatar_id: string }> {
  const { title, avatarId, engine, audio, orientation = 'portrait', resolution, motionPrompt, voiceMirroring, voiceId } = params;
  const eng = ENGINES[engine];
  if (!eng) throw new Error(`Motor desconhecido: ${engine}`);

  // ============================================================
  // VOICE MIRRORING / ESPELHAMENTO DE VOZ (VA de Avatar)
  // ============================================================
  // Shape descoberto por engenharia-reversa do submit NATIVO do HeyGen
  // (payload capturado 2026-06-03 pelo interceptor MAIN-world). O SEGREDO
  // do Espelhamento NAO sao campos "voice_mirroring" (nao existem) — e o
  // audio_type "sts_pending" (speech-to-speech, pending): o HeyGen pega o
  // source_audio_url (timing/cadencia do audio original) e RE-SINTETIZA na
  // voz alvo voice_id. Por isso "uploaded" dava voz errada: usava o audio
  // como trilha final = voz original do AD. Payload nativo de referencia:
  //   audio_data: { audio_type:"sts_pending", source_audio_url, voice_id, duration }
  //   source_type:"avatar_video_shortcut_modal"
  //   avatar_settings: { use_avatar_iv_model:false, use_unlimited_mode:true }
  if (voiceMirroring) {
    if (!voiceId) {
      // Sem voz alvo o STS nao tem pra onde converter -> HeyGen cairia na
      // voz original. Falha CLARA em vez de entregar voz errada de novo.
      throw new Error('Espelhamento de Voz exige uma voz alvo (voiceId). Escolha a voz no seletor antes de disparar o VA.');
    }
    const mirrorBody: Record<string, any> = {
      video_title: title || 'Vídeo de Avatar',
      video_orientation: orientation,
      resolution: resolution || '720p',
      avatar_id: avatarId,
      source_type: 'avatar_video_shortcut_modal',
      fit: 'cover',
      audio_data: {
        audio_type: 'sts_pending',
        source_audio_url: audio.audio_url,
        voice_id: voiceId,
        duration: audio.duration,
      },
      avatar_settings: { use_avatar_iv_model: false, use_unlimited_mode: true },
      enable_caption: false,
      create_new_avatar: false,
    };
    const rm = await jsonCall('POST', '/v2/avatar/shortcut/submit', mirrorBody);
    if (!rm.ok) {
      // status SEMPRE embutido (via describeSubmitError) → withRetry classifica transitorio (429/5xx/0).
      throw new Error('Falha ao criar video (Espelhamento de Voz): ' + describeSubmitError(rm.status, rm.body?.message || rm.body?.msg || '?'));
    }
    return rm.body.data;
  }

  // ============================================================
  // MODO NORMAL (audio uploaded vira trilha) — task comum
  // ============================================================
  const settings = eng.settings(avatarId);
  if (motionPrompt && eng.supports_motion_prompt) {
    settings.motion_prompt = motionPrompt;
    settings.prompt = motionPrompt;
  }

  const audio_data: Record<string, any> = {
    audio_type: 'uploaded',
    audio_url: audio.audio_url,
    duration: audio.duration,
    words: audio.words,
    text: audio.text || '',
  };

  const body: Record<string, any> = {
    video_title: title || 'Avatar Video',
    video_orientation: orientation,
    resolution: resolution || eng.default_resolution,
    avatar_id: avatarId,
    source_type: eng.source_type,
    fit: 'cover',
    audio_data,
    avatar_settings: settings,
    enable_caption: false,
    create_new_avatar: false,
  };
  const r = await jsonCall('POST', '/v2/avatar/shortcut/submit', body);
  if (!r.ok) {
    // status SEMPRE embutido (via describeSubmitError) → withRetry classifica transitorio (429/5xx/0).
    throw new Error('Falha ao criar video: ' + describeSubmitError(r.status, r.body?.message || r.body?.msg || '?'));
  }
  return r.body.data;
}

/* ============= Submit DIRETO com texto (HeyGen TTS server-side) ============= */

export type CreateVideoWithTextParams = {
  title: string;
  avatarId: string;
  engine: EngineKey;
  text: string;
  voiceId: string;
  orientation?: 'portrait' | 'landscape' | 'square';
  resolution?: '720p' | '1080p';
  motionPrompt?: string;
};

/**
 * Submete video com TEXTO + VOICE_ID direto, deixando o HeyGen fazer o TTS
 * server-side DENTRO da geracao (sem chamada de TTS separada). Substitui o
 * fluxo antigo que pre-gerava audio via /v2/online/text_to_speech.stream —
 * endpoint INTERNO que a HeyGen aposentou (410 Gone, jun/2026).
 *
 * SHAPE CONFIRMADA AO VIVO (eng. reversa via interceptor + probe do schema,
 * 2026-06-16): o /v2/avatar/shortcut/submit aceita audio_type ∈ {uploaded,
 * tts, sts, tts_pending}. O modo texto e o `tts_pending` — analogo EXATO do
 * `sts_pending` do Espelhamento de Voz (difere a sintese pro render):
 *   audio_data: { audio_type:'tts_pending', text:<script>, voice_id:<voiceId> }
 * O campo e `text` (NAO `input_text`) — o validador do servidor confirma:
 *   "audio_data.tts_pending.text is invalid: Field required".
 *
 * Vantagem de robustez: roda no endpoint CORE de geracao (o mesmo do modo
 * normal `uploaded` e do VA `sts_pending`), nao num endpoint auxiliar de TTS
 * que pode sumir sozinho. Se a HeyGen mudar o schema, o erro de validacao
 * abaixo e auto-explicativo (o servidor diz qual campo falta) — fim da
 * adivinhacao de shape.
 */
export async function createVideoWithText(
  params: CreateVideoWithTextParams,
): Promise<{ video_id: string; avatar_id: string }> {
  const { title, avatarId, engine, text, voiceId, orientation = 'portrait', resolution, motionPrompt } = params;
  const eng = ENGINES[engine];
  if (!eng) throw new Error(`Motor desconhecido: ${engine}`);
  if (!voiceId) {
    throw new Error('createVideoWithText: voice_id obrigatorio pro TTS server-side (tts_pending).');
  }

  const settings = eng.settings(avatarId);
  if (motionPrompt && eng.supports_motion_prompt) {
    settings.motion_prompt = motionPrompt;
    settings.prompt = motionPrompt;
  }

  const body = {
    video_title: title || 'Avatar Video',
    video_orientation: orientation,
    resolution: resolution || eng.default_resolution,
    avatar_id: avatarId,
    source_type: eng.source_type,
    fit: 'cover',
    audio_data: { audio_type: 'tts_pending', text, voice_id: voiceId },
    avatar_settings: settings,
    enable_caption: false,
    create_new_avatar: false,
  };

  const r = await jsonCall('POST', '/v2/avatar/shortcut/submit', body);
  if (r.ok && r.body?.data?.video_id) {
    return r.body.data;
  }
  const msg = r.body?.message ?? r.body?.msg ?? r.body?._text?.slice(0, 200) ?? '?';
  throw new Error('createVideoWithText falhou (tts_pending): ' + describeSubmitError(r.status, msg));
}

/* ============= Polling + download de videos prontos ============= */

export type VideoStatus = {
  videoId: string;
  status: 'completed' | 'pending' | 'failed' | 'unknown';
  videoUrl: string | null;
  error?: string;
};

/**
 * Pega status de N videos em UMA chamada (mais eficiente que 1 GET por video).
 * Lista os ultimos N projects do user e cruza com os videoIds que queremos.
 *
 * FALLBACK PAGINADO (fix 2026-05-30): se algum videoId ficar 'unknown' depois
 * da primeira chamada, pagina /v1/project/items ate 5 paginas pra cair em
 * videos antigos que saíram da janela recente. Sem isso, qualquer batch
 * grande ou conta movimentada perde IDs antigos → polling fica esperando
 * status que NUNCA volta = "NA FILA eterno".
 */
export async function getVideosStatus(
  videoIds: string[],
): Promise<Record<string, VideoStatus>> {
  // Limit GENEROSO — pega 4x o numero de IDs pedidos, com piso de 200.
  // Conta com muitas dispatches consegue ter os 200 mais recentes cobertos.
  const limit = Math.max(200, videoIds.length * 4);
  const out: Record<string, VideoStatus> = {};
  for (const id of videoIds) out[id] = { videoId: id, status: 'unknown', videoUrl: null };

  function applyItems(items: any[]) {
    for (const it of items) {
      const id = it.video_id;
      if (!id || !(id in out)) continue;
      // Se ja temos status definitivo (completed/failed), nao sobrescreve.
      if (out[id].status === 'completed' || out[id].status === 'failed') continue;
      const st = String(it.status || '').toLowerCase();
      let mapped: VideoStatus['status'] = 'unknown';
      if (st === 'completed' || st === 'done' || st === 'success') mapped = 'completed';
      else if (st === 'failed' || st === 'error') mapped = 'failed';
      else if (st === '' || st === 'pending' || st === 'processing' || st === 'rendering' || it.status == null) mapped = 'pending';
      out[id] = {
        videoId: id,
        status: mapped,
        videoUrl: it.video_url || null,
        error: it.error || it.failed_reason || undefined,
      };
    }
  }

  // 1a tentativa: ultimo lote (mais recente). Cobre 95%+ dos casos normais.
  const r0 = await jsonCall('GET', `/v1/project/items?limit=${limit}`);
  if (r0.ok) applyItems(r0.body?.data?.items || []);

  // FALLBACK: se sobrou algum 'unknown', pagina ate achar (max 5 paginas).
  // Cada pagina = 200 items, total 1000 — cobre semanas de historico.
  const stillUnknown = () => videoIds.filter((id) => out[id].status === 'unknown');
  if (stillUnknown().length > 0) {
    for (let page = 2; page <= 5; page++) {
      const missing = stillUnknown();
      if (missing.length === 0) break;
      try {
        const r = await jsonCall(
          'GET',
          `/v1/project/items?limit=${limit}&page=${page}`,
        );
        if (!r.ok) break;
        const items = r.body?.data?.items || [];
        if (items.length === 0) break; // fim da paginacao
        applyItems(items);
      } catch (e) {
        console.warn(`[getVideosStatus] paginacao page=${page} falhou:`, e);
        break;
      }
    }
  }

  return out;
}

/** Lista videos da conta HeyGen com paginacao. Retention de 60 dias (limit
 *  imposto pelo HeyGen). Mais novos primeiro. */
export type HistoryVideo = {
  videoId: string;
  name: string;
  status: VideoStatus['status'];
  videoUrl: string | null;
  thumbUrl: string | null;
  durationSec: number | null;
  createdAt: number; // unix ms
  error?: string;
};

export async function listMyVideos(opts: {
  limit?: number;
  page?: number;
} = {}): Promise<{ items: HistoryVideo[]; hasMore: boolean; totalLoaded: number }> {
  const limit = opts.limit ?? 50;
  const page = opts.page ?? 1;
  // Tenta varios endpoints — HeyGen tem inconsistencia entre v1/v2
  const candidates = [
    `/v1/pacific/video.list?limit=${limit}&page=${page}`,
    `/v1/video.list?limit=${limit}&page=${page}`,
    `/v2/video.list?limit=${limit}&page=${page}`,
    `/v1/project/items?limit=${limit}&item_types=heygen_video&sort_key=created_ts&sort_order=desc`,
  ];
  for (const path of candidates) {
    const r = await jsonCall('GET', path);
    if (!r.ok) continue;
    const data = r.body?.data;
    const rawList: any[] = data?.list || data?.items || data?.videos || (Array.isArray(data) ? data : []);
    if (!Array.isArray(rawList) || rawList.length === 0) continue;
    const items: HistoryVideo[] = rawList.map((it) => {
      const st = String(it.status || it.state || '').toLowerCase();
      let status: VideoStatus['status'] = 'unknown';
      if (st === 'completed' || st === 'done' || st === 'success') status = 'completed';
      else if (st === 'failed' || st === 'error') status = 'failed';
      else if (st === 'pending' || st === 'processing' || st === 'rendering') status = 'pending';
      // Created timestamp pode vir em ms ou s (epoch)
      let createdAt = Number(it.created_ts || it.created_at || it.created || 0);
      if (createdAt > 0 && createdAt < 10_000_000_000) createdAt *= 1000;
      return {
        videoId: String(it.video_id || it.id || ''),
        name: String(it.video_title || it.title || it.name || '(sem nome)'),
        status,
        videoUrl: it.video_url || it.url || null,
        thumbUrl: it.thumbnail_url || it.thumb_url || it.cover_image_url || null,
        durationSec: typeof it.duration === 'number' ? it.duration : (typeof it.duration_seconds === 'number' ? it.duration_seconds : null),
        createdAt,
        error: it.error || it.failed_reason || undefined,
      };
    }).filter((v) => v.videoId);
    return { items, hasMore: items.length >= limit, totalLoaded: items.length };
  }
  return { items: [], hasMore: false, totalLoaded: 0 };
}

/**
 * RECUPERAÇÃO por TÍTULO: lista os vídeos JÁ RENDERIZADOS (completed) no HeyGen
 * cujo título contém `namePrefix`, e devolve um mapa título → video_url (a cópia
 * MAIS RECENTE de cada título vence). Serve pra reusar partes que renderizaram no
 * HeyGen mas o app não capturou (poll estourou, cota voltou numa re-tentativa
 * DEPOIS do vídeo já ter ficado pronto, etc.) — assim o RETOMAR monta SEM
 * re-gerar (não gasta cota). Best-effort: erro/timeout → mapa vazio (cai no
 * caminho normal de render).
 */
export async function findCompletedVideosByName(
  namePrefix: string,
  opts: { maxPages?: number } = {},
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const maxPages = opts.maxPages ?? 6;
  // NÃO usa name_filter: nesse endpoint ele volta os itens com TÍTULO VAZIO (não
  // dá pra saber qual parte é cada vídeo). Lista normal (com títulos) + filtro por
  // título no cliente — comprovado funcionando.
  for (let page = 1; page <= maxPages; page++) {
    const path = `/v1/project/items?limit=100&page=${page}&item_types=heygen_video&sort_key=created_ts&sort_order=desc`;
    const r = await jsonCall('GET', path).catch(() => null);
    if (!r || !r.ok) break;
    const data = r.body?.data;
    const list: any[] = data?.list || data?.items || data?.videos || (Array.isArray(data) ? data : []);
    if (!Array.isArray(list) || list.length === 0) break;
    for (const it of list) {
      const title = String(it.video_title || it.title || it.name || '');
      if (!title.includes(namePrefix)) continue;
      if (map.has(title)) continue; // já temos a cópia mais recente desse título
      const st = String(it.status || it.state || '').toLowerCase();
      const url = it.video_url || it.url;
      if ((st === 'completed' || st === 'done' || st === 'success') && url) {
        map.set(title, String(url));
      }
    }
    if (list.length < 100) break; // última página
  }
  return map;
}

/**
 * Polla repetidamente ate todos os videoIds estarem 'completed' ou 'failed'
 * ou ate timeout. Chama onStatus a cada poll.
 *
 * ZOMBIE DETECTION (fix 2026-05-30): cada videoId tem seu proprio relogio
 * de "quanto tempo ja estou pending". Se passar de maxPendingMsPerId
 * (default 15min — HeyGen normal leva 2-8min), promove status pra 'failed'
 * com erro descritivo. Isso DESTRAVA batches onde 1-2 videos zumbis prendem
 * o pipeline inteiro.
 *
 * TIMEOUT GRACEFUL (fix 2026-05-30): se atingir o deadline global, em vez
 * de jogar throw (que abortava todo o pipeline), retorna o que tem e marca
 * os que sobraram como 'failed'. Pipeline pos-producao roda com partial
 * result, gera _NAO_RENDERIZOU.txt nas vagas.
 */
export async function pollVideosUntilReady(
  videoIds: string[],
  opts: {
    onStatus?: (statuses: Record<string, VideoStatus>) => void;
    intervalMs?: number;
    /** Timeout TOTAL — depois disso, retorna marcando o que sobrou como failed. Default 30min. */
    timeoutMs?: number;
    /**
     * Max tempo POR ID em 'pending'/'unknown' antes de virar zombie.
     * Default 15min: HeyGen video normal leva 2-8min; 15min eh folga 2x
     * pra cobrir picos de carga. Stuck >15min eh fatal pra esse render.
     */
    maxPendingMsPerId?: number;
    isCancelled?: () => boolean;
  } = {},
): Promise<Record<string, VideoStatus>> {
  const interval = opts.intervalMs ?? 8000;
  const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60 * 1000);
  const maxPendingPerId = opts.maxPendingMsPerId ?? 15 * 60 * 1000;

  // Relogio por ID — quando vi este ID em pending/unknown pela 1a vez?
  const firstPendingAt: Record<string, number> = {};
  let lastStatuses: Record<string, VideoStatus> = {};

  while (true) {
    if (opts.isCancelled?.()) {
      throw new Error('Polling cancelado pelo user.');
    }

    const statuses = await getVideosStatus(videoIds);
    const now = Date.now();

    // ZOMBIE PASS: pra cada ID ainda pending/unknown, conta o tempo.
    // Se ja passou do limit, promove pra 'failed' com erro descritivo.
    for (const id of videoIds) {
      const s = statuses[id];
      if (!s) continue;
      if (s.status === 'pending' || s.status === 'unknown') {
        if (!firstPendingAt[id]) firstPendingAt[id] = now;
        const stuckFor = now - firstPendingAt[id];
        if (stuckFor > maxPendingPerId) {
          const min = Math.round(stuckFor / 60000);
          statuses[id] = {
            ...s,
            status: 'failed',
            error: s.status === 'unknown'
              ? `Video sumiu do historico HeyGen apos ${min}min — render perdido. Re-dispare essa parte.`
              : `Render travado ${min}min sem progresso (zombie HeyGen). Pulando essa parte — re-dispare se precisar.`,
          };
          console.warn(`[poll] zombie killed: ${id} (stuck ${min}min)`);
        }
      } else {
        // Saiu de pending — limpa o relogio
        delete firstPendingAt[id];
      }
    }

    lastStatuses = statuses;
    opts.onStatus?.(statuses);

    const allDone = videoIds.every((id) => {
      const s = statuses[id]?.status;
      return s === 'completed' || s === 'failed';
    });
    if (allDone) return statuses;

    if (Date.now() > deadline) {
      // GRACEFUL TIMEOUT: marca todos os que ainda nao terminaram como failed
      // e retorna. Pipeline pos-producao roda com partial result.
      console.warn(`[poll] global timeout — marcando ${videoIds.length} restantes como failed`);
      for (const id of videoIds) {
        const s = lastStatuses[id];
        if (s && s.status !== 'completed' && s.status !== 'failed') {
          lastStatuses[id] = {
            ...s,
            status: 'failed',
            error: 'Timeout global do polling (30min). Render ainda pode terminar no HeyGen — re-dispare se quiser tentar de novo.',
          };
        }
      }
      return lastStatuses;
    }

    // Espera NÃO-estrangulada (Web Worker): em aba de segundo plano o setTimeout
    // da janela cai pra ~1x/min e travava o poll (render "RENDERIZANDO" eterno +
    // contador congelado + montagem que não disparava). Ver [[unthrottled-clock]].
    await sleepUnthrottled(interval);
  }
}

/**
 * Baixa o MP4 de um videoUrl (CDN HeyGen). Tenta direct fetch primeiro;
 * se falhar (CORS), routeia via proxy da extensao (que tem origin certo).
 */
export async function downloadVideoBytes(videoUrl: string): Promise<Uint8Array> {
  // Download e idempotente (GET no CDN) → retry agressivo (4 tentativas). Um
  // blip de rede/CORS/proxy NAO pode mais deixar a parte sem blob (= montagem
  // INCOMPLETA). Tenta direct fetch primeiro; se falhar, routeia via proxy.
  return withRetry(async () => {
    try {
      // TIMEOUT no fetch DIRETO: fetch do browser não tem teto default. Se o CDN
      // aceita a conexão mas para de mandar bytes (socket estagnado — comum em aba
      // de fundo throttlada/rede móvel), o arrayBuffer() ficava pendurado PRA SEMPRE
      // e o withRetry (que só re-tenta em REJEIÇÃO) nunca disparava → run preso em
      // 'downloading', slot HeyGen nunca liberava, fila congelava. Agora um hang
      // vira AbortError → cai pro proxy (que já tem seu próprio timeout de 90s) e,
      // se ambos falharem, o withRetry re-tenta. (proxy = heygenApiFetch, L90-93.)
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 120_000);
      try {
        const r = await fetch(videoUrl, { signal: ac.signal });
        if (r.ok) {
          const buf = await r.arrayBuffer();
          const u8 = new Uint8Array(buf);
          if (u8.byteLength > 1024) return u8; // sanity: <1KB = corpo de erro, nao MP4
        }
      } finally {
        clearTimeout(to);
      }
    } catch {
      /* timeout/CORS/erro → cai pro proxy */
    }
    const r = await heygenApiFetch({ url: videoUrl, method: 'GET' });
    if (!r.ok) throw new Error(`Falha download (status ${r.status}): ${r.body?.message || r.body?._text?.slice(0, 100) || '?'}`);
    const b64 = r.body?._bytesBase64;
    if (!b64) throw new Error('Proxy nao retornou bytes do video (status 0). Body keys: ' + Object.keys(r.body || {}).join(','));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.byteLength <= 1024) throw new Error(`Download retornou ${bytes.byteLength}B (provavel erro transitorio, status 0)`);
    return bytes;
  }, { tries: 4, baseDelayMs: 1000, label: 'downloadVideo' });
}

/* ============= Pipeline completo ============= */

export type ProcessJobInput = {
  /** modo audio: arquivo direto */
  file?: File;
  /** modo texto: texto + voiceId pra TTS */
  text?: string;
  voiceId?: string;
  title: string;
  avatarId: string;
  engine: EngineKey;
  orientation?: 'portrait' | 'landscape' | 'square';
  resolution?: '720p' | '1080p';
  motionPrompt?: string;
  /** VA de avatar: ativa Voice Mirroring (avatar fala com a propria voz
   *  espelhando o audio uploaded). Equivalente ao checkbox "Voice
   *  Mirroring" no Quick Create do HeyGen. */
  voiceMirroring?: boolean;
};

export async function processJob(
  job: ProcessJobInput,
  { onProgress }: { onProgress?: (stage: string, info: any) => void } = {},
): Promise<{ videoId: string; avatarId: string; audio?: UploadedAudio }> {
  // ============= MODO AUDIO: arquivo direto =============
  if (job.file) {
    onProgress?.('upload', { msg: 'Preparando upload...' });
    const audio = await uploadAudio(job.file, {
      onStep: (step, info) => onProgress?.(`upload-${step}`, info),
    });

    onProgress?.('submitting', { duration: audio.duration, voiceMirroring: !!job.voiceMirroring, voiceId: job.voiceId || null });
    // Retry conservador (transitorio-only) — mesmo racional do submit por texto.
    const created = await withRetry(
      () => createVideo({
        title: job.title,
        avatarId: job.avatarId,
        engine: job.engine,
        audio,
        orientation: job.orientation,
        resolution: job.resolution,
        motionPrompt: job.motionPrompt,
        voiceMirroring: job.voiceMirroring,
        voiceId: job.voiceId, // VA: voz custom do user (Mirror Voice ID)
      }),
      { tries: 3, baseDelayMs: 1200, label: `submit-audio ${job.title}` },
    );

    if (job.title && job.title !== 'Avatar Video') {
      onProgress?.('renaming', { videoId: created.video_id });
      try {
        await jsonCall('POST', '/v1/pacific/video.update', {
          id: created.video_id,
          params: { title: job.title },
        });
      } catch {}
    }
    onProgress?.('done', { videoId: created.video_id });
    return { videoId: created.video_id, avatarId: created.avatar_id, audio };
  }

  // ============= MODO TEXTO: submete texto direto, HeyGen TTS server-side =============
  if (!job.text) {
    throw new Error('processJob: precisa de `file` (audio) OU `text` (texto).');
  }

  let voiceId = job.voiceId;
  if (!voiceId) {
    onProgress?.('voice-lookup', { msg: 'Buscando voz default do avatar...' });
    // voice-lookup e GET idempotente (3 endpoints + fallback). Um null pode ser
    // blip transitorio do proxy → re-tenta ate 3x (sempre, e seguro) antes de
    // desistir. Sem isso, 1 hiccup no lookup matava a parte inteira.
    const found = await withRetry(
      async () => {
        const v = await getAvatarDefaultVoice(job.avatarId);
        if (!v) throw new Error('voice-lookup vazio (status 0 — transitorio?)');
        return v;
      },
      { tries: 3, baseDelayMs: 700, label: `voice-lookup ${job.avatarId}`, shouldRetry: () => true },
    ).catch(() => null);
    if (!found) {
      throw new Error(
        'Nao foi possivel descobrir a voz default desse avatar. Marque "Substituir voz padrao do avatar" e escolha uma voz manualmente.',
      );
    }
    voiceId = found;
  }

  // TTS server-side NATIVO do HeyGen via tts_pending: submete texto +
  // voice_id DIRETO no /v2/avatar/shortcut/submit (endpoint CORE de geracao)
  // e o HeyGen sintetiza no render, com a VOZ NATIVA do avatar. Substitui o
  // antigo /v2/online/text_to_speech.stream que a HeyGen aposentou (410 Gone).
  // Ver [[project_heygen_tts_410]].
  onProgress?.('submitting', { msg: 'Gerando por texto (TTS nativo do avatar)...' });
  // Retry CONSERVADOR no submit: so re-tenta em erro transitorio (429/5xx/timeout
  // do proxy) — NUNCA num 4xx de validacao. Submit nao e 100% idempotente (um
  // timeout pode ter criado o video do lado do servidor), mas em modo unlimited
  // uma duplicata so ocupa historico e nunca e pollada/baixada — trade-off
  // aceitavel vs. deixar a parte "faltando texto" na montagem.
  const created = await withRetry(
    () => createVideoWithText({
      title: job.title,
      avatarId: job.avatarId,
      engine: job.engine,
      text: job.text!, // guard `if (!job.text) throw` acima garante; narrowing some no closure
      voiceId: voiceId!,
      orientation: job.orientation,
      resolution: job.resolution,
      motionPrompt: job.motionPrompt,
    }),
    { tries: 3, baseDelayMs: 1200, label: `submit ${job.title}` },
  );

  if (job.title && job.title !== 'Avatar Video') {
    onProgress?.('renaming', { videoId: created.video_id });
    try {
      await jsonCall('POST', '/v1/pacific/video.update', {
        id: created.video_id,
        params: { title: job.title },
      });
    } catch {}
  }
  onProgress?.('done', { videoId: created.video_id });
  return { videoId: created.video_id, avatarId: created.avatar_id };
}
