/**
 * lib/vmake-api.ts — cliente server-to-server da API PRIVADA do vmake.ai
 * (Vmake Labs / Meitu), usado pra rodar a REMOÇÃO DE LEGENDA/MARCA D'ÁGUA
 * "Smart" na conta paga do admin, sem extensão, sem instalador.
 *
 * Mesmo modelo do lipsync (lib/dreamface-api.ts): o cliente final NUNCA
 * fala com o vmake — é tudo server-side, por 1 token + headers idênticos
 * ao browser logado. O motor (vmake) fica escondido do cliente.
 *
 * Engenharia reversa do app web (Next.js SPA, wapi.vmake.ai). Auth é por
 * header `Access-Token` (NÃO Authorization: Bearer) + `X-Gid` (device id).
 * Sucesso = meta.code === 0.
 *
 * ───────────────────────── PIPELINE (verificado) ─────────────────────────
 *  1. Assinatura de upload:
 *       POST /uploader/sign.json
 *         {count:1, suffix, tool_type:"watermark-remover", source:"", client_os:"Windows"}
 *       → { access_token, params:{app,type,count,sig,sigTime,sigVersion,suffix} }
 *  2. Política de upload (credenciais OSS temporárias — STS):
 *       GET https://strategy.stariidata.com/upload/policy?{params}  (header access-token)
 *       → [{ order:["oss"], oss:{ credentials:{access_key,secret_key,session_token},
 *            bucket, url, backup_url, region, key, data } }]
 *  3. Upload do arquivo pro OSS (S3-compatível, AWS SigV4 + STS token):
 *       PUT {bucket}.{host de oss.url}/{oss.key}   (bytes do vídeo)
 *       → o vídeo fica em oss.data (URL pública no CDN do vmake)
 *  4. Submeter a remoção (o SERVIDOR gera o record_id — NÃO mandar record_id!):
 *       POST /vm/tool/purchase.json
 *         {tool_type:"watermark-remover", url:oss.data, title, effect_model,
 *          support_h_265:1, client_os:"Windows"}
 *       → { record_id, task_id }
 *  5. Poll até concluir:
 *       POST /vm/tool/query.json  {record_id:[record_id], client_os:"Windows"}
 *       → response.list[0].purchased_list[]/trial_list[] → item com effect_model:
 *            status: 1 = processando, 2 = pronto, <0 = falhou
 *            download_url = MP4 final (legenda removida)
 *
 * effect_model (modo): Smart = "video_remove_full" (auto: legenda + marca).
 *   Também: legenda = "video_remove_subtitle", marca = "video_remove_watermark".
 *
 * ───────────────────────── ANTI-BLOQUEIO ─────────────────────────
 *  - 100% server-to-server: o IP do cliente final nunca chega no vmake.
 *  - Vercel rotaciona IP → defina VMAKE_PROXY_URL (IP fixo) p/ produção.
 *  - Fila serial (lib/vmake-queue.ts) dá ritmo humano por instância.
 */

import { createHash, createHmac } from 'crypto';

// ───────────────────────────── Config ─────────────────────────────

const BASE = 'https://wapi.vmake.ai';
const POLICY_BASE = 'https://strategy.stariidata.com';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const TOOL_TYPE = 'watermark-remover';
const CLIENT_OS = 'Windows';

/** Modos de remoção → effect_model do vmake. Default = Smart. */
export const VMAKE_EFFECT = {
  smart: 'video_remove_full',
  subtitle: 'video_remove_subtitle',
  watermark: 'video_remove_watermark',
} as const;
export type VmakeMode = keyof typeof VMAKE_EFFECT;

export class VmakeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'VmakeError';
    this.code = code;
  }
}

type VmakeConfig = {
  accessToken: string;
  gid: string;
  timezone: string;
};

function cfg(): VmakeConfig {
  const accessToken = process.env.VMAKE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new VmakeError(
      'config_missing',
      'vmake não configurado no servidor. Defina VMAKE_ACCESS_TOKEN (e VMAKE_GID).',
    );
  }
  return {
    accessToken,
    // X-Gid é só tracking/analytics do Meitu — NÃO é validado (testado: gid
    // vazio/aleatório passa code:0). Default genérico; VMAKE_GID é opcional.
    gid: process.env.VMAKE_GID?.trim() || 'autoedit-0000000000000-0000000000000',
    timezone: process.env.VMAKE_TIMEZONE?.trim() || 'GMT+00:00',
  };
}

export function isVmakeConfigured(): boolean {
  return Boolean(process.env.VMAKE_ACCESS_TOKEN);
}

// ──────────────────────── Proxy (IP fixo) ─────────────────────────

let _dispatcherPromise: Promise<unknown> | null = null;
async function getDispatcher(): Promise<unknown> {
  const url = process.env.VMAKE_PROXY_URL?.trim();
  if (!url) return undefined;
  if (!_dispatcherPromise) {
    _dispatcherPromise = (async () => {
      try {
        const { ProxyAgent } = await import('undici');
        return new ProxyAgent(url);
      } catch (e) {
        console.error('[vmake] falha ao iniciar proxy, caindo pra fetch direto:', e);
        return undefined;
      }
    })();
  }
  return _dispatcherPromise;
}

async function rawFetch(
  url: string,
  init: RequestInit & { dispatcher?: unknown } = {},
): Promise<Response> {
  const dispatcher = await getDispatcher();
  if (dispatcher) {
    const { fetch: undiciFetch } = await import('undici');
    const opts = { ...(init as Record<string, unknown>), dispatcher } as unknown;
    return undiciFetch(
      url as string,
      opts as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>;
  }
  return fetch(url, { ...init, cache: 'no-store' });
}

function apiHeaders(c: VmakeConfig): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'content-type': 'application/json',
    origin: 'https://vmake.ai',
    referer: 'https://vmake.ai/',
    'user-agent': UA,
    'access-token': c.accessToken,
    'x-gid': c.gid,
    'x-client-timezone': c.timezone,
  };
}

// ─────────────────────── Envelope helpers ─────────────────────────

type Envelope<T = unknown> = {
  meta?: { code?: number; msg?: string; error?: string };
  response?: T;
};

function checkOk<T>(json: Envelope<T>, path: string): T {
  const code = json.meta?.code;
  if (code === 0) return json.response as T;
  const msg = (json.meta?.msg || json.meta?.error || '').toString();
  // 10022 = login validation failed → token expirou.
  if (code === 10022 || /login|token|expire|unauthor/i.test(msg)) {
    throw new VmakeError('auth', `Sessão vmake expirada/sem permissão (${path}): ${msg}`);
  }
  throw new VmakeError('api_error', `vmake erro em ${path}: code=${code} ${msg}`);
}

async function safeJson<T>(res: Response, path: string): Promise<Envelope<T>> {
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new VmakeError('auth', `Sessão vmake expirada (${path}, HTTP ${res.status}).`);
  }
  try {
    return JSON.parse(text) as Envelope<T>;
  } catch {
    throw new VmakeError('bad_response', `Resposta não-JSON de ${path} (HTTP ${res.status}).`);
  }
}

async function postJson<T = unknown>(
  c: VmakeConfig,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await rawFetch(BASE + path, {
    method: 'POST',
    headers: apiHeaders(c),
    body: JSON.stringify(body),
  });
  return checkOk(await safeJson<T>(res, path), path);
}

// ───────────────────────────── Tipos ─────────────────────────────

type SignParams = {
  app: string;
  type: string;
  count: number;
  sig: string;
  sigTime: number;
  sigVersion: string;
  suffix: string;
};

type OssCredentials = {
  access_key: string;
  secret_key: string;
  session_token: string;
};

type OssPolicy = {
  credentials: OssCredentials;
  bucket: string;
  url: string; // endpoint de upload (ex.: https://upload.stariidata.com)
  backup_url?: string;
  region: string;
  key: string; // caminho do objeto no bucket
  data: string; // URL pública final do vídeo
  use_virtual_host?: boolean;
};

// ───────────────────── Passos do pipeline ─────────────────────

/** 1. Pede a assinatura de upload. */
async function signUpload(c: VmakeConfig, suffix: string): Promise<{ accessToken: string; params: SignParams }> {
  const r = await postJson<{ access_token: string; params: SignParams }>(
    c,
    '/uploader/sign.json',
    { count: 1, suffix, tool_type: TOOL_TYPE, source: '', client_os: CLIENT_OS },
  );
  if (!r?.access_token || !r?.params) {
    throw new VmakeError('upload_init_failed', 'vmake não retornou a assinatura de upload.');
  }
  return { accessToken: r.access_token, params: r.params };
}

/** 2. Pega a política/credenciais OSS (STS) pro upload. */
async function getPolicy(
  c: VmakeConfig,
  signAccessToken: string,
  params: SignParams,
): Promise<OssPolicy> {
  const qs = new URLSearchParams({
    app: params.app,
    count: String(params.count),
    sig: params.sig,
    sigTime: String(params.sigTime),
    sigVersion: params.sigVersion,
    suffix: params.suffix,
    type: params.type,
  });
  const res = await rawFetch(`${POLICY_BASE}/upload/policy?${qs.toString()}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': UA,
      origin: 'https://vmake.ai',
      referer: 'https://vmake.ai/',
      'access-token': signAccessToken,
    },
  });
  const text = await res.text();
  let arr: Array<{ order?: string[]; oss?: OssPolicy }>;
  try {
    arr = JSON.parse(text);
  } catch {
    throw new VmakeError('upload_init_failed', `Política de upload inválida (HTTP ${res.status}).`);
  }
  const oss = Array.isArray(arr) ? arr.find((x) => x?.oss)?.oss : undefined;
  if (!oss?.credentials || !oss.bucket || !oss.key || !oss.data) {
    throw new VmakeError('upload_init_failed', 'vmake não retornou credenciais de upload (OSS).');
  }
  return oss;
}

// ── AWS SigV4 (PutObject) — o OSS do vmake é S3-compatível com STS ──

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** 3. Sobe os bytes pro OSS via PUT assinado (SigV4 + session token). */
async function uploadToOss(oss: OssPolicy, body: Buffer, contentType: string): Promise<string> {
  const endpoint = new URL(oss.url); // ex.: https://upload.stariidata.com
  // virtual-host: {bucket}.{host}
  const host = `${oss.bucket}.${endpoint.host}`;
  const canonicalUri =
    '/' + oss.key.split('/').map((s) => encodeURIComponent(s)).join('/');
  const region = oss.region || 'ap-southeast-1';
  const service = 's3';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headersToSign: Record<string, string> = {
    'content-type': contentType,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'x-amz-security-token': oss.credentials.session_token,
  };
  const signedHeaders = Object.keys(headersToSign).sort().join(';');
  const canonicalHeaders =
    Object.keys(headersToSign)
      .sort()
      .map((k) => `${k}:${headersToSign[k]}\n`)
      .join('');

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '', // query string vazia
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + oss.credentials.secret_key, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${oss.credentials.access_key}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const putUrl = `${endpoint.protocol}//${host}${canonicalUri}`;
  const res = await rawFetch(putUrl, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amz-security-token': oss.credentials.session_token,
      authorization,
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new VmakeError('upload_failed', `Falha ao subir o vídeo pro vmake (HTTP ${res.status}). ${t.slice(0, 160)}`);
  }
  return oss.data;
}

/** 4. Submete a remoção. O SERVIDOR gera o record_id (NÃO mandar!). */
async function submitRemoval(
  c: VmakeConfig,
  sourceUrl: string,
  effectModel: string,
  title: string,
): Promise<{ recordId: string; taskId: string }> {
  const r = await postJson<{ record_id?: string; task_id?: string }>(c, '/vm/tool/purchase.json', {
    tool_type: TOOL_TYPE,
    url: sourceUrl,
    title: title.slice(0, 120),
    effect_model: effectModel,
    support_h_265: 1,
    client_os: CLIENT_OS,
  });
  if (!r?.record_id || !r?.task_id) {
    throw new VmakeError('submit_failed', 'vmake não retornou record_id/task_id no submit.');
  }
  return { recordId: r.record_id, taskId: r.task_id };
}

type QueryTask = {
  effect_model?: string;
  task_id?: string;
  status?: number; // 1 = processando, 2 = pronto, <0 = falhou
  process?: number;
  download_url?: string;
  result?: string;
};
type QueryRecord = {
  record_id?: string;
  trial_list?: QueryTask[];
  purchased_list?: QueryTask[];
};

/** 5. Poll até concluir. Retorna a URL do MP4 final (legenda removida). */
async function pollUntilDone(
  c: VmakeConfig,
  recordId: string,
  effectModel: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 280_000;
  const baseInterval = opts.intervalMs ?? 4000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const r = await postJson<{ list?: QueryRecord[] }>(c, '/vm/tool/query.json', {
      record_id: [recordId],
      client_os: CLIENT_OS,
    });
    const rec = r?.list?.find((x) => x.record_id === recordId) ?? r?.list?.[0];
    const tasks = [...(rec?.purchased_list ?? []), ...(rec?.trial_list ?? [])];
    const task =
      tasks.find((t) => t.effect_model === effectModel) ?? tasks[0];
    if (task) {
      if (task.status === 2) {
        const url = task.download_url || task.result;
        if (url) return url;
      } else if (typeof task.status === 'number' && task.status < 0) {
        throw new VmakeError(
          'generation_failed',
          'O vmake falhou ao processar (vídeo inválido ou sem legenda detectável).',
        );
      }
    }
    await sleep(baseInterval + Math.floor(Math.random() * 600));
  }
  throw new VmakeError('timeout', 'O vmake demorou demais pra processar (timeout).');
}

// ───────────────────── Orquestrador de alto nível ─────────────────────

export type RemoveSubtitleInput = {
  videoBuffer: Buffer | Uint8Array;
  videoName?: string;
  videoType?: string;
  mode?: VmakeMode; // default: 'smart'
};

export type RemoveSubtitleResult = {
  url: string; // MP4 final (legenda removida), no CDN do vmake
  recordId: string;
  taskId: string;
};

/**
 * Roda o pipeline completo: assina → política → upload → submete →
 * poll → resolve o MP4 final. Tudo server-side, por 1 token (proxy opcional).
 */
export async function removeSubtitle(input: RemoveSubtitleInput): Promise<RemoveSubtitleResult> {
  const c = cfg();
  const name = input.videoName || 'video.mp4';
  const suffix = (name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const effectModel = VMAKE_EFFECT[input.mode || 'smart'];

  // 1+2: assinatura + política OSS
  const { accessToken: signToken, params } = await signUpload(c, suffix);
  const oss = await getPolicy(c, signToken, params);

  // 3: upload do vídeo pro OSS
  const buf = Buffer.isBuffer(input.videoBuffer)
    ? input.videoBuffer
    : Buffer.from(input.videoBuffer);
  const sourceUrl = await uploadToOss(oss, buf, input.videoType || 'video/mp4');

  // 4: submete a remoção (server gera record_id)
  const { recordId, taskId } = await submitRemoval(c, sourceUrl, effectModel, name);

  // 5: poll até o MP4 final
  const url = await pollUntilDone(c, recordId, effectModel);
  return { url, recordId, taskId };
}

// ───────────────────────────── Health ─────────────────────────────

/** Checa se o Access-Token está válido (chama task_list — read-only). */
export async function checkHealth(): Promise<{ ok: boolean; reason?: string }> {
  if (!isVmakeConfigured()) return { ok: false, reason: 'config_missing' };
  try {
    const c = cfg();
    const qs = new URLSearchParams({
      tool_type: TOOL_TYPE,
      page_size: '1',
      cursor: '',
      client_os: CLIENT_OS,
    });
    const res = await rawFetch(`${BASE}/vm/tool/task_list.json?${qs.toString()}`, {
      headers: apiHeaders(c),
    });
    const json = await safeJson(res, '/vm/tool/task_list.json');
    if (json.meta?.code !== 0) return { ok: false, reason: String(json.meta?.code) };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof VmakeError ? e.code : 'unknown' };
  }
}

// ───────────────────────────── util ─────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Mensagem que vai pro CLIENTE — NUNCA cita o motor (vmake) nem endpoints.
 * (Requisito: o cliente não sabe qual motor está por trás.) O detalhe cru
 * fica só no log do servidor.
 */
const CLIENT_MSG: Record<string, string> = {
  config_missing: 'A remoção está indisponível no momento. Tente mais tarde.',
  auth: 'A remoção está temporariamente indisponível. Tenta de novo em instantes.',
  generation_failed: 'Não consegui limpar esse vídeo. Confirma que tem legenda/marca queimada e tenta de novo.',
  timeout: 'A remoção demorou demais. Tenta de novo em instantes.',
  upload_failed: 'Falha ao enviar o vídeo. Tenta de novo.',
  upload_init_failed: 'Falha ao iniciar o envio. Tenta de novo.',
  submit_failed: 'Não consegui iniciar a remoção agora. Tenta de novo em instantes.',
  api_error: 'O serviço recusou a solicitação agora. Tenta de novo em instantes.',
  bad_response: 'A remoção instabilizou. Tenta de novo.',
  internal: 'Algo deu errado na remoção. Tenta de novo.',
};

const HTTP_STATUS: Record<string, number> = {
  config_missing: 500,
  auth: 502,
  generation_failed: 422,
  timeout: 504,
  upload_failed: 502,
  upload_init_failed: 502,
  submit_failed: 502,
  api_error: 502,
  bad_response: 502,
};

export function vmakeErrorToHttp(
  e: unknown,
): { status: number; message: string; code: string; detail: string } {
  if (e instanceof VmakeError) {
    return {
      status: HTTP_STATUS[e.code] ?? 500,
      message: CLIENT_MSG[e.code] ?? CLIENT_MSG.internal,
      code: e.code,
      detail: e.message,
    };
  }
  const detail = e instanceof Error ? e.message : String(e);
  return { status: 500, message: CLIENT_MSG.internal, code: 'internal', detail };
}
