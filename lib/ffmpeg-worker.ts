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

/**
 * Cancela qualquer operacao em andamento. Mata o worker FFmpeg WASM,
 * libera memoria, deixa proxima chamada de getFFmpeg reinicializar
 * limpo. As Promises de exec() em andamento vao rejeitar com erro
 * "terminated" — pegue isso no try/catch da tool.
 */
export function cancelFFmpeg(): void {
  if (instance) {
    try {
      instance.terminate();
    } catch {
      /* ignora */
    }
    instance = null;
  }
  loadingPromise = null;
}

/**
 * Sentinel pro caller saber que a falha foi cancelamento (nao bug).
 */
export const CANCELLED_ERROR = 'CANCELLED_BY_USER';

export function isCancellationError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /terminat|abort|cancel|destroyed/i.test(msg) || msg === CANCELLED_ERROR;
}

async function loadCore(onStage?: FFLoadStage, onLog?: FFLog): Promise<FFmpeg> {
  onStage?.('Preparando o motor...');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');

  const ff = new FFmpeg();
  if (onLog) ff.on('log', ({ message }) => onLog(message));

  let lastErr: unknown = null;
  for (let i = 0; i < CDNS.length; i++) {
    const baseURL = CDNS[i];
    try {
      onStage?.('Carregando o motor...');
      const [coreURL, wasmURL] = await Promise.all([
        cachedBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        cachedBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      onStage?.('Inicializando...');
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
    'Nao foi possivel carregar o motor. Verifique sua conexao. Detalhe: ' +
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
    // Mesma estrategia do Compressor: ultrafast + x264-params agressivos.
    // Aceleracao ja descarta frames implicitamente (PTS/speed), entao a perda
    // de eficiencia do encoder importa pouco e o ganho de tempo e enorme.
    await ff.exec([
      '-i', inputName,
      '-filter:v', `setpts=PTS/${speed}`,
      '-filter:a', atempoChain(speed),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', '23',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
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
  // Modo camuflagem: MP3 com estéreo INDEPENDENTE (sem joint/M-S, que
  // destrói a camada quieta do WHITE) e bitrate máximo, pra o cancelamento
  // de fase sobreviver ao codec lossy.
  robust = false,
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
    } else if (robust) {
      args.push(
        '-c:a', 'libmp3lame',
        '-b:a', '320k',
        '-joint_stereo', '0',
        '-ar', '44100',
      );
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
  return compressVideoOn(ff, file, params, opts);
}

/**
 * Versão "lower-level" do compressVideo que aceita uma instância FFmpeg
 * já carregada (vinda do pool). Permite paralelismo real — várias
 * instâncias do pool podem comprimir simultaneamente em workers próprios.
 *
 * Nomes de arquivo dentro do FFmpeg são únicos por chamada (timestamp +
 * random) pra dois jobs paralelos não colidirem no FS virtual.
 */
export async function compressVideoOn(
  ff: FFmpeg,
  file: Blob,
  params: { crf: number; resolution: 'original' | '1080' | '720' | '480' },
  opts: RunOptions = {},
): Promise<Blob> {
  const { fetchFile } = await import('@ffmpeg/util');

  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inputName = `in_${uniq}.${guessExt(file, 'mp4')}`;
  const outputName = `out_${uniq}.mp4`;

  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    const args: string[] = ['-i', inputName];
    if (params.resolution !== 'original') {
      // fast_bilinear é ~30-40% mais rápido que o scaler default; perda
      // visual em downscale (1080→720→480) é imperceptível.
      args.push('-vf', `scale=-2:${params.resolution}:flags=fast_bilinear`);
    }
    // ENCODE: preset ultrafast + x264-params agressivos pra wasm.
    args.push(
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', String(params.crf),
      '-g', '120',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
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

// ---------- Estimativa de tamanho do video comprimido ------------------
//
// Bitrate-alvo do libx264 com preset ultrafast a CRF 23, em bps. Calibrado
// empiricamente em videos reais de VSL/social/screencast.
// (CRF logaritmico: cada +6 = ~metade do bitrate; cada -6 = ~dobro.)
// Bitrate-alvo do libx264 com preset ULTRAFAST a CRF 23, em bps.
// O preset ultrafast produz arquivos ~15% maiores que veryfast/medium no
// mesmo CRF, entao calibramos um pouco mais alto que valores "padrao".
// Calibrado empiricamente em VSL/screencast/talking-head 1080p reais.
const TARGET_BITRATE_AT_CRF23: Record<
  'original' | '1080' | '720' | '480',
  number
> = {
  original: 6_500_000,
  '1080': 6_500_000,
  '720': 3_200_000,
  '480': 1_300_000,
};

const AUDIO_BITRATE = 128_000;

/**
 * Estima o tamanho do MP4 comprimido em bytes.
 *
 * Forma base:
 *   videoBitrate = base[res] * 2^((23 - crf) / 6)
 *   sizeBytes    = (videoBitrate + 128kbps) * duration / 8
 *
 * Refinamentos:
 *  - Quando `resolution === 'original'` e altura conhecida, o bitrate-alvo
 *    e escalado proporcional ao quadrado da razao de altura.
 *  - "Floor" do input: se o input ja e muito comprimido (bitrate baixo), o
 *    output nao pode ficar dramaticamente menor — clampamos em 60% do input.
 *  - "Ceiling" do input: o output nunca pode ser maior que ~95% do input
 *    quando mantendo a mesma resolucao (caso usuario esteja em CRF muito
 *    baixo + ultrafast, que poderia inflar arquivo).
 */
export function estimateCompressedSize(params: {
  durationSec: number;
  inputHeight?: number;
  inputBytes: number;
  crf: number;
  resolution: 'original' | '1080' | '720' | '480';
}): number {
  if (!params.durationSec || params.durationSec <= 0) {
    // Sem duracao, cai num heuristico crudo proporcional ao input.
    const factor = Math.pow(2, (23 - params.crf) / 6);
    const resScale =
      params.resolution === 'original'
        ? 1
        : params.resolution === '1080'
          ? 0.7
          : params.resolution === '720'
            ? 0.4
            : 0.18;
    return Math.round(params.inputBytes * factor * resScale);
  }

  let videoBps = TARGET_BITRATE_AT_CRF23[params.resolution];

  // Original + altura conhecida → escala proporcional a area.
  if (params.resolution === 'original' && params.inputHeight && params.inputHeight > 0) {
    const ratio = (params.inputHeight / 1080) ** 2;
    videoBps = Math.min(10_000_000, 6_500_000 * ratio);
  }

  // CRF logaritmico: cada -6 dobra bitrate, cada +6 corta pela metade.
  const crfFactor = Math.pow(2, (23 - params.crf) / 6);
  videoBps *= crfFactor;

  let predictedBytes = Math.round(((videoBps + AUDIO_BITRATE) * params.durationSec) / 8);

  // Refinamento: se o input ja era muito comprimido (input bitrate < target),
  // o output nao vai ficar magicamente menor — comprimir um arquivo ja-bem
  // -comprimido raramente gera ganho de >40%. E se for re-encodado em
  // ultrafast com bitrate-alvo MAIOR que o input, pode ate inflar.
  const inputBitrate = (params.inputBytes * 8) / params.durationSec;

  if (params.resolution === 'original') {
    // Nao remosamos resolucao: floor em 60% do input (impossivel comprimir
    // alem disso sem perda visivel forte).
    const floor = params.inputBytes * 0.6;
    // Ceiling em 105% do input (seguranca contra inflacao em CRF baixo).
    const ceiling = params.inputBytes * 1.05;
    predictedBytes = Math.max(floor, Math.min(ceiling, predictedBytes));
  } else if (inputBitrate < videoBps * 0.7) {
    // Input ja com bitrate menor que o alvo. Output nao deveria ser
    // muito maior que o input, e provavelmente sera SIMILAR ao input
    // (nao ha como ganhar mais comprimindo o que ja esta comprimido).
    predictedBytes = Math.min(predictedBytes, Math.round(params.inputBytes * 0.95));
  }

  return predictedBytes;
}

/**
 * Lê duração + altura de um arquivo de video usando o elemento HTMLVideo.
 * Roda 100% no client, em ms, sem precisar do FFmpeg WASM.
 */
export function probeVideoMetadata(
  file: Blob,
): Promise<{ durationSec: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(null);
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
        /* ignora */
      }
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      const dur = isFinite(video.duration) ? video.duration : 0;
      const h = video.videoHeight || 0;
      cleanup();
      resolve({ durationSec: dur, height: h });
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    video.src = url;
  });
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
  // Modo camuflagem: AAC no bitrate máximo pra o piso de ruído do codec
  // ficar bem abaixo do WHITE e o cancelamento de fase sobreviver.
  robust = false,
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
      '-b:a', robust ? '320k' : '192k',
      ...(robust ? ['-ar', '44100', '-cutoff', '20000'] : []),
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
// Máximo de segmentos por passada de filter_complex. Acima disso o
// ffmpeg-wasm (single-thread, heap limitado ~2GB) ESTOURA A MEMÓRIA num
// vídeo full-HD e aborta sem mensagem ("erro desconhecido").
//
// User reportou (2026-05-28): vídeo de 202s gerava 86 segmentos de fala →
// filter_complex de 173 linhas re-encodando 1080x1920 → crash do WASM.
// Solução: processa em BATCHES de N segmentos, gera sub-vídeos, depois
// concatena com concat demuxer (leve). Mantém precisão (re-encode exato
// por segmento) sem estourar memória.
const MAX_SEGMENTS_PER_PASS = 12;

export async function cutVideoSegments(
  file: Blob,
  segments: Array<{ start: number; end: number }>,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const ext = guessExt(file, 'mp4');
  const inputName = 'in.' + ext;
  const progressHandler = wireProgress(ff, opts.onProgress);

  // Roda UMA passada de filter_complex pra um subconjunto de segmentos →
  // grava num arquivo de saída. Re-encode preciso (trim exato).
  async function cutBatch(segs: Array<{ start: number; end: number }>, outName: string): Promise<void> {
    const filterLines: string[] = [];
    const concatInputs: string[] = [];
    segs.forEach((seg, i) => {
      const start = seg.start.toFixed(3);
      const end = seg.end.toFixed(3);
      filterLines.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}]`,
        // áudio normalizado 48k stereo pra concat consistente (sem robótico)
        `[0:a]atrim=start=${start}:end=${end},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`,
      );
      concatInputs.push(`[v${i}][a${i}]`);
    });
    filterLines.push(`${concatInputs.join('')}concat=n=${segs.length}:v=1:a=1[outv][outa]`);
    await ff.exec([
      '-i', inputName,
      '-filter_complex', filterLines.join(';'),
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '26',
      '-g', '60',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outName,
    ]);
  }

  const batchOutputs: string[] = [];
  try {
    await ff.writeFile(inputName, await fetchFile(file));

    // Caminho rápido: poucos segmentos → 1 passada só (comportamento antigo).
    if (segments.length <= MAX_SEGMENTS_PER_PASS) {
      await cutBatch(segments, 'out.mp4');
      const data = await ff.readFile('out.mp4');
      await safeDelete(ff, 'out.mp4');
      return toBlob(data, 'video/mp4');
    }

    // Caminho em batches: divide em grupos de MAX_SEGMENTS_PER_PASS.
    const numBatches = Math.ceil(segments.length / MAX_SEGMENTS_PER_PASS);
    opts.onStage?.(`Decupando ${segments.length} segmentos em ${numBatches} lotes (anti-estouro de memória)...`);
    for (let b = 0; b < numBatches; b++) {
      const slice = segments.slice(b * MAX_SEGMENTS_PER_PASS, (b + 1) * MAX_SEGMENTS_PER_PASS);
      const outName = `cut_batch_${String(b).padStart(2, '0')}.mp4`;
      opts.onStage?.(`Decupando lote ${b + 1}/${numBatches} (${slice.length} segmentos)...`);
      await cutBatch(slice, outName);
      batchOutputs.push(outName);
    }

    // Concatena os sub-vídeos via concat demuxer. Como cada batch saiu com
    // codec/SR/dimensões idênticos (mesmo encode), o -c copy junta sem dor.
    const listName = 'cut_concat_list.txt';
    const list = batchOutputs.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile(listName, new TextEncoder().encode(list));
    opts.onStage?.(`Juntando ${numBatches} lotes decupados...`);
    await ff.exec([
      '-fflags', '+genpts',
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      'out.mp4',
    ]);
    const data = await ff.readFile('out.mp4');
    await safeDelete(ff, listName);
    await safeDelete(ff, 'out.mp4');
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    for (const n of batchOutputs) await safeDelete(ff, n);
  }
}

// ---------- Normalizador de Volume --------------------------------------
//
// Estrategia: compressor ESTATICO (acompressor) em vez de normalizacao
// dinamica (dynaudnorm). Compressor estatico age sobre o nivel instantaneo
// — quando entra uma voz baixa, ela JA aparece no nivel certo, sem drift
// gradual. Quando entra uma voz alta, ela e atenuada na hora.
//
// Cadeia de filtros aplicada em todos os presets:
//  1. highpass=f=80      → remove rumble (vento, fan, mesa)
//  2. acompressor (1×)   → comprime dinamica (threshold + ratio)
//  3. acompressor (2×)   → segundo estagio mais leve em "padrao"/"forte"
//                          pra capturar transientes que escaparam do 1°
//  4. alimiter           → ceiling final pra impedir clip
//  5. loudnorm I=-16     → alvo de loudness fixo (single-pass, leve)
//
// IMPORTANTE: o `dynaudnorm` que era usado antes causava drift gradual
// (voz baixa subia ao longo de varios segundos). Removido por completo.

// ---------- Decupagem com Copy (audio extraction p/ transcricao) --------
//
// Extrai audio de um video em OPUS 12kbps mono 16kHz — bitrate baixo o
// suficiente pra caber no body limit do Vercel route handler (4.5MB) ate
// ~40min de video, com qualidade ainda aceitavel pra speech-to-text.
// Tamanhos esperados:
//   12kbps × 3600s / 8 = 5.4MB pra 1h
//   12kbps × 2400s / 8 = 3.6MB pra 40min  ← cap escolhido
//
// O frontend usa esse audio pra mandar pro AssemblyAI via /api/decupagem-copy/match.

export async function extractAudioForTranscription(
  file: Blob,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.opus';
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    opts.onStage?.('Carregando video...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.('Extraindo o áudio...');
    await ff.exec([
      '-i', inputName,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '12k',
      '-ac', '1',
      '-ar', '16000',
      '-application', 'voip',
      '-vbr', 'off',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'audio/ogg');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Igual à de cima, mas mantém os DOIS canais (estéreo) intactos — sem
 * `-ac 1`, que faria a média (L+R)/2 e, num arquivo de camuflagem por
 * inversão de fase, "limparia" o BLACK artificialmente. Para o botão
 * TRANSCREVER reproduzir fielmente o que um ASR faz com o arquivo REAL
 * (ele costuma pegar UM canal, onde o BLACK está cheio), precisamos do
 * estéreo preservado. Opus 48k estéreo é minúsculo (~720KB p/ 2min).
 */
export async function extractStereoAudioForTranscription(
  file: Blob,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.opus';
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    opts.onStage?.('Extraindo audio estereo (fiel ao arquivo real)...');
    await ff.writeFile(inputName, await fetchFile(file));
    await ff.exec([
      '-i', inputName,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ac', '2',
      '-ar', '16000',
      '-application', 'audio',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'audio/ogg');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

// ---------- Take Splitter (separa cenas/takes de um video) --------------
//
// Detecta cortes de cena via filtro `select='gt(scene,N)'` do FFmpeg
// (1a passada, scan completo) e depois extrai cada segmento usando
// -c copy (zero re-encode, lossless, instantaneo).
//
// Observacoes:
// - Threshold 0.1-0.6: maior = menos cortes (so cenas muito diferentes).
// - minDurationSec funde clusters de cortes muito proximos (descarta
//   falsos positivos tipo flash/movimento brusco), e nunca cria takes
//   menores que esse valor.
// - 2 ffmpeg.exec() chamadas por video (um scan + N copies).

export type Take = {
  index: number;
  startSec: number;
  endSec: number;
  blob: Blob;
};

function buildCutPoints(
  durationSec: number,
  sceneTimes: number[],
  minDur: number,
): number[] {
  const sorted = [...sceneTimes]
    .sort((a, b) => a - b)
    .filter((t) => t > 0 && t < durationSec);
  const out: number[] = [0];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (t - last < minDur) {
      // Cluster — substitui o cut anterior pelo atual (excepto se for a ancora 0)
      if (out.length > 1) out[out.length - 1] = t;
    } else {
      out.push(t);
    }
  }
  const last = out[out.length - 1];
  if (durationSec - last < minDur && out.length > 1) {
    out[out.length - 1] = durationSec;
  } else {
    out.push(durationSec);
  }
  return out;
}

/**
 * Callback opcional pra verificacao IA dos candidatos de corte.
 * Recebe os timestamps detectados pelo scdet + 1 frame antes/depois de cada,
 * retorna SUBSET aprovado. Usado pelo modo IA do Take Splitter pra filtrar
 * falsos positivos do scdet.
 */
export type AiCutVerifyFn = (
  candidates: Array<{
    time: number;
    frameBefore: string; // base64 data URL ou base64 puro
    frameAfter: string;
  }>,
  onProgress?: (msg: string) => void,
) => Promise<Array<{ time: number; isRealCut: boolean }>>;

export async function splitVideoByScenes(
  file: Blob,
  options: {
    threshold?: number;
    minDurationSec?: number;
    aiVerify?: AiCutVerifyFn;
  } = {},
  opts: RunOptions = {},
): Promise<Take[]> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const threshold = Math.max(0.05, Math.min(0.95, options.threshold ?? 0.3));
  const minDur = Math.max(0.5, options.minDurationSec ?? 3);

  let durationSec = 0;
  const sceneTimes: number[] = [];
  const logHandler = ({ message }: { message: string }) => {
    const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(message);
    if (dm) {
      const d = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]);
      if (d > durationSec) durationSec = d;
    }
    // scdet emite "lavfi.scd.time: NN.NNN" pra cada scene change detectado.
    // Tambem capturamos pts_time (compat com select=gt(scene,...) caso
    // FFmpeg fallback).
    const sm = /lavfi\.scd\.time:\s*([\d.]+)/.exec(message);
    if (sm) {
      const t = parseFloat(sm[1]);
      if (!isNaN(t) && t > 0) sceneTimes.push(t);
    } else {
      const ptm = /pts_time:([\d.]+)/.exec(message);
      if (ptm) {
        const t = parseFloat(ptm[1]);
        if (!isNaN(t) && t > 0) sceneTimes.push(t);
      }
    }
    opts.onLog?.(message);
  };
  ff.on('log', logHandler);

  // Mapeia progresso: detect = 0-70%, cuts = 70-100%
  let phase: 'detect' | 'cut' = 'detect';
  let cutsTotal = 0;
  let cutsDone = 0;
  const progHandler = ({ progress }: { progress: number }) => {
    if (!opts.onProgress) return;
    if (phase === 'detect') {
      opts.onProgress({
        ratio: Math.min(0.7, Math.max(0, progress) * 0.7),
        time: 0,
      });
    } else {
      const overall = 0.7 + (cutsDone / Math.max(1, cutsTotal)) * 0.3;
      opts.onProgress({ ratio: Math.min(1, overall), time: 0 });
    }
  };
  ff.on('progress', progHandler);

  try {
    opts.onStage?.('Carregando o vídeo...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.('Escaneando cortes de cena (1 passada)...');
    // 1a passada: usa scdet (Scene Change Detection) que e mais
    // assertivo que select=gt(scene,N) — usa color histogram, nao
    // so luminance diff. Threshold scdet vai de 0-100 (default 10).
    // Mapeamos nosso 0.05-0.95 (compat com UI antiga) → 5-95.
    const scdetThreshold = Math.round(threshold * 100);
    await ff.exec([
      '-i', inputName,
      '-filter:v', `scdet=threshold=${scdetThreshold}`,
      '-an',
      '-f', 'null',
      '-',
    ]);

    if (durationSec <= 0) {
      durationSec =
        sceneTimes.length > 0 ? sceneTimes[sceneTimes.length - 1] + 5 : 0;
    }
    if (durationSec <= 0) {
      throw new Error('Nao foi possivel ler a duracao do video.');
    }

    let effectiveSceneTimes = sceneTimes;

    // AI verify mode: extrai 1 frame antes/depois de cada scene time,
    // manda pra callback (que vai chamar /api/take-splitter/verify-cuts),
    // recebe a lista filtrada de cuts REAIS.
    if (options.aiVerify && sceneTimes.length > 0) {
      opts.onStage?.(
        `IA verificando ${sceneTimes.length} candidatos (cuts falsos serao filtrados)...`,
      );

      const candidates: Array<{
        time: number;
        frameBefore: string;
        frameAfter: string;
      }> = [];

      for (let i = 0; i < sceneTimes.length; i++) {
        const t = sceneTimes[i];
        const before = await extractSmallFrameAt(
          ff,
          inputName,
          Math.max(0, t - 0.4),
          `frame_b_${i}.jpg`,
        );
        const after = await extractSmallFrameAt(
          ff,
          inputName,
          Math.min(durationSec - 0.05, t + 0.4),
          `frame_a_${i}.jpg`,
        );
        candidates.push({
          time: t,
          frameBefore: await blobToBase64(before),
          frameAfter: await blobToBase64(after),
        });
      }

      const verifs = await options.aiVerify(candidates, (m) =>
        opts.onStage?.(m),
      );
      const realSet = new Set(
        verifs.filter((v) => v.isRealCut).map((v) => v.time.toFixed(3)),
      );
      effectiveSceneTimes = sceneTimes.filter((t) =>
        realSet.has(t.toFixed(3)),
      );
      opts.onStage?.(
        `IA aprovou ${effectiveSceneTimes.length}/${sceneTimes.length} cortes.`,
      );
    }

    const cuts = buildCutPoints(durationSec, effectiveSceneTimes, minDur);
    const segments: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      segments.push({ start: cuts[i], end: cuts[i + 1] });
    }
    if (segments.length === 0) {
      segments.push({ start: 0, end: durationSec });
    }

    cutsTotal = segments.length;
    phase = 'cut';

    const takes: Take[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      opts.onStage?.(
        `Extraindo take ${i + 1}/${segments.length} (${(seg.end - seg.start).toFixed(1)}s)...`,
      );
      const outName = `take_${String(i + 1).padStart(3, '0')}.mp4`;
      // -c copy: sem re-encode. Cuts caem no keyframe mais proximo, ai
      // a duracao real pode variar levemente. Pra documentario isso e ok.
      await ff.exec([
        '-ss', seg.start.toFixed(3),
        '-to', seg.end.toFixed(3),
        '-i', inputName,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outName,
      ]);
      const data = await ff.readFile(outName);
      takes.push({
        index: i + 1,
        startSec: seg.start,
        endSec: seg.end,
        blob: toBlob(data, 'video/mp4'),
      });
      await safeDelete(ff, outName);
      cutsDone = i + 1;
    }

    return takes;
  } finally {
    ff.off('log', logHandler);
    ff.off('progress', progHandler);
    await safeDelete(ff, inputName);
  }
}

// ---------- Remover Elementos (legendas / watermarks) -------------------
//
// Usa o filtro `delogo` do FFmpeg pra apagar regioes retangulares,
// interpolando das bordas adjacentes. Funciona muito bem pra:
//  - Legendas hardcoded (bottom strip)
//  - Watermarks/logos estaticos
//  - Time codes / channel marks
// Limitacao: regioes em movimento ou sobre conteudo complexo deixam
// halo visivel. Pra esses casos a alternativa seria inpainting AI
// (Replicate ProPainter), mas ai precisa servidor pra processar — fora
// do escopo "sem mexer na estrutura".

export type RemoveRegion = {
  /** Coordenadas em PIXELS no espaco do video original */
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function removeRegions(
  file: Blob,
  regions: RemoveRegion[],
  opts: RunOptions & { preserveAudio?: boolean } = {},
): Promise<Blob> {
  if (regions.length === 0) throw new Error('Nenhuma regiao a remover.');
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.mp4';
  const progressHandler = wireProgress(ff, opts.onProgress);

  // delogo precisa de inteiros >= 1. Cada regiao vira um delogo na cadeia.
  // band=4 suaviza as bordas pra ficar menos perceptivel.
  const filterParts = regions.map((r) => {
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const w = Math.max(2, Math.round(r.width));
    const h = Math.max(2, Math.round(r.height));
    return `delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`;
  });
  const vfilter = filterParts.join(',');

  const preserveAudio = opts.preserveAudio !== false;

  try {
    opts.onStage?.('Carregando o vídeo...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.('Aplicando a remoção...');
    await ff.exec([
      '-i', inputName,
      '-vf', vfilter,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      // CRF 20 (qualidade levemente maior que 23) pra nao acumular perda
      // sobre a perda do delogo.
      '-crf', '20',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
      // Audio: copy quando possivel (sem perda + super rapido)
      ...(preserveAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']),
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

/**
 * Extrai um frame JPEG do video num timestamp (s) — usado pra mandar
 * pra IA detectar regioes. Tamanho cap pra economizar token.
 */
export async function extractFrameAt(
  file: Blob,
  timeSec: number,
  opts: { maxWidth?: number; quality?: number } = {},
): Promise<Blob> {
  const ff = await getFFmpeg();
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'frame_in.' + guessExt(file, 'mp4');
  const outputName = 'frame_out.jpg';
  const maxW = opts.maxWidth ?? 1024;
  const q = opts.quality ?? 5; // 1=best, 31=worst; 5 e bom pra IA

  try {
    await ff.writeFile(inputName, await fetchFile(file));
    await ff.exec([
      '-ss', timeSec.toFixed(2),
      '-i', inputName,
      '-vframes', '1',
      '-vf', `scale=${maxW}:-2:flags=fast_bilinear`,
      '-q:v', String(q),
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'image/jpeg');
  } finally {
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Pipeline ÚNICO de normalização — calibrado pra "equalizar vozes" entre
 * múltiplos avatares no mesmo clip. Faz exatamente o que o usuário pede:
 * voz baixa sobe, voz alta desce, ambas ficam confortáveis de ouvir.
 *
 * Por que essa cadeia:
 *  1. `highpass=80`     — corta rumble (ar-condicionado, mesa, etc)
 *  2. `dynaudnorm`      — gain dinâmico per-frame com janela gaussiana de
 *                          15 frames de 150ms = ~2.25s de smoothing. Cada
 *                          fala é trazida pro mesmo nível percebido sem
 *                          "bombear" entre as transições. **Esse é o
 *                          filtro principal pra equalizar vozes**.
 *  3. `acompressor`     — polimento: 2.5:1 a -18dB pra controlar picos
 *                          que sobraram do dynaudnorm
 *  4. `alimiter`        — teto -0.3dB pra garantir 0 clipping
 *  5. `loudnorm=I=-16`  — LUFS final padrão broadcast (Spotify/podcast)
 *
 * Output: MP4 mantém vídeo + re-encode rápido do áudio; MP3/WAV descarta
 * vídeo. Sem opções de intensidade — uma resposta pra um problema.
 */
const NORMALIZE_FILTER = [
  'highpass=f=80',
  'dynaudnorm=f=150:g=15:n=1:p=0.85:r=0.7:m=8',
  'acompressor=threshold=-18dB:ratio=2.5:attack=5:release=80:makeup=2',
  'alimiter=limit=0.97',
  'loudnorm=I=-16:LRA=7:TP=-1.5',
].join(',');

export type NormalizeOutFormat = 'mp4' | 'mp3' | 'wav';

/**
 * Equaliza o volume de vozes diferentes num mesmo arquivo.
 *
 * Caso típico: vídeo com 2 avatares — um foi gravado alto, outro baixo.
 * Sai daqui com ambos no mesmo nível confortável.
 *
 * - Se output for MP4: mantem o vídeo, re-encoda áudio com pipeline aplicado
 * - Se output for MP3/WAV: descarta vídeo (se houver) e gera só áudio
 */
export async function normalizeVolume(
  file: Blob,
  params: { output: NormalizeOutFormat },
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.' + params.output;
  const filter = NORMALIZE_FILTER;
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    opts.onStage?.('Carregando arquivo...');
    await ff.writeFile(inputName, await fetchFile(file));

    const args: string[] = ['-i', inputName, '-af', filter];

    if (params.output === 'mp4') {
      // Mantem video, re-encoda so audio com filtro de normalizacao.
      // -c:v copy nem sempre funciona bem com -af (FFmpeg pode reclamar
      // de mismatch de timestamps), entao fazemos re-encode rapido com
      // ultrafast + bframes=0 — o video so precisa "passar reto" enquanto
      // o trabalho real e o filtro de audio (acompressor + loudnorm).
      args.push(
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'fastdecode',
        '-crf', '22',
        '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
        '-pix_fmt', 'yuv420p',
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

/**
 * Concat de varios MP4s gerados pelo HeyGen (cada parte = 1 paragrafo da
 * copy gerado separado no Script-to-Video). Usa filter_complex pra garantir
 * que codec/fps/resolucao bata mesmo se cada parte vier ligeiramente
 * diferente do HeyGen.
 *
 * Saida: 1080x1920 30fps H.264 ultrafast.
 */
export async function concatAvatarParts(
  parts: Blob[],
  opts: RunOptions = {},
): Promise<Blob> {
  if (parts.length === 0) throw new Error('Nenhuma parte pra concatenar.');
  if (parts.length === 1) return parts[0];

  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');
  const progressHandler = wireProgress(ff, opts.onProgress);

  const inputNames: string[] = [];
  const outputName = 'concat_out.mp4';

  try {
    for (let i = 0; i < parts.length; i++) {
      const name = `part_${String(i).padStart(3, '0')}.mp4`;
      inputNames.push(name);
      await ff.writeFile(name, await fetchFile(parts[i]));
    }

    // filter_complex com normalizacao: scale + fps + format pra todas as
    // partes ficarem identicas, depois concat
    const inputFlags: string[] = [];
    inputNames.forEach((n) => {
      inputFlags.push('-i', n);
    });

    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    inputNames.forEach((_, i) => {
      filterParts.push(
        `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a${i}]`,
      );
      concatInputs.push(`[v${i}][a${i}]`);
    });
    filterParts.push(
      `${concatInputs.join('')}concat=n=${inputNames.length}:v=1:a=1[outv][outa]`,
    );

    opts.onStage?.(`Concatenando ${inputNames.length} partes do avatar...`);
    await ff.exec([
      ...inputFlags,
      '-filter_complex',
      filterParts.join(';'),
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', '22',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    for (const n of inputNames) await safeDelete(ff, n);
    await safeDelete(ff, outputName);
  }
}

/**
 * Concat rapido sem re-encode (concat demuxer). 5-10x mais rapido que
 * concatAvatarParts pra videos do mesmo codec/resolucao (caso comum: todos
 * vindos do HeyGen com mesmo avatar). Se os videos divergem em codec/
 * dimensao, ffmpeg pode falhar — caller deve cair no concatAvatarParts.
 *
 * Usa o "concat demuxer" via lista txt + -c copy (zero re-encode).
 */
export async function concatVideosFast(
  parts: Blob[],
  opts: RunOptions = {},
): Promise<Blob> {
  if (parts.length === 0) throw new Error('Nenhuma parte pra concatenar.');
  if (parts.length === 1) return parts[0];

  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');
  const progressHandler = wireProgress(ff, opts.onProgress);

  const inputNames: string[] = [];
  const listName = 'concat_list.txt';
  const outputName = 'concat_fast_out.mp4';

  try {
    for (let i = 0; i < parts.length; i++) {
      const name = `fast_part_${String(i).padStart(3, '0')}.mp4`;
      inputNames.push(name);
      await ff.writeFile(name, await fetchFile(parts[i]));
    }
    // Lista pra concat demuxer: uma linha "file '<name>'" por parte
    const list = inputNames.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile(listName, new TextEncoder().encode(list));

    opts.onStage?.(`Concat rapido (${inputNames.length} partes)...`);
    // VIDEO: -c:v copy (zero re-encode, mantém qualidade original)
    // AUDIO: SEMPRE re-encode com SR/codec normalizados.
    //
    // User reportou áudio robótico em alguns trechos da montagem (2026-05-27).
    // Causa: -c copy preserva o codec/SR original de cada parte. Se HeyGen
    // retorna parts com:
    //   - SR diferentes (44.1k em alguns, 48k em outros) → re-sampling errado
    //   - AAC LC vs HE-AAC v1 vs v2 → frame size mismatch
    //   - bitrate diferente → glitches na junção
    // A concat demuxer com -c copy NÃO resampleia, só junta frames como vem
    // → fica robótico/clicking/pitch shift entre parts.
    //
    // Fix: força AAC 48k stereo 192k pra todas as parts no concat. Custo de
    // re-encode de audio é desprezível (~5% do tempo total) vs ganho de
    // qualidade. Video continua -c copy (rápido).
    //
    // -fflags +genpts: regenera timestamps (Web Audio API decode no decupagem)
    await ff.exec([
      '-fflags', '+genpts',
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '192k',
      '-af', 'aresample=async=1:first_pts=0',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      outputName,
    ]);
    const data = await ff.readFile(outputName);
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    for (const n of inputNames) await safeDelete(ff, n);
    await safeDelete(ff, listName);
    await safeDelete(ff, outputName);
  }
}

async function safeDelete(ff: FFmpeg, name: string) {
  try {
    await ff.deleteFile(name);
  } catch {
    /* ignora */
  }
}

/**
 * Extrai um frame pequeno (largura 384px) num timestamp pra mandar pra IA.
 * Reusa o FFmpeg ja carregado e o input ja escrito em memfs (nao recarrega
 * o arquivo). Esta separado de extractFrameAt pra evitar I/O duplicado.
 */
async function extractSmallFrameAt(
  ff: FFmpeg,
  inputName: string,
  timeSec: number,
  outName: string,
): Promise<Blob> {
  await ff.exec([
    '-ss', timeSec.toFixed(2),
    '-i', inputName,
    '-vframes', '1',
    '-vf', 'scale=384:-2:flags=fast_bilinear',
    '-q:v', '6',
    outName,
  ]);
  const data = await ff.readFile(outName);
  await safeDelete(ff, outName);
  return toBlob(data, 'image/jpeg');
}

/** Blob -> base64 string (sem prefixo "data:..."). Browser only. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // String.fromCharCode em chunks pra evitar stack overflow em frames grandes
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return typeof btoa !== 'undefined' ? btoa(binary) : '';
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

/**
 * SMART MODE VA — overlay multiplos lipsync videos no video original em
 * timestamps EXATOS (cut puro, sem crossfade, frame-perfect).
 *
 * INPUT:
 *  - original: video original (AD) que serve de base
 *  - overlays: array de { start, end, video } — onde cada `video` e o
 *    lipsync gerado pra aquele segmento (mesma duracao de end-start)
 *
 * OUTPUT:
 *  - 1 MP4 mesma duracao do original
 *  - Audio: SEMPRE do original (preserva timing perfeito)
 *  - Video: original onde nao tem overlay; lipsync onde tem overlay
 *  - Transicao: cut puro via overlay enable='between(t,start,end)'
 *
 * GARANTIA "zero ms de avatar antigo":
 *  - filter overlay com enable='between(t,start,end)' usa PTS do encoder
 *    (frame-accurate, nao timestamp-by-timestamp)
 *  - Audio do original e' COPIADO (stream copy, sem re-encode)
 *  - Video reencodado com mesma resolucao/fps do original
 *
 * NOTA: cada overlay e' redimensionado/reposicionado pra encaixar nas
 * dimensoes do original via scale + setpts.
 */
export async function overlaySegmentsOnVideo(
  original: Blob,
  overlays: Array<{ start: number; end: number; video: Blob }>,
  opts: RunOptions = {},
): Promise<Blob> {
  if (overlays.length === 0) {
    // Nada pra trocar — retorna original
    return original;
  }
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const baseExt = guessExt(original, 'mp4');
  const baseName = 'base.' + baseExt;
  const overlayNames: string[] = [];
  const outputName = 'out.mp4';
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    // Escreve original
    await ff.writeFile(baseName, await fetchFile(original));

    // Escreve cada overlay
    for (let i = 0; i < overlays.length; i++) {
      const ext = guessExt(overlays[i].video, 'mp4');
      const n = `ov${i}.${ext}`;
      await ff.writeFile(n, await fetchFile(overlays[i].video));
      overlayNames.push(n);
    }

    // Monta inputs args
    const args: string[] = ['-i', baseName];
    for (const n of overlayNames) args.push('-i', n);

    // Filter complex: encadeia overlays sequencialmente.
    // Cada overlay i: scale pra mesma resolucao do base + setpts pra alinhar
    // no timestamp start. Encadeia [base][ov_i_scaled] -> [tmp_i] usando
    // overlay com enable='between(t,start_i,end_i)'.
    //
    // Pra setpts: cada overlay tem duracao end-start. O PTS interno comeca
    // em 0. Pra alinhar com o timestamp original, usamos:
    //   setpts=PTS-STARTPTS+<start>/TB
    // (desloca o PTS pra start_i segundos)
    const filterLines: string[] = [];
    let lastVideoLabel = '[0:v]';
    overlays.forEach((ov, i) => {
      const idx = i + 1; // input index (0 = base, 1..N = overlays)
      const startTs = ov.start.toFixed(3);
      const endTs = ov.end.toFixed(3);
      const scaledLabel = `[ov${i}_scaled]`;
      const shiftedLabel = `[ov${i}_shifted]`;
      const outLabel = i === overlays.length - 1 ? '[vout]' : `[tmp${i}]`;
      // Scale pra mesma resolucao do base + setpts pra start exato
      filterLines.push(`[${idx}:v]scale=w='iw':h='ih',setpts=PTS-STARTPTS+${startTs}/TB${scaledLabel}`);
      filterLines.push(`${shiftedLabel.replace(']', ']')}`); // no-op placeholder
      // Overlay com enable
      filterLines.pop(); // remove placeholder
      filterLines.push(
        `${lastVideoLabel}${scaledLabel}overlay=x=0:y=0:enable='between(t\\,${startTs}\\,${endTs})'${outLabel}`,
      );
      lastVideoLabel = outLabel;
    });

    const filterComplex = filterLines.join(';');

    args.push(
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', '0:a?',          // audio do original (preservacao perfeita do timing)
      '-c:a', 'copy',           // stream copy audio = ZERO mudanca no audio
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y', outputName,
    );

    await ff.exec(args);
    const data = await ff.readFile(outputName);
    return toBlob(data as Uint8Array, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, baseName);
    for (const n of overlayNames) await safeDelete(ff, n);
    await safeDelete(ff, outputName);
  }
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

// ---------- Mind Ads Suite — silence cut + montagem ---------------------
//
// Avatar vem do HeyGen com pausas naturais entre frases. A gente roda
// silenceremove com tolerancia de 50ms (default) pra cortar so as pausas
// muito longas (vicio de tempo morto, respiracao, etc) sem comer palavras.

export async function removeAvatarSilences(
  file: Blob,
  toleranceSec = 0.05,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'avatar_in.' + guessExt(file, 'mp4');
  const outputName = 'avatar_cut.mp4';
  const progressHandler = wireProgress(ff, opts.onProgress);

  // silenceremove com stop_periods=-1 remove TODOS os silencios, com
  // stop_threshold em -32dB (ruido ambiente) e duracao minima do
  // silencio configuravel.
  const af =
    `silenceremove=stop_periods=-1:stop_duration=${toleranceSec.toFixed(3)}:` +
    `stop_threshold=-32dB:detection=peak,aresample=44100`;

  try {
    opts.onStage?.('Cortando silencios do avatar (tolerancia ' + toleranceSec + 's)...');
    await ff.writeFile(inputName, await fetchFile(file));

    // Re-encoda video junto pra os timestamps baterem com o audio cortado.
    await ff.exec([
      '-i', inputName,
      '-af', af,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', '22',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
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

// ---------- Mind Ads — montagem final ------------------------------------
//
// Recebe:
//  - avatarBlob: video do HeyGen ja com silencios cortados (audio MASTER)
//  - takeSegments: lista de takes com [start, end] em segundos NO AVATAR
//    cortado, e tipo (avatar | broll) + opcional brollVideo
//  - bgMusic: audio opcional pra colocar de fundo
//  - bgVolume: 0..100 (default 20)
//
// Logica:
//  - Pra cada take avatar: usa o segmento puro do avatar (video + audio)
//  - Pra cada take broll: usa o brollVideo como video, mas o audio E o
//    audio do avatar nesse intervalo (loop/scale do video se preciso)
//  - Concatena todos os segmentos em ordem
//  - Mixa bg music por baixo se fornecida (no track inteiro)

export type MindAdsTakeSegment = {
  n: number;
  type: 'avatar' | 'broll';
  startSec: number;
  endSec: number;
  brollVideo?: Blob; // obrigatorio se type === 'broll'
};

export type MindAdsMontageInput = {
  avatar: Blob;
  takes: MindAdsTakeSegment[];
  bgMusic?: Blob | null;
  bgVolume?: number; // 0..100
  hookVideo?: Blob | null;
  hookLayout?: 'fullscreen' | 'split' | 'react';
};

export async function mindAdsMontage(
  input: MindAdsMontageInput,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');
  const progressHandler = wireProgress(ff, opts.onProgress);

  const avatarName = 'avatar.mp4';
  const segmentNames: string[] = [];
  const tempFiles: string[] = [avatarName];

  try {
    opts.onStage?.('Carregando avatar...');
    await ff.writeFile(avatarName, await fetchFile(input.avatar));

    // 1) Gera um arquivo MP4 por take (avatar slice OU broll com audio do avatar)
    for (let i = 0; i < input.takes.length; i++) {
      const take = input.takes[i];
      const dur = Math.max(0.2, take.endSec - take.startSec);
      const segName = `seg_${String(i).padStart(3, '0')}.mp4`;
      segmentNames.push(segName);
      tempFiles.push(segName);

      opts.onStage?.(
        `Montando take ${i + 1}/${input.takes.length} (${take.type}, ${dur.toFixed(1)}s)...`,
      );

      if (take.type === 'avatar') {
        // Recorte direto do avatar
        await ff.exec([
          '-ss', take.startSec.toFixed(3),
          '-to', take.endSec.toFixed(3),
          '-i', avatarName,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'fastdecode',
          '-crf', '22',
          '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '160k',
          '-r', '30',
          '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
          segName,
        ]);
      } else {
        // Broll: video da broll, audio do avatar nesse range
        if (!take.brollVideo) {
          throw new Error(
            `Take ${take.n} marcado como broll mas sem video.`,
          );
        }
        const brollName = `broll_${String(i).padStart(3, '0')}.mp4`;
        tempFiles.push(brollName);
        await ff.writeFile(brollName, await fetchFile(take.brollVideo));

        // Estende o broll a duracao do take via tpad (freeze last frame)
        // e trim ao final. Se broll for mais longo, trima.
        const vfBroll =
          `scale=1080:1920:force_original_aspect_ratio=increase,` +
          `crop=1080:1920,` +
          `tpad=stop_mode=clone:stop_duration=${dur.toFixed(3)},` +
          `trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS`;

        await ff.exec([
          // Input 0: broll video (sem audio)
          '-i', brollName,
          // Input 1: avatar — vamos extrair audio do range
          '-ss', take.startSec.toFixed(3),
          '-to', take.endSec.toFixed(3),
          '-i', avatarName,
          // Map: video do broll filtrado + audio do avatar
          '-filter_complex',
          `[0:v]${vfBroll}[v];[1:a]asetpts=PTS-STARTPTS[a]`,
          '-map', '[v]',
          '-map', '[a]',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'fastdecode',
          '-crf', '22',
          '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '160k',
          '-r', '30',
          segName,
        ]);
      }
    }

    // 2) Concat list pra concatenar todos os segmentos
    const concatList = segmentNames.map((n) => `file '${n}'`).join('\n');
    const concatName = 'concat.txt';
    tempFiles.push(concatName);
    await ff.writeFile(concatName, new TextEncoder().encode(concatList));

    const concatedName = 'concated.mp4';
    tempFiles.push(concatedName);

    opts.onStage?.('Concatenando segmentos...');
    await ff.exec([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatName,
      '-c', 'copy',
      '-movflags', '+faststart',
      concatedName,
    ]);

    // 3) Hook video opcional no inicio (so suporta fullscreen por enquanto;
    //    split/react ficam no proximo round — precisa de overlay timing)
    let withHookName = concatedName;
    if (input.hookVideo) {
      const hookName = 'hook.mp4';
      const hookProcessed = 'hook_proc.mp4';
      const finalWithHook = 'with_hook.mp4';
      tempFiles.push(hookName, hookProcessed, finalWithHook);

      opts.onStage?.('Processando hook video...');
      await ff.writeFile(hookName, await fetchFile(input.hookVideo));

      // Padroniza hook video pra mesmo formato dos segmentos
      await ff.exec([
        '-i', hookName,
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '160k',
        '-r', '30',
        hookProcessed,
      ]);

      // Concat hook + concated
      const concatList2 = `file '${hookProcessed}'\nfile '${concatedName}'`;
      const concatName2 = 'concat2.txt';
      tempFiles.push(concatName2);
      await ff.writeFile(concatName2, new TextEncoder().encode(concatList2));

      await ff.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', concatName2,
        '-c', 'copy',
        '-movflags', '+faststart',
        finalWithHook,
      ]);

      withHookName = finalWithHook;
    }

    // 4) Bg music opcional, mixada por cima do audio existente
    let outputName = withHookName;
    if (input.bgMusic) {
      const bgName = 'bg.audio';
      const finalWithBg = 'final.mp4';
      tempFiles.push(bgName, finalWithBg);

      opts.onStage?.('Mixando musica de fundo...');
      await ff.writeFile(bgName, await fetchFile(input.bgMusic));
      const bgVol = Math.max(0, Math.min(100, input.bgVolume ?? 20)) / 100;

      await ff.exec([
        '-i', withHookName,
        '-stream_loop', '-1', // loop pra cobrir o video se a musica for menor
        '-i', bgName,
        '-filter_complex',
        `[1:a]volume=${bgVol.toFixed(3)},aloop=loop=-1:size=2e9[bg];` +
          `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]`,
        '-map', '0:v',
        '-map', '[a]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        finalWithBg,
      ]);
      outputName = finalWithBg;
    }

    const data = await ff.readFile(outputName);
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    for (const n of tempFiles) {
      await safeDelete(ff, n);
    }
  }
}

/**
 * Estima divisao de um avatar continuo em N takes baseado na proporcao do
 * comprimento de copy de cada take em relacao ao total.
 *
 * Retorna [start, end] pra cada take em segundos no avatar.
 *
 * Premissa: o avatar fala todo o copy a um ritmo constante. Boa primeira
 * aproximacao — refinamento futuro pode usar word-level timestamps do
 * AssemblyAI pra precisao de palavra.
 */
export function estimateTakeBoundaries(
  copyLengths: number[],
  totalDurationSec: number,
): Array<{ startSec: number; endSec: number }> {
  const total = copyLengths.reduce((a, b) => a + b, 0);
  if (total <= 0 || totalDurationSec <= 0) {
    // fallback: divide igualmente
    const each = totalDurationSec / Math.max(1, copyLengths.length);
    return copyLengths.map((_, i) => ({
      startSec: i * each,
      endSec: (i + 1) * each,
    }));
  }
  const result: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  for (const len of copyLengths) {
    const dur = (len / total) * totalDurationSec;
    result.push({ startSec: cursor, endSec: cursor + dur });
    cursor += dur;
  }
  // Garante que o ultimo termina exatamente em totalDurationSec
  if (result.length > 0) {
    result[result.length - 1].endSec = totalDurationSec;
  }
  return result;
}
