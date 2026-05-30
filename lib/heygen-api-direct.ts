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

/* ============= TTS pra modo TEXTO ============= */

/**
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

export async function createVideo(params: CreateVideoParams): Promise<{ video_id: string; avatar_id: string }> {
  const { title, avatarId, engine, audio, orientation = 'portrait', resolution, motionPrompt, voiceMirroring, voiceId } = params;
  const eng = ENGINES[engine];
  if (!eng) throw new Error(`Motor desconhecido: ${engine}`);

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
  // Voice Mirroring: avatar fala com voz especifica espelhando o audio
  // uploaded (timing/cadencia). HeyGen UI mostra checkbox "Voice
  // Mirroring" no Quick Create. Mandamos as variantes mais provaveis de
  // param name (server ignora as que nao conhece).
  if (voiceMirroring) {
    audio_data.voice_mirroring = true;
    audio_data.enable_voice_mirroring = true;
    audio_data.mirror_voice = true;
  }
  // Voice ID override (user escolheu uma voz especifica pra mirror).
  // HeyGen aceita varias keys — mandamos todas as conhecidas pra robustez.
  if (voiceId) {
    audio_data.voice_id = voiceId;
    audio_data.mirror_voice_id = voiceId;
    audio_data.target_voice_id = voiceId;
  }

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
  if (voiceMirroring) {
    // Tambem no body root, caso HeyGen leia de la
    body.voice_mirroring = true;
    body.enable_voice_mirroring = true;
  }
  if (voiceId) {
    body.voice_id = voiceId;
    body.mirror_voice_id = voiceId;
  }
  const r = await jsonCall('POST', '/v2/avatar/shortcut/submit', body);
  if (!r.ok) {
    throw new Error(r.body?.message || `Falha ao criar video (status ${r.status})`);
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
 * Submete video com TEXTO + VOICE_ID direto, deixando HeyGen fazer TTS
 * server-side. Tenta multiplas shapes de audio_data sequencialmente porque
 * nao temos certeza de qual o /v2/avatar/shortcut/submit interno aceita.
 *
 * Se TODAS falharem, joga erro acumulado pra UI debugar.
 */
export async function createVideoWithText(
  params: CreateVideoWithTextParams,
): Promise<{ video_id: string; avatar_id: string }> {
  const { title, avatarId, engine, text, voiceId, orientation = 'portrait', resolution, motionPrompt } = params;
  const eng = ENGINES[engine];
  if (!eng) throw new Error(`Motor desconhecido: ${engine}`);

  const settings = eng.settings(avatarId);
  if (motionPrompt && eng.supports_motion_prompt) {
    settings.motion_prompt = motionPrompt;
    settings.prompt = motionPrompt;
  }

  // Shapes possiveis pra audio_data em modo texto. Ordem do mais provavel
  // pro menos provavel. Cada uma e tentada ate uma retornar 200.
  const audioDataShapes: Array<Record<string, any>> = [
    // Shape 1: padrao publico V2 do HeyGen (mais provavel)
    { audio_type: 'text', input_text: text, voice_id: voiceId },
    // Shape 2: variante "tts"
    { audio_type: 'tts', input_text: text, voice_id: voiceId },
    // Shape 3: variante com "text" em vez de "input_text"
    { audio_type: 'text', text, voice_id: voiceId },
    // Shape 4: voice nested
    { audio_type: 'text', voice: { input_text: text, voice_id: voiceId } },
    // Shape 5: script
    { audio_type: 'script', input_text: text, voice_id: voiceId },
  ];

  const baseBody = {
    video_title: title || 'Avatar Video',
    video_orientation: orientation,
    resolution: resolution || eng.default_resolution,
    avatar_id: avatarId,
    source_type: eng.source_type,
    fit: 'cover',
    avatar_settings: settings,
    enable_caption: false,
    create_new_avatar: false,
  };

  const errors: string[] = [];
  for (let i = 0; i < audioDataShapes.length; i++) {
    const audio_data = audioDataShapes[i];
    const body = { ...baseBody, audio_data };
    const r = await jsonCall('POST', '/v2/avatar/shortcut/submit', body);
    if (r.ok && r.body?.data?.video_id) {
      console.log(`[DARKO LAB] createVideoWithText shape #${i + 1} OK:`, audio_data);
      return r.body.data;
    }
    const msg = r.body?.message ?? r.body?.msg ?? r.body?._text?.slice(0, 200) ?? '?';
    errors.push(`shape#${i + 1}(${Object.keys(audio_data).join(',')})→${r.status}:${msg}`);
    // Erros de validacao indicam shape errada → tenta proxima.
    // Mas se erro for permissao/quota/avatar invalido, parar.
    const fatalRe = /(permiss|forbidden|quota|credit|avatar.*invalid|avatar.*not.*found|avatar.*exist)/i;
    if (fatalRe.test(String(msg))) {
      throw new Error(`createVideoWithText fatal: ${msg}`);
    }
  }
  throw new Error(`createVideoWithText: nenhuma shape aceita. Tentativas: ${errors.join(' | ')}`);
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

    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Baixa o MP4 de um videoUrl (CDN HeyGen). Tenta direct fetch primeiro;
 * se falhar (CORS), routeia via proxy da extensao (que tem origin certo).
 */
export async function downloadVideoBytes(videoUrl: string): Promise<Uint8Array> {
  try {
    const r = await fetch(videoUrl);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      return new Uint8Array(buf);
    }
  } catch {
    /* cai pro proxy */
  }
  const r = await heygenApiFetch({ url: videoUrl, method: 'GET' });
  if (!r.ok) throw new Error(`Falha download (status ${r.status}): ${r.body?.message || r.body?._text?.slice(0, 100) || '?'}`);
  const b64 = r.body?._bytesBase64;
  if (!b64) throw new Error('Proxy nao retornou bytes do video. Body keys: ' + Object.keys(r.body || {}).join(','));
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
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
    const created = await createVideo({
      title: job.title,
      avatarId: job.avatarId,
      engine: job.engine,
      audio,
      orientation: job.orientation,
      resolution: job.resolution,
      motionPrompt: job.motionPrompt,
      voiceMirroring: job.voiceMirroring,
      voiceId: job.voiceId, // VA: voz custom do user (Mirror Voice ID)
    });

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
    const found = await getAvatarDefaultVoice(job.avatarId);
    if (!found) {
      throw new Error(
        'Nao foi possivel descobrir a voz default desse avatar. Marque "Substituir voz padrao do avatar" e escolha uma voz manualmente.',
      );
    }
    voiceId = found;
  }

  // TTS via /v2/online/text_to_speech.stream (ndjson, parsed pelo proxy).
  // Texto-direto pro submit (5 shapes) NAO funcionou nos testes, removido
  // do fluxo principal pra nao gastar 5 API calls inuteis. Mantido como
  // funcao exportada caso futuramente vejamos a shape correta.
  onProgress?.('tts', { msg: 'Gerando audio TTS (voz original do avatar)...' });
  const audioFile = await ttsToFile(job.text, voiceId!);
  onProgress?.('upload', { msg: 'Preparando upload...' });
  const audio = await uploadAudio(audioFile, {
    onStep: (step, info) => onProgress?.(`upload-${step}`, info),
  });
  onProgress?.('submitting', { duration: audio.duration });
  const created = await createVideo({
    title: job.title,
    avatarId: job.avatarId,
    engine: job.engine,
    audio,
    orientation: job.orientation,
    resolution: job.resolution,
    motionPrompt: job.motionPrompt,
  });

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
