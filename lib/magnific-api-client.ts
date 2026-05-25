/**
 * magnific-api-client — CLIENT-SIDE versão do magnific-api-server.
 * Faz chamadas via extension proxy (bridge). Pipeline V2 usa isso
 * pra todas operações magnific (passa Cloudflare via TLS do browser).
 *
 * API quase idêntica à server-side — só muda que tudo é Promise<T> com
 * fetch indo pela extensão em vez de Node.
 */

import { magnificFetch } from './magnific-bridge';

/* ────────── Types (espelho do server) ────────── */

export type ImageModel =
  | 'imagen-nano-banana-2-flash'
  | 'imagen-nano-banana-2'
  | 'imagen-nano-banana'
  | 'imagen-nano-banana-pro';

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
  startImageUrl: string;
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
  metadata?: Record<string, unknown>;
};

export type UnlimitedStatus = {
  isEnabled: boolean;
  isBanned: boolean;
  usagePercent: number;
  cycleResetDate?: string;
};

export type SimulateResult = {
  totalCredits: number;
  hasUnlimited: boolean;
  remaining: number;
  realCost: number;
};

/* ────────── Constants ────────── */

const DEFAULT_IMAGE_MODEL: ImageModel = 'imagen-nano-banana-2-flash';
const DEFAULT_VIDEO_MODEL: VideoModel = 'kling-25';
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_IMG_MS = 240_000; // 4min — Nano Banana raramente passa 30s
const POLL_TIMEOUT_VID_MS = 1_800_000; // 30min — Kling 2.5 pode levar até 15-20min sob carga; damos folga 2x

/* ────────── User id ────────── */

let cachedUserId: number | null = null;

async function getUserId(): Promise<number> {
  if (cachedUserId) return cachedUserId;
  const r = await magnificFetch('/app/api/auth/verify?lang=en_US');
  if (!r.ok) throw new Error(`auth/verify falhou: ${r.status}`);
  const j = r.json() as { userData?: { fpId?: string | number; id?: number } };
  const u = j.userData;
  if (!u) throw new Error('auth/verify sem userData');
  const fpId = typeof u.fpId === 'string' ? parseInt(u.fpId, 10) : u.fpId;
  const uid = fpId || u.id || 0;
  if (!uid) throw new Error('Sem fpId/id em auth/verify');
  cachedUserId = uid;
  return uid;
}

/* ────────── Guards ────────── */

export async function getUnlimitedStatus(): Promise<UnlimitedStatus> {
  const uid = await getUserId();
  const r = await magnificFetch(
    `/app/api/unlimited-status?lang=en_US&user_id=${uid}`,
  );
  if (!r.ok) throw new Error(`unlimited-status falhou: ${r.status}`);
  const j = r.json() as {
    is_unlimited_mode_enabled?: boolean;
    is_banned?: boolean;
    usage?: { percent?: number };
    unlimited_cycle_reset_date?: string;
  };
  return {
    isEnabled: !!j.is_unlimited_mode_enabled,
    isBanned: !!j.is_banned,
    usagePercent: j.usage?.percent ?? 0,
    cycleResetDate: j.unlimited_cycle_reset_date,
  };
}

export async function simulateGeneration(
  items: Array<{ model: string; quantity: number; config: Record<string, unknown> }>,
): Promise<SimulateResult> {
  const uid = await getUserId();
  const r = await magnificFetch(
    `/app/api/v2/ai/simulate-generation?lang=en_US&user_id=${uid}`,
    { method: 'POST', body: { items, forceCredits: false } },
  );
  if (!r.ok) throw new Error(`simulate-generation falhou: ${r.status}`);
  const j = r.json() as {
    total: { credits: number; hasUnlimited: boolean; remaining: number; realCost?: number };
  };
  return {
    totalCredits: j.total.credits ?? 0,
    hasUnlimited: !!j.total.hasUnlimited,
    remaining: j.total.remaining ?? 0,
    realCost: j.total.realCost ?? 0,
  };
}

/** Confirma Unlimited ON + custo zero pros 2 modelos. Throws se alguma falha. */
export async function assertZeroCreditCost(): Promise<void> {
  const status = await getUnlimitedStatus();
  if (status.isBanned) throw new Error('Conta Magnific BANIDA.');
  if (!status.isEnabled) throw new Error('Unlimited mode DESLIGADO no Magnific.');
  const [img, vid] = await Promise.all([
    simulateGeneration([
      {
        model: 'imagen-nano-banana-2-flash',
        quantity: 1,
        config: { resolution: '1k', variant: 'standard', tier: 'mid' },
      },
    ]),
    simulateGeneration([
      {
        model: 'kling-25',
        quantity: 1,
        config: { resolution: '720p', variant: 'standard', tier: 'mid', duration: 10 },
      },
    ]),
  ]);
  if (img.totalCredits > 0 || !img.hasUnlimited) {
    throw new Error(`Nano Banana custaria ${img.totalCredits} créditos (não Unlimited).`);
  }
  if (vid.totalCredits > 0 || !vid.hasUnlimited) {
    throw new Error(`Kling 2.5 custaria ${vid.totalCredits} créditos (não Unlimited).`);
  }
}

/* ────────── Image ────────── */

export async function generateImage(input: ImageGenInput): Promise<CreationResult> {
  const uid = await getUserId();
  const model = input.model || DEFAULT_IMAGE_MODEL;
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '1k';
  const smartPrompt = input.smartPrompt !== false;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000);

  // 1) Reserve tokens
  const r1 = await magnificFetch(
    `/app/api/start-tti-v2?lang=en_US&user_id=${uid}`,
    {
      method: 'POST',
      body: {
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
    },
  );
  if (!r1.ok) throw new Error(`start-tti-v2 falhou: ${r1.status} ${r1.text().slice(0, 200)}`);
  const reserve = r1.json() as { family: string; request_tokens: string[] };
  if (!reserve.family || !reserve.request_tokens?.[0]) {
    throw new Error('start-tti-v2 sem family/tokens');
  }

  // 2) Render
  const r2 = await magnificFetch(`/app/api/render/v4?lang=en_US&user_id=${uid}`, {
    method: 'POST',
    body: {
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
  if (!r2.ok) throw new Error(`render/v4 image falhou: ${r2.status}`);
  const rendered = r2.json() as { creation: { identifier: string } };
  if (!rendered.creation?.identifier) throw new Error('render/v4 sem identifier');

  return pollCreation(rendered.creation.identifier, POLL_TIMEOUT_IMG_MS);
}

/* ────────── Video ────────── */

export async function generateVideoFromImage(input: VideoGenInput): Promise<CreationResult> {
  const uid = await getUserId();
  const model = input.model || DEFAULT_VIDEO_MODEL;
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '720p';
  const duration = input.duration || 10;

  // family UUID
  const family =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  const modelMap: Record<VideoModel, { api: string; mode: string; slug: string }> = {
    'kling-25': { api: 'kling', mode: '25', slug: 'kling-25' },
    'kling-26': { api: 'kling', mode: '26', slug: 'kling-26' },
    'kling-21': { api: 'kling', mode: '21', slug: 'kling-21' },
  };
  const m = modelMap[model] || modelMap['kling-25'];

  // 2026-05-24: Magnific moveu o endpoint de POST /app/api/generate (agora 405)
  // pra POST /app/api/video/generate. Mesma shape de payload.
  const r = await magnificFetch(
    `/app/api/video/generate?return_creations=true&lang=en_US&user_id=${uid}`,
    {
      method: 'POST',
      body: {
        video: {
          family,
          clips: [
            {
              position: 0,
              prompt: input.prompt,
              negativePrompt: '',
              name: input.prompt.slice(0, 80),
              family,
              aspectRatio,
              cameraMotion: null,
              duration,
              api: m.api,
              model: m.api,
              mode: m.mode,
              slug: m.slug,
              extraParameters: {},
              withSoundEffects: false,
              promptType: 'basic',
              resolution,
              keyframes: { start: { type: 'image', url: input.startImageUrl } },
              audioUrl: '',
              voices: [],
              boardUuid: null,
              videoPreset: 'custom',
            },
          ],
        },
      },
    },
  );
  if (!r.ok) throw new Error(`generate video falhou: ${r.status} ${r.text().slice(0, 200)}`);
  const j = r.json() as { data?: { creations?: Array<{ identifier: string }> } };
  const id = j.data?.creations?.[0]?.identifier;
  if (!id) throw new Error('generate video sem identifier');
  return pollCreation(id, POLL_TIMEOUT_VID_MS);
}

/* ────────── Batch polling ────────── */

export async function pollCreationsBatch(
  identifiers: string[],
): Promise<Map<string, CreationResult>> {
  const map = new Map<string, CreationResult>();
  if (identifiers.length === 0) return map;
  const uid = await getUserId();
  const qs =
    identifiers.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&') +
    `&limit=${identifiers.length}`;
  const r = await magnificFetch(`/app/api/creations?${qs}&lang=en_US&user_id=${uid}`);
  if (!r.ok) throw new Error(`Batch polling falhou: ${r.status}`);
  const j = r.json() as {
    data?: Array<{
      id: number;
      identifier: string;
      family: string;
      status: string;
      url?: string | null;
      metadata?: Record<string, unknown> & { url?: string };
    }>;
  };
  for (const c of j.data || []) {
    const status: CreationResult['status'] =
      c.status === 'completed' || c.status === 'failed' ? c.status : 'pending';
    // VIDEOS: c.url é null, URL real está em c.metadata.url
    // IMAGES: c.url está populado no top-level
    // Fallback chain pra cobrir ambos.
    const url = c.url || c.metadata?.url || undefined;
    map.set(c.identifier, {
      id: c.id,
      identifier: c.identifier,
      family: c.family,
      status,
      url,
      metadata: c.metadata,
    });
  }
  return map;
}

export type BatchPoller = {
  poll(identifier: string, timeoutMs: number): Promise<CreationResult>;
  stop(): void;
  activeCount(): number;
};

export function createBatchPoller(): BatchPoller {
  type Sub = {
    identifier: string;
    deadline: number;
    resolve: (r: CreationResult) => void;
    reject: (e: Error) => void;
  };
  const subs = new Map<string, Sub>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const now = Date.now();
    for (const [id, sub] of subs) {
      if (now > sub.deadline) {
        subs.delete(id);
        sub.reject(new Error(`Polling timeout pra ${id}`));
      }
    }
    if (subs.size === 0) return;
    const ids = Array.from(subs.keys());
    let m: Map<string, CreationResult>;
    try {
      m = await pollCreationsBatch(ids);
    } catch (e) {
      console.warn('[magnific-batch] tick falhou', e);
      return;
    }
    for (const [id, sub] of subs) {
      const r = m.get(id);
      if (!r) continue;
      if (r.status === 'completed' && r.url) {
        subs.delete(id);
        sub.resolve(r);
      } else if (r.status === 'failed') {
        subs.delete(id);
        sub.resolve(r);
      }
    }
  }

  function ensure() {
    if (timer || stopped) return;
    timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    setTimeout(() => void tick(), 100);
  }

  return {
    poll(identifier, timeoutMs) {
      if (stopped) return Promise.reject(new Error('Poller parado.'));
      return new Promise((resolve, reject) => {
        subs.set(identifier, { identifier, deadline: Date.now() + timeoutMs, resolve, reject });
        ensure();
      });
    },
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const [id, sub] of subs) {
        sub.reject(new Error(`Poller parado antes de ${id}.`));
      }
      subs.clear();
    },
    activeCount: () => subs.size,
  };
}

async function pollCreation(identifier: string, timeoutMs: number): Promise<CreationResult> {
  const p = createBatchPoller();
  try {
    return await p.poll(identifier, timeoutMs);
  } finally {
    p.stop();
  }
}
