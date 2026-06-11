/**
 * runMagnificPipelineV2 — drop-in compatível com runMagnificPipeline.
 *
 * 100% CLIENT-SIDE via extension Freepik Sync (window.postMessage →
 * content script → background.js → magnific.com).
 *
 * Por que client-side: Cloudflare bloqueia chamadas do backend Vercel
 * (TLS JA3 fingerprint / IP de data center). A extensão fetcha do
 * browser real — passa Cloudflare 100%.
 *
 * Pipeline:
 *   1. Confirma extensão instalada + Magnific conectado
 *   2. assertZeroCreditCost (unlimited-status + simulate-generation)
 *   3. Pra cada take em paralelo (semáforo 12 img / 6 vid):
 *        a. generateImage (start-tti-v2 + render/v4 + batch poll)
 *        b. generateVideoFromImage (POST /generate + batch poll)
 *   4. Download MP4s assinados (browser fetch direto, CDN sem CF)
 *   5. Empacota ZIP + retorna
 */

import type {
  MagnificPipelineConfig,
  PipelineCallbacks,
  TakeState,
  PipelineProgress,
} from './magnific-pipeline';
import { buildZip, type ZipEntry } from './zip-builder';
import { isExtensionInstalled, ExtensionNotInstalledError } from './magnific-bridge';
import {
  assertZeroCreditCost,
  generateImage,
  generateVideoFromImage,
  generateVideoFromText,
  createBatchPoller,
} from './magnific-api-client';

type RunnerResultV2 = {
  ok: boolean;
  spaceId?: string;
  spaceUrl?: string;
  takes: TakeState[];
  zipBlob?: Blob;
  zipName?: string;
  successCount: number;
  failedCount: number;
  complete?: boolean;
  missingIdxs?: number[];
};

// CONCORRENCIA OTIMIZADA (2026-06-10):
// IMAGE e VIDEO tem SEMAFOROS SEPARADOS — o cap "exceeded concurrent" do
// Magnific (~4-6/conta) é aferido no SUBMIT; quando bate, o backoff
// agressivo + cooldown global JÁ regula sozinho (auto-tuning). Então
// podemos empurrar mais forte sem risco de falha: se o cap server-side for
// menor, alguns takes só esperam vaga e re-submetem — nunca falham.
//   - Imagem (Nano Banana, rápida): 6 simultâneas
//   - Vídeo (Kling, lento): 3 simultâneos
// Ganho real sob relaxed mode: TODOS os takes entram na fila do Magnific
// muito mais rápido (intervalo de disparo curto), então o Magnific
// processa continuamente em vez de receber a conta-gotas.
const DEFAULT_IMAGE_CONC = 6;
const DEFAULT_VIDEO_CONC = 3;

// Throttle de DISPARO (não de concurrência): intervalo mínimo entre dois
// acquire() — só evita burst instantâneo. Reduzido p/ 600/1200ms: 45 takes
// entram na fila em ~27s em vez de ~67s. O cooldown anti-429 (setCooldown)
// pausa tudo se o Magnific reclamar, então disparo rápido é seguro.
const IMAGE_DISPATCH_INTERVAL_MS = 600;
const VIDEO_DISPATCH_INTERVAL_MS = 1200;

/** Semáforo com throttle de disparo: limita N simultâneas E espaça acquires
 *  por intervalMs mínimos. Também tem "global cooldown" que pausa TUDO
 *  quando detectamos 429 (set via setCooldown). */
class ThrottledSemaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  private lastDispatchAt = 0;
  /** Quando >0: tudo pausa até esse timestamp. Setado por 429 detection. */
  private cooldownUntilMs = 0;

  constructor(
    public readonly max: number,
    public readonly intervalMs: number,
    public readonly label: string,
  ) {}

  /** Pausa TODOS os acquire ativos + futuros até `untilMs`. */
  setCooldown(untilMs: number): void {
    if (untilMs > this.cooldownUntilMs) this.cooldownUntilMs = untilMs;
  }

  async acquire(): Promise<void> {
    // 1. Espera vaga no semáforo
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;

    // 2. Respeita global cooldown (429 backoff)
    if (this.cooldownUntilMs > Date.now()) {
      const wait = this.cooldownUntilMs - Date.now();
      console.warn(`[${this.label} sem] cooldown 429 — esperando ${Math.round(wait/1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }

    // 3. Throttle: garante intervalo mínimo desde último dispatch
    const sinceLast = Date.now() - this.lastDispatchAt;
    if (sinceLast < this.intervalMs) {
      await new Promise((r) => setTimeout(r, this.intervalMs - sinceLast));
    }
    this.lastDispatchAt = Date.now();
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/** Detecta se um erro é "retryable" — vale fazer backoff e tentar de novo:
 *   - 429 / rate limit / exceeded concurrent
 *   - Failed to fetch / network errors (Cloudflare drop, extension reconnect)
 *   - timeouts
 *   - 5xx server errors
 *   - "fetch failed"
 *
 *  Erros NÃO retryable (= falha permanente, marcar failed):
 *   - NSFW content blocked
 *   - 4xx (exceto 429)
 *   - "blocked by policy"
 */
function isRetryableError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  // PERMANENTES (NÃO retry — só desperdiça tempo):
  //  - NSFW / content policy → prompt bloqueado, retry com seed novo não resolve
  //  - MAGNIFIC_CAP_EXCEEDED → conta estourou usage do ciclo, server devolve
  //    HTML paywall. Retry só queima tempo. User tem que aguardar reset
  //    OU usar outra conta.
  if (msg.includes('nsfw') || msg.includes('blocked by') || msg.includes('content policy')) {
    return false;
  }
  if (msg.includes('magnific_cap_exceeded') || msg.includes('cap do ciclo') || msg.includes('paywall')) {
    return false;
  }
  // Tudo que parece rede/server/limit = retryable
  return (
    msg.includes('fantasma') ||           // render fantasma → re-disparar (id novo)
    msg.includes('429') ||
    msg.includes('too many') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('exceeded concurrent') || // Magnific-specific: hard cap por conta
    msg.includes('concurrent') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('cloudflare') ||
    msg.includes('extension') ||
    msg.includes('bridge') ||
    msg.includes('disconnected')
  );
}

/** True se o erro indica que Magnific rejeitou por excesso de paralelismo
 *  ("rate_limit_exceeded f57009f has exceeded concurrent"). Diferente de
 *  429 generico — esse pede backoff AGRESSIVO porque significa que ja
 *  tem N renders rodando E o server rejeitou + 1. */
function isConcurrentExceeded(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('exceeded concurrent') || msg.includes('rate_limit_exceeded');
}

/** True se é "render fantasma" (aceito mas nunca enfileirado pela Magnific).
 *  Cura = re-disparar JÁ (id novo quase sempre enfileira). NÃO é 429, então
 *  não merece backoff longo nem cooldown global. */
function isGhostRender(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes('fantasma');
}

/** True se a IMAGEM foi NEGADA (política de conteúdo OU status:failed
 *  persistente pós re-seeds — o Magnific não declara motivo, mas failed
 *  repetido em prompt médico = filtro de conteúdo na prática). Nesses casos
 *  o take NÃO morre: cai pro fallback text-to-video direto no Kling 2.5
 *  (sem keyframe). Pedido do user: "se a geração da imagem for negada,
 *  roda só o prompt no Kling". */
function isImageDeniedError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes('img_denied') ||
    msg.includes('nsfw') ||
    msg.includes('blocked by') ||
    msg.includes('content policy') ||
    msg.includes('magnific status:failed')
  );
}

/** Backoff escalonado pra erros transientes. Início suave (3s) pra não
 *  pausar o pipeline cedo demais; cresce até 3min. */
function backoffMs(attempt: number): number {
  const ladder = [3_000, 6_000, 10_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000];
  return ladder[Math.min(attempt - 1, ladder.length - 1)];
}

/** Backoff AGRESSIVO pra "exceeded concurrent" — começa em 15s e cresce
 *  rapido. Razao: esse erro indica que o cap server-side foi atingido,
 *  preciso esperar OUTROS renders terminarem antes de tentar dispatch novo. */
function backoffConcurrentMs(attempt: number): number {
  const ladder = [15_000, 30_000, 60_000, 90_000, 120_000, 180_000, 240_000, 300_000];
  return ladder[Math.min(attempt - 1, ladder.length - 1)];
}

export async function runMagnificPipelineV2(
  cfg: MagnificPipelineConfig,
  cb: PipelineCallbacks = {},
): Promise<RunnerResultV2> {
  const { takes, spaceName } = cfg;
  const total = takes.length;
  const imageConcurrency = cfg.imageConcurrency ?? DEFAULT_IMAGE_CONC;
  const videoConcurrency = cfg.videoConcurrency ?? DEFAULT_VIDEO_CONC;

  if (total === 0) {
    return {
      ok: false,
      takes: [],
      successCount: 0,
      failedCount: 0,
      complete: false,
      missingIdxs: [],
    };
  }

  const takeStates: TakeState[] = takes.map((t) => ({
    idx: t.idx,
    status: 'running',
    phase: 'init',
    percent: 0,
    message: 'Aguardando...',
  }));

  function emit(message: string, phase: string, percent: number) {
    const ready = takeStates.filter((s) => s.status === 'ready').length;
    const p: PipelineProgress = {
      spaceId: `ext-v2:${spaceName}`,
      spaceUrl: undefined,
      takes: takeStates,
      ready,
      total,
      message,
      phase,
      percent,
    };
    cb.onProgress?.(p);
  }

  function patchTake(idx: number, patch: Partial<TakeState>) {
    const i = takeStates.findIndex((s) => s.idx === idx);
    if (i === -1) return;
    takeStates[i] = { ...takeStates[i], ...patch } as TakeState;
  }

  // ───────── Pre-flight: extensão + guard zero-créditos ─────────
  emit('Verificando extensão Auto Edit · Freepik Sync...', 'preflight', 2);
  const extOk = await isExtensionInstalled();
  if (!extOk) {
    const err = new ExtensionNotInstalledError().message;
    takeStates.forEach((s, i) => {
      takeStates[i] = { idx: s.idx, status: 'failed', error: err };
    });
    emit(err, 'failed', 0);
    return {
      ok: false,
      takes: takeStates,
      successCount: 0,
      failedCount: total,
      complete: false,
      missingIdxs: takes.map((t) => t.idx),
    };
  }

  emit('Validando Unlimited + custo zero...', 'preflight', 4);
  try {
    // 3 tentativas: o preflight faz ~5 round-trips pela bridge e UMA falha
    // transiente (timeout 60s, blip de rede) matava o batch INTEIRO na hora.
    // Erros permanentes (banida/unlimited off/custo>0) falham direto.
    const PREFLIGHT_DELAYS = [3_000, 8_000, 20_000];
    for (let attempt = 0; ; attempt++) {
      try {
        await assertZeroCreditCost();
        break;
      } catch (e) {
        if (attempt >= PREFLIGHT_DELAYS.length || !isRetryableError(e)) throw e;
        const wait = PREFLIGHT_DELAYS[attempt];
        console.warn(`[pipeline] preflight falhou (retry ${attempt + 1}/3 em ${wait / 1000}s):`, (e as Error)?.message);
        emit(`Preflight instável — tentando de novo em ${wait / 1000}s (${attempt + 1}/3)...`, 'preflight', 4);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    takeStates.forEach((s, i) => {
      takeStates[i] = { idx: s.idx, status: 'failed', error: msg };
    });
    emit('Guard zero-créditos rejeitou: ' + msg, 'failed', 0);
    return {
      ok: false,
      takes: takeStates,
      successCount: 0,
      failedCount: total,
      complete: false,
      missingIdxs: takes.map((t) => t.idx),
    };
  }

  // ───────── Semáforos com throttle + cooldown ─────────
  const imgSem = new ThrottledSemaphore(imageConcurrency, IMAGE_DISPATCH_INTERVAL_MS, 'img');
  const vidSem = new ThrottledSemaphore(videoConcurrency, VIDEO_DISPATCH_INTERVAL_MS, 'vid');
  // Poller compartilhado alimenta o watchdog: tick com fetch OK = sistema
  // vivo (render demorando ≠ stall). noteProgress é function declaration
  // (hoisted) — referenciar aqui é seguro.
  const poller = createBatchPoller(() => noteProgress());
  // CANCELAR de verdade: antes o signal só era usado nos downloads — a
  // geração continuava rodando invisível e o user re-disparava por cima
  // (double-dispatch). Agora o abort derruba o poller (rejeita polls em voo)
  // e os retry loops checam o signal antes de cada tentativa.
  if (cb.signal) {
    if (cb.signal.aborted) poller.stop();
    else cb.signal.addEventListener('abort', () => poller.stop(), { once: true });
  }

  // Stamp visível na UI: confirma qual versão do pipeline o bundle carregado
  // está rodando (diagnóstico de "user não recarregou a aba").
  const PIPELINE_BUILD = 'r3';
  console.log(`[pipeline] build ${PIPELINE_BUILD} — ghost-detect + pending 30min + watchdog poll-aware`);
  emit(
    `Disparando ${total} takes (${imageConcurrency} img · ${videoConcurrency} vid · anti-429 · ${PIPELINE_BUILD})...`,
    'dispatch',
    6,
  );

  // ───────── Retry policy (tolerante + bounded) ─────────
  // User pediu: "NUNCA falhe por não esperar" + "JAMAIS travar infinito".
  // Equilíbrio:
  //   - Per-take HARD CAP: 15min em retries (não no render real do Kling
  //     que pode levar 60min — esse é polling do status). Se demora 15min
  //     SÓ pra conseguir disparar, marca failed e segue (outros 29 takes
  //     não pagam pela falha de 1).
  //   - GLOBAL WATCHDOG: se NENHUM take avançou fase em 5min, aborta
  //     pipeline com erro claro ("extension caiu / Magnific bloqueado").
  //   - Telemetria visível: cada wait/retry vira mensagem no take card.
  const MAX_RETRIES_NETWORK = 20;
  const MAX_RETRIES_STATUS_FAILED = 5;
  // Regra do user (2026-06-10): prioridade SEMPRE é imagem (Nano Banana) →
  // animar com Kling. Se a IMAGEM for NEGADA por política (status failed /
  // nsfw), re-tenta UMA vez (re-seed); negou DE NOVO (2ª) → desiste da
  // imagem e gera aquele take direto no Kling text-to-video.
  const MAX_IMG_DENIED_BEFORE_T2V = 2;
  const RETRY_DELAY_STATUS_MS = 3000;
  const PER_TAKE_RETRY_BUDGET_MS = 15 * 60_000; // 15min total em retries
  // 7min (era 5): backoff máximo de concurrent-cap é 5min — com 1 take
  // restante em backoff longo, 5min de watchdog abortava EXATAMENTE no
  // limite. Agora o poller também reporta atividade (tick OK), então o
  // watchdog só dispara em stall real (bridge/extensão morta).
  const GLOBAL_WATCHDOG_MS = 7 * 60_000;

  // Watchdog: marca o timestamp do último progresso de QUALQUER take.
  // Se passar GLOBAL_WATCHDOG_MS sem update, signal aborta tudo.
  let lastProgressAt = Date.now();
  function noteProgress() { lastProgressAt = Date.now(); }
  const watchdogAbort = new AbortController();
  const watchdogTimer = setInterval(() => {
    if (Date.now() - lastProgressAt > GLOBAL_WATCHDOG_MS) {
      console.error(`[pipeline] WATCHDOG: ${GLOBAL_WATCHDOG_MS/60000}min sem progresso. Abortando.`);
      watchdogAbort.abort();
      clearInterval(watchdogTimer);
      // Derruba o poller: rejeita TODAS as subs em voo na hora. Sem isso,
      // polls pendurados (deadline estendido a cada tick falho) seguravam o
      // Promise.all pra sempre → job RUNNING eterno com bridge morta.
      poller.stop();
    }
  }, 30_000);

  async function generateImageWithRetry(
    prompt: string,
    onAttempt: (n: number, msg?: string) => void,
  ): Promise<{ url: string }> {
    const budgetStart = Date.now();
    let lastErr: Error | null = null;
    let netAttempt = 0;
    let statusAttempt = 0;
    const HARD_CAP = MAX_RETRIES_NETWORK + MAX_RETRIES_STATUS_FAILED;
    for (let total = 1; total <= HARD_CAP; total++) {
      // BUDGET CHECK — desiste se ficou 15min só em retry
      if (Date.now() - budgetStart > PER_TAKE_RETRY_BUDGET_MS) {
        throw lastErr || new Error(`Budget esgotado (${PER_TAKE_RETRY_BUDGET_MS/60000}min em retries)`);
      }
      if (watchdogAbort.signal.aborted) {
        throw new Error('Pipeline abortado por watchdog (sem progresso geral)');
      }
      if (cb.signal?.aborted) {
        throw new Error('Cancelado pelo usuário');
      }
      onAttempt(total);
      try {
        noteProgress();
        const img = await generateImage({
          prompt,
          aspectRatio: '9:16',
          resolution: '1k',
          smartPrompt: true,
          seed: Math.floor(Math.random() * 1_000_000),
        }, poller);
        noteProgress();
        if (img.status === 'completed' && img.url) return { url: img.url };
        lastErr = new Error(`Magnific status:${img.status}`);
        statusAttempt++;
        // NEGAÇÃO POR POLÍTICA (status failed do render): 1ª vez re-tenta
        // com seed novo; 2ª negação → desiste da IMAGEM e o take cai pro
        // fallback Kling text-to-video (catch do take loop).
        if (img.status === 'failed' && statusAttempt >= MAX_IMG_DENIED_BEFORE_T2V) {
          throw new Error(`IMG_DENIED: imagem negada ${statusAttempt}x (Magnific status:failed) — fallback Kling`);
        }
        if (statusAttempt >= MAX_RETRIES_STATUS_FAILED) throw lastErr;
        onAttempt(total, `Imagem negada (${statusAttempt}ª) — re-tentando com seed novo`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_STATUS_MS * statusAttempt));
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        // Negação 2x já decidida acima — propaga direto pro fallback t2v
        if (lastErr.message.startsWith('IMG_DENIED:')) throw lastErr;
        if (isRetryableError(e)) {
          netAttempt++;
          if (netAttempt > MAX_RETRIES_NETWORK) throw lastErr;
          // FANTASMA: render aceito mas nunca enfileirado. Re-dispara JÁ (id
          // novo cola). Backoff curtinho, SEM cooldown global (não é 429).
          const isGhost = isGhostRender(e);
          // SE eh "exceeded concurrent" → backoff AGRESSIVO + propaga cooldown
          // GLOBAL pros outros workers tambem pausarem (senao ficam empurrando
          // mais requests e Magnific re-rejeita).
          const isConcurrent = isConcurrentExceeded(e);
          const waitMs = isGhost ? 1500 : isConcurrent ? backoffConcurrentMs(netAttempt) : backoffMs(netAttempt);
          const errSnip = lastErr.message.slice(0, 60);
          console.warn(`[img] ${isGhost ? 'GHOST' : isConcurrent ? 'CONCURRENT-CAP' : 'retryable'} #${netAttempt}/${MAX_RETRIES_NETWORK} — wait ${waitMs/1000}s — ${errSnip}`);
          onAttempt(total, isGhost
            ? `Render fantasma — re-disparando (id novo) · ${netAttempt}ª`
            : isConcurrent
            ? `Magnific cheio (${waitMs/1000}s aguardando vaga) · retry ${netAttempt}/20`
            : `Rede falhou (${errSnip}) — wait ${Math.round(waitMs/1000)}s · retry ${netAttempt}/20`);
          // Propaga cooldown GLOBAL pros outros workers se backoff longo OU
          // concurrent-cap (pausa TODO mundo, evita storm). Fantasma NÃO pausa.
          if (!isGhost && (isConcurrent || waitMs >= 60_000)) {
            imgSem.setCooldown(Date.now() + Math.min(waitMs, 90_000));
            vidSem.setCooldown(Date.now() + Math.min(waitMs, 90_000));
          }
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          statusAttempt++;
          // nsfw/content-policy explícito = negação por política → mesma
          // regra: 2 strikes e cai pro fallback Kling text-to-video
          if (isImageDeniedError(e) && statusAttempt >= MAX_IMG_DENIED_BEFORE_T2V) {
            throw new Error(`IMG_DENIED: ${lastErr.message.slice(0, 80)}`);
          }
          if (statusAttempt >= MAX_RETRIES_STATUS_FAILED) throw lastErr;
          console.warn(`[img] non-net err attempt#${statusAttempt}`);
          onAttempt(total, `Falha (${lastErr.message.slice(0,40)}) — re-seed`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_STATUS_MS * statusAttempt));
        }
      }
    }
    throw lastErr || new Error('Image falhou após retries totais');
  }

  async function generateVideoWithRetry(
    prompt: string,
    startImageUrl: string | null, // null = text-to-video puro (imagem negada)
    onAttempt: (n: number, msg?: string) => void,
  ): Promise<{ url: string }> {
    const budgetStart = Date.now();
    let lastErr: Error | null = null;
    let netAttempt = 0;
    let statusAttempt = 0;
    const HARD_CAP = MAX_RETRIES_NETWORK + MAX_RETRIES_STATUS_FAILED;
    for (let total = 1; total <= HARD_CAP; total++) {
      // BUDGET pra retries — render real do Kling não conta (é dentro do generateVideoFromImage polling)
      if (Date.now() - budgetStart > PER_TAKE_RETRY_BUDGET_MS) {
        throw lastErr || new Error(`Budget de retries esgotado`);
      }
      if (watchdogAbort.signal.aborted) {
        throw new Error('Pipeline abortado por watchdog');
      }
      if (cb.signal?.aborted) {
        throw new Error('Cancelado pelo usuário');
      }
      onAttempt(total);
      try {
        noteProgress();
        const vid = startImageUrl
          ? await generateVideoFromImage({
              prompt,
              startImageUrl,
              aspectRatio: '9:16',
              resolution: '720p',
              duration: 10,
            }, poller)
          : await generateVideoFromText({
              prompt,
              aspectRatio: '9:16',
              resolution: '720p',
              duration: 10,
            }, poller);
        noteProgress();
        if (vid.status === 'completed' && vid.url) return { url: vid.url };
        lastErr = new Error(`Magnific status:${vid.status}`);
        statusAttempt++;
        if (statusAttempt >= MAX_RETRIES_STATUS_FAILED) throw lastErr;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_STATUS_MS * statusAttempt));
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (isRetryableError(e)) {
          netAttempt++;
          if (netAttempt > MAX_RETRIES_NETWORK) throw lastErr;
          // Fantasma re-dispara já (id novo); concurrent-cap = backoff agressivo
          const isGhost = isGhostRender(e);
          const isConcurrent = isConcurrentExceeded(e);
          const waitMs = isGhost ? 1500 : isConcurrent ? backoffConcurrentMs(netAttempt) : backoffMs(netAttempt);
          const errSnip = lastErr.message.slice(0, 60);
          console.warn(`[vid] ${isGhost ? 'GHOST' : isConcurrent ? 'CONCURRENT-CAP' : 'retryable'} #${netAttempt}/${MAX_RETRIES_NETWORK} — wait ${waitMs/1000}s — ${errSnip}`);
          onAttempt(total, isGhost
            ? `Render fantasma — re-disparando (id novo) · ${netAttempt}ª`
            : isConcurrent
            ? `Magnific cheio (${waitMs/1000}s aguardando vaga) · retry ${netAttempt}/20`
            : `Rede (${errSnip}) — wait ${Math.round(waitMs/1000)}s · retry ${netAttempt}/20`);
          if (!isGhost && (isConcurrent || waitMs >= 60_000)) {
            imgSem.setCooldown(Date.now() + Math.min(waitMs, 90_000));
            vidSem.setCooldown(Date.now() + Math.min(waitMs, 90_000));
          }
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          statusAttempt++;
          if (statusAttempt >= MAX_RETRIES_STATUS_FAILED) throw lastErr;
          onAttempt(total, `Falha (${lastErr.message.slice(0,40)}) — re-seed`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_STATUS_MS * statusAttempt));
        }
      }
    }
    throw lastErr || new Error('Video falhou após retries totais');
  }

  // ───────── Pipeline por take ─────────
  await Promise.all(
    takes.map(async (take) => {
      try {
        // === IMAGE ===
        await imgSem.acquire();
        // null = imagem negada pelo filtro → fallback text-to-video no Kling
        let imageUrl: string | null = null;
        try {
          patchTake(take.idx, {
            status: 'running',
            phase: 'image-gen',
            percent: 10,
            message: 'Compondo frame inicial · Nano Banana 1K',
          });
          emit(`Take ${take.idx}: imagem...`, 'running', undefined as unknown as number);
          const img = await generateImageWithRetry(take.imagePrompt, (n, customMsg) => {
            noteProgress(); // decisão de retry/backoff = sistema vivo
            if (n > 1 || customMsg) {
              patchTake(take.idx, {
                status: 'running',
                phase: 'image-gen',
                percent: 10,
                message: customMsg || `Recompondo · ${n}ª variação`,
              });
            }
          });
          imageUrl = img.url;
          patchTake(take.idx, { status: 'image-done', imageUrl });
        } catch (e) {
          // IMAGEM NEGADA (filtro de conteúdo / failed persistente) → NÃO
          // mata o take: anima o prompt DIRETO no Kling 2.5 (text-to-video).
          // O ideal segue sendo animar a imagem — isso é rede de segurança.
          if (!isImageDeniedError(e)) throw e;
          console.warn(`[take ${take.idx}] imagem NEGADA (${(e as Error).message.slice(0, 60)}) — fallback text-to-video Kling`);
          patchTake(take.idx, {
            status: 'running',
            phase: 'image-gen',
            percent: 25,
            message: 'Imagem negada pelo filtro — gerando vídeo DIRETO no Kling 2.5',
          });
        } finally {
          imgSem.release();
        }

        // === VIDEO ===
        await vidSem.acquire();
        const vidStartedAt = Date.now();
        // Timer mostra elapsed time. Kling 2.5 sob carga pesada pode levar
        // 30-60min — user pediu "esperar em paz". Mostramos o relógio
        // andando pra dar feedback visual de que tá vivo.
        const tickTimer = setInterval(() => {
          const elapsedMin = (Date.now() - vidStartedAt) / 60_000;
          patchTake(take.idx, {
            status: 'running',
            phase: 'video-gen',
            percent: 40,
            message: elapsedMin < 6
              ? `Renderizando movimento · Kling 2.5 · ${elapsedMin.toFixed(1)}min`
              : `Render sob carga — esperando em paz · ${elapsedMin.toFixed(0)}min decorridos`,
            // @ts-expect-error mantém compat
            imageUrl,
          });
        }, 15_000);
        try {
          patchTake(take.idx, {
            status: 'running',
            phase: 'video-gen',
            percent: 40,
            message: 'Renderizando movimento · Kling 2.5 (iniciando)',
            // @ts-expect-error mantém compat
            imageUrl,
          });
          emit(`Take ${take.idx}: vídeo...`, 'running', undefined as unknown as number);
          const vid = await generateVideoWithRetry(
            take.videoPrompt || take.imagePrompt,
            imageUrl,
            (n, customMsg) => {
              noteProgress(); // decisão de retry/backoff = sistema vivo
              if (n > 1 || customMsg) {
                patchTake(take.idx, {
                  status: 'running',
                  phase: 'video-gen',
                  percent: 40,
                  message: customMsg || `Re-render · ${n}ª passada (paciência, vai render)`,
                  // @ts-expect-error compat
                  imageUrl,
                });
              }
            },
          );
          patchTake(take.idx, { status: 'video-done', imageUrl: imageUrl || undefined, videoUrl: vid.url });
        } finally {
          clearInterval(tickTimer);
          vidSem.release();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        patchTake(take.idx, { status: 'failed', error: msg });
      }
    }),
  );
  poller.stop();
  clearInterval(watchdogTimer);

  // ───────── Download MP4s ─────────
  emit('Baixando vídeos finais...', 'downloading', 90);
  // Nome do arquivo = O QUE A CENA ILUSTRA (label/section do JSON), pra dar
  // match perfeito no CutFeeling por nicho. Ex: "03 - PROSTATA INCHANDO.mp4".
  // Prefixo NN mantém ordenação + unicidade; sem label cai no take_NN antigo.
  const fileSafe = (s2: string) =>
    s2.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
  function takeFileName(idx: number): string {
    const t = takes.find((tk) => tk.idx === idx);
    const label = t?.label ? fileSafe(t.label) : '';
    const nn = String(idx).padStart(2, '0');
    return label ? `${nn} - ${label}.mp4` : `take_${nn}.mp4`;
  }
  const entries: ZipEntry[] = [];
  let downloaded = 0;
  for (const s of takeStates) {
    if (s.status !== 'video-done') continue;
    try {
      // pikaso.cdnpk.net não passa por Cloudflare; fetch direto do browser ok.
      // 3 tentativas: blip de rede num download de 10-50MB marcava como FAILED
      // um render que JÁ ESTAVA PRONTO (e o auto-retry re-renderizava à toa).
      const DL_DELAYS = [2_000, 5_000, 15_000];
      let ab: ArrayBuffer | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(s.videoUrl, { signal: cb.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          ab = await r.arrayBuffer();
          break;
        } catch (e) {
          if (attempt >= DL_DELAYS.length || cb.signal?.aborted) throw e;
          console.warn(`[download] take ${s.idx} falhou (retry ${attempt + 1}/3):`, (e as Error)?.message);
          await new Promise((r2) => setTimeout(r2, DL_DELAYS[attempt]));
        }
      }
      if (!ab) throw new Error('download vazio');
      entries.push({
        name: takeFileName(s.idx),
        data: ab,
      });
      patchTake(s.idx, {
        status: 'ready',
        videoUrl: s.videoUrl,
        mp4Size: ab.byteLength,
        imageUrl: s.imageUrl, // preserva pra poster do preview
      });
      downloaded++;
      emit(
        `Baixados ${downloaded} take(s)...`,
        'downloading',
        90 + Math.round((downloaded / total) * 8),
      );
    } catch (e) {
      patchTake(s.idx, {
        status: 'failed',
        error: 'Falha download: ' + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  let zipBlob: Blob | undefined;
  let zipName: string | undefined;
  if (entries.length > 0) {
    emit('Empacotando ZIP...', 'zipping', 99);
    zipBlob = await buildZip(entries);
    zipName = `${spaceName.replace(/[^\w\d-]+/g, '_').slice(0, 60)}_takes.zip`;
  }

  const success = takeStates.filter((s) => s.status === 'ready').length;
  const failed = takeStates.filter((s) => s.status === 'failed').length;
  const missingIdxs = takeStates
    .filter((s) => s.status !== 'ready')
    .map((s) => s.idx);

  emit(
    success === total
      ? `✓ ${success}/${total} takes prontos.`
      : `Concluído: ${success}/${total} ok, ${failed} falharam.`,
    'done',
    100,
  );

  return {
    ok: success > 0,
    spaceId: `ext-v2:${spaceName}`,
    takes: takeStates,
    zipBlob,
    zipName,
    successCount: success,
    failedCount: failed,
    complete: success === total,
    missingIdxs,
  };
}
