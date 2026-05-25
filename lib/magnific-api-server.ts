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

/* ───────────────────────── Anti-credit guards ───────────────────────── */

export type UnlimitedStatus = {
  /** Modo Unlimited ATIVO (custo zero pra modelos elegíveis). */
  isEnabled: boolean;
  /** % consumido do ciclo (0-100+). 100+ = throttle ativo. */
  usagePercent: number;
  /** Data de reset do ciclo (ISO yyyy-mm-dd). */
  cycleResetDate?: string;
  /** Banido por abuso. */
  isBanned: boolean;
};

/**
 * Confirma se a conta está em Unlimited mode (custo 0).
 * Se desligado → disparar gastaria créditos reais → BLOQUEAR.
 */
export async function getUnlimitedStatus(
  creds: MagnificCreds,
): Promise<UnlimitedStatus> {
  const r = await magnificFetch(creds, '/unlimited-status');
  if (!r.ok) throw new Error(`unlimited-status falhou: ${r.status}`);
  const j = (await r.json()) as {
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

export type SimulateItem = {
  model: string;
  quantity: number;
  config: Record<string, unknown>;
};

export type SimulateResult = {
  /** Créditos que SERIAM cobrados. 0 = zero cobrança garantida. */
  totalCredits: number;
  /** Todos items elegíveis pra Unlimited. */
  hasUnlimited: boolean;
  /** Créditos restantes na conta. */
  remaining: number;
  /** Custo real em compute (info, não cobrado se hasUnlimited). */
  realCost: number;
  /** Per-item: cada um é Unlimited? */
  itemsUnlimited: boolean[];
};

/**
 * Simula custo ANTES de disparar de verdade. Se vai cobrar créditos,
 * aborta o pipeline — o user exige zero cobrança.
 */
export async function simulateGeneration(
  creds: MagnificCreds,
  items: SimulateItem[],
): Promise<SimulateResult> {
  const r = await magnificFetch(creds, '/v2/ai/simulate-generation', {
    method: 'POST',
    jsonBody: { items, forceCredits: false },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`simulate-generation falhou (${r.status}): ${txt.slice(0, 300)}`);
  }
  const j = (await r.json()) as {
    items: Array<{ isUnlimited: boolean }>;
    total: {
      credits: number;
      hasUnlimited: boolean;
      remaining: number;
      realCost?: number;
    };
  };
  return {
    totalCredits: j.total.credits ?? 0,
    hasUnlimited: !!j.total.hasUnlimited,
    remaining: j.total.remaining ?? 0,
    realCost: j.total.realCost ?? 0,
    itemsUnlimited: j.items.map((i) => !!i.isUnlimited),
  };
}

/**
 * Guard combinado: confirma Unlimited ON + simula custo zero pros 2 modelos.
 * Se alguma checagem falhar, joga erro descritivo (rota deve retornar 402).
 */
export async function assertZeroCreditCost(creds: MagnificCreds): Promise<{
  status: UnlimitedStatus;
  image: SimulateResult;
  video: SimulateResult;
}> {
  const status = await getUnlimitedStatus(creds);
  if (status.isBanned) {
    throw new Error('Conta Magnific BANIDA.');
  }
  if (!status.isEnabled) {
    throw new Error('Unlimited mode DESLIGADO no Magnific — disparar agora cobraria créditos.');
  }
  const [image, video] = await Promise.all([
    simulateGeneration(creds, [
      {
        model: 'imagen-nano-banana-2-flash',
        quantity: 1,
        config: { resolution: '1k', variant: 'standard', tier: 'mid' },
      },
    ]),
    simulateGeneration(creds, [
      {
        model: 'kling-25',
        quantity: 1,
        config: {
          resolution: '720p',
          variant: 'standard',
          tier: 'mid',
          duration: 10,
        },
      },
    ]),
  ]);
  if (image.totalCredits > 0 || !image.hasUnlimited) {
    throw new Error(
      `Nano Banana NÃO está em Unlimited (cobraria ${image.totalCredits} créditos).`,
    );
  }
  if (video.totalCredits > 0 || !video.hasUnlimited) {
    throw new Error(
      `Kling 2.5 NÃO está em Unlimited (cobraria ${video.totalCredits} créditos).`,
    );
  }
  return { status, image, video };
}

/* ───────────────────────── Auth verify ───────────────────────── */

/** Confirma que as credenciais funcionam. Retorna { userId, plan, credits }.
 *
 * IMPORTANTE: shape real do /auth/verify (capturado live 2026-05-24):
 *   {
 *     userData: {
 *       id: 156031909,            // ID interno do Magnific (nao usado em queries)
 *       fpId: "188211386",        // ID do Freepik — ESSE vai em ?user_id=... das outras chamadas
 *       email, name, displayName, avatar,
 *       freepikPremium: true,     // Premium+ flag
 *       hasRealFreepikPremium: true,
 *       walletId: "uuid",         // pra GET /wallet?wallet_id=...
 *       creditSystemEnabled, ...
 *     },
 *     folders: [...]
 *   }
 *
 * Por isso a chave de "user_id" pra autenticar é o `fpId`, não o `id`.
 */
export async function verifyCredentials(creds: MagnificCreds): Promise<{
  userId: number;
  email?: string;
  plan?: string;
  credits?: number;
  walletId?: string;
}> {
  // Magnific aceita /auth/verify sem user_id na query (descoberto live)
  const url = `${BASE}/auth/verify?lang=en_US`;
  const r = await fetch(url, {
    headers: {
      accept: 'application/json',
      cookie: creds.cookie,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Auth verify falhou: ${r.status} ${txt.slice(0, 200)}`);
  }
  const j = (await r.json()) as {
    userData?: {
      id?: number;
      fpId?: string | number;
      email?: string;
      freepikPremium?: boolean;
      hasRealFreepikPremium?: boolean;
      walletId?: string;
    };
  };
  const u = j.userData;
  if (!u || (!u.fpId && !u.id)) {
    throw new Error('Auth verify: userData ausente (sessao invalida?)');
  }
  // fpId vem como string — converte pra number
  const fpId = typeof u.fpId === 'string' ? parseInt(u.fpId, 10) : u.fpId;
  const userId = fpId || u.id || 0;
  // Plano: derivado dos flags do Freepik
  const isPremium = !!(u.hasRealFreepikPremium || u.freepikPremium);
  const plan = isPremium ? 'Premium+' : 'Free';
  return {
    userId,
    email: u.email,
    plan,
    credits: undefined, // disponivel via /wallet?wallet_id=... se precisar
    walletId: u.walletId,
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
  sharedPoller?: BatchPoller,
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

  // 3) Poll — usa poller compartilhado se fornecido (batch dedup)
  if (sharedPoller) {
    return sharedPoller.poll(creation.identifier, POLL_TIMEOUT_IMG_MS);
  }
  return pollCreation(creds, creation.identifier, POLL_TIMEOUT_IMG_MS);
}

/* ───────────────────────── VIDEO (parcial) ───────────────────────── */

/**
 * Gera 1 vídeo animando uma imagem (image-to-video). Kling 2.5 720p 10s 9:16.
 *
 * VALIDADO LIVE (2026-05): endpoint POST /app/api/generate?return_creations=true.
 * Payload é diferente do image — aninhado em `video.clips[]`, sem reserve step.
 * Direto cria + polling.
 */
export async function generateVideoFromImage(
  creds: MagnificCreds,
  input: VideoGenInput,
  sharedPoller?: BatchPoller,
): Promise<CreationResult> {
  const model = input.model || DEFAULT_VIDEO_MODEL;
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '720p';
  const duration = input.duration || 10;

  // Family UUID gerado client-side (compartilhado entre clips da mesma submissão)
  const family = crypto.randomUUID();

  // Map model slug → api/model/mode (descoberto via captura real)
  const modelMap: Record<VideoModel, { api: string; mode: string; slug: string }> = {
    'kling-25': { api: 'kling', mode: '25', slug: 'kling-25' },
    'kling-26': { api: 'kling', mode: '26', slug: 'kling-26' },
    'kling-21': { api: 'kling', mode: '21', slug: 'kling-21' },
  };
  const m = modelMap[model] || modelMap['kling-25'];

  const r = await magnificFetch(creds, '/generate?return_creations=true', {
    method: 'POST',
    jsonBody: {
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
            keyframes: {
              start: {
                type: 'image',
                url: input.startImageUrl,
              },
            },
            audioUrl: '',
            voices: [],
            boardUuid: null,
            videoPreset: 'custom',
          },
        ],
      },
    },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`generate video falhou (${r.status}): ${txt.slice(0, 500)}`);
  }
  const rendered = (await r.json()) as {
    success?: boolean;
    data?: { creations?: Array<{ id: number; identifier: string; family: string }> };
  };
  const creation = rendered.data?.creations?.[0];
  if (!creation?.identifier) {
    throw new Error('generate video: sem creation.identifier no response');
  }

  if (sharedPoller) {
    return sharedPoller.poll(creation.identifier, POLL_TIMEOUT_VID_MS);
  }
  return pollCreation(creds, creation.identifier, POLL_TIMEOUT_VID_MS);
}

/* ───────────────────────── Polling (batch) ───────────────────────── */

/**
 * Faz 1 GET pra TODOS os identifiers de uma vez.
 * Endpoint: GET /app/api/creations?ids[]=A&ids[]=B&limit=N
 * Resposta: { data: [...creations] }
 *
 * IDs não encontrados são silenciosamente omitidos (não dão erro).
 */
export async function pollCreationsBatch(
  creds: MagnificCreds,
  identifiers: string[],
): Promise<Map<string, CreationResult>> {
  const map = new Map<string, CreationResult>();
  if (identifiers.length === 0) return map;
  const qs =
    identifiers.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&') +
    `&limit=${identifiers.length}`;
  const r = await magnificFetch(creds, `/creations?${qs}`);
  if (!r.ok) {
    throw new Error(`Batch polling falhou (${r.status})`);
  }
  const j = (await r.json()) as {
    data?: Array<{
      id: number;
      identifier: string;
      family: string;
      status: string;
      url?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  for (const c of j.data || []) {
    const status: CreationResult['status'] =
      c.status === 'completed' || c.status === 'failed' ? c.status : 'pending';
    map.set(c.identifier, {
      id: c.id,
      identifier: c.identifier,
      family: c.family,
      status,
      url: c.url,
      metadata: c.metadata,
    });
  }
  return map;
}

/**
 * Poller centralizado: 1 loop, 1 request HTTP/ciclo, distribui resultados
 * pra todos identifiers inscritos via Promises.
 *
 * Uso:
 *   const poller = createBatchPoller(creds);
 *   const result = await poller.poll(identifier, timeoutMs); // dezenas em paralelo OK
 *   poller.stop();
 */
export type BatchPoller = {
  poll(identifier: string, timeoutMs: number): Promise<CreationResult>;
  stop(): void;
  activeCount(): number;
};

export function createBatchPoller(creds: MagnificCreds): BatchPoller {
  type Sub = {
    identifier: string;
    deadline: number;
    resolve: (r: CreationResult) => void;
    reject: (e: Error) => void;
  };
  const subs = new Map<string, Sub>();
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const now = Date.now();
    // Expira subscriptions que estouraram timeout
    for (const [id, sub] of subs) {
      if (now > sub.deadline) {
        subs.delete(id);
        sub.reject(new Error(`Polling timeout pra ${id}`));
      }
    }
    if (subs.size === 0) return;
    const ids = Array.from(subs.keys());
    let map: Map<string, CreationResult>;
    try {
      map = await pollCreationsBatch(creds, ids);
    } catch (e) {
      // Network blip — só loga, mantém subs vivas
      console.warn('[magnific-batch-poll] tick falhou:', e);
      return;
    }
    for (const [id, sub] of subs) {
      const result = map.get(id);
      if (!result) continue; // ainda não apareceu (race após render)
      if (result.status === 'completed' && result.url) {
        subs.delete(id);
        sub.resolve(result);
      } else if (result.status === 'failed') {
        subs.delete(id);
        sub.resolve(result); // não throw — let caller decide
      }
      // pending → continua aguardando próximo tick
    }
  }

  function ensureLoop() {
    if (loopTimer || stopped) return;
    loopTimer = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    // Primeiro tick rápido (não espera 2s)
    setTimeout(() => void tick(), 100);
  }

  return {
    poll(identifier, timeoutMs) {
      if (stopped) return Promise.reject(new Error('Poller parado.'));
      return new Promise<CreationResult>((resolve, reject) => {
        subs.set(identifier, {
          identifier,
          deadline: Date.now() + timeoutMs,
          resolve,
          reject,
        });
        ensureLoop();
      });
    },
    stop() {
      stopped = true;
      if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
      }
      for (const [id, sub] of subs) {
        sub.reject(new Error(`Poller parado antes de ${id} completar.`));
      }
      subs.clear();
    },
    activeCount() {
      return subs.size;
    },
  };
}

/**
 * Compatibilidade: poll single creation usando batch internamente.
 * Mantém API anterior pra chamadas pontuais (1 creation só).
 */
async function pollCreation(
  creds: MagnificCreds,
  identifier: string,
  timeoutMs: number,
): Promise<CreationResult> {
  const poller = createBatchPoller(creds);
  try {
    return await poller.poll(identifier, timeoutMs);
  } finally {
    poller.stop();
  }
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
