'use client';

/**
 * lib/webcodecs-join — junção dos trechos limpos com CROSSFADE nas emendas.
 *
 * O trabalho pesado (decode + crossfade + encode por HARDWARE) roda num Web
 * Worker (lib/webcodecs-join.worker.ts) — ordens de grandeza mais rápido que
 * re-encodar o mesmo xfade no ffmpeg.wasm, e imune à suspensão de hardware que
 * o Chrome faz em aba oculta (em Worker o encoder continua; na main thread,
 * não). Este arquivo só orquestra: cria o worker, acompanha o progresso, e
 * depois re-muxa o ÁUDIO ORIGINAL (ffmpeg, -c:v copy = sem re-encode do vídeo).
 *
 * Blindagem: se o WebCodecs não existir, o worker falhar, ou nada progredir,
 * cai pro caminho ffmpeg (joinCleanedWithOriginalAudio) — NUNCA quebra.
 */

import {
  joinCleanedWithOriginalAudio,
  muxAudioIntoVideo,
  SEG_XFADE_SEC,
  type RunOptions,
} from './ffmpeg-worker';
import { withFFLock } from './lipsync-pipeline';

/** Roda o join no worker. Resolve com o MP4 vídeo-só, ou null (→ fallback). */
function joinViaWorker(
  parts: Blob[],
  offsets: number[],
  xfadeSec: number,
  onProgress?: (ratio: number) => void,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof Worker === 'undefined' || typeof VideoEncoder === 'undefined') { resolve(null); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./webcodecs-join.worker.ts', import.meta.url));
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    let lastPing = Date.now();
    const finish = (r: Blob | null) => {
      if (settled) return;
      settled = true;
      clearInterval(wd);
      try { worker.terminate(); } catch { /* ok */ }
      resolve(r);
    };
    // Watchdog global: nenhum sinal por 60s → desiste (o worker também tem o
    // seu, por stall; este cobre o worker morto/mudo).
    const wd = setInterval(() => { if (Date.now() - lastPing > 60_000) finish(null); }, 5_000);
    worker.onmessage = (e: MessageEvent<{ type: string; ratio?: number; blob?: Blob; message?: string }>) => {
      const d = e.data;
      lastPing = Date.now();
      if (d.type === 'progress') onProgress?.(d.ratio ?? 0);
      else if (d.type === 'done' && d.blob) finish(d.blob);
      else {
        if (d.type === 'error') console.warn('[webcodecs worker] erro:', d.message);
        finish(null); // 'error' | 'incompatible' | inesperado
      }
    };
    worker.onerror = () => finish(null);
    try {
      worker.postMessage({ parts, offsets, xfadeSec });
    } catch {
      finish(null);
    }
  });
}

/**
 * Junta os trechos limpos + áudio original, PREFERINDO o WebCodecs (worker,
 * rápido). Cai pro ffmpeg se: 1 trecho só, WebCodecs indisponível, ou qualquer
 * erro/stall no caminho rápido. Resultado idêntico em qualquer caminho.
 */
export async function joinCleanedSmart(
  cleanedParts: Blob[],
  original: Blob,
  offsets: number[],
  opts: RunOptions = {},
): Promise<Blob> {
  // 1 trecho (vídeo curto): sem crossfade → o ffmpeg só troca o áudio, SEM
  // re-encodar o vídeo (qualidade intacta). Nada a ganhar com WebCodecs.
  if (cleanedParts.length < 2 || offsets.length !== cleanedParts.length - 1) {
    return joinCleanedWithOriginalAudio(cleanedParts, original, offsets, opts);
  }

  // Caminho rápido: crossfade por hardware no worker (vídeo-só).
  let videoOnly: Blob | null = null;
  try {
    opts.onStage?.('Finalizando...');
    videoOnly = await joinViaWorker(cleanedParts, offsets, SEG_XFADE_SEC, (r) =>
      opts.onProgress?.({ ratio: Math.min(1, r), time: 0 }),
    );
  } catch (e) {
    console.warn('[removedor] join WebCodecs falhou — fallback ffmpeg:', e);
    videoOnly = null;
  }

  if (!videoOnly) {
    return withFFLock(() => joinCleanedWithOriginalAudio(cleanedParts, original, offsets, opts));
  }

  // Re-muxa o áudio ORIGINAL (fonte = o próprio arquivo original; -c:v copy).
  try {
    return await withFFLock(() =>
      muxAudioIntoVideo(videoOnly!, original, {
        onStage: opts.onStage,
        onProgress: (p) => opts.onProgress?.({ ratio: Math.min(1, p.ratio), time: p.time }),
      }),
    );
  } catch (e) {
    console.warn('[removedor] re-mux de áudio falhou, entregando vídeo sem áudio:', e);
    return videoOnly;
  }
}
