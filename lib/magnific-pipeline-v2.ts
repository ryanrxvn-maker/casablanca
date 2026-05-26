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

const DEFAULT_IMAGE_CONC = 12;
const DEFAULT_VIDEO_CONC = 6;

// Throttle de DISPARO (não de concurrência): garante intervalo mínimo entre
// dois acquire() consecutivos pra evitar burst de N requests simultâneas que
// causa 429 "Too Many Attempts" no Magnific.
//
// Empírico: 12 imagens em <1s sempre vira 429. Espaçando ~800ms entre cada
// disparo (12 * 800ms = ~10s pra mandar todas), Magnific aceita tranquilo.
const IMAGE_DISPATCH_INTERVAL_MS = 800;
const VIDEO_DISPATCH_INTERVAL_MS = 1500;

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
 *   - 429 / rate limit
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
  // Tudo que parece rede/server = retryable
  return (
    msg.includes('429') ||
    msg.includes('too many') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
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

/** Backoff escalonado pra erros transientes. Início suave (3s) pra não
 *  pausar o pipeline cedo demais; cresce até 3min. Empírico: Magnific
 *  responde bem com retries curtos no início, só pede pause longa em
 *  abuse real (429 sustentado).  */
function backoffMs(attempt: number): number {
  const ladder = [3_000, 6_000, 10_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000];
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
    await assertZeroCreditCost();
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
  const poller = createBatchPoller();

  emit(
    `Disparando ${total} takes (${imageConcurrency} img · ${videoConcurrency} vid · disparo escalonado anti-429)...`,
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
  const RETRY_DELAY_STATUS_MS = 3000;
  const PER_TAKE_RETRY_BUDGET_MS = 15 * 60_000; // 15min total em retries
  const GLOBAL_WATCHDOG_MS = 5 * 60_000;        // 5min sem progresso → abort

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
        throw new Error('Pipeline abortado por watchdog (5min sem progresso geral)');
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
        });
        noteProgress();
        if (img.status === 'completed' && img.url) return { url: img.url };
        lastErr = new Error(`Magnific status:${img.status}`);
        statusAttempt++;
        if (statusAttempt >= MAX_RETRIES_STATUS_FAILED) throw lastErr;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_STATUS_MS * statusAttempt));
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (isRetryableError(e)) {
          netAttempt++;
          if (netAttempt > MAX_RETRIES_NETWORK) throw lastErr;
          const waitMs = backoffMs(netAttempt);
          const errSnip = lastErr.message.slice(0, 60);
          console.warn(`[img] retryable #${netAttempt}/${MAX_RETRIES_NETWORK} — wait ${waitMs/1000}s — ${errSnip}`);
          // Telemetria visível no take card
          onAttempt(total, `Rede falhou (${errSnip}) — wait ${Math.round(waitMs/1000)}s · retry ${netAttempt}/20`);
          // Só propaga cooldown GLOBAL pra outros workers se backoff >= 60s
          // (= é um problema sério, não só uma falha pontual). Pra falhas
          // rápidas, esse worker espera sozinho.
          if (waitMs >= 60_000) imgSem.setCooldown(Date.now() + Math.min(waitMs, 60_000));
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          statusAttempt++;
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
    startImageUrl: string,
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
      onAttempt(total);
      try {
        noteProgress();
        const vid = await generateVideoFromImage({
          prompt,
          startImageUrl,
          aspectRatio: '9:16',
          resolution: '720p',
          duration: 10,
        });
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
          const waitMs = backoffMs(netAttempt);
          const errSnip = lastErr.message.slice(0, 60);
          console.warn(`[vid] retryable #${netAttempt}/${MAX_RETRIES_NETWORK} — wait ${waitMs/1000}s — ${errSnip}`);
          onAttempt(total, `Rede (${errSnip}) — wait ${Math.round(waitMs/1000)}s · retry ${netAttempt}/20`);
          if (waitMs >= 60_000) vidSem.setCooldown(Date.now() + Math.min(waitMs, 60_000));
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
        let imageUrl: string;
        try {
          patchTake(take.idx, {
            status: 'running',
            phase: 'image-gen',
            percent: 10,
            message: 'Compondo frame inicial · Nano Banana 1K',
          });
          emit(`Take ${take.idx}: imagem...`, 'running', undefined as unknown as number);
          const img = await generateImageWithRetry(take.imagePrompt, (n, customMsg) => {
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
          patchTake(take.idx, { status: 'video-done', imageUrl, videoUrl: vid.url });
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
  const entries: ZipEntry[] = [];
  let downloaded = 0;
  for (const s of takeStates) {
    if (s.status !== 'video-done') continue;
    try {
      // pikaso.cdnpk.net não passa por Cloudflare; fetch direto do browser ok
      const r = await fetch(s.videoUrl, { signal: cb.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ab = await r.arrayBuffer();
      entries.push({
        name: `take_${String(s.idx).padStart(2, '0')}.mp4`,
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
