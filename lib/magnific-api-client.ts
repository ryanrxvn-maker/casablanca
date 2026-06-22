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
  | 'imagen-nano-banana-pro'
  | 'seedream-4-5'; // Seedream 4.5 (zero-crédito no Unlimited, confirmado live)

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
// 30min (era 10min): com ghost detection, id morto é detectado em 90s e
// re-disparado — então esse timeout só se aplica a render VIVO (pending no
// /creations). Render vivo sob relaxed mode (usage >100%) pode demorar MUITO;
// matar com 10min causava as FALHAs "Polling timeout" em batch de 40. Vivo =
// espera em paz.
const POLL_TIMEOUT_IMG_MS = 1_800_000;
const POLL_TIMEOUT_VID_MS = 5_400_000; // 90min — Kling 2.5 sob carga MUITO pesada chega 30-60min;
                                       // damos folga generosa. User pediu "esperar em paz".

// "Render fantasma": o client pula start-tti-v2 (reserva) e chama render/v4
// direto. Sob carga (40 takes), parte das gerações é ACEITA (devolve
// identifier) mas a Magnific nunca enfileira o job — o id NUNCA aparece em
// /creations. Antes isso só era detectado ao bater o timeout cheio (10min)
// -> "Polling timeout". Agora: se um id nunca foi visto em /creations dentro
// desse prazo curto, declaramos fantasma e o caller RE-DISPARA na hora (novo
// render/v4 = novo id, quase sempre enfileira). Custo zero no Unlimited.
// Um render REAL aparece como 'pending' em poucos segundos. A folga grande
// (120s/240s) cobre lag de listagem do /creations sob relaxed mode — falso
// fantasma re-dispararia deixando um render órfão comendo o cap concurrent
// (~4-6/conta) e causando storm de "exceeded concurrent".
const NOT_SEEN_TIMEOUT_IMG_MS = 120_000; // 2min sem aparecer = fantasma -> re-dispara
const NOT_SEEN_TIMEOUT_VID_MS = 240_000; // 4min (vídeo demora mais p/ registrar)

/* ────────── User id / conta ativa ────────── */

export type MagnificAccount = {
  fpId: number;
  name?: string;
  email?: string;
  avatar?: string;
};

let cachedAccount: MagnificAccount | null = null;
let cachedAt = 0;
// TTL curto (30s): a cada 30s re-checa /auth/verify pra detectar troca
// de conta Freepik. User só desloga/loga no magnific.com → em até 30s
// o app reflete. Cada novo batch invalida ANTES (preflight) → 0s de delay.
const ACCOUNT_TTL_MS = 30_000;

/** Invalida o cache da conta ativa. Use quando souber que o user trocou. */
export function invalidateUserIdCache(): void {
  cachedAccount = null;
  cachedAt = 0;
}

/** Listener registrados pra notificar UI quando conta muda. */
const accountChangeListeners = new Set<(acc: MagnificAccount) => void>();
export function onAccountChange(cb: (acc: MagnificAccount) => void): () => void {
  accountChangeListeners.add(cb);
  return () => accountChangeListeners.delete(cb);
}

/** Pega a conta ATIVA do Magnific (lendo cookies vivos da aba magnific.com).
 *  Cache TTL 30s — re-busca automático detecta troca de conta sem reload. */
export async function getCurrentAccount(forceFresh = false): Promise<MagnificAccount> {
  const now = Date.now();
  if (!forceFresh && cachedAccount && now - cachedAt < ACCOUNT_TTL_MS) return cachedAccount;
  const r = await magnificFetch('/app/api/auth/verify?lang=en_US');
  if (!r.ok) throw new Error(`auth/verify falhou: ${r.status}`);
  const j = r.json() as {
    userData?: { fpId?: string | number; id?: number; name?: string; email?: string; avatar?: string };
  };
  const u = j.userData;
  if (!u) throw new Error('auth/verify sem userData (sessão Freepik expirou?)');
  const fpId = typeof u.fpId === 'string' ? parseInt(u.fpId, 10) : u.fpId;
  const id = fpId || u.id || 0;
  if (!id) throw new Error('Sem fpId/id em auth/verify');
  const acc: MagnificAccount = { fpId: id, name: u.name, email: u.email, avatar: u.avatar };
  // Notifica troca de conta
  if (cachedAccount && cachedAccount.fpId !== acc.fpId) {
    console.log(`[magnific] conta trocada: fpId ${cachedAccount.fpId} → ${acc.fpId} (${acc.email || acc.name || '?'})`);
    for (const cb of accountChangeListeners) { try { cb(acc); } catch {} }
  }
  cachedAccount = acc;
  cachedAt = now;
  return acc;
}

async function getUserId(): Promise<number> {
  const acc = await getCurrentAccount();
  return acc.fpId;
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

/** Confirma Unlimited ON + custo zero pros 2 modelos. Throws se alguma falha.
 *  CRÍTICO: invalida cache de conta no INÍCIO. Se user trocou de conta
 *  Freepik nesse meio tempo (logout/login no magnific.com), o batch
 *  vai usar a conta NOVA, não a velha em cache. Zero delay. */
export async function assertZeroCreditCost(
  imageModel: ImageModel = DEFAULT_IMAGE_MODEL,
): Promise<void> {
  invalidateUserIdCache(); // força re-fetch /auth/verify com cookies vivos
  const status = await getUnlimitedStatus();
  if (status.isBanned) throw new Error('Conta Magnific BANIDA.');
  if (!status.isEnabled) throw new Error('Unlimited mode DESLIGADO no Magnific.');
  // ❌ REMOVIDO: bloqueio preventivo se percent > 100.
  //
  // Descoberta 2026-05-30: o cap percentual NÃO é bloqueio rígido. Quando
  // ultrapassa, o Magnific apenas ativa is_relaxed_mode: true (throttle de
  // prioridade na fila), mas CONTINUA gerando. User comprovou: gerou Kling
  // 2.5 manualmente na MESMA conta que mostrava percent 133%.
  //
  // Só logamos pra visibilidade — não bloqueamos. Se o Magnific de fato
  // bloquear depois, a request real vai falhar e o pipeline trata.
  if (status.usagePercent > 100) {
    console.warn(
      `[magnific] usage ${status.usagePercent}% (cap soft excedido) — ` +
      `Magnific está em ${status.isEnabled ? 'Unlimited' : 'paid'}/relaxed mode. ` +
      `Continuamos: o Magnific ainda permite gerações nesse estado, só com prioridade menor.`,
    );
  }
  // Shape NOVA (2026-05-30): só model/quantity/config{resolution[,duration]}.
  // variant/tier foram dropados — servidor ignora se mandar, mas pra alinhar
  // com o que a UI real do Magnific manda, deixamos só o essencial.
  const [img, vid] = await Promise.all([
    simulateGeneration([
      {
        model: imageModel, // modelo ESCOLHIDO (nano-banana-2-flash OU seedream-4-5)
        quantity: 1,
        config: { resolution: '1k' },
      },
    ]),
    simulateGeneration([
      {
        model: 'kling-25',
        quantity: 1,
        config: { resolution: '720p', duration: 10 },
      },
    ]),
  ]);
  if (img.totalCredits > 0 || !img.hasUnlimited) {
    throw new Error(`Imagem (${imageModel}) custaria ${img.totalCredits} créditos (não Unlimited).`);
  }
  if (vid.totalCredits > 0 || !vid.hasUnlimited) {
    throw new Error(`Kling 2.5 custaria ${vid.totalCredits} créditos (não Unlimited).`);
  }
}

/* ────────── Image ────────── */

/** Gera request_token estilo do site (12 chars alfanuméricos). */
function genRequestToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = crypto.getRandomValues(new Uint8Array(12));
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[buf[i] % chars.length];
  return out;
}

/** Gera UUID v4 client-side (pra family). */
function genFamilyUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback paranóico
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function generateImage(
  input: ImageGenInput,
  sharedPoller?: BatchPoller,
): Promise<CreationResult> {
  const uid = await getUserId();
  const model = input.model || DEFAULT_IMAGE_MODEL;
  const aspectRatio = input.aspectRatio || '9:16';
  const resolution = input.resolution || '1k';
  const smartPrompt = input.smartPrompt !== false;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000);

  // ARQUITETURA NOVA (2026-05-30): /api/render/v4 aceita family+request_token
  // gerados client-side. start-tti-v2 está obsoleto/quebrado (419 CSRF). Provado
  // live no browser do user: render/v4 funciona stand-alone com 0 créditos no
  // unlimited, mesmo com usage >100% (relaxed mode).
  const family = genFamilyUUID();
  const requestToken = genRequestToken();

  const r = await magnificFetch(`/app/api/render/v4?lang=en_US&user_id=${uid}`, {
    method: 'POST',
    body: {
      tool: 'text-to-image',
      mode: model,
      family,
      prompt: input.prompt,
      negative_prompt: null,
      width: 0,
      height: 0,
      seed,
      aspect_ratio: aspectRatio,
      resolution,
      thinking_level: 'minimal',
      use_google_search_tool: false,
      request_token: requestToken,
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
  if (!r.ok) throw new Error(`render/v4 image falhou: ${r.status} ${r.text().slice(0, 200)}`);
  const rendered = r.json() as { creation?: { identifier?: string } };
  if (!rendered.creation?.identifier) throw new Error('render/v4 sem identifier');

  // Poll — usa poller compartilhado se fornecido (1 request batched p/ TODOS
  // os takes em voo, em vez de N loops competindo pela ponte da extensão).
  // notSeenTimeout: se o id nunca aparecer em /creations em 90s = fantasma,
  // rejeita rápido p/ o caller re-disparar (em vez de esperar 10min à toa).
  if (sharedPoller) {
    return sharedPoller.poll(rendered.creation.identifier, POLL_TIMEOUT_IMG_MS, NOT_SEEN_TIMEOUT_IMG_MS);
  }
  return pollCreation(rendered.creation.identifier, POLL_TIMEOUT_IMG_MS, NOT_SEEN_TIMEOUT_IMG_MS);
}

/* ────────── Video ────────── */

export async function generateVideoFromImage(
  input: VideoGenInput,
  sharedPoller?: BatchPoller,
): Promise<CreationResult> {
  return generateVideoInternal(input, input.startImageUrl, sharedPoller);
}

/** Text-to-video PURO no Kling (sem keyframe de imagem). Fallback pra quando
 *  a geração da IMAGEM é negada (política de conteúdo / failed persistente):
 *  o take ainda sai — animado direto do prompt. */
export async function generateVideoFromText(
  input: Omit<VideoGenInput, 'startImageUrl'>,
  sharedPoller?: BatchPoller,
): Promise<CreationResult> {
  return generateVideoInternal(input as VideoGenInput, null, sharedPoller);
}

async function generateVideoInternal(
  input: VideoGenInput,
  startImageUrl: string | null,
  sharedPoller?: BatchPoller,
): Promise<CreationResult> {
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
              // text-to-video puro (fallback de imagem negada) manda keyframes vazio
              keyframes: startImageUrl ? { start: { type: 'image', url: startImageUrl } } : {},
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
  if (sharedPoller) {
    return sharedPoller.poll(id, POLL_TIMEOUT_VID_MS, NOT_SEEN_TIMEOUT_VID_MS);
  }
  return pollCreation(id, POLL_TIMEOUT_VID_MS, NOT_SEEN_TIMEOUT_VID_MS);
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

/** Erro de "render fantasma": id aceito pelo render/v4 mas que nunca apareceu
 *  em /creations dentro do prazo curto. O caller deve RE-DISPARAR (gera id
 *  novo). É distinto de um timeout normal (job real que demorou). */
export class GhostRenderError extends Error {
  constructor(id: string, secs: number) {
    super(`Render fantasma: ${id} nunca apareceu em /creations após ${secs}s — re-disparando`);
    this.name = 'GhostRenderError';
  }
}

export type BatchPoller = {
  /** notSeenTimeoutMs: se o id nunca aparecer em /creations nesse prazo,
   *  rejeita com GhostRenderError (caller re-dispara). Default: sem detecção. */
  poll(identifier: string, timeoutMs: number, notSeenTimeoutMs?: number): Promise<CreationResult>;
  stop(): void;
  activeCount(): number;
};

export function createBatchPoller(onActivity?: () => void): BatchPoller {
  type Sub = {
    identifier: string;
    deadline: number;       // absolute timestamp ms (extended on outages)
    startedAt: number;
    everSeen: boolean;      // já apareceu (qualquer status) em /creations?
    notSeenDeadline: number; // se !everSeen e passar disso = fantasma. Infinity = desabilitado
    resolve: (r: CreationResult) => void;
    reject: (e: Error) => void;
  };
  const subs = new Map<string, Sub>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  // Guard anti-overlap: setInterval dispara a cada 2.5s independente do fetch
  // anterior ter terminado. Sob carga (bridge lenta), ticks sobrepostos
  // multiplicavam requests /creations e dobravam extensões de deadline.
  let ticking = false;

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await tickInner();
    } finally {
      ticking = false;
    }
  }

  async function tickInner() {
    if (stopped) return;
    const tickStart = Date.now();
    const now = tickStart;
    for (const [id, sub] of subs) {
      // Fantasma: nunca foi visto E estourou o prazo curto de "não-visto".
      if (!sub.everSeen && now > sub.notSeenDeadline) {
        subs.delete(id);
        sub.reject(new GhostRenderError(id, Math.round((now - sub.startedAt) / 1000)));
        continue;
      }
      if (now > sub.deadline) {
        subs.delete(id);
        sub.reject(new Error(`Polling timeout pra ${id} após ${Math.round((now - sub.startedAt)/60000)}min`));
      }
    }
    if (subs.size === 0) {
      // Poller VIVO porém sem renders pendentes = todos os takes estão em
      // backoff/cooldown de DISPATCH (comum sob 300 takes que saturam o
      // concurrent-cap da Magnific). Isso é "throttled", NÃO é stall: alimenta
      // o watchdog do pipeline pra ele não abortar o batch inteiro durante uma
      // janela de espera legítima (era o que matava ~290 takes de uma vez).
      // Bridge morta DE VERDADE mantém subs.size>0 com fetch falhando, então o
      // watchdog continua disparando nesse caso — sem mascarar stall real.
      onActivity?.();
      return;
    }
    const ids = Array.from(subs.keys());
    let m: Map<string, CreationResult>;
    try {
      m = await pollCreationsBatch(ids);
    } catch (e) {
      // FETCH FALHOU — extension/rede problema. Estende o deadline de TODAS
      // as subs pelo TEMPO REAL que esse tick consumiu às cegas (um timeout
      // da bridge leva 60s — extensão fixa de +3.5s deixava o deadline
      // consumir 56.5s "cego" por ciclo e expirava ghost/poll injustamente).
      // Assim "esperar em paz" mesmo durante outages: deadline não consome
      // quando a gente nem consegue checar status. Também adia o prazo de
      // fantasma: não dá pra acusar fantasma se nem conseguimos ler.
      const blindMs = Date.now() - tickStart + POLL_INTERVAL_MS;
      console.warn(`[magnific-batch] tick falhou (estendendo deadlines +${Math.round(blindMs / 1000)}s):`, (e as Error)?.message);
      for (const sub of subs.values()) {
        sub.deadline += blindMs;
        if (!sub.everSeen) sub.notSeenDeadline += blindMs;
      }
      return;
    }
    // Tick com fetch OK = extensão + Magnific vivos (sinal pro watchdog do
    // pipeline: não é stall global, é render demorando — esperar em paz).
    onActivity?.();
    for (const [id, sub] of subs) {
      const r = m.get(id);
      if (!r) continue;          // ainda não apareceu (race após render OU fantasma)
      sub.everSeen = true;       // apareceu (pending/completed/failed) → não é fantasma
      if (r.status === 'completed' && r.url) {
        subs.delete(id);
        sub.resolve(r);
      } else if (r.status === 'failed') {
        subs.delete(id);
        sub.resolve(r);
      }
      // status 'pending'/'processing' → continua aguardando paciente
    }
  }

  function ensure() {
    if (timer || stopped) return;
    timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    setTimeout(() => void tick(), 100);
  }

  return {
    poll(identifier, timeoutMs, notSeenTimeoutMs) {
      if (stopped) return Promise.reject(new Error('Poller parado.'));
      return new Promise((resolve, reject) => {
        const now = Date.now();
        subs.set(identifier, {
          identifier,
          deadline: now + timeoutMs,
          startedAt: now,
          everSeen: false,
          notSeenDeadline: notSeenTimeoutMs ? now + notSeenTimeoutMs : Infinity,
          resolve,
          reject,
        });
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

async function pollCreation(
  identifier: string,
  timeoutMs: number,
  notSeenTimeoutMs?: number,
): Promise<CreationResult> {
  const p = createBatchPoller();
  try {
    return await p.poll(identifier, timeoutMs, notSeenTimeoutMs);
  } finally {
    p.stop();
  }
}
