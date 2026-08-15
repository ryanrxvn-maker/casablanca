/**
 * Export da Tipografia Automática — queima os letterings no vídeo 100% no
 * NAVEGADOR (custo zero de servidor):
 *
 *   1. Decode do vídeo fonte, em DOIS caminhos:
 *      a) RÁPIDO (padrão p/ MP4/MOV): demux com mp4box + VideoDecoder
 *         (WebCodecs, hardware) — o arquivo é decodificado em fluxo contínuo,
 *         sem seek. Ordens de grandeza mais rápido que (b), que re-decodifica
 *         desde o keyframe a cada frame.
 *      b) FALLBACK: seek determinístico (<video> oculto + evento seeked) pra
 *         formatos fora do ISO-BMFF (webm...), codec sem decoder, vídeo com
 *         rotação de container ou qualquer falha do caminho (a).
 *   2. Composição no canvas: frame do vídeo + drawCaptions (mesmo engine do
 *      preview → WYSIWYG de verdade, nos dois caminhos).
 *   3. Encode H.264 via WebCodecs (VideoEncoder, acelerado por hardware) +
 *      mux MP4 com mp4-muxer. MUITO mais rápido e leve que re-encodar no
 *      ffmpeg-wasm.
 *   4. Áudio: extractAudio (wav) + muxAudioIntoVideo (ffmpeg-wasm, -c:v copy
 *      -c:a aac) — infra já blindada do repo (watchdog + assertValidMp4).
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type Box,
  type Movie,
  type Sample,
} from 'mp4box';
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
  /** que caminho de decode rodou (QA/telemetria) */
  mode: 'decode' | 'seek';
};

const FPS = 30;
/** teto do arquivo de vídeo intermediário no MEMFS do ffmpeg (heap ~2GB) */
const RENDER_BYTES_BUDGET = 300_000_000;
/**
 * O demux usa append ÚNICO do arquivo inteiro (mp4box 2.x perde samples no
 * feed em pedaços quando o moov vem no FIM — validado empiricamente). Acima
 * deste teto o buffer em memória fica arriscado — cai pro caminho por seek.
 */
const FASTPATH_MAX_BYTES = 300_000_000;

function even(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v - 1;
}

/**
 * Yield de backpressure IMUNE ao throttle de aba oculta: setTimeout em aba
 * de fundo é clampado pra 1s+ (render cairia pra ~1fps se o user trocar de
 * aba); mensagens de MessageChannel não sofrem esse clamp.
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
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

/* ───────────── encoder + muxer (compartilhado pelos dois caminhos) ───────────── */

type EncodeSink = {
  encoder: VideoEncoder;
  muxer: Muxer<ArrayBufferTarget>;
  target: ArrayBufferTarget;
  err: () => Error | null;
};

function makeSink(
  codec: string,
  W: number,
  H: number,
  bitrate: number,
): EncodeSink {
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
  return { encoder, muxer, target, err: () => encoderError };
}

/* ───────────────────── caminho RÁPIDO: mp4box + VideoDecoder ───────────────────── */

/** true se o arquivo parece ISO-BMFF (mp4/mov/m4v) — assinatura 'ftyp'. */
async function looksLikeMp4(file: Blob): Promise<boolean> {
  if (file.size < 64) return false;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return (
    head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70
  );
}

/** Description (avcC/hvcC/vpcC/av1C) da entry do stsd — o VideoDecoder exige. */
function trackDescription(
  trak: unknown,
): { desc: Uint8Array | undefined; needsDesc: boolean } {
  type DescBoxes = {
    avcC?: Box;
    hvcC?: Box;
    vpcC?: Box;
    av1C?: Box;
  };
  const entries =
    ((trak as { mdia?: { minf?: { stbl?: { stsd?: { entries?: DescBoxes[] } } } } })
      ?.mdia?.minf?.stbl?.stsd?.entries ?? []);
  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      // pula o header (size+type, 8 bytes) do box — formato que o decoder espera
      return { desc: new Uint8Array(stream.buffer, 8), needsDesc: true };
    }
  }
  return { desc: undefined, needsDesc: true };
}

/**
 * Decodifica o MP4 em fluxo (sem seek) e devolve o vídeo-só encodado.
 * Retorna null quando o arquivo não serve pro caminho rápido (aí o caller
 * usa o seek); lança erro em falha no meio (o caller também cai pro seek).
 */
async function renderFramesByDecode(opts: {
  file: File | Blob;
  blocks: Block[];
  preset: TypoPreset;
  style: StyleState;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  srcW: number;
  srcH: number;
  durationSec: number;
  codec: string;
  bitrate: number;
  onProgress?: (p: RenderProgress) => void;
  throwIfAborted: () => void;
}): Promise<Blob | null> {
  const {
    file,
    blocks,
    preset,
    style,
    canvas,
    ctx,
    W,
    H,
    srcW,
    srcH,
    durationSec,
    codec,
    bitrate,
    onProgress,
    throwIfAborted,
  } = opts;

  if (typeof VideoDecoder === 'undefined') return null;
  if (file.size > FASTPATH_MAX_BYTES) return null;
  if (!(await looksLikeMp4(file))) return null;

  // keepMdatData=true é OBRIGATÓRIO: o default do mp4box 2.x descarta o mdat
  // e a extração entrega ZERO samples (validado no harness)
  const mp4 = createFile(true);
  let movie: Movie | null = null;
  let demuxError: Error | null = null;
  const pending: Sample[] = [];
  mp4.onError = (module: string, message: string) => {
    demuxError = new Error(`demux ${module}: ${message}`);
  };
  mp4.onReady = (m: Movie) => {
    movie = m;
  };
  mp4.onSamples = (_id: number, _user: unknown, samples: Sample[]) => {
    for (const s of samples) pending.push(s);
  };

  const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));
  const frameUs = Math.round(1_000_000 / FPS);

  let sink: EncodeSink | null = null;
  let decodeError: Error | null = null;
  let nextTick = 0;
  let lastFrame: VideoFrame | null = null;
  let basePtsUs: number | null = null;
  let sizeChecked = false;

  const emitTick = (src: VideoFrame) => {
    if (!sink) return;
    const t = Math.min(nextTick / FPS + 0.0001, durationSec - 0.001);
    ctx.drawImage(src, 0, 0, W, H);
    ctx.filter = 'none';
    drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);
    const vf = new VideoFrame(canvas, {
      timestamp: nextTick * frameUs,
      duration: frameUs,
    });
    sink.encoder.encode(vf, { keyFrame: nextTick % (FPS * 4) === 0 });
    vf.close();
    nextTick++;
    if (nextTick % 3 === 0 || nextTick === totalFrames) {
      onProgress?.({
        phase: 'frames',
        ratio: nextTick / totalFrames,
        frame: nextTick,
        totalFrames,
      });
    }
  };

  // saída do decoder chega em ORDEM DE EXIBIÇÃO — cada tick de 30fps usa o
  // último frame com pts <= tick (converte qualquer fps/VFR pra CFR certinho)
  const onFrame = (f: VideoFrame) => {
    if (decodeError || nextTick >= totalFrames) {
      f.close();
      return;
    }
    if (!sizeChecked) {
      sizeChecked = true;
      // Rotação de container / SAR exótico: o <video> reporta o tamanho de
      // EXIBIÇÃO já rotacionado; o VideoFrame ignora a matriz do container.
      // Divergiu → só o caminho por seek renderiza certo.
      const dw = f.displayWidth || f.codedWidth;
      const dh = f.displayHeight || f.codedHeight;
      if (Math.abs(dw - srcW) > 2 || Math.abs(dh - srcH) > 2) {
        decodeError = new Error(
          `frame ${dw}x${dh} != vídeo ${srcW}x${srcH} (rotação/SAR) — seek path`,
        );
        f.close();
        return;
      }
    }
    if (basePtsUs == null) basePtsUs = f.timestamp;
    const ptsUs = f.timestamp - basePtsUs;
    while (
      nextTick < totalFrames &&
      Math.round((nextTick * 1_000_000) / FPS) < ptsUs
    ) {
      emitTick(lastFrame ?? f);
    }
    lastFrame?.close();
    lastFrame = f;
  };

  const decoder = new VideoDecoder({
    output: onFrame,
    error: (e) => {
      decodeError = e instanceof Error ? e : new Error(String(e));
    },
  });

  try {
    const checkErrors = () => {
      throwIfAborted();
      if (demuxError) throw demuxError;
      if (decodeError) throw decodeError;
      const ee = sink?.err();
      if (ee) throw ee;
    };

    // roda a fila de samples pelo decoder com backpressure dos DOIS lados
    const pump = async () => {
      while (pending.length) {
        const s = pending.shift()!;
        if (!s.data) continue;
        const chunk = new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: Math.round((s.cts / s.timescale) * 1_000_000),
          duration: Math.max(0, Math.round((s.duration / s.timescale) * 1_000_000)),
          data: s.data,
        });
        decoder.decode(chunk);
        while (
          decoder.decodeQueueSize > 12 ||
          (sink !== null && sink.encoder.encodeQueueSize > 6)
        ) {
          await nextTask();
          checkErrors();
        }
      }
      checkErrors();
    };

    // Append ÚNICO do arquivo inteiro: o moov pode estar no INÍCIO (faststart)
    // ou no FIM (gravação de celular) — com o buffer completo o mp4box entrega
    // 100% dos samples nos dois layouts. Feed em pedaços PERDE samples quando
    // o moov vem no fim (validado no harness) — por isso o teto de tamanho.
    const raw = await file.arrayBuffer();
    throwIfAborted();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, 0), true);
    if (demuxError) throw demuxError;

    // (cast: o TS não enxerga a atribuição feita dentro do callback onReady)
    const mv = movie as Movie | null;
    if (!mv) return null; // sem moov — deixa o <video> tentar pelo seek
    const track = mv.videoTracks?.[0];
    if (!track) return null;
    const { desc } = trackDescription(mp4.getTrackById(track.id));
    if (!desc) return null; // sem avcC/hvcC/vpcC/av1C não tem decode
    const config: VideoDecoderConfig = {
      codec: track.codec,
      description: desc,
    };
    let supported = false;
    try {
      supported = (await VideoDecoder.isConfigSupported(config)).supported === true;
    } catch {
      supported = false;
    }
    if (!supported) return null;

    decoder.configure(config);
    sink = makeSink(codec, W, H, bitrate);
    mp4.setExtractionOptions(track.id, null, { nbSamples: 100 });
    mp4.start();
    mp4.flush(); // entrega inclusive o lote final (<nbSamples)
    if (pending.length === 0) return null; // extração seca — seek cobre

    await pump();

    await decoder.flush().catch((e) => {
      // flush rejeita quando o decoder morreu — decodeError conta a história
      if (!decodeError) throw e;
    });
    checkErrors();

    if (!lastFrame && nextTick === 0) {
      throw new Error('decoder não produziu nenhum frame');
    }
    // rabo: repete o último frame até fechar a duração do container
    while (nextTick < totalFrames && lastFrame) {
      emitTick(lastFrame);
      if (sink && sink.encoder.encodeQueueSize > 6) {
        await nextTask();
        checkErrors();
      }
    }

    if (!sink) return null;
    await sink.encoder.flush();
    checkErrors();
    sink.encoder.close();
    sink.muxer.finalize();
    return new Blob([sink.target.buffer], { type: 'video/mp4' });
  } finally {
    // (cast: o TS não enxerga as atribuições feitas dentro do callback output)
    (lastFrame as VideoFrame | null)?.close();
    lastFrame = null;
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch {
      /* já fechado */
    }
    try {
      if (sink && sink.encoder.state !== 'closed') sink.encoder.close();
    } catch {
      /* já fechado */
    }
  }
}

/* ───────────────────── caminho FALLBACK: seek frame a frame ───────────────────── */

async function renderFramesBySeek(opts: {
  video: HTMLVideoElement;
  blocks: Block[];
  preset: TypoPreset;
  style: StyleState;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  durationSec: number;
  codec: string;
  bitrate: number;
  onProgress?: (p: RenderProgress) => void;
  throwIfAborted: () => void;
}): Promise<Blob> {
  const {
    video,
    blocks,
    preset,
    style,
    canvas,
    ctx,
    W,
    H,
    durationSec,
    codec,
    bitrate,
    onProgress,
    throwIfAborted,
  } = opts;

  const sink = makeSink(codec, W, H, bitrate);
  const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));
  const frameUs = Math.round(1_000_000 / FPS);

  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted();
      const e0 = sink.err();
      if (e0) throw e0;

      const t = Math.min(i / FPS + 0.0001, durationSec - 0.001);
      await seekVideo(video, t);

      ctx.drawImage(video, 0, 0, W, H);
      ctx.filter = 'none';
      drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);

      const frame = new VideoFrame(canvas, {
        timestamp: i * frameUs,
        duration: frameUs,
      });
      sink.encoder.encode(frame, { keyFrame: i % (FPS * 4) === 0 });
      frame.close();

      // backpressure: não deixa a fila do encoder crescer sem limite
      while (sink.encoder.encodeQueueSize > 6) {
        await nextTask();
        const e1 = sink.err();
        if (e1) throw e1;
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

    await sink.encoder.flush();
    const e2 = sink.err();
    if (e2) throw e2;
    sink.encoder.close();
    sink.muxer.finalize();
    return new Blob([sink.target.buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (sink.encoder.state !== 'closed') sink.encoder.close();
    } catch {
      /* já fechado */
    }
  }
}

/* ───────────────────────────── orquestração ───────────────────────────── */

export async function renderTypographyVideo(opts: {
  file: File | Blob;
  blocks: Block[];
  preset: TypoPreset;
  style: StyleState;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** força o caminho por seek (QA/harness — não usar na UI) */
  forceSeekPath?: boolean;
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

  // ── vídeo fonte (metadata sempre via <video>; frames só no fallback) ──
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

    // bitrate: régua por bpp, mas ACOMPANHA a fonte quando ela é mais pesada
    // que a régua (re-encodar acima do bitrate original não deixa nada na
    // mesa). Teto de 20M + orçamento de MEMFS seguram arquivo e memória; a
    // régua nunca desce abaixo do próprio piso (legenda nítida mesmo com
    // fonte fraca). srcRate inclui áudio/container (~5-10% a mais) — inócuo.
    const bppRate = W * H * FPS * 0.12;
    const srcRate = (file.size * 8) / durationSec;
    const budgetRate = (RENDER_BYTES_BUDGET * 8) / durationSec;
    const bitrate = Math.round(
      Math.min(
        Math.max(bppRate, Math.min(srcRate, 20_000_000), 2_500_000),
        budgetRate,
      ),
    );

    const codec = await pickCodec(W, H, bitrate);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new FriendlyError('Não consegui criar o canvas de composição.');

    // ── frames: caminho rápido primeiro; qualquer tropeço cai pro seek ──
    let videoOnly: Blob | null = null;
    let mode: 'decode' | 'seek' = 'decode';
    if (!opts.forceSeekPath) {
      try {
        videoOnly = await renderFramesByDecode({
          file,
          blocks,
          preset,
          style,
          canvas,
          ctx,
          W,
          H,
          srcW,
          srcH,
          durationSec,
          codec,
          bitrate,
          onProgress,
          throwIfAborted,
        });
      } catch (e) {
        if (isCancellationError(e) || signal?.aborted) throw e;
        console.warn('[tipografia] decode rápido falhou — caindo pro seek:', e);
        videoOnly = null;
      }
    }
    if (!videoOnly) {
      mode = 'seek';
      onProgress?.({ phase: 'frames', ratio: 0, frame: 0, totalFrames: Math.ceil(durationSec * FPS) });
      videoOnly = await renderFramesBySeek({
        video,
        blocks,
        preset,
        style,
        canvas,
        ctx,
        W,
        H,
        durationSec,
        codec,
        bitrate,
        onProgress,
        throwIfAborted,
      });
    }

    if (videoOnly.size < 2048) {
      throw new FriendlyError('O render saiu vazio — tenta de novo. Se repetir, fecha outras abas pesadas.');
    }

    // ── áudio original de volta (ffmpeg-wasm, infra blindada do repo) ──
    onProgress?.({ phase: 'audio', ratio: 0 });
    throwIfAborted();
    let final = videoOnly;
    let audioOk = false;
    try {
      const vOnly = videoOnly;
      final = await runFfmpegExclusive(async () => {
        const wav = await extractAudio(file, {
          onProgress: (p) => onProgress?.({ phase: 'audio', ratio: p.ratio * 0.5 }),
        });
        throwIfAborted();
        return muxAudioIntoVideo(vOnly, wav, {
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
    return { blob: final, audioOk, width: W, height: H, fps: FPS, mode };
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
