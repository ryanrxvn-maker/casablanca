/**
 * SERVER-ONLY. Magnific.com API direta — substitui automação UI (Spaces).
 *
 * Descoberto via engenharia reversa live (lib/magnific-api-spec.md).
 *
 * Auth: cookie session (mesmo do browser logado do user) + XSRF token.
 * User configura uma vez via /configuracoes/magnific-token, sobrevive
 * até ~7 dias (refresh manual).
 *
 * IMAGE: 100% validado (geração real funcionou).
 * VIDEO: parcial — render/v4 confirmado responder pra video, mas precisa
 *        finalizar captura de width/height/resolution exatos.
 */

/* ───────────────────────── Types ───────────────────────── */

export type MagnificCreds = {
  /** Cookie completo da conta Magnific. Inclui `magnific_session`, `XSRF-TOKEN`, etc.
   * Pega via DevTools > Application > Cookies > magnific.com */
  cookie: string;
  /** XSRF-TOKEN decodificado (URI decoded). */
  xsrfToken: string;
  /** ID numérico do user (vem de /app/api/auth/verify). */
  userId: number;
};

export type ImageModel =
  | 'imagen-nano-banana-2-flash'
  | 'imagen-nano-banana-2'
  | 'imagen-nano-banana'
  | 'imagen-nano-banana-pro'; // pra contas que têm Pro

export type VideoModel = 'kling-25' | 'kling-26' | 'kling-21';

export type AspectRatio = '9:16' | '16:9' | '1:1' | 'auto';

export type ImageGenInput = {
  prompt: string;
  model?: ImageModel;
  aspectRatio?: AspectRatio;
  resolution?: '1k' | '2k';
  smartPrompt?: boolean;
  seed?: number;
};

export type VideoGenInput = {
  prompt: string;
  startImageUrl: string; // URL da imagem (de uma image gen anterior)
  model?: VideoModel;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  resolution?: '720p' | '1080p';
  duration?: 5 | 10;
  seed?: number;
};

export type CreationResult = {
  id: number;
  identifier: string;
  status: 'pending' | 'completed' | 'failed';
  url?: string;
  family: string;
  expectTime?: number;
  metadata?: Record<string, unknown>;
};

/* ───────────────────────── Constants ───────────────────────── */

const BASE = 'https://www.magnific.com/app/api';
const DEFAULT_IMAGE_MODEL: ImageModel = 'imagen-nano-banana-2-flash';
const DEFAULT_VIDEO_MODEL: VideoModel = 'kling-25';

/** Ports do timeout — geração demora segundos pra minutos. */
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_IMG_MS = 180_000; // 3min — Nano Banana é ~15-30s
const POLL_TIMEOUT_VID_MS = 900_000; // 15min — Kling 2.5 é ~5-10min

/* ───────────────────────── HTTP helper ───────────────────────── */

async function magnificFetch(
  creds: MagnificCreds,
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {},
): Promise<Response> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}lang=en_US&user_id=${creds.userId}`;
  const headers: Record<string, string> = {
    accept: 'application/json',
    cookie: creds.cookie,
    'X-Requested-With': 'XMLHttpRequest',
    ...(init.headers as Record<string, string> | undefined),
  };
  let body = init.body;
  if (init.jsonBody !== undefined) {
    headers['content-type'] = 'application/json';
    headers['X-XSRF-TOKEN'] = creds.xsrfToken;
    body = JSON.stringify(init.jsonBody);
  }
  return fetch(url, { ...init, headers, body });
}

/* ───────────────────────── Auth verify ───────────────────────── */

/** Confirma que as credenciais funcionam. Retorna { userId, plan, credits }. */
export async function verifyCredentials(creds: MagnificCreds): Promise<{
  userId: number;
  email?: string;
  plan?: string;
  credits?: number;
}> {
  const r = await magnificFetch(creds, '/auth/verify');
  if (!r.ok) throw new Error(`Auth verify falhou: ${r.status}`);
  const j = (await r.json()) as {
    user?: { id?: number; email?: string; plan?: string; credits?: number };
  };
  if (!j.user?.id) throw new Error('Auth verify: user.id ausente');
  return {
    userId: j.user.id,
    email: j.user.email,
    plan: j.user.plan,
    credits: j.user.credits,
  };
}

/* ───────────────────────── IMAGE ───────────────────────── */

/**
 * Gera 1 imagem do zero (text-to-image). Faz reserve + render + polling.
 * Retorna URL signed (válida ~3 dias). Custa 0 créditos se Unlimited ON.
 */
export async function generateImage(
  creds: MagnificCreds,
  input: ImageGenInput,
): Promise<CreationResult> {
  const model = input.model || DEFAULT_IMAGE_MODEL;
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '1k';
  const smartPrompt = input.smartPrompt !== false;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000);

  // 1) Reserve tokens
  const r1 = await magnificFetch(creds, '/start-tti-v2', {
    method: 'POST',
    jsonBody: {
      mode: model,
      prompt: input.prompt,
      references: [],
      num_images: 1,
      aspect_ratio: aspectRatio,
      color_palette: null,
      color_palette_id: null,
      variations: true,
      force_credits: false,
    },
  });
  if (!r1.ok) {
    const txt = await r1.text().catch(() => '');
    throw new Error(`start-tti-v2 falhou (${r1.status}): ${txt.slice(0, 300)}`);
  }
  const reserve = (await r1.json()) as {
    family: string;
    request_tokens: string[];
  };
  if (!reserve.family || !reserve.request_tokens?.[0]) {
    throw new Error('start-tti-v2: response sem family ou tokens');
  }

  // 2) Render
  const r2 = await magnificFetch(creds, '/render/v4', {
    method: 'POST',
    jsonBody: {
      tool: 'text-to-image',
      mode: model,
      family: reserve.family,
      prompt: input.prompt,
      negative_prompt: null,
      width: 0,
      height: 0,
      seed,
      aspect_ratio: aspectRatio,
      resolution,
      thinking_level: 'minimal',
      use_google_search_tool: false,
      request_token: reserve.request_tokens[0],
      force_credits: false,
      metadata: {
        inputPrompt: input.prompt,
        aspectRatio,
        mode: model,
        unlimited: true,
        smartPrompt,
      },
      smart_prompt: smartPrompt,
      image_index: 0,
      num_images: 1,
    },
  });
  if (!r2.ok) {
    const txt = await r2.text().catch(() => '');
    throw new Error(`render/v4 image falhou (${r2.status}): ${txt.slice(0, 300)}`);
  }
  const rendered = (await r2.json()) as {
    creation: { id: number; identifier: string; family: string; metadata?: Record<string, unknown> };
  };
  const creation = rendered.creation;
  if (!creation?.identifier) throw new Error('render/v4 image: sem creation.identifier');

  // 3) Poll until complete
  return pollCreation(creds, creation.identifier, POLL_TIMEOUT_IMG_MS);
}

/* ───────────────────────── VIDEO (parcial) ───────────────────────── */

/**
 * Gera 1 vídeo animando uma imagem (image-to-video). Kling 2.5 720p 10s 9:16.
 *
 * ATENÇÃO: payload de video AINDA não 100% validado. Falta capturar:
 * - `tool` exato (provavelmente "image-to-video")
 * - `width`/`height` exatos pra 9:16 720p (provavelmente 720x1280)
 * - `resolution` enum válido
 * - como passa `start_image` (URL ou ID)
 *
 * Implementação atual usa hipóteses inteligentes. Se 422, mostra mensagem
 * com erros do Magnific pra ajustar.
 */
export async function generateVideoFromImage(
  creds: MagnificCreds,
  input: VideoGenInput,
): Promise<CreationResult> {
  const model = input.model || DEFAULT_VIDEO_MODEL;
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '720p';
  const duration = input.duration || 10;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000);

  // Dimensões pra 9:16 720p ← chute baseado em padrão Kling
  const dims =
    aspectRatio === '9:16'
      ? { width: 720, height: 1280 }
      : aspectRatio === '16:9'
        ? { width: 1280, height: 720 }
        : { width: 720, height: 720 };

  // HIPÓTESE 1: mesmo padrão start-tti-v2 mas pra video (start-ttv-v2 OU mesmo start-tti-v2 com mode video)
  // HIPÓTESE 2: render/v4 direto com tool diferente
  // Tentando HIPÓTESE 2 primeiro (mais provável baseado em 422 anterior)

  const r = await magnificFetch(creds, '/render/v4', {
    method: 'POST',
    jsonBody: {
      tool: 'image-to-video',
      mode: model,
      family: '00000000-0000-0000-0000-000000000000', // sem reserve por agora
      prompt: input.prompt,
      start_image_url: input.startImageUrl,
      width: dims.width,
      height: dims.height,
      seed,
      aspect_ratio: aspectRatio,
      resolution,
      duration,
      thinking_level: 'minimal',
      request_token: 'unlimited',
      force_credits: false,
      metadata: {
        inputPrompt: input.prompt,
        aspectRatio,
        mode: model,
        unlimited: true,
        startImage: input.startImageUrl,
      },
      smart_prompt: true,
      num_images: 1,
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(
      `render/v4 video falhou (${r.status}): ${txt.slice(0, 500)} — ` +
        `payload de video precisa de ajustes (ver magnific-api-spec.md)`,
    );
  }
  const rendered = (await r.json()) as {
    creation?: { id: number; identifier: string; family: string };
  };
  if (!rendered.creation?.identifier)
    throw new Error('render/v4 video: sem creation.identifier');

  return pollCreation(creds, rendered.creation.identifier, POLL_TIMEOUT_VID_MS);
}

/* ───────────────────────── Polling ───────────────────────── */

async function pollCreation(
  creds: MagnificCreds,
  identifier: string,
  timeoutMs: number,
): Promise<CreationResult> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | undefined;
  while (Date.now() < deadline) {
    const r = await magnificFetch(creds, `/creation/${identifier}`);
    if (!r.ok) {
      // 404 pode acontecer logo após render (race) — retry
      if (r.status === 404) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      throw new Error(`Polling creation falhou (${r.status})`);
    }
    const j = (await r.json()) as {
      id: number;
      identifier: string;
      family: string;
      tool: string;
      status: string;
      url?: string;
      metadata?: Record<string, unknown>;
    };
    lastStatus = j.status;
    if (j.status === 'completed' && j.url) {
      return {
        id: j.id,
        identifier: j.identifier,
        family: j.family,
        status: 'completed',
        url: j.url,
        metadata: j.metadata,
      };
    }
    if (j.status === 'failed') {
      return {
        id: j.id,
        identifier: j.identifier,
        family: j.family,
        status: 'failed',
        metadata: j.metadata,
      };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Polling timeout (${timeoutMs / 1000}s) — última status: ${lastStatus || 'desconhecido'}`,
  );
}

/* ───────────────────────── Pipeline completo (image + video) ───────────────────────── */

/**
 * Gera 1 par completo de B-roll: image (Nano Banana) → video (Kling 2.5).
 * Roda os 2 sequenciais, retorna URLs finais.
 */
export async function generateBrollPair(
  creds: MagnificCreds,
  imagePrompt: string,
  videoPrompt: string,
): Promise<{
  image: CreationResult;
  video: CreationResult;
}> {
  const image = await generateImage(creds, {
    prompt: imagePrompt,
    aspectRatio: '9:16',
    resolution: '1k',
  });
  if (image.status !== 'completed' || !image.url) {
    throw new Error('Image gen falhou: ' + image.status);
  }
  const video = await generateVideoFromImage(creds, {
    prompt: videoPrompt || imagePrompt,
    startImageUrl: image.url,
    aspectRatio: '9:16',
    resolution: '720p',
    duration: 10,
  });
  return { image, video };
}

/* ───────────────────────── Util ───────────────────────── */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
