/// <reference lib="webworker" />
/**
 * Worker do join por WebCodecs. Roda decode + crossfade + encode (hardware)
 * FORA da thread principal — o que, além de não travar a UI, faz o encoder de
 * hardware CONTINUAR mesmo com a aba oculta (na main thread o Chrome suspende
 * o hardware em aba de fundo; em Worker, não). Recebe os trechos + offsets,
 * devolve o MP4 vídeo-só (sem áudio; o áudio original é re-muxado na main).
 *
 * Toda a lógica WebCodecs vive aqui (não no bundle da página). Ver
 * lib/webcodecs-join.ts pro wrapper que cria este worker + faz o mux + fallback.
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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
    ch.port2.postMessage(0);
  });
}

function even(n: number): number {
  const v = Math.round(n);
  return v % 2 === 0 ? v : v - 1;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ]);
}

async function looksLikeMp4(file: Blob): Promise<boolean> {
  if (file.size < 64) return false;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}

function trackDescription(trak: unknown): Uint8Array | undefined {
  type DescBoxes = { avcC?: Box; hvcC?: Box; vpcC?: Box; av1C?: Box };
  const entries =
    (trak as { mdia?: { minf?: { stbl?: { stsd?: { entries?: DescBoxes[] } } } } })
      ?.mdia?.minf?.stbl?.stsd?.entries ?? [];
  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  return undefined;
}

async function pickCodec(W: number, H: number, bitrate: number, fps: number): Promise<string | null> {
  const candidates = ['avc1.640033', 'avc1.640032', 'avc1.64002a', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f'];
  for (const codec of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps });
      if (s.supported) return codec;
    } catch { /* próximo */ }
  }
  return null;
}

type EncodeSink = {
  encoder: VideoEncoder;
  muxer: Muxer<ArrayBufferTarget>;
  target: ArrayBufferTarget;
  err: () => Error | null;
};

function makeSink(codec: string, W: number, H: number, bitrate: number, fps: number): EncodeSink {
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
    error: (e) => { encoderError = e instanceof Error ? e : new Error(String(e)); },
  });
  encoder.configure({ codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' });
  return { encoder, muxer, target, err: () => encoderError };
}

type VideoInfo = { fps: number; width: number; height: number; durationSec: number };

async function probeVideoInfo(blob: Blob): Promise<VideoInfo | null> {
  if (!(await looksLikeMp4(blob))) return null;
  const mp4 = createFile(true);
  let movie: Movie | null = null;
  mp4.onReady = (m: Movie) => { movie = m; };
  mp4.onError = () => {};
  try {
    const raw = await blob.arrayBuffer();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, 0), true);
    mp4.flush();
  } catch { return null; }
  const mv = movie as Movie | null;
  if (!mv) return null;
  const vt = mv.videoTracks?.[0] as unknown as {
    nb_samples?: number; timescale?: number; duration?: number;
    track_width?: number; track_height?: number; video?: { width?: number; height?: number };
  } | undefined;
  if (!vt) return null;
  const ts = vt.timescale || 0;
  const durationSec = ts > 0 && vt.duration ? vt.duration / ts : 0;
  const width = vt.track_width || vt.video?.width || 0;
  const height = vt.track_height || vt.video?.height || 0;
  const fps = vt.nb_samples && durationSec > 0 ? vt.nb_samples / durationSec : 0;
  if (!width || !height || durationSec <= 0) return null;
  return { fps: fps > 0 ? fps : 30, width, height, durationSec };
}

async function decodeSegmentCFR(
  blob: Blob,
  durationSec: number,
  fps: number,
  encoder: VideoEncoder,
  onTick: (localTick: number, frame: VideoFrame) => void,
  throwIfAborted: () => void,
): Promise<boolean> {
  if (!(await looksLikeMp4(blob))) return false;

  const mp4 = createFile(true);
  let movie: Movie | null = null;
  let demuxError: Error | null = null;
  const pending: Sample[] = [];
  mp4.onError = (module: string, message: string) => { demuxError = new Error(`demux ${module}: ${message}`); };
  mp4.onReady = (m: Movie) => { movie = m; };
  mp4.onSamples = (_id: number, _u: unknown, samples: Sample[]) => { for (const s of samples) pending.push(s); };

  const totalLocalTicks = Math.max(1, Math.round(durationSec * fps));
  let localTick = 0;
  let lastFrame: VideoFrame | null = null;
  let basePtsUs: number | null = null;
  let decodeError: Error | null = null;

  const onFrame = (f: VideoFrame) => {
    if (decodeError || localTick >= totalLocalTicks) { f.close(); return; }
    if (basePtsUs == null) basePtsUs = f.timestamp;
    const ptsUs = f.timestamp - basePtsUs;
    while (localTick < totalLocalTicks && Math.round((localTick * 1_000_000) / fps) < ptsUs) {
      onTick(localTick, lastFrame ?? f);
      localTick++;
    }
    lastFrame?.close();
    lastFrame = f;
  };

  const decoder = new VideoDecoder({
    output: onFrame,
    error: (e) => { decodeError = e instanceof Error ? e : new Error(String(e)); },
  });

  try {
    const check = () => {
      throwIfAborted();
      if (demuxError) throw demuxError;
      if (decodeError) throw decodeError;
    };

    const raw = await blob.arrayBuffer();
    throwIfAborted();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, 0), true);
    if (demuxError) throw demuxError;

    const mv = movie as Movie | null;
    const track = mv?.videoTracks?.[0];
    if (!track) return false;
    const desc = trackDescription(mp4.getTrackById(track.id));
    if (!desc) return false;
    const config: VideoDecoderConfig = { codec: track.codec, description: desc };
    let supported = false;
    try { supported = (await VideoDecoder.isConfigSupported(config)).supported === true; } catch { supported = false; }
    if (!supported) return false;

    decoder.configure(config);
    mp4.setExtractionOptions(track.id, null, { nbSamples: 100 });
    mp4.start();
    mp4.flush();
    if (pending.length === 0) return false;

    while (pending.length) {
      const s = pending.shift()!;
      if (!s.data) continue;
      decoder.decode(new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: Math.round((s.cts / s.timescale) * 1_000_000),
        duration: Math.max(0, Math.round((s.duration / s.timescale) * 1_000_000)),
        data: s.data,
      }));
      while (decoder.decodeQueueSize > 12 || encoder.encodeQueueSize > 6) {
        await nextTask();
        check();
      }
    }
    await withTimeout(decoder.flush(), 30_000, 'decoder.flush').catch((e) => { if (!decodeError) throw e; });
    check();

    while (localTick < totalLocalTicks && lastFrame) {
      onTick(localTick, lastFrame);
      localTick++;
      if (encoder.encodeQueueSize > 6) { await nextTask(); check(); }
    }
    return localTick > 0;
  } finally {
    (lastFrame as VideoFrame | null)?.close();
    lastFrame = null;
    try { if (decoder.state !== 'closed') decoder.close(); } catch { /* ok */ }
  }
}

/** Junta com crossfade (OffscreenCanvas). Devolve vídeo-só ou null se incompatível. */
async function joinCore(
  parts: Blob[],
  offsets: number[],
  xfadeSec: number,
  fpsOverride: number | undefined,
  onProgress: (ratio: number) => void,
): Promise<Blob | null> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') return null;
  if (parts.length < 2 || offsets.length !== parts.length - 1) return null;

  const infos = await Promise.all(parts.map((p) => probeVideoInfo(p)));
  if (infos.some((i) => !i)) return null;
  const info0 = infos[0]!;
  const fps = fpsOverride && fpsOverride > 0 && fpsOverride <= 120 ? fpsOverride : info0.fps;
  const W = even(info0.width);
  const H = even(info0.height);
  if (!W || !H || !fps) return null;

  const Xticks = Math.max(1, Math.round(xfadeSec * fps));
  const accTicks: number[] = [0];
  for (let i = 0; i < offsets.length; i++) accTicks.push(accTicks[i] + Math.round(offsets[i] * fps));
  const lastDurTicks = Math.round(infos[parts.length - 1]!.durationSec * fps);
  const totalTicks = accTicks[parts.length - 1] + lastDurTicks;

  const bitrate = Math.round(Math.min(20_000_000, Math.max(2_500_000, W * H * fps * 0.12)));
  const codec = await pickCodec(W, H, bitrate, fps);
  if (!codec) return null;

  const canvas = new OffscreenCanvas(W, H);
  const cctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | null;
  if (!cctx) return null;

  const sink = makeSink(codec, W, H, bitrate, fps);
  const frameUs = Math.round(1_000_000 / fps);
  let tail = new Map<number, OffscreenCanvas>();
  let emitted = 0;

  // Watchdog: mesmo em Worker, se decode/encode travar por algum motivo, aborta.
  // Tolerante (decodificar o 1º GOP de um trecho pode demorar em aba throttlada).
  const STALL_MS = 40_000;
  let lastEmitCount = 0;
  let lastEmitAt = Date.now();
  const guard = () => {
    const now = Date.now();
    if (emitted > lastEmitCount) { lastEmitCount = emitted; lastEmitAt = now; }
    else if (now - lastEmitAt > STALL_MS) throw new Error('encode travou (watchdog)');
  };

  const emit = (gTick: number) => {
    const vf = new VideoFrame(canvas, { timestamp: gTick * frameUs, duration: frameUs });
    sink.encoder.encode(vf, { keyFrame: gTick % (Math.round(fps) * 4) === 0 });
    vf.close();
    emitted++;
    if (emitted % 5 === 0 || emitted === totalTicks) onProgress(Math.min(1, emitted / totalTicks));
  };

  let tickError: Error | null = null;

  try {
    for (let i = 0; i < parts.length; i++) {
      guard();
      const ee = sink.err();
      if (ee) throw ee;

      const base = accTicks[i];
      const blendInEnd = i > 0 ? base + Xticks : base;
      const bodyEnd = i < parts.length - 1 ? accTicks[i + 1] : base + lastDurTicks;
      const tailEnd = i < parts.length - 1 ? bodyEnd + Xticks : bodyEnd;
      const newTail = new Map<number, OffscreenCanvas>();

      const onTick = (localTick: number, frame: VideoFrame) => {
        if (tickError) return;
        try {
          const g = base + localTick;
          if (g >= tailEnd) return;
          if (g < blendInEnd) {
            const tf = tail.get(g); // OffscreenCanvas (cauda do trecho anterior)
            const a = Math.max(0, Math.min(1, (g - base + 0.5) / Xticks));
            cctx.globalAlpha = 1;
            cctx.drawImage(tf ?? frame, 0, 0, W, H);
            if (tf) { cctx.globalAlpha = a; cctx.drawImage(frame, 0, 0, W, H); cctx.globalAlpha = 1; }
            emit(g);
          } else if (g < bodyEnd) {
            cctx.globalAlpha = 1;
            cctx.drawImage(frame, 0, 0, W, H);
            emit(g);
          } else {
            // cauda pro crossfade com o próximo: copia os PIXELS pra um canvas
            // (independente do decoder — VideoFrame.clone() morre quando o
            // decoder do trecho fecha, e aí o drawImage no próximo trecho trava).
            const cc = new OffscreenCanvas(W, H);
            const cx = cc.getContext('2d', { alpha: false });
            if (cx) { cx.drawImage(frame, 0, 0, W, H); newTail.set(g, cc); }
          }
        } catch (err) {
          tickError = err instanceof Error ? err : new Error(String(err));
        }
      };

      // guardTick também propaga erro capturado no onTick (o WebCodecs engole
      // exceptions lançadas dentro do callback do decoder — sem isto, um erro
      // de composição vira um travamento mudo).
      const guardTick = () => { guard(); if (tickError) throw tickError; };
      const ok = await decodeSegmentCFR(parts[i], infos[i]!.durationSec, fps, sink.encoder, onTick, guardTick);
      if (tickError) throw tickError;
      tail = newTail; // canvases da cauda: independentes do decoder, GC libera
      if (!ok) throw new Error(`decode do trecho ${i} não produziu frames`);
    }

    await withTimeout(sink.encoder.flush(), 30_000, 'encoder.flush');
    const ee = sink.err();
    if (ee) throw ee;
    sink.encoder.close();
    sink.muxer.finalize();
    const blob = new Blob([sink.target.buffer], { type: 'video/mp4' });
    if (blob.size <= 2048) return null;

    // valida a duração (bug de lógica/encode incompleto → null → fallback ffmpeg)
    const expectedSec = totalTicks / fps;
    const got = await probeVideoInfo(blob);
    if (!got || Math.abs(got.durationSec - expectedSec) > Math.max(0.5, expectedSec * 0.03)) return null;
    return blob;
  } finally {
    tail.clear(); // canvases da cauda: o GC libera
    try { if (sink.encoder.state !== 'closed') sink.encoder.close(); } catch { /* ok */ }
  }
}

// ─────────────────── protocolo com a main thread ───────────────────

type ReqMsg = { parts: Blob[]; offsets: number[]; xfadeSec: number; fps?: number };

ctx.onmessage = async (e: MessageEvent<ReqMsg>) => {
  const { parts, offsets, xfadeSec, fps } = e.data;
  try {
    const blob = await joinCore(parts, offsets, xfadeSec, fps, (ratio) => ctx.postMessage({ type: 'progress', ratio }));
    if (!blob) { ctx.postMessage({ type: 'incompatible' }); return; }
    ctx.postMessage({ type: 'done', blob });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
