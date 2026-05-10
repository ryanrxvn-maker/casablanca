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
    bodyText: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!r.ok) {
    throw new Error(`TTS falhou (${r.status}): ${r.body?.message ?? r.body?.msg ?? ''}`);
  }
  // Body pode vir como audio_bytes (base64) ou audio_url
  const audioBytes = r.body?.audio_bytes ?? r.body?.data?.audio_bytes;
  if (!audioBytes) {
    throw new Error('TTS resposta sem audio_bytes. Body keys: ' + Object.keys(r.body ?? {}).join(','));
  }
  const bytes = Uint8Array.from(atob(audioBytes), (c) => c.charCodeAt(0));
  return new File([bytes], 'tts.mp3', { type: 'audio/mpeg' });
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
};

export async function createVideo(params: CreateVideoParams): Promise<{ video_id: string; avatar_id: string }> {
  const { title, avatarId, engine, audio, orientation = 'portrait', resolution, motionPrompt } = params;
  const eng = ENGINES[engine];
  if (!eng) throw new Error(`Motor desconhecido: ${engine}`);

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
    audio_data: {
      audio_type: 'uploaded',
      audio_url: audio.audio_url,
      duration: audio.duration,
      words: audio.words,
      text: audio.text || '',
    },
    avatar_settings: settings,
    enable_caption: false,
    create_new_avatar: false,
  };
  const r = await jsonCall('POST', '/v2/avatar/shortcut/submit', body);
  if (!r.ok) {
    throw new Error(r.body?.message || `Falha ao criar video (status ${r.status})`);
  }
  return r.body.data;
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
};

export async function processJob(
  job: ProcessJobInput,
  { onProgress }: { onProgress?: (stage: string, info: any) => void } = {},
): Promise<{ videoId: string; avatarId: string; audio: UploadedAudio }> {
  // Modo TEXTO: gera TTS antes (com lookup automatico da voz default do avatar)
  let audioFile: File;
  if (job.file) {
    audioFile = job.file;
  } else if (job.text) {
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
    onProgress?.('tts', { msg: 'Gerando audio TTS (voz original do avatar)...' });
    audioFile = await ttsToFile(job.text, voiceId);
  } else {
    throw new Error('processJob: precisa de `file` (audio) OU `text` (texto).');
  }

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
  return { videoId: created.video_id, avatarId: created.avatar_id, audio };
}
