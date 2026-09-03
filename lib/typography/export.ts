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
import { drawHeadlines, type Headline } from './headline';
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
  /** o encode rodou no HARDWARE da máquina? (só velocidade; QA/telemetria) */
  hw?: boolean;
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

/** Codec + de onde ele roda. `hw` só muda velocidade, nunca o resultado. */
type CodecEscolhido = { codec: string; hw: boolean };

/**
 * Escolhe o codec E TENTA HARDWARE PRIMEIRO (31.08).
 *
 * O encode é a fase mais cara do render — um AD de 90s são ~2.700 frames — e
 * o padrão do WebCodecs é deixar o navegador decidir, o que na prática cai no
 * encoder de SOFTWARE. Pedir `prefer-hardware` liga o NVENC/QuickSync da
 * máquina: mesmo bitrate, mesmo codec, várias vezes mais rápido. Se a máquina
 * não tiver (ou o perfil não couber no hardware), `isConfigSupported` diz não
 * e caímos no software exatamente como antes — nada quebra.
 */
async function pickCodec(
  width: number,
  height: number,
  bitrate: number,
): Promise<CodecEscolhido> {
  const candidates = [
    'avc1.640033', // High 5.1
    'avc1.640032', // High 5.0
    'avc1.64002a', // High 4.2
    'avc1.640028', // High 4.0
    'avc1.4d0028', // Main 4.0
    'avc1.42e01f', // Baseline 3.1
  ];
  // 1ª passada HARDWARE, 2ª passada o que der. A ordem importa: um perfil
  // mais simples NO HARDWARE ganha de um perfil alto no software.
  for (const modo of ['prefer-hardware', 'no-preference'] as const) {
    for (const codec of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate,
          framerate: FPS,
          hardwareAcceleration: modo,
        });
        if (support.supported) return { codec, hw: modo === 'prefer-hardware' };
      } catch {
        /* tenta o próximo */
      }
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
  hw = false,
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
    ...(hw ? { hardwareAcceleration: 'prefer-hardware' as const } : null),
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
  /** headlines: texto PARADO por cima, faixa separada da legenda */
  headlines?: Headline[];
  zoom?: ZoomSeg[];
  inserts?: PlanoInsert;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  srcW: number;
  srcH: number;
  durationSec: number;
  codec: string;
  bitrate: number;
  hw?: boolean;
  onProgress?: (p: RenderProgress) => void;
  throwIfAborted: () => void;
}): Promise<Blob | null> {
  const {
    file,
    blocks,
    preset,
    style,
    headlines,
    zoom,
    inserts,
    canvas,
    ctx,
    W,
    H,
    srcW,
    srcH,
    durationSec,
    codec,
    bitrate,
    hw,
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
    drawZoomed(ctx, src, src.displayWidth || W, src.displayHeight || H, W, H, zoom, t);
    ctx.filter = 'none';
    desenharInsert(ctx, inserts, t, W, H, src, src.displayWidth || W, src.displayHeight || H);
    drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);
    if (headlines && headlines.length > 0) drawHeadlines(ctx, headlines, t * 1000, W, H);
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
    sink = makeSink(codec, W, H, bitrate, hw);
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
  /** headlines: texto PARADO por cima, faixa separada da legenda */
  headlines?: Headline[];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  durationSec: number;
  codec: string;
  bitrate: number;
  hw?: boolean;
  zoom?: ZoomSeg[];
  inserts?: PlanoInsert;
  onProgress?: (p: RenderProgress) => void;
  throwIfAborted: () => void;
}): Promise<Blob> {
  const {
    video,
    blocks,
    preset,
    style,
    headlines,
    zoom,
    inserts,
    canvas,
    ctx,
    W,
    H,
    durationSec,
    codec,
    bitrate,
    hw,
    onProgress,
    throwIfAborted,
  } = opts;

  const sink = makeSink(codec, W, H, bitrate, hw);
  const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));
  const frameUs = Math.round(1_000_000 / FPS);

  try {
    for (let i = 0; i < totalFrames; i++) {
      throwIfAborted();
      const e0 = sink.err();
      if (e0) throw e0;

      const t = Math.min(i / FPS + 0.0001, durationSec - 0.001);
      await seekVideo(video, t);
      // o quadro do INSERT também tem que estar pronto antes de desenhar
      if (inserts?.preparar) await inserts.preparar(t);

      drawZoomed(ctx, video, video.videoWidth || W, video.videoHeight || H, W, H, zoom, t);
      ctx.filter = 'none';
      desenharInsert(ctx, inserts, t, W, H, video, video.videoWidth || W, video.videoHeight || H);
      drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);
      if (headlines && headlines.length > 0) drawHeadlines(ctx, headlines, t * 1000, W, H);

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

/* ───────────────────────────── zoom por segmento ─────────────────────────
 * DINÂMICA DE ZOOM (30.08): cada segmento é uma rampa de escala (from → to)
 * aplicada como CROP CENTRAL do frame fonte — o vídeo "empurra pra dentro"
 * sem borda preta e sem mexer na duração (o áudio continua batendo). A
 * legenda é desenhada DEPOIS, então ela nunca é ampliada junto. Fora de
 * qualquer segmento a escala é 1 (frame intocado). */

export type ZoomSeg = {
  /** janela do segmento em segundos, no tempo do vídeo FINAL */
  start: number;
  end: number;
  /** escala no começo e no fim da janela (1 = sem zoom) */
  from: number;
  to: number;
  /** instante em que a RAMPA termina; de `rampaAte` até `end` a escala fica
   *  parada em `to`. É o respiro que faz o movimento RESOLVER antes do corte,
   *  em vez de ser interrompido por ele. Ausente = rampa até `end`. */
  rampaAte?: number;
};

// A curva mora em [[lib/pilot-pos-producao.ts]], junto do planejador — assim o
// teste do plano mede a MESMA escala que o render desenha.
export { escalaNoInstante as zoomScaleAt } from '../pilot-pos-producao';
import { escalaNoInstante as zoomScaleAt } from '../pilot-pos-producao';

/** Desenha o frame fonte com o crop central da escala do instante `t`. */
function drawZoomed(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  W: number,
  H: number,
  plan: ZoomSeg[] | undefined,
  t: number,
) {
  const s = zoomScaleAt(plan, t);
  if (s <= 1.0005) {
    ctx.drawImage(src, 0, 0, W, H);
    return;
  }
  const sw = srcW / s;
  const sh = srcH / s;
  ctx.drawImage(src, (srcW - sw) / 2, (srcH - sh) / 2, sw, sh, 0, 0, W, H);
}

/* ──────────────────────────── inserts (31.08) ─────────────────────────────
 * O insert é b-roll que entra POR CIMA do avatar durante uma janela de tempo,
 * em tela cheia ou dividindo a tela com ele. Tudo o que decide GEOMETRIA mora
 * em lib/pilot-inserts (testado); aqui é só pintura.
 *
 * A ordem importa: zoom → avatar → insert → transição → legenda. A legenda
 * fica por último porque ela tem que ser lida SEMPRE, inclusive em cima do
 * insert; e a transição vem antes dela pra não apagar o texto no flash. */

/** Uma fonte de pixels do insert, já pronta pra desenhar num instante t. */
export type FonteInsert = {
  id: string;
  /** o que desenhar no instante `tRel` (segundos desde o começo da janela) */
  quadro: (tRel: number) => CanvasImageSource | null;
  w: number;
  h: number;
};

export type PlanoInsert = {
  janelas: Array<{ id: string; start: number; end: number }>;
  /**
   * layout/foco por id, JÁ NA RÉGUA DO FRAME.
   *
   * ⚠ `W`/`H` são obrigatórios: o palco tem que ser calculado nas dimensões
   * REAIS do render. Numa versão anterior ele saía fixo em 1080×1920 e, num
   * vídeo 720×1280, o card do avatar caía fora da tela.
   */
  porId: (id: string, W: number, H: number) => {
    palco: { avatar: Ret | null; insert: Ret; raio: number };
    focoAvatarY: number;
    /** borrão de movimento que mascara o slow motion (px na régua de 1080) */
    blur?: number;
  } | null;
  cobertura: (t: number) => { cor: 'preto' | 'branco'; alpha: number } | null;
  fontes: Map<string, FonteInsert>;
  /**
   * ESPERA o quadro do instante `t` ficar pronto (02.09).
   *
   * O `quadro()` é síncrono e não pode esperar seek de `<video>`. Sem este
   * gancho, o caminho rápido compunha frames muito mais depressa do que o
   * vídeo do insert completava seeks — o insert repetia o MESMO quadro por
   * vários frames de saída e o AD saía "passando frame a frame, parece 5fps"
   * (Silas, 02.09), no take longo E no curto. Não era a velocidade: era o
   * quadro que nunca chegava.
   */
  preparar?: (t: number) => Promise<void>;
};

type Ret = { x: number; y: number; w: number; h: number };

/** COVER com foco — o mesmo cálculo de lib/pilot-inserts, sem import cíclico. */
function recorteCover(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  focoY: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (!(srcW > 0) || !(srcH > 0) || !(dstW > 0) || !(dstH > 0)) {
    return { sx: 0, sy: 0, sw: Math.max(1, srcW), sh: Math.max(1, srcH) };
  }
  const escala = Math.max(dstW / srcW, dstH / srcH);
  const sw = Math.min(srcW, dstW / escala);
  const sh = Math.min(srcH, dstH / escala);
  const fy = Math.min(1, Math.max(0, focoY));
  const sx = Math.min(srcW - sw, Math.max(0, srcW / 2 - sw / 2));
  const sy = Math.min(srcH - sh, Math.max(0, srcH * fy - sh / 2));
  return { sx, sy, sw, sh };
}

function caminhoArredondado(ctx: CanvasRenderingContext2D, r: Ret, raio: number) {
  const rr = Math.min(raio, r.w / 2, r.h / 2);
  ctx.beginPath();
  ctx.moveTo(r.x + rr, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rr);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rr);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rr);
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rr);
  ctx.closePath();
}

/**
 * Compõe o frame do instante `t`: avatar (já desenhado no canvas) + insert.
 *
 * Em SPLIT o avatar é redesenhado no retângulo dele — ancorado no ROSTO, não
 * no centro, senão o corte come a testa. Em TELA CHEIA o insert cobre tudo.
 * Nos dois casos o desenho é COVER: nunca sobra borda.
 *
 * `fonteAvatar` é o frame do vídeo principal (o mesmo que já está no canvas),
 * necessário pro split poder reposicioná-lo.
 */
function desenharInsert(
  ctx: CanvasRenderingContext2D,
  plano: PlanoInsert | undefined,
  t: number,
  W: number,
  H: number,
  fonteAvatar: CanvasImageSource | null,
  avatarW: number,
  avatarH: number,
) {
  if (!plano) return;
  const jan = plano.janelas.find((j) => t >= j.start && t < j.end);
  if (jan) {
    const cfg = plano.porId(jan.id, W, H);
    const fonte = plano.fontes.get(jan.id);
    if (cfg && fonte) {
      const img = fonte.quadro(t - jan.start);
      if (img) {
        // SPLIT: o avatar sai do lugar dele e vai pro card, com foco no rosto
        if (cfg.palco.avatar && fonteAvatar) {
          ctx.save();
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          const ra = cfg.palco.avatar;
          const rec = recorteCover(avatarW, avatarH, ra.w, ra.h, cfg.focoAvatarY);
          if (cfg.palco.raio > 0) {
            caminhoArredondado(ctx, ra, cfg.palco.raio);
            ctx.clip();
          }
          ctx.drawImage(fonteAvatar, rec.sx, rec.sy, rec.sw, rec.sh, ra.x, ra.y, ra.w, ra.h);
          ctx.restore();
        }
        // o insert no retângulo dele
        ctx.save();
        const ri = cfg.palco.insert;
        if (cfg.palco.raio > 0) {
          caminhoArredondado(ctx, ri, cfg.palco.raio);
          ctx.clip();
        }
        // MÁSCARA DO SLOW MOTION: sem interpolação de frames, desacelerar
        // repete o mesmo frame e o olho lê travamento. O borrão leve cobre o
        // degrau — é o que separa "câmera lenta" de "vídeo travando".
        if (cfg.blur && cfg.blur > 0.05) {
          ctx.filter = `blur(${((cfg.blur * W) / 1080).toFixed(2)}px)`;
        }
        const rec = recorteCover(fonte.w, fonte.h, ri.w, ri.h, 0.5);
        ctx.drawImage(img, rec.sx, rec.sy, rec.sw, rec.sh, ri.x, ri.y, ri.w, ri.h);
        ctx.filter = 'none';
        ctx.restore();
      }
    }
  }
  // TRANSIÇÃO por último: o flash cobre avatar E insert (é a troca inteira)
  const cob = plano.cobertura(t);
  if (cob && cob.alpha > 0.001) {
    ctx.save();
    ctx.globalAlpha = cob.alpha;
    ctx.fillStyle = cob.cor === 'preto' ? '#000' : '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/* ───────────────────────────── orquestração ───────────────────────────── */

export async function renderTypographyVideo(opts: {
  file: File | Blob;
  blocks: Block[];
  preset: TypoPreset;
  style: StyleState;
  /** headlines: texto PARADO por cima, faixa separada da legenda */
  headlines?: Headline[];
  /** DINÂMICA DE ZOOM — rampas de escala por janela; vazio/ausente = sem zoom */
  zoom?: ZoomSeg[];
  /** INSERTS — b-roll por cima do avatar (tela cheia ou split) */
  inserts?: PlanoInsert;
  onProgress?: (p: RenderProgress) => void;
  signal?: AbortSignal;
  /** força o caminho por seek (QA/harness — não usar na UI) */
  forceSeekPath?: boolean;
  /**
   * O CHAMADOR JÁ SEGURA o lock exclusivo do ffmpeg (`runFfmpegExclusive`).
   *
   * A fila do ffmpeg NÃO é reentrante: pedir o slot de dentro de quem já o
   * segura é esperar a si mesmo — deadlock silencioso. É exatamente o que
   * travava a pós-produção do Pilot na fase de áudio: o pipeline roda inteiro
   * dentro do lock e o mux daqui pedia o lock de novo. Com isto ligado, o mux
   * roda DIRETO (a exclusividade já está garantida por quem chamou).
   */
  ffmpegJaExclusivo?: boolean;
}): Promise<RenderResult> {
  const { file, blocks, preset, style, headlines, zoom, inserts, onProgress, signal, ffmpegJaExclusivo } = opts;

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
    // ── metadata: <video> primeiro, CABEÇALHO do MP4 como reserva ──
    // Numa aba em segundo plano o Chrome estrangula o pipeline de mídia e o
    // `loadedmetadata` nunca chega. Isso derrubava o render inteiro (e, no
    // Pilot, o AD saía sem legenda e sem zoom sem ninguém saber). O moov do
    // MP4 tem os mesmos números e não depende de aba nenhuma.
    const videoAbriu = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(true);
      };
      video.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      video.src = url;
    });

    let srcW = video.videoWidth;
    let srcH = video.videoHeight;
    let durationSec = video.duration;
    if (!videoAbriu || !srcW || !srcH || !isFinite(durationSec) || durationSec <= 0) {
      const { metaPeloCabecalho } = await import('../video-duracao');
      const meta = await metaPeloCabecalho(file);
      if (!meta) {
        throw new FriendlyError(
          videoAbriu
            ? 'Não consegui ler as dimensões do vídeo. Converte pra MP4 (H.264) e tenta de novo.'
            : 'Não consegui abrir o vídeo. Confere o arquivo e tenta de novo.',
        );
      }
      srcW = meta.width;
      srcH = meta.height;
      durationSec = meta.durSec;
      console.warn(
        `[typo-export] <video> não respondeu (aba em segundo plano?) — metadata lida do cabeçalho: ` +
          `${srcW}x${srcH} ${durationSec.toFixed(1)}s`,
      );
    }

    const longSide = Math.max(srcW, srcH);
    const scale = longSide > 1920 ? 1920 / longSide : 1;
    const W = even(srcW * scale);
    const H = even(srcH * scale);

    // bitrate: régua por bpp, mas ACOMPANHA a fonte quando ela é mais pesada
    // que a régua (re-encodar acima do bitrate original não deixa nada na
    // mesa). A fonte ganha 1,5x DE FOLGA: celular grava HEVC, e H.264 no
    // MESMO bitrate de um HEVC perde nitidez visível — era o "legendou e o
    // vídeo perdeu qualidade" (02.09). Teto de 26M + orçamento de MEMFS
    // seguram arquivo e memória; a régua nunca desce abaixo do próprio piso
    // (0,14 bpp — legenda nítida mesmo com fonte fraca). srcRate inclui
    // áudio/container (~5-10% a mais) — só reforça a folga.
    const bppRate = W * H * FPS * 0.14;
    const srcRate = (file.size * 8) / durationSec;
    const budgetRate = (RENDER_BYTES_BUDGET * 8) / durationSec;
    const bitrate = Math.round(
      Math.min(
        Math.max(bppRate, Math.min(srcRate * 1.5, 26_000_000), 2_500_000),
        budgetRate,
      ),
    );

    const { codec, hw } = await pickCodec(W, H, bitrate);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new FriendlyError('Não consegui criar o canvas de composição.');

    // ── frames: caminho rápido primeiro; qualquer tropeço cai pro seek ──
    let videoOnly: Blob | null = null;
    let mode: 'decode' | 'seek' = 'decode';
    // INSERT liga o caminho por seek: o decode compõe frames dentro do
    // callback do decoder (síncrono) e não tem onde esperar o seek do vídeo
    // do insert. O seek path já espera o frame do vídeo principal — esperar o
    // do insert junto é uma linha. Mais lento, mas o insert sai FLUIDO.
    const insertsPrecisamEsperar = !!(inserts && inserts.janelas.length > 0 && inserts.preparar);
    if (insertsPrecisamEsperar) {
      console.log('[tipografia] inserts presentes — render pelo caminho de seek (frame a frame do insert esperado)');
    }
    if (!opts.forceSeekPath && !insertsPrecisamEsperar) {
      try {
        videoOnly = await renderFramesByDecode({
          file,
          blocks,
          preset,
          style,
          headlines,
          zoom,
          inserts,
          canvas,
          ctx,
          W,
          H,
          srcW,
          srcH,
          durationSec,
          codec,
          bitrate,
          hw,
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
      // O seek pinta os frames DO <video>. Se ele nem abriu (aba em segundo
      // plano), esse caminho não desenha nada — ficaria esperando um seek que
      // nunca completa. Falhar aqui, alto e claro, é melhor que travar.
      if (!videoAbriu) {
        throw new FriendlyError(
          'O navegador não abriu o vídeo pra renderizar (a aba precisa ficar VISÍVEL durante o render). ' +
            'Deixa esta aba na frente e roda de novo.',
        );
      }
      mode = 'seek';
      onProgress?.({ phase: 'frames', ratio: 0, frame: 0, totalFrames: Math.ceil(durationSec * FPS) });
      videoOnly = await renderFramesBySeek({
        video,
        blocks,
        preset,
        style,
        headlines,
        zoom,
        inserts,
        canvas,
        ctx,
        W,
        H,
        durationSec,
        codec,
        bitrate,
        hw,
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
      // Quem já tem o lock roda direto; quem não tem, entra na fila.
      const comLock = <R,>(f: () => Promise<R>): Promise<R> =>
        ffmpegJaExclusivo ? f() : runFfmpegExclusive(f);
      final = await comLock(async () => {
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
    return { blob: final, audioOk, width: W, height: H, fps: FPS, mode, hw };
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
