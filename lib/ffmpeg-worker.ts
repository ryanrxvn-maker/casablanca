/**
 * CASABLANCA — Wrapper do FFmpeg WASM.
 *
 * Carrega o core via CDN (unpkg) em Client Component. Precisa de SharedArrayBuffer,
 * portanto exige os headers COOP/COEP (configurados em next.config.js + vercel.json).
 *
 * API: singleton com `getFFmpeg()`, mais helpers de alto nível:
 *   - speedUpVideo: acelera video mantendo pitch (atempo + setpts).
 *   - speedUpAudio: acelera audio mantendo pitch.
 *   - compressVideo: H.264 com CRF + scale opcional.
 *   - extractAudio: extrai trilha de audio de um video.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

export type FFProgress = { ratio: number; time: number };
export type FFLog = (line: string) => void;

let instance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;
let activeVariant: 'mt' | 'st' | null = null;

/**
 * Detecta se o ambiente atual suporta o core multithreaded. Precisa de:
 *   - SharedArrayBuffer disponivel (requer COOP/COEP em resposta de todas
 *     as dependencias: HTML, scripts, workers, blobs).
 *   - window.crossOriginIsolated === true (garantia definitiva dos headers).
 */
export function supportsFFmpegMT(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof SharedArrayBuffer === 'undefined') return false;
  return (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

/**
 * Retorna qual variante do core esta ativa. Util para UI/telemetria.
 * `null` se o FFmpeg ainda nao foi carregado.
 */
export function getFFmpegVariant(): 'mt' | 'st' | null {
  return activeVariant;
}

/**
 * Carrega e retorna o singleton do FFmpeg. Na primeira chamada, baixa o core
 * WASM (~30MB) do CDN. Chamadas seguintes reaproveitam a instância carregada.
 *
 * Seleciona automaticamente `@ffmpeg/core-mt` (multithreaded) quando o browser
 * esta `crossOriginIsolated` e tem `SharedArrayBuffer` — o MT reduz o tempo de
 * compressao/aceleracao em ~2-3x. Caso contrario, cai para `@ffmpeg/core` (ST).
 */
export async function getFFmpeg(onLog?: FFLog): Promise<FFmpeg> {
  if (instance) return instance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');

    const ff = new FFmpeg();
    if (onLog) ff.on('log', ({ message }) => onLog(message));

    const useMT = supportsFFmpegMT();
    const baseURL = useMT
      ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd'
      : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

    if (useMT) {
      // MT requer 3 arquivos: core.js, core.wasm e core.worker.js (pool de threads)
      const [coreURL, wasmURL, workerURL] = await Promise.all([
        cachedBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        cachedBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        cachedBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
      ]);
      await ff.load({ coreURL, wasmURL, workerURL });
      activeVariant = 'mt';
    } else {
      // ST: core + wasm, sem worker adicional
      const [coreURL, wasmURL] = await Promise.all([
        cachedBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        cachedBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      await ff.load({ coreURL, wasmURL });
      activeVariant = 'st';
    }

    instance = ff;
    return ff;
  })();

  try {
    return await loadingPromise;
  } catch (e) {
    loadingPromise = null;
    activeVariant = null;
    throw e;
  }
}

/**
 * Retorna true se o browser suporta os recursos minimos (WebAssembly).
 */
export function isFFmpegSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof WebAssembly === 'object';
}

// ---------- Helpers de alto nivel ----------------------------------------

export type RunOptions = {
  onProgress?: (p: FFProgress) => void;
  onLog?: FFLog;
};

/**
 * Decompoe atempo em chain (FFmpeg aceita atempo entre 0.5 e 2.0). Para 2.5x,
 * a gente aplica atempo=2,atempo=1.25. Para 3x, atempo=2,atempo=1.5.
 */
function atempoChain(speed: number): string {
  const s = Math.max(0.5, Math.min(4, speed));
  if (s <= 2) return `atempo=${s.toFixed(3)}`;
  // s entre 2 e 4: aplica atempo=2 e depois o resto
  const rest = s / 2;
  return `atempo=2.0,atempo=${rest.toFixed(3)}`;
}

/**
 * Acelera um video mantendo pitch do audio.
 *   -filter:a atempo=X  (chain se necessario)
 *   -filter:v setpts=PTS/X
 * Saida: MP4 (H.264 + AAC).
 */
export async function speedUpVideo(
  file: Blob,
  speed: number,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.mp4';

  let progressHandler: ((e: { progress: number; time: number }) => void) | null = null;
  if (opts.onProgress) {
    progressHandler = ({ progress, time }) =>
      opts.onProgress!({ ratio: Math.max(0, Math.min(1, progress)), time });
    ff.on('progress', progressHandler);
  }

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    await ff.exec([
      '-i', inputName,
      '-filter:v', `setpts=PTS/${speed}`,
      '-filter:a', atempoChain(speed),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Acelera audio mantendo pitch. Saida WAV (PCM) por padrao, ou MP3/AAC se pedido.
 */
export async function speedUpAudio(
  file: Blob,
  speed: number,
  format: 'wav' | 'mp3' = 'wav',
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp3');
  const outputName = 'out.' + format;

  let progressHandler: ((e: { progress: number; time: number }) => void) | null = null;
  if (opts.onProgress) {
    progressHandler = ({ progress, time }) =>
      opts.onProgress!({ ratio: Math.max(0, Math.min(1, progress)), time });
    ff.on('progress', progressHandler);
  }

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    const args = ['-i', inputName, '-filter:a', atempoChain(speed)];
    if (format === 'wav') {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-q:a', '2');
    }
    args.push(outputName);
    await ff.exec(args);
    const data = await ff.readFile(outputName);
    const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
    return toBlob(data, mime);
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Comprime video com H.264 CRF. Opcionalmente rescala para 1080/720/480.
 */
export async function compressVideo(
  file: Blob,
  params: { crf: number; resolution: 'original' | '1080' | '720' | '480' },
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.mp4';

  let progressHandler: ((e: { progress: number; time: number }) => void) | null = null;
  if (opts.onProgress) {
    progressHandler = ({ progress, time }) =>
      opts.onProgress!({ ratio: Math.max(0, Math.min(1, progress)), time });
    ff.on('progress', progressHandler);
  }

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    const args: string[] = ['-i', inputName];
    if (params.resolution !== 'original') {
      // -2 para manter aspect ratio e garantir numero par (requisito H.264)
      args.push('-vf', `scale=-2:${params.resolution}`);
    }
    args.push(
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', String(params.crf),
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputName,
    );
    await ff.exec(args);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Extrai a trilha de audio de um video como WAV (PCM 16-bit).
 */
export async function extractAudio(
  file: Blob,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.wav';

  let progressHandler: ((e: { progress: number; time: number }) => void) | null = null;
  if (opts.onProgress) {
    progressHandler = ({ progress, time }) =>
      opts.onProgress!({ ratio: Math.max(0, Math.min(1, progress)), time });
    ff.on('progress', progressHandler);
  }

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    await ff.exec([
      '-i', inputName,
      '-vn',
      '-c:a', 'pcm_s16le',
      '-ar', '44100',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'audio/wav');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

// ---------- Internos ------------------------------------------------------

function guessExt(file: Blob, fallback: string): string {
  const f = file as File;
  if (f?.name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(f.name);
    if (m) return m[1].toLowerCase();
  }
  const t = file.type || '';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('webm')) return 'webm';
  if (t.includes('quicktime')) return 'mov';
  if (t.includes('mpeg')) return 'mp3';
  if (t.includes('wav')) return 'wav';
  return fallback;
}

function toBlob(data: Uint8Array | string, type: string): Blob {
  if (typeof data === 'string') {
    return new Blob([data], { type });
  }
  // Copia defensiva para ArrayBuffer "dono"
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new Blob([copy.buffer], { type });
}

async function safeDelete(ff: FFmpeg, name: string) {
  try {
    await ff.deleteFile(name);
  } catch {
    /* ignora */
  }
}

// ---------- Cache do core FFmpeg -----------------------------------------

const CORE_CACHE = 'casablanca-ffmpeg-core-v1';

/**
 * Busca um asset do CDN usando Cache API quando disponivel. No primeiro
 * carregamento faz download + cacheia; em sessoes seguintes le do cache.
 * Converte o response em blob URL pro FFmpeg.load() consumir.
 *
 * Fallback para fetch direto + blob quando Cache API nao esta presente
 * (ex: Safari privado) ou quando o cache falha por qualquer motivo.
 */
async function cachedBlobURL(url: string, mime: string): Promise<string> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CORE_CACHE);
      let resp = await cache.match(url);
      if (!resp) {
        const fresh = await fetch(url);
        if (!fresh.ok) throw new Error('HTTP ' + fresh.status + ' ao baixar ' + url);
        // Clona pra ter 2 readable streams (um pra cache, outro pro blob)
        await cache.put(url, fresh.clone());
        resp = fresh;
      }
      const bytes = await resp.arrayBuffer();
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    }
  } catch (err) {
    console.warn('[ffmpeg-worker] cache falhou, usando fetch direto:', err);
  }
  // Fallback: fetch direto sem cache
  const resp = await fetch(url);
  const bytes = await resp.arrayBuffer();
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * Limpa o cache do core FFmpeg. Util pra forcar re-download em updates.
 */
export async function clearFFmpegCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(CORE_CACHE);
}
