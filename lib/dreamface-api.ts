/**
 * lib/dreamface-api.ts — cliente server-to-server da API PRIVADA do
 * DreamFace web (www.dreamfaceapp.com), usado pra rodar lipsync
 * "ilimitado" na conta paga (consumer), sem extensão, sem créditos.
 *
 * Engenharia reversa do app web (Nuxt SPA). Auth é SÓ por cookie de
 * sessão (httpOnly) — nada de Bearer. Sucesso = status_code
 * "THS12140000000".
 *
 * ───────────────────────── PIPELINE (verificado) ─────────────────────────
 *  1. Upload do VÍDEO (rosto):
 *       POST /dw-server/oss/put_url  {user_id,file_name,content_type,dir:"WEB_ANIMATE_MATERIAL"}
 *         → { put_url (aliyun presigned), file_url (uss3), content_type }
 *       PUT <put_url>  (bytes crus + Content-Type)
 *  2. Registrar AVATAR custom a partir do vídeo:
 *       POST /df-server/avatar/add  (FormData {user_id,account_id,url:file_url,type:"VIDEO",support_multi_face:"false"})
 *       POST /df-server/avatar/list → acha o registro com path === file_url
 *         → { id (avatar_id), cover_path, width, height, face_count }
 *  3. Upload do ÁUDIO (fala alvo):
 *       POST /dw-server/phone_file/upload_audio_with_dir (FormData {file,userId,ossDir:"AVATAR_AUDIO"})
 *         → { file_path (uss3 mp3) }
 *  4. Submeter o job:
 *       POST /dw-server/task/v2/submit  {body completo}
 *         → { animate_image_id (uuid) }
 *  5. Poll de conclusão (mapeia animate_image_id → work completo):
 *       POST /dw-server/work/v2/get_recent_creation_list {user_id,account_id,page,size,is_web:true,app_version}
 *         → data.list[] onde item.animate_id === animate_image_id
 *            web_work_status: 200 = pronto, -1 = falhou, senão processando
 *  6. Resolver o MP4 final:
 *       GET /dw-server/work/get_work_detail_web?work_id=<work id completo>
 *         → { work_url / nw_work_url } = MP4 final (OSS aliyun, baixável)
 *
 * ───────────────────────── ANTI-BLOQUEIO ─────────────────────────
 *  - É 100% server-to-server: o IP do usuário final NUNCA chega no
 *    DreamFace. O DreamFace só vê o IP do servidor + 1 cookie + headers
 *    idênticos ao browser logado. 10 usuários em 10 IPs = ainda 1 cliente.
 *  - Vercel rotaciona IP de egress → defina DREAMFACE_PROXY_URL apontando
 *    pra UM proxy de IP fixo. Todas as chamadas saem por esse IP único.
 *  - A fila serial (lib/dreamface-queue.ts) garante ritmo humano.
 */

// ───────────────────────────── Config ─────────────────────────────

const BASE = 'https://www.dreamfaceapp.com';

// Chrome real (bate com o sec-ch-ua abaixo). Mantém igual ao browser logado.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const SUCCESS = 'THS12140000000';

export type DreamFaceConfig = {
  accountId: string;
  userId: string;
  appVersion: string;
  templateId: string;
  /** OPCIONAIS — o pipeline autoriza pelo account_id/user_id no corpo. */
  cookie?: string;
  token?: string;
};

export class DreamFaceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DreamFaceError';
    this.code = code;
  }
}

function cfg(): DreamFaceConfig {
  const accountId = process.env.DREAMFACE_ACCOUNT_ID?.trim();
  const userId = process.env.DREAMFACE_USER_ID?.trim();
  if (!accountId || !userId) {
    throw new DreamFaceError(
      'config_missing',
      'DreamFace não configurado no servidor. Defina DREAMFACE_ACCOUNT_ID e DREAMFACE_USER_ID.',
    );
  }
  // Cookie/token são OPCIONAIS: VERIFICADO que os endpoints do pipeline
  // autorizam SÓ pelo account_id/user_id no corpo (credentials:'omit'
  // retorna 200/THS). Sem cookie = sem expiração, durável pra sempre.
  // Mandamos cookie/token só se existirem (defesa extra / future-proof).
  const cookie = process.env.DREAMFACE_COOKIE?.replace(/^\s*cookie:\s*/i, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return {
    accountId,
    userId,
    appVersion: process.env.DREAMFACE_APP_VERSION?.trim() || '4.7.1',
    templateId: process.env.DREAMFACE_TEMPLATE_ID?.trim() || '6606889f54e4e700070db4b1',
    cookie: cookie || undefined,
    token: process.env.DREAMFACE_TOKEN?.trim() || undefined,
  };
}

export function isDreamFaceConfigured(): boolean {
  return Boolean(process.env.DREAMFACE_ACCOUNT_ID && process.env.DREAMFACE_USER_ID);
}

// ──────────────────────── Proxy (IP fixo) ─────────────────────────
// Vercel rotaciona IP de egress. Pra não tomar bloqueio com 1 cookie
// vindo de N IPs, roteamos TODAS as chamadas por 1 proxy de IP fixo.

let _dispatcherPromise: Promise<unknown> | null = null;
async function getDispatcher(): Promise<unknown> {
  const url = process.env.DREAMFACE_PROXY_URL?.trim();
  if (!url) return undefined;
  if (!_dispatcherPromise) {
    _dispatcherPromise = (async () => {
      try {
        const { ProxyAgent } = await import('undici');
        return new ProxyAgent(url);
      } catch (e) {
        console.error('[dreamface] falha ao iniciar proxy, caindo pra fetch direto:', e);
        return undefined;
      }
    })();
  }
  return _dispatcherPromise;
}

/** fetch que aplica o proxy (quando DREAMFACE_PROXY_URL setado). */
async function rawFetch(url: string, init: RequestInit & { dispatcher?: unknown } = {}): Promise<Response> {
  const dispatcher = await getDispatcher();
  if (dispatcher) {
    const { fetch: undiciFetch } = await import('undici');
    // undici fetch é spec-compatível (.ok/.status/.json/.text). O option
    // `dispatcher` é específico do undici — cast pra any só nesse ponto.
    const opts = { ...(init as Record<string, unknown>), dispatcher } as unknown;
    return undiciFetch(url as string, opts as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  }
  return fetch(url, { ...init, cache: 'no-store' });
}

function browserHeaders(c: DreamFaceConfig): Record<string, string> {
  const h: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    origin: BASE,
    referer: `${BASE}/`,
    'user-agent': UA,
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not(A:Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  if (c.cookie) h.cookie = c.cookie;
  if (c.token) h.token = c.token;
  return h;
}

// ─────────────────────── HTTP helpers (DreamFace) ─────────────────────

type DFResponse<T = unknown> = { status_code?: string; data?: T; message?: string };

function checkAuthOrThrow(res: Response, json: DFResponse, path: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new DreamFaceError('auth', 'Sessão DreamFace expirada/sem permissão — atualize o DREAMFACE_COOKIE.');
  }
  if (json.status_code && json.status_code !== SUCCESS) {
    const blob = JSON.stringify(json).slice(0, 240).toLowerCase();
    if (/login|auth|token|expire|sign in|unauthorized/.test(blob)) {
      throw new DreamFaceError('auth', 'Sessão DreamFace expirada — atualize o DREAMFACE_COOKIE.');
    }
    throw new DreamFaceError('api_error', `DreamFace erro em ${path}: ${json.status_code}`);
  }
}

async function dfPostJson<T = unknown>(c: DreamFaceConfig, path: string, body: unknown): Promise<DFResponse<T>> {
  const res = await rawFetch(BASE + path, {
    method: 'POST',
    headers: { ...browserHeaders(c), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await safeJson(res, path)) as DFResponse<T>;
  checkAuthOrThrow(res, json, path);
  return json;
}

async function dfPostForm<T = unknown>(c: DreamFaceConfig, path: string, form: FormData): Promise<DFResponse<T>> {
  const res = await rawFetch(BASE + path, {
    method: 'POST',
    headers: browserHeaders(c), // NÃO setar content-type: o boundary é automático
    body: form as unknown as BodyInit,
  });
  const json = (await safeJson(res, path)) as DFResponse<T>;
  checkAuthOrThrow(res, json, path);
  return json;
}

async function dfGet<T = unknown>(c: DreamFaceConfig, path: string): Promise<DFResponse<T>> {
  const res = await rawFetch(BASE + path, { headers: browserHeaders(c) });
  const json = (await safeJson(res, path)) as DFResponse<T>;
  checkAuthOrThrow(res, json, path);
  return json;
}

async function safeJson(res: Response, path: string): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 401 || res.status === 403 || /login|sign in/i.test(text.slice(0, 200))) {
      throw new DreamFaceError('auth', 'Sessão DreamFace expirada — atualize o DREAMFACE_COOKIE.');
    }
    throw new DreamFaceError('bad_response', `Resposta não-JSON de ${path} (HTTP ${res.status}).`);
  }
}

// ───────────────────────────── Tipos ─────────────────────────────

export type DreamFaceAvatar = {
  id: string;
  path: string;
  coverPath: string;
  width: number;
  height: number;
  faceCount: number;
  isDefault: boolean;
};

export type LipsyncStage =
  | 'uploading-video'
  | 'uploading-audio'
  | 'registering'
  | 'submitting'
  | 'generating'
  | 'resolving';

// ───────────────────── Passos individuais ─────────────────────

/** 1a. Pega URL presigned + URL final pro upload de vídeo. */
async function ossPutUrl(
  c: DreamFaceConfig,
  fileName: string,
  contentType: string,
): Promise<{ putUrl: string; fileUrl: string; contentType: string }> {
  const j = await dfPostJson<{ put_url: string; file_url: string; content_type: string }>(
    c,
    '/dw-server/oss/put_url',
    { user_id: c.userId, file_name: fileName, content_type: contentType, dir: 'WEB_ANIMATE_MATERIAL' },
  );
  const d = j.data;
  if (!d?.put_url || !d?.file_url) {
    throw new DreamFaceError('upload_init_failed', 'DreamFace não retornou URL de upload do vídeo.');
  }
  return { putUrl: d.put_url, fileUrl: d.file_url, contentType: d.content_type || contentType };
}

/** 2a. Registra o vídeo já enviado como avatar custom. */
async function avatarAdd(c: DreamFaceConfig, fileUrl: string): Promise<void> {
  const form = new FormData();
  form.append('user_id', c.userId);
  form.append('account_id', c.accountId);
  form.append('url', fileUrl);
  form.append('type', 'VIDEO');
  form.append('support_multi_face', 'false');
  await dfPostForm(c, '/df-server/avatar/add', form);
}

type RawAvatar = {
  id: string;
  path?: string;
  cover_path?: string;
  width?: number;
  height?: number;
  face_count?: number;
  is_default?: boolean;
};

/** 2b. Lê a lista de avatares e acha o registrado pelo path. */
async function findAvatarByPath(
  c: DreamFaceConfig,
  fileUrl: string,
  opts: { tries: number; delayMs: number },
): Promise<DreamFaceAvatar | null> {
  for (let i = 0; i < opts.tries; i++) {
    const j = await dfPostJson<RawAvatar[] | { list?: RawAvatar[] }>(c, '/df-server/avatar/list', {
      account_id: c.accountId,
      user_id: c.userId,
      app_version: c.appVersion,
    });
    const arr: RawAvatar[] = Array.isArray(j.data) ? j.data : (j.data?.list ?? []);
    const found = arr.find((a) => a.path === fileUrl);
    if (found) {
      return {
        id: found.id,
        path: found.path || fileUrl,
        coverPath: found.cover_path || '',
        width: found.width || 1080,
        height: found.height || 1080,
        faceCount: found.face_count ?? 0,
        isDefault: Boolean(found.is_default),
      };
    }
    if (i < opts.tries - 1) await sleep(opts.delayMs);
  }
  return null;
}

/** 1+2. Faz upload do vídeo e registra como avatar custom. */
export async function uploadAndRegisterAvatar(
  c: DreamFaceConfig,
  videoBuffer: Buffer | Uint8Array,
  fileName = 'face.mp4',
  contentType = 'video/mp4',
  onStage?: (s: LipsyncStage) => void,
): Promise<DreamFaceAvatar> {
  onStage?.('uploading-video');
  const { putUrl, fileUrl, contentType: ct } = await ossPutUrl(c, fileName, contentType);

  // x-oss-storage-class:Standard FAZ PARTE da assinatura presigned do
  // DreamFace — sem esse header o aliyun retorna SignatureDoesNotMatch (403).
  const putRes = await rawFetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': ct, 'x-oss-storage-class': 'Standard' },
    body: videoBuffer as unknown as BodyInit,
  });
  if (!putRes.ok) {
    throw new DreamFaceError('upload_failed', `Falha no upload do vídeo pro DreamFace (HTTP ${putRes.status}).`);
  }

  onStage?.('registering');
  await avatarAdd(c, fileUrl);

  const avatar = await findAvatarByPath(c, fileUrl, { tries: 15, delayMs: 1000 });
  if (!avatar) {
    throw new DreamFaceError('avatar_register_failed', 'Falha ao registrar o avatar (vídeo não apareceu na lista).');
  }
  return avatar;
}

/** 3. Upload do áudio alvo. Retorna a URL uss3. */
export async function uploadAudio(
  c: DreamFaceConfig,
  audioBuffer: Buffer | Uint8Array,
  fileName = 'voice.mp3',
  contentType = 'audio/mpeg',
  onStage?: (s: LipsyncStage) => void,
): Promise<string> {
  onStage?.('uploading-audio');
  const form = new FormData();
  form.append('file', new Blob([audioBuffer as unknown as BlobPart], { type: contentType }), fileName);
  form.append('userId', c.userId);
  form.append('ossDir', 'AVATAR_AUDIO');
  const j = await dfPostForm<{ file_path?: string }>(c, '/dw-server/phone_file/upload_audio_with_dir', form);
  const filePath = j.data?.file_path;
  if (!filePath) throw new DreamFaceError('audio_upload_failed', 'DreamFace não retornou URL do áudio.');
  return filePath;
}

/** 4. Submete o job de lipsync. Retorna animate_image_id. */
export async function submitLipsync(
  c: DreamFaceConfig,
  args: { avatar: DreamFaceAvatar; audioUrl: string; audioMs: number; videoName?: string; audioName?: string },
): Promise<string> {
  const { avatar, audioUrl, audioMs } = args;
  const durationSec = Math.max(1, Math.ceil(audioMs / 1000));
  const body = {
    media: {
      images: [],
      videos: [{ url: avatar.path }],
      texts: [],
      audios: [{ url: audioUrl, audio_start_time: 0, audio_end_time: Math.round(audioMs) }],
    },
    user: {
      account_id: c.accountId,
      app_version: c.appVersion,
      platform_type: 'WEB',
      user_id: c.userId,
    },
    template: { template_id: c.templateId, play_types: ['VIDEO', 'PT'], project_id: '' },
    output: {
      width: avatar.width,
      height: avatar.height,
      ratio: '',
      duration: durationSec,
      resolution: '720',
      vertical: avatar.height >= avatar.width,
    },
    ext_info: {
      sing_title: args.audioName || 'audio',
      is_sound_effect: true,
      animate_channel: 'dynamic',
      route_url: '',
      timbre_id: '',
      cover: avatar.coverPath,
      video_id: '',
      genders: [],
      avatar_id: avatar.id,
      is_default_avatar: avatar.isDefault,
    },
    work_type: 'AVATAR_VIDEO',
    create_work_session: false,
    asset_info: { asset_id: '', original_video_url: avatar.path, file_name: args.videoName || 'face.mp4' },
  };
  // RETRY no submit: erros transitórios do motor (risk-control/throttle —
  // ex.: THS12150000003, que aparece quando vários submits chegam juntos) NÃO
  // são falha definitiva. Re-tenta 3× com backoff + jitter (ritmo humano).
  // Erros definitivos (auth, etc) propagam na hora.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const j = await dfPostJson<{ animate_image_id?: string }>(c, '/dw-server/task/v2/submit', body);
      const animateId = j.data?.animate_image_id;
      if (!animateId) throw new DreamFaceError('submit_failed', 'DreamFace não retornou animate_image_id no submit.');
      return animateId;
    } catch (e) {
      lastErr = e;
      const transient =
        e instanceof DreamFaceError && (e.code === 'api_error' || e.code === 'submit_failed' || e.code === 'bad_response');
      if (!transient || attempt === 2) throw e;
      await sleep(2500 * (attempt + 1) + Math.floor(Math.random() * 1200)); // ~2.5s, ~5s
    }
  }
  throw lastErr;
}

type RawWorkItem = { id: string; animate_id?: string; web_work_status?: number; work_name?: string };

/**
 * 5. Poll até concluir. Mapeia animate_image_id → work completo via
 * get_recent_creation_list (is_web:true). Retorna o work id completo.
 */
export async function pollUntilDone(
  c: DreamFaceConfig,
  animateId: string,
  opts: { timeoutMs?: number; intervalMs?: number; onStage?: (s: LipsyncStage) => void } = {},
): Promise<{ workId: string }> {
  const timeoutMs = opts.timeoutMs ?? 250_000; // ~4,2 min (margem sob o teto 300s da função)
  const baseInterval = opts.intervalMs ?? 2500;
  const started = Date.now();
  opts.onStage?.('generating');

  while (Date.now() - started < timeoutMs) {
    const j = await dfPostJson<{ list?: RawWorkItem[] }>(c, '/dw-server/work/v2/get_recent_creation_list', {
      user_id: c.userId,
      account_id: c.accountId,
      page: 1,
      size: 30,
      is_web: true,
      app_version: c.appVersion,
    });
    const list = j.data?.list ?? [];
    const item = list.find((w) => w.animate_id === animateId);
    if (item) {
      if (item.web_work_status === 200) return { workId: item.id };
      if (item.web_work_status === -1) {
        throw new DreamFaceError(
          'generation_failed',
          'O DreamFace falhou ao gerar (rosto não detectado, vídeo curto/ruim ou áudio inválido). Tente outro vídeo com rosto frontal nítido.',
        );
      }
    }
    // jitter leve (ritmo humano + não martelar)
    await sleep(baseInterval + Math.floor(Math.random() * 700));
  }
  throw new DreamFaceError('timeout', 'O DreamFace demorou demais pra gerar (timeout). Tente de novo.');
}

/** 6. Resolve a URL do MP4 final a partir do work id completo. */
export async function resolveMp4(c: DreamFaceConfig, workId: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const j = await dfGet<{ work_url?: string; nw_work_url?: string }>(
      c,
      `/dw-server/work/get_work_detail_web?work_id=${encodeURIComponent(workId)}`,
    );
    const url = j.data?.work_url || j.data?.nw_work_url;
    if (url) return url;
    await sleep(1200);
  }
  throw new DreamFaceError('no_output_url', 'O job concluiu mas o DreamFace não devolveu a URL do MP4.');
}

// ───────────────────── Orquestrador de alto nível ─────────────────────

export type GenerateLipsyncInput = {
  videoBuffer: Buffer | Uint8Array;
  videoName?: string;
  videoType?: string;
  audioBuffer: Buffer | Uint8Array;
  audioName?: string;
  audioType?: string;
  audioMs: number;
  onStage?: (s: LipsyncStage) => void;
};

export type GenerateLipsyncResult = {
  url: string;
  workId: string;
  animateId: string;
  avatarId: string;
};

/**
 * Roda o pipeline completo: upload vídeo+áudio EM PARALELO, registra
 * avatar, submete, faz poll e resolve o MP4 final. Tudo server-side,
 * por 1 cookie + 1 IP (proxy).
 */
export async function generateLipsync(input: GenerateLipsyncInput): Promise<GenerateLipsyncResult> {
  const c = cfg();

  // Uploads em paralelo (vídeo+registro || áudio) — máxima velocidade.
  const [avatar, audioUrl] = await Promise.all([
    uploadAndRegisterAvatar(
      c,
      input.videoBuffer,
      input.videoName || 'face.mp4',
      input.videoType || 'video/mp4',
      input.onStage,
    ),
    uploadAudio(c, input.audioBuffer, input.audioName || 'voice.mp3', input.audioType || 'audio/mpeg', input.onStage),
  ]);

  if (avatar.faceCount < 1) {
    throw new DreamFaceError(
      'no_face',
      'Nenhum rosto detectado no vídeo. Use um vídeo com rosto frontal, nítido e bem iluminado.',
    );
  }

  input.onStage?.('submitting');
  const animateId = await submitLipsync(c, {
    avatar,
    audioUrl,
    audioMs: input.audioMs,
    videoName: input.videoName,
    audioName: input.audioName,
  });

  const { workId } = await pollUntilDone(c, animateId, { onStage: input.onStage });

  input.onStage?.('resolving');
  const url = await resolveMp4(c, workId);

  return { url, workId, animateId, avatarId: avatar.id };
}

// ───────────────────────────── Health ─────────────────────────────

/**
 * Checa se o cookie/sessão estão válidos (chama avatar/list).
 * Usado pelo endpoint de status/health admin.
 */
export async function checkHealth(): Promise<{ ok: boolean; reason?: string }> {
  if (!isDreamFaceConfigured()) return { ok: false, reason: 'config_missing' };
  try {
    const c = cfg();
    const j = await dfPostJson(c, '/df-server/avatar/list', {
      account_id: c.accountId,
      user_id: c.userId,
      app_version: c.appVersion,
    });
    if (j.status_code && j.status_code !== SUCCESS) return { ok: false, reason: j.status_code };
    return { ok: true };
  } catch (e) {
    const reason = e instanceof DreamFaceError ? e.code : 'unknown';
    return { ok: false, reason };
  }
}

// ───────────────────────────── util ─────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Mensagem que vai pro CLIENTE — NUNCA cita o motor (DreamFace) nem
 * endpoints/códigos internos. (Requisito: o cliente não pode saber qual
 * motor de lipsync está por trás.) O detalhe cru fica só no log do servidor.
 */
const CLIENT_MSG: Record<string, string> = {
  config_missing: 'A geração está indisponível no momento. Tente mais tarde.',
  auth: 'A geração está temporariamente indisponível. Tenta de novo em instantes.',
  no_face: 'Nenhum rosto detectado no vídeo. Use um rosto frontal, nítido e bem iluminado.',
  generation_failed: 'A geração falhou. Use um vídeo com rosto frontal nítido e um áudio limpo, e tenta de novo.',
  timeout: 'A geração demorou demais. Tenta de novo em instantes.',
  upload_failed: 'Falha ao enviar o arquivo. Tenta de novo.',
  upload_init_failed: 'Falha ao iniciar o envio. Tenta de novo.',
  audio_upload_failed: 'Falha ao enviar o áudio. Tenta de novo.',
  avatar_register_failed: 'Não consegui preparar o rosto. Use um vídeo com rosto frontal nítido.',
  submit_failed: 'Não consegui iniciar a geração agora. Tenta de novo em instantes.',
  no_output_url: 'A geração concluiu mas não retornou o vídeo. Tenta de novo.',
  api_error: 'O serviço de geração recusou a solicitação agora. Tenta de novo em instantes.',
  bad_response: 'A geração instabilizou. Tenta de novo.',
  internal: 'Algo deu errado na geração. Tenta de novo.',
};

const HTTP_STATUS: Record<string, number> = {
  config_missing: 500,
  auth: 502,
  no_face: 422,
  generation_failed: 422,
  timeout: 504,
  upload_failed: 502,
  upload_init_failed: 502,
  audio_upload_failed: 502,
  avatar_register_failed: 502,
  submit_failed: 502,
  no_output_url: 502,
  api_error: 502,
  bad_response: 502,
};

/**
 * Mapeia erro → { status, message (CLIENTE, sem marca), code, detail (LOG) }.
 * `message` é sempre genérica/sem marca; `detail` carrega o texto cru
 * (que pode citar DreamFace/endpoint) APENAS pra log server-side.
 */
export function dreamFaceErrorToHttp(
  e: unknown,
): { status: number; message: string; code: string; detail: string } {
  if (e instanceof DreamFaceError) {
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
