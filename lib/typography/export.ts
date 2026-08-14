/**
 * Export da Tipografia Automática — queima os letterings no vídeo 100% no
 * NAVEGADOR (custo zero de servidor):
 *
 *   1. Decode por seek determinístico (<video> oculto + evento seeked, mesmo
 *      padrão do face-detector) — sem frame perdido, sem depender de rAF.
 *   2. Composição no canvas: frame do vídeo + drawCaptions (mesmo engine do
 *      preview → WYSIWYG de verdade).
 *   3. Encode H.264 via WebCodecs (VideoEncoder, acelerado por hardware) +
 *      mux MP4 com mp4-muxer. MUITO mais rápido e leve que re-encodar no
 *      ffmpeg-wasm.
 *   4. Áudio: extractAudio (wav) + muxAudioIntoVideo (ffmpeg-wasm, -c:v copy
 *      -c:a aac) — infra já blindada do repo (watchdog + assertValidMp4).
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { FriendlyError } from '@/lib/friendly-error';
import {
  CANCELLED_ERROR,
  extractAudio,
  isCancellationError,
  muxAudioIntoVideo,
} from '@/lib/ffmpeg-worker';
import { runFfmpegExclusive } from '@/lib/ffmpeg-serial';
import { drawCaptions, type Block, type StyleState, type TypoPreset } from './engine';
import { ensureTypoFonts } from './fonts';

export type RenderPhase = 'fontes' | 'frames' | 'audio' | 'finalizando';
export type RenderProgress = {
  phase: RenderPhase;
  ratio: number; // 0..1 da fase
  frame?: number;
  totalFrames?: number;
};

export type RenderResult = {
  blob: Blob;
  audioOk: boolean;
  width: number;
  height: number;
  fps: number;
};

const FPS = 30;
/** teto do arquivo de vídeo intermediário no MEMFS do ffmpeg (heap ~2GB) */
const RENDER_BYTES_BUDGET = 300_000_000;

function even(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v - 1;
}

function seekVideo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timer);
      resolve();
    };
    // Alguns browsers não disparam 'seeked' quando o alvo é o frame atual —
    // fallback por timeout mantém o loop vivo (padrão do face-detector).
    const timer = setTimeout(finish, 4000);
    video.addEventListener('seeked', finish);
    video.currentTime = t;
  });
}

async function pickCodec(
  width: number,
  height: number,
  bitrate: number,
): Promise<string> {
  const candidates = [
    'avc1.640033', // High 5.1
    'avc1.640032', // High 5.0
    'avc1.64002a', // High 4.2
    'avc1.640028', // High 4.0
    'avc1.4d0028', // Main 4.0
    'avc1.42e01f', // Baseline 3.1
  ];
  for (const codec of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate: FPS,
      });
      if (support.supported) return codec;
    } catch {
      /* tenta o próximo */
    }
  }
  throw new FriendlyError(
    'Seu navegador não conseguiu preparar o encoder de vídeo. Usa o Chrome ou Edge atualizados no computador.',
  );
}

export async function renderTypographyVideo(opts: {
  file: File | Blob;
  blocks: Block[];
  preset: TypoPreset;
  style: StyleState;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
}): Promise<RenderResult> {
  const { file, blocks, preset, style, onProgress, signal } = opts;

  if (typeof VideoEncoder === 'undefined') {
    throw new FriendlyError(
      'Seu navegador não suporta o render local (WebCodecs). Usa o Chrome ou Edge atualizados no computador.',
    );
  }

  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error(CANCELLED_ERROR);
  };

  onProgress?.({ phase: 'fontes', ratio: 0 });
  await ensureTypoFonts();
  throwIfAborted();

  // ── vídeo fonte ──
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new FriendlyError('Não consegui abrir o vídeo. Confere o arquivo e tenta de novo.')),
        15000,
      );
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new FriendlyError('Formato de vídeo não suportado pelo navegador. Converte pra MP4 (H.264) e tenta de novo.'));
      };
      video.src = url;
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const durationSec = video.duration;
    if (!srcW || !srcH || !isFinite(durationSec) || durationSec <= 0) {
      throw new FriendlyError('Não consegui ler as dimensões do vídeo. Converte pra MP4 (H.264) e tenta de novo.');
    }

    const longSide = Math.max(srcW, srcH);
    const scale = longSide > 1920 ? 1920 / longSide : 1;
    const W = even(srcW * scale);
    const H = even(srcH * scale);

    // bitrate por bpp com teto de orçamento de MEMFS
    const bppRate = W * H * FPS * 0.1;
    const budgetRate = (RENDER_BYTES_BUDGET * 8) / durationSec;
    const bitrate = Math.round(Math.min(Math.max(bppRate, 2_500_000), 10_000_000, budgetRate));

    const codec = await pickCodec(W, H, bitrate);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new FriendlyError('Não consegui criar o canvas de composição.');

    // ── encoder + muxer ──
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let encoderError: Error | null = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        encoderError = e instanceof Error ? e : new Error(String(e));
      },
    });
    encoder.configure({
      codec,
      width: W,
      height: H,
      bitrate,
      framerate: FPS,
      latencyMode: 'quality',
    });

    const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));
    const frameUs = Math.round(1_000_000 / FPS);

    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted();
      if (encoderError) throw encoderError;

      const t = Math.min(i / FPS + 0.0001, durationSec - 0.001);
      await seekVideo(video, t);

      ctx.drawImage(video, 0, 0, W, H);
      ctx.filter = 'none';
      drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);

      const frame = new VideoFrame(canvas, {
        timestamp: i * frameUs,
        duration: frameUs,
      });
      encoder.encode(frame, { keyFrame: i % (FPS * 4) === 0 });
      frame.close();

      // backpressure: não deixa a fila do encoder crescer sem limite
      while (encoder.encodeQueueSize > 6) {
        await new Promise((r) => setTimeout(r, 4));
        if (encoderError) throw encoderError;
        throwIfAborted();
      }

      if (i % 3 === 0 || i === totalFrames - 1) {
        onProgress?.({
          phase: 'frames',
          ratio: (i + 1) / totalFrames,
          frame: i + 1,
          totalFrames,
        });
      }
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
    encoder.close();
    muxer.finalize();

    const videoOnly = new Blob([target.buffer], { type: 'video/mp4' });

    // ── áudio original de volta (ffmpeg-wasm, infra blindada do repo) ──
    onProgress?.({ phase: 'audio', ratio: 0 });
    throwIfAborted();
    let final = videoOnly;
    let audioOk = false;
    try {
      final = await runFfmpegExclusive(async () => {
        const wav = await extractAudio(file, {
          onProgress: (p) => onProgress?.({ phase: 'audio', ratio: p.ratio * 0.5 }),
        });
        throwIfAborted();
        return muxAudioIntoVideo(videoOnly, wav, {
          onProgress: (p) => onProgress?.({ phase: 'audio', ratio: 0.5 + p.ratio * 0.5 }),
        });
      });
      audioOk = true;
    } catch (e) {
      if (isCancellationError(e) || signal?.aborted) throw e;
      // Vídeo sem trilha de áudio (ou extração falhou): entrega o render
      // mudo em vez de morrer no fim — o caller informa o user.
      console.warn('[tipografia] mux de áudio falhou, entregando sem áudio:', e);
    }

    onProgress?.({ phase: 'finalizando', ratio: 1 });
    return { blob: final, audioOk, width: W, height: H, fps: FPS };
  } finally {
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignora */
    }
    URL.revokeObjectURL(url);
  }
}
