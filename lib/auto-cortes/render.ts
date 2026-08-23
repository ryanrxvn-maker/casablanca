/**
 * AUTO CORTES — render de UM corte, 100 % no navegador.
 *
 * Fork controlado de `lib/typography/export.ts` (que NÃO pode mudar: a
 * Tipografia depende dele byte a byte). Do original ficam IDÊNTICOS:
 * `pickCodec`, `makeSink`, `nextTask` (MessageChannel, imune a aba de fundo),
 * o demux com mp4box (`createFile(true)`, append ÚNICO, `setExtractionOptions
 * nbSamples 100`), a conversão CFR por "último frame com pts <= tick", o
 * fallback por seek, o bitrate adaptativo com teto de MEMFS, o cancelamento
 * por `signal` e o mux de áudio dentro do `runFfmpegExclusive`.
 *
 * O que MUDA (docs/auto-cortes/ARQUITETURA.md §3.5):
 *  1. O arquivo de entrada é o CLIPE já cortado (`-c copy`, com sobra de ~6 s
 *     antes e ~1 s depois), não o vídeo inteiro. Só os frames do intervalo
 *     ABSOLUTO `[absStart, absEnd)` viram tick.
 *  2. A saída tem tamanho PRÓPRIO (`out.w × out.h`), independente da fonte.
 *  3. Cada frame passa por `compose(ctx, frame, tAbs)` (crop/split/fit) e
 *     depois por `overlay(ctx, tRelMs)` (legenda + headline).
 *  4. O áudio chega PRONTO (já cortado em AAC) — `null` entrega mudo.
 *
 * ── pts → tempo ABSOLUTO (a parte que dá errado se for feita no chute) ──
 * O clipe não sabe onde ele começa no vídeo original; quem sabe é o chamador.
 * Por isso `clipFirstPts` é PARÂMETRO, já resolvido:
 *   - corte feito COM `-copyts`: os timestamps do clipe continuam sendo os da
 *     fonte, e `probeFirstPts(clip)` devolve o segundo absoluto do 1º frame →
 *     é esse valor que entra aqui;
 *   - corte SEM `-copyts` (fallback do `cutClipCopy` quando o `-copyts`
 *     falha): o arquivo foi rebaseado pra zero e a informação SUMIU do
 *     arquivo. Nesse caso `probeFirstPts` devolve ~0 e o chamador deve passar
 *     a MELHOR ESTIMATIVA — o `-ss` que ele pediu (`t0 - cutLeadSec`, clampado
 *     em 0). O erro residual é o recuo até o keyframe anterior (o `-c copy`
 *     começa no keyframe, não no `-ss` exato), então o corte pode nascer
 *     alguns frames antes/depois do pedido. É a degradação aceita: nunca
 *     entregar vídeo errado, e sim vídeo com a borda ligeiramente deslocada.
 * No caminho rápido: `tAbs = clipFirstPts + (pts - basePts) / 1e6`.
 * No caminho por seek: `video.currentTime = tAbs - clipFirstPts`.
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
  assertValidMp4,
  isCancellationError,
  muxAudioIntoVideo,
} from '@/lib/ffmpeg-worker';
import { runFfmpegExclusive } from '@/lib/ffmpeg-serial';
import { ensureTypoFonts } from '@/lib/typography/fonts';
import type { CropPlan } from './types';
import { boxAtTime } from './reframe-plan';

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

export type OutSize = { w: number; h: number };

/** Desenha o FRAME (já recortado/composto) no canvas de saída. */
export type ComposeFn = (
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  tAbs: number,
) => void;

/** Desenha o que vai POR CIMA do frame (legenda + headline), em ms do corte. */
export type OverlayFn = (ctx: CanvasRenderingContext2D, tRelMs: number) => void;

const FPS = 30;
/** teto do arquivo de vídeo intermediário no MEMFS do ffmpeg (heap ~2GB) */
const RENDER_BYTES_BUDGET = 300_000_000;
/**
 * O demux usa append ÚNICO do arquivo inteiro (mp4box 2.x perde samples no
 * feed em pedaços quando o moov vem no FIM — validado empiricamente). Acima
 * deste teto o buffer em memória fica arriscado — cai pro caminho por seek.
 * (Um clipe de 90 s dificilmente chega perto disso.)
 */
const FASTPATH_MAX_BYTES = 300_000_000;

function even(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v - 1;
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return v < lo ? lo : v > hi ? hi : v;
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

async function pickCodec(width: number, height: number, bitrate: number): Promise<string> {
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

function makeSink(codec: string, W: number, H: number, bitrate: number): EncodeSink {
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

/* ───────────────────────────── COMPOSITOR ───────────────────────────── */

/** blur do fundo do modo "ajustar", proporcional à saída (40 px em 1080). */
function fitBlurPx(outW: number): number {
  return Math.max(12, Math.round((outW / 1080) * 40));
}

/** escurecimento do fundo desfocado (o vídeo da frente tem que ganhar) */
const FIT_DIM = 0.35;
/** o fundo é o próprio frame ampliado — cobre a borda que o blur come */
const FIT_BG_ZOOM = 1.6;

function drawCrop(
  ctx: CanvasRenderingContext2D,
  frame: CanvasImageSource,
  srcW: number,
  srcH: number,
  box: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const sw = clamp(box.w * srcW, 2, srcW);
  const sh = clamp(box.h * srcH, 2, srcH);
  const sx = clamp(box.x * srcW, 0, srcW - sw);
  const sy = clamp(box.y * srcH, 0, srcH - sh);
  ctx.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Constrói a função de composição a partir do plano de reenquadro.
 *
 *  - `none`  : a fonte já está na proporção certa — escala direta.
 *  - `single`: um crop que segue o plano (interpolação LINEAR entre keyframes).
 *  - `split` : dois crops; 9:16 empilha, o resto fica lado a lado. A orientação
 *              é DEDUZIDA da proporção da caixa do plano (metade empilhada tem
 *              o dobro da proporção da saída; lado a lado tem a metade), então
 *              o contrato do CropPlan não precisou de campo novo.
 *  - `fit`   : vídeo inteiro centralizado sobre o próprio frame ampliado,
 *              desfocado e escurecido. `ctx.filter` só é usado no FUNDO e é
 *              zerado logo em seguida (o overlay nunca pode herdar blur).
 */
export function makeComposer(
  plan: CropPlan,
  srcW: number,
  srcH: number,
  out: OutSize,
): ComposeFn {
  const W = out.w;
  const H = out.h;

  if (plan.layout === 'none') {
    return (ctx, frame) => {
      ctx.filter = 'none';
      ctx.drawImage(frame, 0, 0, W, H);
    };
  }

  if (plan.layout === 'fit') {
    const blur = `blur(${fitBlurPx(W)}px)`;
    const srcAR = srcW / srcH;
    const outAR = W / H;
    // frente: contain (vídeo inteiro, sem cortar nada)
    const fw = srcAR > outAR ? W : H * srcAR;
    const fh = srcAR > outAR ? W / srcAR : H;
    const fx = (W - fw) / 2;
    const fy = (H - fh) / 2;
    // fundo: cover ampliado (o blur "come" a borda, o zoom devolve)
    const cw = srcAR > outAR ? H * srcAR : W;
    const ch = srcAR > outAR ? H : W / srcAR;
    const bw = cw * FIT_BG_ZOOM;
    const bh = ch * FIT_BG_ZOOM;
    const bx = (W - bw) / 2;
    const by = (H - bh) / 2;
    return (ctx, frame) => {
      ctx.filter = blur;
      ctx.drawImage(frame, bx, by, bw, bh);
      ctx.filter = 'none';
      ctx.fillStyle = `rgba(0,0,0,${FIT_DIM})`;
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(frame, fx, fy, fw, fh);
    };
  }

  if (plan.layout === 'split') {
    const [kfsA, kfsB] = plan.tracks;
    const first = kfsA[0]?.box ?? kfsB[0]?.box ?? { x: 0, y: 0, w: 1, h: 1 };
    const halfARpx = (first.w * srcW) / Math.max(1, first.h * srcH);
    const outAR = W / H;
    // empilhado = metade com o DOBRO da proporção da saída; lado a lado = metade
    const stacked = Math.abs(halfARpx - outAR * 2) <= Math.abs(halfARpx - outAR / 2);
    const halfW = stacked ? W : Math.round(W / 2);
    const halfH = stacked ? Math.round(H / 2) : H;
    const posB = stacked ? { x: 0, y: H - halfH } : { x: W - halfW, y: 0 };
    return (ctx, frame, tAbs) => {
      ctx.filter = 'none';
      drawCrop(ctx, frame, srcW, srcH, boxAtTime(kfsA, tAbs), 0, 0, halfW, halfH);
      drawCrop(ctx, frame, srcW, srcH, boxAtTime(kfsB, tAbs), posB.x, posB.y, halfW, halfH);
    };
  }

  const kfs = plan.keyframes;
  return (ctx, frame, tAbs) => {
    ctx.filter = 'none';
    drawCrop(ctx, frame, srcW, srcH, boxAtTime(kfs, tAbs), 0, 0, W, H);
  };
}

/* ───────────────────── caminho RÁPIDO: mp4box + VideoDecoder ───────────────────── */

/** true se o arquivo parece ISO-BMFF (mp4/mov/m4v) — assinatura 'ftyp'. */
async function looksLikeMp4(file: Blob): Promise<boolean> {
  if (file.size < 64) return false;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

/** Description (avcC/hvcC/vpcC/av1C) da entry do stsd — o VideoDecoder exige. */
function trackDescription(trak: unknown): { desc: Uint8Array | undefined; needsDesc: boolean } {
  type DescBoxes = {
    avcC?: Box;
    hvcC?: Box;
    vpcC?: Box;
    av1C?: Box;
  };
  const entries =
    (trak as { mdia?: { minf?: { stbl?: { stsd?: { entries?: DescBoxes[] } } } } })?.mdia?.minf
      ?.stbl?.stsd?.entries ?? [];
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

type FramesOpts = {
  clip: Blob;
  absStart: number;
  absEnd: number;
  clipFirstPts: number;
  compose: ComposeFn;
  overlay: OverlayFn;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  outDurationSec: number;
  codec: string;
  bitrate: number;
  onProgress?: (p: RenderProgress) => void;
  throwIfAborted: () => void;
};

/**
 * Decodifica o clipe em fluxo (sem seek) e devolve o vídeo-só encodado.
 * Retorna null quando o arquivo não serve pro caminho rápido (aí o caller
 * usa o seek); lança erro em falha no meio (o caller também cai pro seek).
 */
async function renderFramesByDecode(
  opts: FramesOpts & { srcW: number; srcH: number },
): Promise<Blob | null> {
  const {
    clip,
    absStart,
    clipFirstPts,
    compose,
    overlay,
    canvas,
    ctx,
    W,
    H,
    srcW,
    srcH,
    outDurationSec,
    codec,
    bitrate,
    onProgress,
    throwIfAborted,
  } = opts;

  if (typeof VideoDecoder === 'undefined') return null;
  if (clip.size > FASTPATH_MAX_BYTES) return null;
  if (!(await looksLikeMp4(clip))) return null;

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

  const totalFrames = Math.max(1, Math.ceil(outDurationSec * FPS));
  const frameUs = Math.round(1_000_000 / FPS);

  let sink: EncodeSink | null = null;
  let decodeError: Error | null = null;
  let nextTick = 0;
  let lastFrame: VideoFrame | null = null;
  let basePtsUs: number | null = null;
  let sizeChecked = false;

  const emitTick = (src: VideoFrame) => {
    if (!sink) return;
    // tempo do TICK (não o pts do frame): CFR determinístico, igual no
    // preview e no MP4. O corte manda; o frame é só o pixel mais recente.
    const tRel = Math.min(nextTick / FPS + 0.0001, outDurationSec - 0.001);
    const tAbs = absStart + tRel;
    compose(ctx, src, tAbs);
    ctx.filter = 'none';
    overlay(ctx, tRel * 1000);
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
  // último frame com pts <= tick (converte qualquer fps/VFR pra CFR certinho).
  // Aqui o "tick" está no relógio ABSOLUTO da fonte, então o que está fora de
  // [absStart, absEnd) simplesmente nunca vira frame de saída.
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
    // pts do clipe → segundo ABSOLUTO da fonte
    const tAbsFrame = clipFirstPts + (f.timestamp - basePtsUs) / 1_000_000;
    while (nextTick < totalFrames && absStart + nextTick / FPS < tAbsFrame) {
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
        // o clipe tem ~1 s de sobra depois do corte: fechado o último tick,
        // não há por que decodificar o rabo
        if (nextTick >= totalFrames) break;
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
    const raw = await clip.arrayBuffer();
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
    // rabo: repete o último frame até fechar a duração do CORTE
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

async function renderFramesBySeek(
  opts: FramesOpts & { video: HTMLVideoElement; clipDurationSec: number },
): Promise<Blob> {
  const {
    video,
    absStart,
    clipFirstPts,
    compose,
    overlay,
    canvas,
    ctx,
    W,
    H,
    outDurationSec,
    clipDurationSec,
    codec,
    bitrate,
    onProgress,
    throwIfAborted,
  } = opts;

  const sink = makeSink(codec, W, H, bitrate);
  const totalFrames = Math.max(1, Math.ceil(outDurationSec * FPS));
  const frameUs = Math.round(1_000_000 / FPS);

  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted();
      const e0 = sink.err();
      if (e0) throw e0;

      const tRel = Math.min(i / FPS + 0.0001, outDurationSec - 0.001);
      const tAbs = absStart + tRel;
      // tempo DENTRO do clipe (o <video> conta do 1º frame do arquivo)
      const tLocal = clamp(tAbs - clipFirstPts, 0, Math.max(0, clipDurationSec - 0.001));
      await seekVideo(video, tLocal);

      compose(ctx, video, tAbs);
      ctx.filter = 'none';
      overlay(ctx, tRel * 1000);

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

export type RenderClipOptions = {
  /** clipe já cortado com `-c copy` (pequeno) */
  clip: Blob;
  /** intervalo ABSOLUTO do corte, em segundos da FONTE */
  absStart: number;
  absEnd: number;
  /** segundo absoluto do 1º frame do clipe (ver cabeçalho do arquivo) */
  clipFirstPts: number;
  /** tamanho da saída (1080x1920 etc.) */
  out: OutSize;
  compose: ComposeFn;
  overlay: OverlayFn;
  /** áudio do corte já extraído (AAC); null = entrega mudo */
  audio: Blob | null;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** força o caminho por seek (QA/harness — não usar na UI) */
  forceSeekPath?: boolean;
  /** pula o ensureTypoFonts (quando o chamador já garantiu as fontes) */
  skipFonts?: boolean;
};

export async function renderClip(opts: RenderClipOptions): Promise<RenderResult> {
  const {
    clip,
    absStart,
    absEnd,
    clipFirstPts,
    out,
    compose,
    overlay,
    audio,
    onProgress,
    signal,
  } = opts;

  if (typeof VideoEncoder === 'undefined') {
    throw new FriendlyError(
      'Seu navegador não suporta o render local (WebCodecs). Usa o Chrome ou Edge atualizados no computador.',
    );
  }

  const outDurationSec = absEnd - absStart;
  if (!(outDurationSec > 0)) {
    throw new FriendlyError('Esse corte ficou com duração zero. Ajusta as bordas e tenta de novo.');
  }

  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error(CANCELLED_ERROR);
  };

  onProgress?.({ phase: 'fontes', ratio: 0 });
  if (!opts.skipFonts) await ensureTypoFonts();
  throwIfAborted();

  // ── clipe fonte (metadata sempre via <video>; frames só no fallback) ──
  const url = URL.createObjectURL(clip);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new FriendlyError('Não consegui abrir o trecho cortado. Tenta renderizar de novo.')),
        15000,
      );
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(
          new FriendlyError(
            'O navegador não abriu o trecho cortado. Se repetir, converte a fonte pra MP4 (H.264) e tenta de novo.',
          ),
        );
      };
      video.src = url;
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const clipDurationSec = isFinite(video.duration) && video.duration > 0 ? video.duration : outDurationSec;
    if (!srcW || !srcH) {
      throw new FriendlyError(
        'Não consegui ler as dimensões do trecho cortado. Converte a fonte pra MP4 (H.264) e tenta de novo.',
      );
    }

    const W = even(out.w);
    const H = even(out.h);

    // bitrate: régua por bpp, mas ACOMPANHA a fonte quando ela é mais pesada
    // que a régua. Teto de 20M + orçamento de MEMFS seguram arquivo e memória.
    // srcRate usa a duração do CLIPE (que inclui a sobra), não a do corte.
    const bppRate = W * H * FPS * 0.12;
    const srcRate = (clip.size * 8) / Math.max(0.5, clipDurationSec);
    const budgetRate = (RENDER_BYTES_BUDGET * 8) / outDurationSec;
    const bitrate = Math.round(
      Math.min(Math.max(bppRate, Math.min(srcRate, 20_000_000), 2_500_000), budgetRate),
    );

    const codec = await pickCodec(W, H, bitrate);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new FriendlyError('Não consegui criar o canvas de composição.');

    const base: FramesOpts = {
      clip,
      absStart,
      absEnd,
      clipFirstPts,
      compose,
      overlay,
      canvas,
      ctx,
      W,
      H,
      outDurationSec,
      codec,
      bitrate,
      onProgress,
      throwIfAborted,
    };

    // ── frames: caminho rápido primeiro; qualquer tropeço cai pro seek ──
    let videoOnly: Blob | null = null;
    let mode: 'decode' | 'seek' = 'decode';
    if (!opts.forceSeekPath) {
      try {
        videoOnly = await renderFramesByDecode({ ...base, srcW, srcH });
      } catch (e) {
        if (isCancellationError(e) || signal?.aborted) throw e;
        console.warn('[auto-cortes] decode rápido falhou — caindo pro seek:', e);
        videoOnly = null;
      }
    }
    if (!videoOnly) {
      mode = 'seek';
      onProgress?.({
        phase: 'frames',
        ratio: 0,
        frame: 0,
        totalFrames: Math.ceil(outDurationSec * FPS),
      });
      videoOnly = await renderFramesBySeek({ ...base, video, clipDurationSec });
    }

    if (videoOnly.size < 2048) {
      throw new FriendlyError('O render saiu vazio — tenta de novo. Se repetir, fecha outras abas pesadas.');
    }

    // ── áudio do corte de volta (ffmpeg-wasm, infra blindada do repo) ──
    onProgress?.({ phase: 'audio', ratio: 0 });
    throwIfAborted();
    let final = videoOnly;
    let audioOk = false;
    if (audio) {
      try {
        const vOnly = videoOnly;
        final = await runFfmpegExclusive(() =>
          muxAudioIntoVideo(vOnly, audio, {
            onProgress: (p) => onProgress?.({ phase: 'audio', ratio: p.ratio }),
          }),
        );
        audioOk = true;
      } catch (e) {
        if (isCancellationError(e) || signal?.aborted) throw e;
        // Entrega o corte MUDO em vez de morrer no fim — o card avisa o user
        // e o botão "Renderizar de novo" existe.
        console.warn('[auto-cortes] mux de áudio falhou, entregando sem áudio:', e);
        final = videoOnly;
      }
    }
    if (!audioOk) {
      // sem passar pelo ffmpeg ninguém validou o MP4 — valida aqui (o
      // muxAudioIntoVideo já faz o assertValidMp4 dele no outro caminho)
      assertValidMp4(new Uint8Array(await final.arrayBuffer()), 'corte');
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

/* ───────────────────────────── thumbnail ───────────────────────────── */

/** largura da miniatura do card (a altura sai da proporção da saída) */
export const THUMB_WIDTH = 540;

/**
 * Miniatura WYSIWYG de UM instante do corte: mesmo compositor e mesmo
 * overlay do MP4, só que num único frame lido por seek (barato, roda antes
 * do render terminar pro grid aparecer cedo).
 *
 * `tAbs` é o segundo ABSOLUTO da fonte; `clipFirstPts` segue a mesma regra
 * documentada no cabeçalho deste arquivo.
 */
export async function renderThumb(
  clip: Blob,
  tAbs: number,
  clipFirstPts: number,
  compose: ComposeFn,
  overlay: OverlayFn,
  out: OutSize,
  opts: { quality?: number; skipFonts?: boolean } = {},
): Promise<Blob> {
  if (!opts.skipFonts) await ensureTypoFonts();

  const url = URL.createObjectURL(clip);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout ao abrir o clipe pra miniatura')), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('o navegador não abriu o clipe pra miniatura'));
      };
      video.src = url;
    });

    const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const tLocal = clamp(tAbs - clipFirstPts, 0, Math.max(0, dur - 0.05));
    await seekVideo(video, tLocal);

    // Compõe em resolução CHEIA (o overlay é dimensionado pela largura do
    // canvas — compor em 540 mudaria a tipografia) e só depois reduz.
    const full = document.createElement('canvas');
    full.width = even(out.w);
    full.height = even(out.h);
    const fctx = full.getContext('2d', { alpha: false });
    if (!fctx) throw new Error('canvas da miniatura indisponível');
    compose(fctx, video, tAbs);
    fctx.filter = 'none';
    overlay(fctx, 0);

    const small = document.createElement('canvas');
    small.width = THUMB_WIDTH;
    small.height = Math.max(2, Math.round((THUMB_WIDTH * full.height) / full.width));
    const sctx = small.getContext('2d', { alpha: false });
    if (!sctx) throw new Error('canvas da miniatura indisponível');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(full, 0, 0, small.width, small.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      small.toBlob(resolve, 'image/jpeg', opts.quality ?? 0.82),
    );
    if (!blob) throw new Error('não consegui gerar a miniatura');
    return blob;
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
