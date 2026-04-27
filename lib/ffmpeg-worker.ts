/**
 * CASABLANCA — Wrapper do FFmpeg WASM.
 *
 * Singleton com `getFFmpeg()` + helpers de alto nivel (speedUpVideo,
 * speedUpAudio, compressVideo, extractAudio, cutVideoSegments).
 *
 * Nota de arquitetura:
 * - Usamos APENAS o core single-threaded (`@ffmpeg/core`). O core-mt depende
 *   de COOP/COEP perfeitos + workers que rodam em contexto isolado, e em
 *   algumas configuracoes trava indefinidamente (o que estava causando o bug
 *   de "Carregando FFmpeg..." infinito). O core ST e' confiavel em toda
 *   plataforma e nao trava.
 * - Tentamos primeiro unpkg, e caimos pra jsdelivr se falhar.
 * - Toda operacao tem timeout explicito para nao pendurar a UI.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

export type FFProgress = { ratio: number; time: number };
export type FFLog = (line: string) => void;
export type FFLoadStage = (stage: string) => void;

let instance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

const CORE_VERSION = '0.12.6';
const CDNS = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
];

const LOAD_TIMEOUT_MS = 90_000; // 90s total pra carregar core + wasm

/**
 * Carrega (se necessario) e retorna a instancia singleton do FFmpeg.
 *
 * `onStage` recebe stages humanas tipo "Baixando core (1/2)...", "Inicializando...".
 * `onLog` recebe linhas cruas do FFmpeg (stderr).
 */
export async function getFFmpeg(
  onStage?: FFLoadStage,
  onLog?: FFLog,
): Promise<FFmpeg> {
  if (instance) return instance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = withTimeout(loadCore(onStage, onLog), LOAD_TIMEOUT_MS, 'Timeout ao carregar FFmpeg');

  try {
    instance = await loadingPromise;
    return instance;
  } catch (e) {
    loadingPromise = null;
    throw e;
  }
}

async function loadCore(onStage?: FFLoadStage, onLog?: FFLog): Promise<FFmpeg> {
  onStage?.('Baixando modulo FFmpeg...');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');

  const ff = new FFmpeg();
  if (onLog) ff.on('log', ({ message }) => onLog(message));

  let lastErr: unknown = null;
  for (let i = 0; i < CDNS.length; i++) {
    const baseURL = CDNS[i];
    try {
      onStage?.(`Baixando core WASM (CDN ${i + 1}/${CDNS.length})...`);
      const [coreURL, wasmURL] = await Promise.all([
        cachedBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        cachedBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      onStage?.('Inicializando runtime...');
      await ff.load({ coreURL, wasmURL });
      onStage?.('Pronto.');
      return ff;
    } catch (err) {
      lastErr = err;
      console.warn(`[ffmpeg] CDN ${i + 1} falhou:`, err);
      // tenta proximo CDN
    }
  }
  throw new Error(
    'Nao foi possivel carregar o FFmpeg. Verifique sua conexao. Detalhe: ' +
      (lastErr instanceof Error ? lastErr.message : String(lastErr)),
  );
}

/**
 * Retorna true se o browser suporta WebAssembly (minimo para FFmpeg rodar).
 */
export function isFFmpegSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof WebAssembly === 'object';
}

// ---------- Helpers de alto nivel ----------------------------------------

export type RunOptions = {
  onProgress?: (p: FFProgress) => void;
  onStage?: FFLoadStage;
  onLog?: FFLog;
};

function atempoChain(speed: number): string {
  const s = Math.max(0.5, Math.min(4, speed));
  if (s <= 2) return `atempo=${s.toFixed(3)}`;
  const rest = s / 2;
  return `atempo=2.0,atempo=${rest.toFixed(3)}`;
}

export async function speedUpVideo(
  file: Blob,
  speed: number,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.mp4';

  const progressHandler = wireProgress(ff, opts.onProgress);

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

export async function speedUpAudio(
  file: Blob,
  speed: number,
  format: 'wav' | 'mp3' = 'wav',
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp3');
  const outputName = 'out.' + format;

  const progressHandler = wireProgress(ff, opts.onProgress);

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
 * Extrai audio de um video e o converte para MP3.
 */
export async function extractAudioAs(
  file: Blob,
  format: 'wav' | 'mp3',
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.' + format;

  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    const args = ['-i', inputName, '-vn'];
    if (format === 'wav') {
      args.push('-c:a', 'pcm_s16le', '-ar', '44100');
    } else {
      args.push('-c:a', 'libmp3lame', '-q:a', '2');
    }
    args.push(outputName);
    await ff.exec(args);
    const data = await ff.readFile(outputName);
    return toBlob(data, format === 'wav' ? 'audio/wav' : 'audio/mpeg');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

export async function compressVideo(
  file: Blob,
  params: { crf: number; resolution: 'original' | '1080' | '720' | '480' },
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.mp4';

  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    const args: string[] = ['-i', inputName];
    if (params.resolution !== 'original') {
      args.push('-vf', `scale=-2:${params.resolution}`);
    }
    // Preset "veryfast" e 3-4x mais rapido que "medium" com CRF equivalente
    // perdendo pouquissima eficiencia de compressao. Em WASM single-threaded
    // isso e a diferenca de "demora muito" pra "roda em tempo aceitavel".
    // tune=fastdecode tambem ajuda no playback de celulares fracos.
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'fastdecode',
      '-crf', String(params.crf),
      '-g', '120',
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

export async function extractAudio(file: Blob, opts: RunOptions = {}): Promise<Blob> {
  return extractAudioAs(file, 'wav', opts);
}

/**
 * Substitui a trilha de audio de um video pela trilha em `audio`.
 * Mantem o video (sem re-encode) quando possivel. Usado pela Camuflagem
 * quando o usuario quer manter o video original e so trocar o audio.
 */
export async function muxAudioIntoVideo(
  video: Blob,
  audio: Blob,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const videoExt = guessExt(video, 'mp4');
  const audioExt = guessExt(audio, 'wav');
  const videoName = 'vin.' + videoExt;
  const audioName = 'ain.' + audioExt;
  const outputName = 'out.mp4';
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    await Promise.all([
      ff.writeFile(videoName, await fetchFile(video)),
      ff.writeFile(audioName, await fetchFile(audio)),
    ]);
    await ff.exec([
      '-i', videoName,
      '-i', audioName,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      '-movflags', '+faststart',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, videoName);
    await safeDelete(ff, audioName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Corta um video em varios segmentos [start, end] (em segundos) e concatena
 * tudo em um unico MP4 de saida. Usado pela Decupagem-em-video.
 */
export async function cutVideoSegments(
  file: Blob,
  segments: Array<{ start: number; end: number }>,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const ext = guessExt(file, 'mp4');
  const inputName = 'in.' + ext;
  const outputName = 'out.mp4';
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    await ff.writeFile(inputName, await fetchFile(file));

    // Monta filter_complex com [0:v]trim + [0:a]atrim para cada segmento,
    // e depois concat tudo num unico video/audio.
    const filterLines: string[] = [];
    const concatInputs: string[] = [];
    segments.forEach((seg, i) => {
      const start = seg.start.toFixed(3);
      const end = seg.end.toFixed(3);
      filterLines.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`,
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`,
      );
      concatInputs.push(`[v${i}][a${i}]`);
    });
    filterLines.push(
      `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[outv][outa]`,
    );
    const filterComplex = filterLines.join(';');

    // Preset "ultrafast" + tune zerolatency + CRF um pouco maior pra
    // maximizar velocidade no WASM single-threaded. A Decupagem corta muitos
    // segmentos (ate dezenas), entao cada segundo de encoder importa.
    await ff.exec([
      '-i', inputName,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '26',
      '-g', '60',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
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

// ---------- Normalizador de Volume --------------------------------------
//
// O FFmpeg tem dois filtros principais pra equalizar volume:
//  - `loudnorm`: implementa EBU R128 (broadcast standard). Caro de rodar em
//    WASM single-threaded e idealmente quer 2-pass pra medir antes; pulamos.
//  - `dynaudnorm`: normalizador dinamico que ajusta gain ao longo do audio,
//    suavizando trechos baixos sem clip nos altos. Perfeito pro caso "uma
//    voz mais alta que outra".
//
// Usamos dynaudnorm com presets variando agressividade. Saida pode ser MP4
// (re-encode mantendo video), MP3 ou WAV (so audio).

export type NormalizeIntensity = 'suave' | 'padrao' | 'forte';

const DYNAUDNORM_PRESETS: Record<NormalizeIntensity, string> = {
  // p=peak (alvo de pico, 0-1), m=max gain, s=compress factor (smoothing)
  suave: 'dynaudnorm=p=0.95:m=10:s=12:f=250',
  padrao: 'dynaudnorm=p=0.9:m=15:s=15:f=300',
  forte: 'dynaudnorm=p=0.85:m=20:s=20:f=400',
};

export type NormalizeOutFormat = 'mp4' | 'mp3' | 'wav';

/**
 * Normaliza o volume de um arquivo (video ou audio).
 *
 * - Se output for MP4: mantem o video, re-encoda audio com dynaudnorm aplicado.
 *   So funciona se o input tiver trilha de video.
 * - Se output for MP3/WAV: descarta video (se houver) e gera so audio normalizado.
 *
 * O filtro `dynaudnorm` faz o que o usuario quer ver: trechos baixos sobem,
 * trechos altos baixam, voz fica equilibrada ao longo do clip.
 */
export async function normalizeVolume(
  file: Blob,
  params: {
    intensity: NormalizeIntensity;
    output: NormalizeOutFormat;
  },
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.' + params.output;
  const filter = DYNAUDNORM_PRESETS[params.intensity];
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    opts.onStage?.('Carregando arquivo...');
    await ff.writeFile(inputName, await fetchFile(file));

    const args: string[] = ['-i', inputName, '-af', filter];

    if (params.output === 'mp4') {
      // Mantem video, re-encoda so audio com filtro de normalizacao.
      // -c:v copy nem sempre funciona bem com -af (FFmpeg pode reclamar
      // de mismatch de timestamps), entao fazemos re-encode rapido com
      // ultrafast pra compensar a velocidade.
      args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'fastdecode',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
      );
      opts.onStage?.('Normalizando audio + remontando video...');
    } else if (params.output === 'mp3') {
      args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2');
      opts.onStage?.('Normalizando e exportando MP3...');
    } else {
      args.push('-vn', '-c:a', 'pcm_s16le', '-ar', '44100');
      opts.onStage?.('Normalizando e exportando WAV...');
    }

    args.push(outputName);
    await ff.exec(args);
    const data = await ff.readFile(outputName);
    const mime =
      params.output === 'mp4'
        ? 'video/mp4'
        : params.output === 'mp3'
          ? 'audio/mpeg'
          : 'audio/wav';
    return toBlob(data, mime);
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

// ---------- Internos ------------------------------------------------------

type ProgressEvent = { progress: number; time: number };

function wireProgress(
  ff: FFmpeg,
  onProgress?: (p: FFProgress) => void,
): ((e: ProgressEvent) => void) | null {
  if (!onProgress) return null;
  const handler = ({ progress, time }: ProgressEvent) =>
    onProgress({ ratio: Math.max(0, Math.min(1, progress)), time });
  ff.on('progress', handler);
  return handler;
}

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

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg + ' (apos ' + ms + 'ms)')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ---------- Cache do core FFmpeg -----------------------------------------

const CORE_CACHE = 'casablanca-ffmpeg-core-v2';

async function cachedBlobURL(url: string, mime: string): Promise<string> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CORE_CACHE);
      let resp = await cache.match(url);
      if (!resp) {
        const fresh = await fetch(url);
        if (!fresh.ok) throw new Error('HTTP ' + fresh.status + ' ao baixar ' + url);
        await cache.put(url, fresh.clone());
        resp = fresh;
      }
      const bytes = await resp.arrayBuffer();
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    }
  } catch (err) {
    console.warn('[ffmpeg-worker] cache falhou, usando fetch direto:', err);
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' em ' + url);
  const bytes = await resp.arrayBuffer();
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

export async function clearFFmpegCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  await caches.delete(CORE_CACHE);
}

// Compat: alguns lugares chamam getFFmpegVariant/supportsFFmpegMT.
// Mantemos stubs pra nao quebrar build enquanto migramos.
export function getFFmpegVariant(): 'st' | null {
  return instance ? 'st' : null;
}
export function supportsFFmpegMT(): boolean {
  return false;
}
