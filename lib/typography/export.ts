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
  mode: 'decode' | 'seek' | 'playback';
  /**
   * O som dos inserts que o editor LIGOU entrou na trilha? `false` quando
   * havia som pedido e a mistura falhou (o AD sai com o áudio do avatar, que
   * é o que não pode faltar). Quem chama transforma isso em aviso — antes a
   * falha morria num console.warn e o editor achava que a opção não funcionava.
   */
  somInsertOk?: boolean;
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
 * ⚡ ESPERA A FILA BAIXAR — POR EVENTO, NÃO POR GIRO EM FALSO (03.09).
 *
 * O render era 10x mais lento do que devia e a culpa não era do encoder nem do
 * decoder. Medido no arquivo real: de 43,8s de render, DESENHO 0,6s, DECODE
 * 2,3s — e **40,9s parado esperando a fila**. O laço antigo girava em falso
 * (`while (fila cheia) await nextTask()`), criando um MessageChannel novo a
 * cada volta, milhares de vezes por segundo. O efeito é perverso: essa espera
 * ocupada monopoliza a thread principal e ROUBA dela justamente os callbacks
 * do decoder e do encoder — o render passava o tempo todo impedindo os codecs
 * de trabalhar.
 *
 * Agora a espera é passiva: o WebCodecs avisa pelo evento `dequeue` quando a
 * fila anda, e a thread fica LIVRE até lá. Com timer de segurança curto pra
 * nunca travar caso o evento não venha (navegador antigo sem `dequeue`).
 */
function esperarFilaBaixar(
  decoder: VideoDecoder | null,
  encoder: VideoEncoder | null,
  tetoDecode: number,
  tetoEncode: number,
): Promise<void> {
  const cabe = () =>
    (!decoder || decoder.decodeQueueSize <= tetoDecode) &&
    (!encoder || encoder.encodeQueueSize <= tetoEncode);
  if (cabe()) return Promise.resolve();
  return new Promise((resolve) => {
    let fechado = false;
    const terminar = () => {
      if (fechado) return;
      fechado = true;
      clearTimeout(rede);
      decoder?.removeEventListener('dequeue', olhar);
      encoder?.removeEventListener('dequeue', olhar);
      resolve();
    };
    const olhar = () => {
      if (cabe()) terminar();
    };
    // rede de segurança: navegador sem `dequeue` continua funcionando, só
    // volta ao ritmo antigo em vez de travar.
    const rede = setTimeout(terminar, 60);
    decoder?.addEventListener('dequeue', olhar);
    encoder?.addEventListener('dequeue', olhar);
    olhar(); // a fila pode ter baixado entre o teste e o registro
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
  qualidadeMax = false,
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
    // ⚡ O MAIOR CUSTO DO RENDER (03.09). `quality` liga a análise
    // multi-passagem do encoder — ela pesa MUITO e o ganho é invisível num
    // vídeo vertical de anúncio. `realtime` codifica em uma passada: várias
    // vezes mais rápido, com perda que não se enxerga no feed. Silas:
    // *"temos que sacrificar um pouco de qualidade (imperceptível) pra ganhar
    // uma boa velocidade"*. Quem quiser o máximo liga MAX QUALITY.
    latencyMode: qualidadeMax ? 'quality' : 'realtime',
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
export function trackDescription(
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
  qualidadeMax?: boolean;
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
    qualidadeMax,
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

  let _msDesenho = 0;
  let _msEspera = 0;
  let _msEncode = 0;
  const _tRender = performance.now();
  const emitTick = (src: VideoFrame) => {
    if (!sink) return;
    const t = Math.min(nextTick / FPS + 0.0001, durationSec - 0.001);
    const _m0 = performance.now();
    drawZoomed(ctx, src, src.displayWidth || W, src.displayHeight || H, W, H, zoom, t);
    ctx.filter = 'none';
    desenharInsert(ctx, inserts, t, W, H, src, src.displayWidth || W, src.displayHeight || H);
    drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);
    if (headlines && headlines.length > 0) drawHeadlines(ctx, headlines, t * 1000, W, H);
    const vf = new VideoFrame(canvas, {
      timestamp: nextTick * frameUs,
      duration: frameUs,
    });
    const _m1 = performance.now();
    sink.encoder.encode(vf, { keyFrame: nextTick % (FPS * 4) === 0 });
    vf.close();
    _msDesenho += _m1 - _m0;
    _msEncode += performance.now() - _m1;
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

  /* ⚡ INSERT NO CAMINHO RÁPIDO (03.09). Antes, ter insert PROIBIA este
   * caminho: a composição acontecia DENTRO do callback do decoder, que é
   * síncrono, e não havia onde esperar o quadro do insert. Sobrava a
   * REPRODUÇÃO (que anda a 1x e congela em aba oculta) e, quando ela parava
   * de progredir, o SEEK — que re-decodifica desde o keyframe A CADA QUADRO.
   * Foi essa cascata que produziu o AD de 1154 minutos entregue sem legenda.
   *
   * Agora o callback só ENFILEIRA o quadro decodificado, e quem compõe é um
   * dreno assíncrono: ele pode esperar o `preparar` do insert antes de cada
   * tick. O insert entra no caminho rápido, com o quadro EXATO, sem relógio e
   * sem depender de a aba estar visível. */
  const chegados: VideoFrame[] = [];
  const prepararInsert = inserts?.preparar;

  const drenar = async () => {
    while (chegados.length > 0) {
      const f = chegados[0];
      if (basePtsUs == null) basePtsUs = f.timestamp;
      const ptsUs = f.timestamp - basePtsUs;
      while (
        nextTick < totalFrames &&
        Math.round((nextTick * 1_000_000) / FPS) < ptsUs
      ) {
        if (prepararInsert) {
          const t = Math.min(nextTick / FPS + 0.0001, durationSec - 0.001);
          const _w = performance.now();
          await prepararInsert(t);
          _msEspera += performance.now() - _w;
        }
        emitTick(lastFrame ?? f);
        // FREIO AQUI TAMBÉM: uma lacuna grande de PTS (vídeo com quadro
        // faltando, VFR) faz este laço emitir dezenas de quadros de uma vez.
        // Sem o freio, a fila do encoder estoura e a memória vai junto — o
        // freio do `pump` só age DEPOIS do dreno inteiro.
        if (sink && sink.encoder.encodeQueueSize > 24) {
          const _w2 = performance.now();
          await esperarFilaBaixar(null, sink.encoder, 30, 24);
          _msEspera += performance.now() - _w2;
        }
      }
      chegados.shift();
      lastFrame?.close();
      lastFrame = f;
      if (nextTick >= totalFrames) {
        for (const x of chegados) {
          try {
            x.close();
          } catch {
            /* já fechado */
          }
        }
        chegados.length = 0;
        return;
      }
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
    chegados.push(f);
  };

  const decoder = new VideoDecoder({
    output: onFrame,
    error: (e) => {
      decodeError = e instanceof Error ? e : new Error(String(e));
    },
  });

  // batimento de diagnostico: se o quadro parar de andar, diz ONDE parou
  let _ultimoTick = -1;
  const _bat = setInterval(() => {
    if (nextTick === _ultimoTick) {
      console.warn(
        `[tipografia] PARADO em tick ${nextTick}/${totalFrames} · chegados=${chegados.length} ` +
          `filaDec=${decoder.decodeQueueSize} filaEnc=${sink ? sink.encoder.encodeQueueSize : -1} ` +
          `pending=${pending.length} lastFrame=${lastFrame ? 'sim' : 'nao'} ` +
          `decState=${decoder.state} encState=${sink ? sink.encoder.state : '-'}`,
      );
    }
    _ultimoTick = nextTick;
  }, 3000);

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
        await drenar(); // compõe o que já saiu (é aqui que o insert pode esperar)
        if (nextTick >= totalFrames) break;
        /* ⚡ FILAS FUNDAS (03.09). Com teto 12/6 o decoder e o encoder de
         * hardware ficavam ociosos: a cada punhado de quadros o laço parava pra
         * esperar. Chip de vídeo trabalha em LOTE — filas fundas mantêm os dois
         * saturados e o render deixa de ser uma fila indiana. Os quadros do
         * encoder são fechados na hora (`vf.close()`), então a memória não
         * cresce com o tamanho da fila. */
        if (decoder.decodeQueueSize > 30 || (sink && sink.encoder.encodeQueueSize > 24)) {
          const _w = performance.now();
          await esperarFilaBaixar(decoder, sink ? sink.encoder : null, 30, 24);
          _msEspera += performance.now() - _w;
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
    /* ⚠ DECODE ERA 99% DO RENDER (03.09). Medido no arquivo real: 420 quadros
     * em 30,3s — desenho 0,3s, encode 0,0s, DECODE 30,0s. Sem dica nenhuma o
     * Chrome escolhia decodificação por SOFTWARE, ~70ms por quadro em 1080x1920.
     * Duas dicas resolvem: `prefer-hardware` usa o decoder do chip, e
     * `optimizeForLatency: false` deixa ele encher o buffer de reordenação e
     * trabalhar em lote (com `true` ele entrega quadro a quadro e perde vazão).
     * Se a máquina não tiver decoder de hardware, cai na config simples — nunca
     * falha por causa da dica. */
    const config: VideoDecoderConfig = {
      codec: track.codec,
      description: desc,
    };
    const rapida: VideoDecoderConfig = {
      ...config,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: false,
    };
    const cabe = async (c: VideoDecoderConfig) => {
      try {
        return (await VideoDecoder.isConfigSupported(c)).supported === true;
      } catch {
        return false;
      }
    };
    let escolhida: VideoDecoderConfig | null = null;
    if (await cabe(rapida)) escolhida = rapida;
    else if (await cabe(config)) escolhida = config;
    if (!escolhida) return null;

    decoder.configure(escolhida);
    sink = makeSink(codec, W, H, bitrate, hw, qualidadeMax);
    mp4.setExtractionOptions(track.id, null, { nbSamples: 100 });
    mp4.start();
    mp4.flush(); // entrega inclusive o lote final (<nbSamples)
    if (pending.length === 0) return null; // extração seca — seek cobre

    await pump();

    /* ⚠⚠ DRENAR DURANTE O FLUSH (04.09). Antes era `await decoder.flush()` e
     * SÓ DEPOIS `drenar()`. Impasse: durante o flush o decoder entrega os
     * quadros que faltavam pelo callback, eles empilham em `chegados`, e o
     * VideoDecoder PARA de produzir quando o app segura quadros de saída
     * demais — então o flush nunca resolve e o render trava perto do fim.
     * Visto em 387/420 com chegados=7, filaDec=19 travada, encoder ocioso.
     * (Foi este travamento que eu li errado como "dois decoders de hardware
     * disputando o pool"; era o dreno parado, não o segundo decoder.)
     * Agora o flush corre JUNTO com o dreno: o decoder nunca fica sem buffer. */
    let flushOk = false;
    let flushErro: unknown = null;
    const pFlush = decoder
      .flush()
      .then(() => {
        flushOk = true;
      })
      .catch((e) => {
        flushOk = true;
        flushErro = e;
      });
    /* A espera aqui NAO pode ser `esperarFilaBaixar(decoder, null, 0, 0)`: com
     * a fila ja em zero ela volta na hora, o laco gira em falso e TRAVA a
     * thread (o mesmo pecado que fazia o render ser 5x mais lento). Esperar
     * um sinal de verdade — quadro novo do decoder, ou 30ms — mantem o laco
     * barato e deixa a promessa do flush assentar. */
    const esperarSinal = () =>
      new Promise<void>((res) => {
        let pronto = false;
        const fim = () => {
          if (pronto) return;
          pronto = true;
          clearTimeout(tm);
          try {
            decoder.removeEventListener('dequeue', fim);
          } catch {
            /* decoder ja fechado */
          }
          res();
        };
        const tm = setTimeout(fim, 30);
        decoder.addEventListener('dequeue', fim);
      });
    while (!flushOk) {
      await drenar();
      if (nextTick >= totalFrames) break;
      if (flushOk) break;
      await esperarSinal();
    }
    await pFlush;
    // flush rejeita quando o decoder morreu — decodeError conta a história
    if (flushErro && !decodeError) throw flushErro;
    await drenar();
    checkErrors();

    if (!lastFrame && nextTick === 0) {
      throw new Error('decoder não produziu nenhum frame');
    }
    // rabo: repete o último frame até fechar a duração do container
    while (nextTick < totalFrames && lastFrame) {
      if (prepararInsert) {
        await prepararInsert(Math.min(nextTick / FPS + 0.0001, durationSec - 0.001));
      }
      emitTick(lastFrame);
      if (sink && sink.encoder.encodeQueueSize > 24) {
        await esperarFilaBaixar(null, sink.encoder, 30, 24);
        checkErrors();
      }
    }

    if (!sink) return null;
    await sink.encoder.flush();
    checkErrors();
    sink.encoder.close();
    {
      const total = performance.now() - _tRender;
      console.log(
        `[tipografia] quadros ${nextTick} em ${(total / 1000).toFixed(1)}s · ` +
          `desenho ${(_msDesenho / 1000).toFixed(1)}s · encode ${(_msEncode / 1000).toFixed(1)}s · ` +
          `espera-fila ${(_msEspera / 1000).toFixed(1)}s · ` +
          `decode ${((total - _msDesenho - _msEncode - _msEspera) / 1000).toFixed(1)}s`,
      );
    }
    sink.muxer.finalize();
    return new Blob([sink.target.buffer], { type: 'video/mp4' });
  } finally {
    clearInterval(_bat);
    // (cast: o TS não enxerga as atribuições feitas dentro do callback output)
    (lastFrame as VideoFrame | null)?.close();
    lastFrame = null;
    // Quadros que ficaram na fila do dreno quando algo falhou no meio. Sem
    // isto o VideoDecoder segue segurando memória do chip depois do erro —
    // e um render seguinte pode nem conseguir configurar o decoder.
    for (const f of chegados) {
      try {
        f.close();
      } catch {
        /* já fechado */
      }
    }
    chegados.length = 0;
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
  qualidadeMax?: boolean;
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
    qualidadeMax,
    onProgress,
    throwIfAborted,
  } = opts;

  const sink = makeSink(codec, W, H, bitrate, hw, qualidadeMax);
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

      // backpressure POR EVENTO (nunca girando em falso — ver esperarFilaBaixar)
      if (sink.encoder.encodeQueueSize > 24) {
        await esperarFilaBaixar(null, sink.encoder, 30, 24);
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

/* ─────────────────── caminho por REPRODUÇÃO (03.09) ──────────────────────
 *
 * Por que existe: com INSERTS o render caía no caminho de seek, e seek em
 * H.264 de GOP longo re-decodifica desde o keyframe anterior — no montado
 * (keyframe a cada 4s) isso deu 0,7 quadro/s num AD REAL: o Silas viu
 * "aplicando zoom: 19% (175/918 frames)" morrer no teto de tempo.
 *
 * Aqui o vídeo TOCA a 1x (mudo) e cada frame APRESENTADO é capturado via
 * requestVideoFrameCallback — decodificação sequencial, sem seek nenhum. Os
 * inserts também TOCAM (aoVivo), com playbackRate = velocidade do plano.
 * Um AD de 30s renderiza em ~30s + folga. Precisa de aba visível (rvfc
 * congela oculto — o watchdog de progresso da pós-produção cuida disso).
 */
async function renderFramesByPlayback(opts: {
  video: HTMLVideoElement;
  blocks: Block[];
  preset: TypoPreset;
  style: StyleState;
  headlines?: Headline[];
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  durationSec: number;
  codec: string;
  bitrate: number;
  hw?: boolean;
  qualidadeMax?: boolean;
  zoom?: ZoomSeg[];
  inserts?: PlanoInsert;
  onProgress?: (p: RenderProgress) => void;
  throwIfAborted: () => void;
}): Promise<Blob> {
  const { video, blocks, preset, style, headlines, zoom, inserts, canvas, ctx, W, H, durationSec, codec, bitrate, hw, qualidadeMax, onProgress, throwIfAborted } = opts;
  type ComRvfc = HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    cancelVideoFrameCallback?: (id: number) => void;
  };
  const v = video as ComRvfc;
  if (typeof v.requestVideoFrameCallback !== 'function') {
    throw new Error('navegador sem requestVideoFrameCallback');
  }

  const sink = makeSink(codec, W, H, bitrate, hw, qualidadeMax);
  const totalFrames = Math.max(1, Math.ceil(durationSec * FPS));
  const frameUs = Math.round(1_000_000 / FPS);
  let nextTick = 0;

  const compor = () => {
    const t = Math.min(nextTick / FPS + 0.0001, durationSec - 0.001);
    inserts?.aoVivo?.(t);
    drawZoomed(ctx, video, video.videoWidth || W, video.videoHeight || H, W, H, zoom, t);
    ctx.filter = 'none';
    desenharInsert(ctx, inserts, t, W, H, video, video.videoWidth || W, video.videoHeight || H);
    drawCaptions(ctx, blocks, preset, style, t * 1000, W, H);
    if (headlines && headlines.length > 0) drawHeadlines(ctx, headlines, t * 1000, W, H);
    const frame = new VideoFrame(canvas, { timestamp: nextTick * frameUs, duration: frameUs });
    sink.encoder.encode(frame, { keyFrame: nextTick % (FPS * 4) === 0 });
    frame.close();
    nextTick++;
    if (nextTick % 3 === 0 || nextTick === totalFrames) {
      onProgress?.({ phase: 'frames', ratio: nextTick / totalFrames, frame: nextTick, totalFrames });
    }
  };

  video.pause();
  await seekVideo(video, 0);

  try {
    await new Promise<void>((resolve, reject) => {
      let vivo = true;
      let rvfcId = 0;
      /* ⚡ RETOMAR NA HORA, NÃO NO PRÓXIMO POLL (04.09). O vídeo pausa pra
       * esperar o encoder e voltava só quando o timer de 120ms passasse por
       * ali de novo. Como a pausa acontece muitas vezes durante o render, o
       * caminho de reprodução andava a uma fração do tempo real (medido: 68%
       * de um vídeo de 14s depois de ~3min). O encoder avisa pelo evento
       * `dequeue` assim que a fila anda — retomar aí devolve o ritmo. O timer
       * acima continua como rede de segurança. */
      const retomarJa = () => {
        if (!vivo) return;
        if (video.paused && !video.ended && sink.encoder.encodeQueueSize <= 12) {
          void video.play().catch(() => { /* o rvfc/onended decide */ });
        }
      };
      sink.encoder.addEventListener('dequeue', retomarJa);

      const encerrar = (fn: () => void) => {
        if (!vivo) return;
        vivo = false;
        clearInterval(retomador);
        try {
          sink.encoder.removeEventListener('dequeue', retomarJa);
        } catch {
          /* encoder já fechado */
        }
        try {
          if (rvfcId && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(rvfcId);
        } catch { /* já cancelado */ }
        video.onended = null;
        video.pause();
        inserts?.pausar?.();
        fn();
      };
      // O backpressure PAUSA o vídeo quando o encoder afoga; este relógio o
      // retoma quando a fila esvazia. É o que mantém A/V em dia sem perder
      // frame: quem dita o tempo é o mediaTime, não o relógio de parede.
      //
      // E é também a GUARDA DE ABA OCULTA: o rvfc congela com a aba fora da
      // frente — sem esta desistência o caminho de reprodução penduraria em
      // silêncio. 8s sem NENHUM tick composto = desiste e o chamador cai pro
      // caminho de seek (que aguenta oculto, só devagar).
      let ultimoTickEm = Date.now();
      let ultimoTickVisto = -1;
      const retomador = setInterval(() => {
        if (!vivo) return;
        if (nextTick !== ultimoTickVisto) {
          ultimoTickVisto = nextTick;
          ultimoTickEm = Date.now();
        } else if (Date.now() - ultimoTickEm > 8_000) {
          encerrar(() => reject(new Error('reprodução sem progresso (aba oculta?) — seek assume')));
          return;
        }
        if (video.paused && !video.ended && sink.encoder.encodeQueueSize <= 12) {
          void video.play().catch(() => { /* o rvfc/onended decide */ });
        }
      }, 120);

      const passo = async (_agora: number, meta: { mediaTime: number }) => {
        if (!vivo) return;
        try {
          throwIfAborted();
          const e = sink.err();
          if (e) throw e;
          // compõe todo tick cujo instante já foi APRESENTADO (frame repetido
          // quando o decode pulou — CFR preservado)
          while (nextTick < totalFrames && nextTick / FPS <= meta.mediaTime + 0.5 / FPS) {
            /* ⚡ INSERT PELO LEITOR EXATO TAMBÉM AQUI (04.09). Este caminho só
             * chamava `aoVivo`, então o insert era DIRIGIDO por <video>: play,
             * pause a cada backpressure e seek quando derivava. Em mídia de GOP
             * longo cada seek re-decodifica desde o keyframe — medido 0,05x do
             * tempo real. Chamando `preparar`, o quadro vem do decoder do
             * insert (exato e sequencial), o <video> dele nem precisa tocar, e
             * `aoVivo` volta a pular quem tem leitor com razão de ser.
             * Aqui só existe UM VideoDecoder (o do insert) — o vídeo principal
             * é decodificado pelo próprio <video> —, então não recai no impasse
             * de dois decoders de hardware disputando o pool de quadros. */
            if (inserts?.preparar) {
              await inserts.preparar(Math.min(nextTick / FPS + 0.0001, durationSec - 0.001));
              if (!vivo) return;
            }
            compor();
          }
          if (nextTick >= totalFrames) {
            encerrar(resolve);
            return;
          }
          if (sink.encoder.encodeQueueSize > 24 && !video.paused) {
            video.pause();
            inserts?.pausar?.(); // os inserts pausam JUNTO — senão adiantam
          }
          rvfcId = v.requestVideoFrameCallback!((a, m) => {
            void passo(a, m);
          });
        } catch (err) {
          encerrar(() => reject(err));
        }
      };

      video.onended = () => {
        if (!vivo) return;
        try {
          // cauda: o vídeo acabou antes do último tick (arredondamento) — os
          // ticks restantes saem do último frame apresentado
          while (nextTick < totalFrames) compor();
          encerrar(resolve);
        } catch (err) {
          encerrar(() => reject(err as Error));
        }
      };

      rvfcId = v.requestVideoFrameCallback!(passo);
      void video.play().catch((err) => encerrar(() => reject(err instanceof Error ? err : new Error(String(err)))));
    });

    await sink.encoder.flush();
    const e2 = sink.err();
    if (e2) throw e2;
    sink.encoder.close();
    sink.muxer.finalize();
    return new Blob([sink.target.buffer], { type: 'video/mp4' });
  } finally {
    try {
      if (sink.encoder.state !== 'closed') sink.encoder.close();
    } catch { /* já fechado */ }
    video.pause();
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
  /** SOM dos inserts que o editor ligou — misturado na trilha antes do mux */
  sons?: Array<{
    blob: Blob;
    entraEm: number;
    saiEm: number;
    deSec: number;
    volume: number;
    velocidade: number;
  }>;
  /**
   * DIRIGE os vídeos dos inserts em tempo real (03.09) — usado pelo caminho
   * de REPRODUÇÃO: em vez de seek por frame, cada insert TOCA com
   * playbackRate = velocidade do plano; este hook (chamado a cada frame
   * apresentado) liga/pausa/corrige deriva. Sem ele o caminho de reprodução
   * não é usado.
   */
  aoVivo?: (t: number) => void;
  /**
   * TODOS os inserts têm leitor de quadros EXATO — logo `preparar` sozinho dá
   * conta e o render pode usar o caminho RÁPIDO de decode. Quando algum insert
   * depende de `<video>` (arquivo grande, codec que o decoder não abre), isto
   * vem false e o render usa a REPRODUÇÃO, como antes.
   */
  exatos?: boolean;
  /** PAUSA todos os vídeos de insert JÁ — chamado sempre que o vídeo
   *  principal pausa (backpressure do encoder). Sem isto o insert seguia
   *  tocando enquanto o principal esperava o encoder: ele adiantava, a
   *  correção de deriva puxava de volta, adiantava de novo — o "acelerado e
   *  piscando" que saiu num download real (03.09). */
  pausar?: () => void;
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
  /** MAX QUALITY: análise multi-passagem do encoder, 1920px e 0,14 bpp.
   *  Desligado (o PADRÃO) o render é várias vezes mais rápido com perda que
   *  não se enxerga no feed. */
  qualidadeMax?: boolean;
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
      /* ⚠ ROTAÇÃO + ABA OCULTA = AD DEITADO, CALADO (04.09). Aqui a metadata
       * veio do CABEÇALHO, ou seja, o tamanho CODIFICADO (sem rotação). A
       * guarda de rotação lá no decode compara o VideoFrame (codificado)
       * contra `srcW/srcH` — se estes também forem codificados, a comparação é
       * codificado-contra-codificado, passa sempre, e o vídeo sai deitado.
       * Guardando o tamanho de EXIBIÇÃO, a guarda volta a funcionar e o render
       * cai no caminho por seek, que desenha rotacionado certo. */
      srcW = meta.rotacionado ? meta.height : meta.width;
      srcH = meta.rotacionado ? meta.width : meta.height;
      if (meta.rotacionado) {
        console.warn('[typo-export] container ROTACIONADO — o caminho rápido não serve, vai por seek');
      }
      durationSec = meta.durSec;
      console.warn(
        `[typo-export] <video> não respondeu (aba em segundo plano?) — metadata lida do cabeçalho: ` +
          `${srcW}x${srcH} ${durationSec.toFixed(1)}s`,
      );
    }

    // MODO DE RENDER (03.09). MAX QUALITY = a régua de sempre; padrão = rápido.
    // Silas: *"tem que ser rápido esse render... sacrificar um pouco de
    // qualidade (imperceptível) pra ganhar uma boa velocidade"*.
    const qualidadeMax = opts.qualidadeMax === true;
    // RESOLUÇÃO: no rápido o lado maior fica em 1600 (1080x1920 → 900x1600,
    // ~30% menos pixels pra compor E codificar). Num celular não se enxerga.
    // A resolução é a MESMA nos dois modos: rebaixar pra 1600 borrava a
    // legenda e, com o gargalo real corrigido (ver esperarFilaBaixar), não
    // comprava velocidade nenhuma. O que MAX QUALITY muda é o bitrate e a
    // análise do encoder — o que o Silas autorizou sacrificar.
    const tetoLado = 1920;
    const longSide = Math.max(srcW, srcH);
    const scale = longSide > tetoLado ? tetoLado / longSide : 1;
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
    // BITRATE: no modo rápido a régua cai de 0,14 pra 0,08 bpp e o teto de
    // acompanhar a fonte cai de 26M pra 10M. Menos bits = menos trabalho do
    // encoder; num vertical de anúncio a diferença é invisível.
    const bpp = qualidadeMax ? 0.14 : 0.08;
    const tetoFonte = qualidadeMax ? 26_000_000 : 10_000_000;
    const fatorFonte = qualidadeMax ? 1.5 : 1.0;
    const bppRate = W * H * FPS * bpp;
    const srcRate = (file.size * 8) / durationSec;
    const budgetRate = (RENDER_BYTES_BUDGET * 8) / durationSec;
    const bitrate = Math.round(
      Math.min(
        Math.max(bppRate, Math.min(srcRate * fatorFonte, tetoFonte), 2_000_000),
        budgetRate,
      ),
    );

    const { codec, hw } = await pickCodec(W, H, bitrate);
    console.log(
      `[tipografia] render ${qualidadeMax ? 'MAX QUALITY' : 'RÁPIDO'} · ${W}x${H} · ` +
        `${(bitrate / 1e6).toFixed(1)}Mbps · ${hw ? 'hardware' : 'software'}`,
    );

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new FriendlyError('Não consegui criar o canvas de composição.');

    // ── frames: caminho rápido primeiro; qualquer tropeço cai pro seek ──
    let videoOnly: Blob | null = null;
    let mode: 'decode' | 'seek' | 'playback' = 'decode';
    // Insert com leitor EXATO roda no caminho rápido (o dreno assíncrono
    // espera o quadro). Só quando algum insert depende de `<video>` é que
    // ainda vale a REPRODUÇÃO — e o seek continua sendo a última reserva.
    const temInsert = !!(inserts && inserts.janelas.length > 0 && inserts.preparar);
    const insertsPrecisamEsperar = temInsert && inserts?.exatos !== true;
    if (temInsert) {
      console.log(
        insertsPrecisamEsperar
          ? '[tipografia] inserts sem leitor exato — caminho de REPRODUÇÃO (tempo real); seek é a reserva'
          : '[tipografia] inserts com leitor EXATO — caminho RÁPIDO de decode',
      );
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
          qualidadeMax,
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
      // O seek/playback pintam os frames DO <video>. Se ele nem abriu (aba em
      // segundo plano), nenhum dos dois desenha nada — falhar alto é melhor
      // que travar.
      if (!videoAbriu) {
        throw new FriendlyError(
          'O navegador não abriu o vídeo pra renderizar (a aba precisa ficar VISÍVEL durante o render). ' +
            'Deixa esta aba na frente e roda de novo.',
        );
      }
      /* REPRODUÇÃO antes do SEEK — SEMPRE, não só quando há insert (04.09).
       * A condição exigia `insertsPrecisamEsperar`, então um vídeo SEM insert
       * que não serve pro caminho rápido (acima de 300MB, ou com matriz de
       * rotação no container — qualquer gravação de celular em pé) pulava
       * direto pro SEEK, que re-decodifica desde o keyframe A CADA QUADRO
       * (0,7 quadro/s medido num AD real). A reprodução faz decode sequencial
       * e é ordens de grandeza mais rápida; ela já trata insert ausente com
       * optional-chaining em todo hook. O seek continua como última reserva. */
      if (!opts.forceSeekPath) {
        try {
          videoOnly = await renderFramesByPlayback({
            video, blocks, preset, style, headlines, zoom, inserts,
            canvas, ctx, W, H, durationSec, codec, bitrate, hw, qualidadeMax,
            onProgress, throwIfAborted,
          });
          mode = 'playback';
          console.log('[tipografia] REPRODUÇÃO assumiu — render em ~tempo real');
        } catch (e) {
          if (isCancellationError(e) || signal?.aborted) throw e;
          console.warn('[tipografia] reprodução falhou — caindo pro seek:', e);
          videoOnly = null;
          // o <video> pode ter ficado no meio: volta pro início pro seek path
          try { video.pause(); } catch { /* segue */ }
        }
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
        qualidadeMax,
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
    // o editor pediu som de insert e ele entrou? (vira aviso lá em cima)
    let somInsertOk = true;
    {
      const vOnly = videoOnly;
      // Quem já tem o lock roda direto; quem não tem, entra na fila.
      const comLock = <R,>(f: () => Promise<R>): Promise<R> =>
        ffmpegJaExclusivo ? f() : runFfmpegExclusive(f);
      const tentarAudio = () =>
        comLock(async () => {
          const wav = await extractAudio(file, {
            onProgress: (p) => onProgress?.({ phase: 'audio', ratio: p.ratio * 0.5 }),
          });
          throwIfAborted();
          // SOM DOS INSERTS (03.09): misturado na trilha do AD antes do mux.
          // Falhar aqui NUNCA custa a entrega — devolve null e segue com a
          // trilha original (a fala do avatar é o que não pode faltar).
          let trilha = wav;
          if (inserts?.sons?.length) {
            try {
              const { misturarSomDosInserts } = await import('../audio-mix-insert');
              const mix = await misturarSomDosInserts(wav, inserts.sons);
              if (mix) {
                trilha = mix;
                console.log(`[tipografia] som de ${inserts.sons.length} insert(s) misturado na trilha`);
              } else {
                somInsertOk = false;
              }
            } catch (e) {
              somInsertOk = false;
              console.warn('[tipografia] mistura do som dos inserts falhou — trilha original:', e);
            }
          }
          throwIfAborted();
          return muxAudioIntoVideo(vOnly, trilha, {
            onProgress: (p) => onProgress?.({ phase: 'audio', ratio: 0.5 + p.ratio * 0.5 }),
          });
        });
      try {
        final = await tentarAudio();
        audioOk = true;
      } catch (e) {
        // Cancelamento NOSSO (o AbortController deste render) morre de vez.
        if (signal?.aborted) throw e;
        if (isCancellationError(e)) {
          // TERMINATE EXTERNO (03.09): "called FFmpeg.terminate()" chegava
          // aqui quando um cancel de OUTRA ferramenta/task (mesma aba SPA)
          // matava o singleton no meio do nosso mux — e um AD REAL saiu com
          // "pós-produção falhou". Não é cancelamento nosso: a instância nova
          // sobe sozinha na próxima chamada. Uma retentativa resolve.
          console.warn('[tipografia] ffmpeg terminado POR FORA durante o áudio — refazendo o mux:', e);
          try {
            final = await tentarAudio();
            audioOk = true;
          } catch (e2) {
            if (signal?.aborted) throw e2;
            console.warn('[tipografia] mux de áudio falhou 2x, entregando sem áudio:', e2);
          }
        } else {
          // Vídeo sem trilha de áudio (ou extração falhou): entrega o render
          // mudo em vez de morrer no fim — o caller informa o user.
          console.warn('[tipografia] mux de áudio falhou, entregando sem áudio:', e);
        }
      }
    }

    onProgress?.({ phase: 'finalizando', ratio: 1 });
    return { blob: final, audioOk, somInsertOk, width: W, height: H, fps: FPS, mode, hw };
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
