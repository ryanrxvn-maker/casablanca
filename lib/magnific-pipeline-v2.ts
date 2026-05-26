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

/** Detecta se um erro é 429 / rate limit do Magnific. */
function is429Error(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('too many') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit')
  );
}

/** Backoff exponencial pra 429: 10s, 30s, 60s, 120s, 240s. */
function backoff429ms(attempt: number): number {
  const ladder = [10_000, 30_000, 60_000, 120_000, 240_000];
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

  // ───────── Retry policy ─────────
  // Magnific retorna status:'failed' por NSFW filter, server load, race
  // condition de Cloudflare/Cloudfront. Ou 429 "Too Many Attempts" por burst.
  //
  // Estratégia em camadas:
  //   429   → backoff exponencial (10s/30s/60s/120s/240s) + propaga global
  //           cooldown pro semáforo (todos pausam)
  //   outros → retry imediato com seed novo (NSFW evasion)
  //   max 5 retries totais (3 por 429 + 3 por outros)
  const MAX_RETRIES_429 = 5;
  const MAX_RETRIES_OTHER = 3;
  const RETRY_DELAY_OTHER_MS = 3000;

  async function generateImageWithRetry(
    prompt: string,
    onAttempt: (n: number) => void,
  ): Promise<{ url: string }> {
    let lastErr: Error | null = null;
    let attempt429 = 0;
    let attemptOther = 0;
    for (let total = 1; total <= MAX_RETRIES_429 + MAX_RETRIES_OTHER; total++) {
      onAttempt(total);
      try {
        const img = await generateImage({
          prompt,
          aspectRatio: '9:16',
          resolution: '1k',
          smartPrompt: true,
          seed: Math.floor(Math.random() * 1_000_000),
        });
        if (img.status === 'completed' && img.url) return { url: img.url };
        lastErr = new Error(`Magnific retornou status:${img.status}`);
        attemptOther++;
        if (attemptOther >= MAX_RETRIES_OTHER) throw lastErr;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_OTHER_MS * attemptOther));
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (is429Error(e)) {
          attempt429++;
          if (attempt429 > MAX_RETRIES_429) throw lastErr;
          const waitMs = backoff429ms(attempt429);
          console.warn(`[img] 429 attempt#${attempt429} — backoff ${waitMs/1000}s + propaga p/ todos`);
          // Pausa GLOBAL: todos os outros workers de imagem também esperam
          imgSem.setCooldown(Date.now() + waitMs);
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          attemptOther++;
          if (attemptOther >= MAX_RETRIES_OTHER) throw lastErr;
          await new Promise((r) => setTimeout(r, RETRY_DELAY_OTHER_MS * attemptOther));
        }
      }
    }
    throw lastErr || new Error('Image falhou após retries');
  }

  async function generateVideoWithRetry(
    prompt: string,
    startImageUrl: string,
    onAttempt: (n: number) => void,
  ): Promise<{ url: string }> {
    let lastErr: Error | null = null;
    let attempt429 = 0;
    let attemptOther = 0;
    for (let total = 1; total <= MAX_RETRIES_429 + MAX_RETRIES_OTHER; total++) {
      onAttempt(total);
      try {
        const vid = await generateVideoFromImage({
          prompt,
          startImageUrl,
          aspectRatio: '9:16',
          resolution: '720p',
          duration: 10,
        });
        if (vid.status === 'completed' && vid.url) return { url: vid.url };
        lastErr = new Error(`Magnific retornou status:${vid.status}`);
        attemptOther++;
        if (attemptOther >= MAX_RETRIES_OTHER) throw lastErr;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_OTHER_MS * attemptOther));
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (is429Error(e)) {
          attempt429++;
          if (attempt429 > MAX_RETRIES_429) throw lastErr;
          const waitMs = backoff429ms(attempt429);
          console.warn(`[vid] 429 attempt#${attempt429} — backoff ${waitMs/1000}s`);
          vidSem.setCooldown(Date.now() + waitMs);
          await new Promise((r) => setTimeout(r, waitMs));
        } else {
          attemptOther++;
          if (attemptOther >= MAX_RETRIES_OTHER) throw lastErr;
          await new Promise((r) => setTimeout(r, RETRY_DELAY_OTHER_MS * attemptOther));
        }
      }
    }
    throw lastErr || new Error('Video falhou após retries');
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
          const img = await generateImageWithRetry(take.imagePrompt, (n) => {
            if (n > 1) {
              patchTake(take.idx, {
                status: 'running',
                phase: 'image-gen',
                percent: 10,
                message: `Recompondo · ${n}ª variação`,
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
        try {
          patchTake(take.idx, {
            status: 'running',
            phase: 'video-gen',
            percent: 40,
            message: 'Renderizando movimento · Kling 2.5 (~6min)',
            // @ts-expect-error mantém compat
            imageUrl,
          });
          emit(`Take ${take.idx}: vídeo...`, 'running', undefined as unknown as number);
          const vid = await generateVideoWithRetry(
            take.videoPrompt || take.imagePrompt,
            imageUrl,
            (n) => {
              if (n > 1) {
                patchTake(take.idx, {
                  status: 'running',
                  phase: 'video-gen',
                  percent: 40,
                  message: `Re-renderizando · ${n}ª passada`,
                  // @ts-expect-error compat
                  imageUrl,
                });
              }
            },
          );
          patchTake(take.idx, { status: 'video-done', imageUrl, videoUrl: vid.url });
        } finally {
          vidSem.release();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        patchTake(take.idx, { status: 'failed', error: msg });
      }
    }),
  );
  poller.stop();

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
