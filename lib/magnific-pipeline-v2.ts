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

/** Semáforo simples — limita N operações simultâneas. */
class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(public readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
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

  // ───────── Semáforos + batch poller compartilhado ─────────
  const imgSem = new Semaphore(imageConcurrency);
  const vidSem = new Semaphore(videoConcurrency);
  const poller = createBatchPoller();

  emit(
    `Disparando ${total} takes (${imageConcurrency} img / ${videoConcurrency} vid simultâneo)...`,
    'dispatch',
    6,
  );

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
            message: 'Gerando imagem (Nano Banana 2 Flash)...',
          });
          emit(`Take ${take.idx}: imagem...`, 'running', undefined as unknown as number);
          const img = await generateImage({
            prompt: take.imagePrompt,
            aspectRatio: '9:16',
            resolution: '1k',
            smartPrompt: true,
          });
          if (img.status !== 'completed' || !img.url) {
            throw new Error(`Image falhou: ${img.status}`);
          }
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
            message: 'Animando (Kling 2.5, ~5-8min)...',
            // @ts-expect-error mantém compat
            imageUrl,
          });
          emit(`Take ${take.idx}: vídeo...`, 'running', undefined as unknown as number);
          const vid = await generateVideoFromImage({
            prompt: take.videoPrompt || take.imagePrompt,
            startImageUrl: imageUrl,
            aspectRatio: '9:16',
            resolution: '720p',
            duration: 10,
          });
          if (vid.status !== 'completed' || !vid.url) {
            throw new Error(`Video falhou: ${vid.status}`);
          }
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
      patchTake(s.idx, { status: 'ready', videoUrl: s.videoUrl, mp4Size: ab.byteLength });
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
