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
// WATCHDOG GLOBAL de exec: teto MUITO generoso (só pega HANG infinito do
// ffmpeg-wasm, nunca mata encode legítimo). Se um exec passar disso, a instância
// está travada (worker poisoned) → matamos e a próxima getFFmpeg reinicia limpa.
// Backstop pra TODO consumidor (decupagem, VA, compressor, etc.); os pipelines
// que querem recuperação RÁPIDA põem timeouts menores por cima (e o exec aqui só
// garante que NADA fica pendurado pra sempre). 25min.
const EXEC_WATCHDOG_MS = 25 * 60 * 1000;
// WATCHDOG POR BATIMENTO (a rede REAL de recuperação rápida): o ffmpeg-wasm emite
// evento `progress` continuamente durante QUALQUER exec de verdade (a cada ~1-2s
// num encode). Se ficar STALL_MS INTEIROS sem NENHUM progresso, o worker morreu
// (hang/poison) — matamos na hora, sem esperar os 25min do teto absoluto. Nunca
// mata encode legítimo: por mais LONGO que seja (montagem grande, re-encode de
// sync), ele continua batendo progresso → nunca cruza o silêncio de 3min. Só um
// hang de verdade fica 3min mudo. Era ISSO que deixava a task "MONTANDO/decupando"
// pendurada 18-25min (user reportou 2026-07-01: 2 tasks travadas em decupagem) —
// o teto de 25min era o único gatilho. Agora cai em ~3min → retry/fallback do
// pipeline conclui rápido, sem precisar de RETOMAR manual.
const EXEC_STALL_MS = 3 * 60 * 1000;

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

/**
 * WATCHDOG no exec: envolve o exec nativo de UMA instância. Se um exec travar
 * (hang infinito do wasm), matamos a instância (terminate) e avisamos o dono
 * via `onKilled` — o singleton zera instance/loadingPromise, o pool remove o
 * slot morto. Backstop universal (todo helper passa por aqui). O exec nativo
 * perdedor da corrida tem .catch no-op pra não virar unhandled rejection.
 *
 * Usado pelo singleton (loadCore) E pelo pool (lib/ffmpeg-pool.ts) — antes o
 * pool rodava SEM watchdog e um hang num job do Compressor ficava pendurado
 * pra sempre (job "running" eterno).
 */
export function attachExecWatchdog(ff: FFmpeg, onKilled?: () => void): void {
  const _origExec = ff.exec.bind(ff) as (...x: unknown[]) => Promise<number>;
  const wrappedExec = (...a: unknown[]): Promise<number> => {
    const real = _origExec(...a);
    real.catch(() => { /* swallow late rejection se o watchdog ganhou */ });

    // BATIMENTO: cada evento `progress` do exec vivo carimba lastBeat. É um
    // listener PRÓPRIO do watchdog — coexiste com o do helper (wireProgress),
    // porque ff.on('progress') empilha callbacks (não sobrescreve). Assim o
    // progresso da UI segue intacto e o watchdog tem seu próprio pulso.
    let lastBeat = Date.now();
    const onBeat = () => { lastBeat = Date.now(); };
    ff.on('progress', onBeat);
    // TAMBÉM carimba no evento 'log': nem todo exec emite 'progress' denso — um
    // stream-copy (-c copy) na junção de lotes ou um scan (-f null) do loudnorm
    // pode ficar longos trechos SEM 'progress' num arquivo grande e cruzar os 3min
    // do EXEC_STALL_MS → seria morto no meio de um encode VÁLIDO. O 'log' sai
    // continuamente em QUALQUER exec vivo (é o pulso mais confiável). O teto
    // absoluto de 25min segue como backstop, então um exec que trava mas ainda
    // cospe log não fica pendurado pra sempre.
    ff.on('log', onBeat);

    let poll: ReturnType<typeof setInterval> | undefined;
    let hardTo: ReturnType<typeof setTimeout> | undefined;
    const kill = (rej: (e: Error) => void, msg: string) => {
      try { ff.terminate(); } catch { /* ignora */ }
      onKilled?.();
      rej(new Error(msg));
    };
    const watchdog = new Promise<number>((_, rej) => {
      // Gatilho PRIMÁRIO: silêncio total de progresso = worker travado → mata rápido.
      poll = setInterval(() => {
        if (Date.now() - lastBeat >= EXEC_STALL_MS) {
          kill(rej, `ffmpeg exec travado (${EXEC_STALL_MS / 1000}s sem progresso) — instância reiniciada`);
        }
      }, 15_000);
      // Backstop ABSOLUTO (rede final): mesmo que algo emita progresso fantasma pra
      // sempre, o teto de 25min garante que NADA fica pendurado eternamente.
      hardTo = setTimeout(() => {
        kill(rej, `ffmpeg exec travou (watchdog ${EXEC_WATCHDOG_MS / 60000}min) — instância reiniciada`);
      }, EXEC_WATCHDOG_MS);
    });
    return Promise.race([real, watchdog]).finally(() => {
      if (poll) clearInterval(poll);
      if (hardTo) clearTimeout(hardTo);
      try { ff.off('progress', onBeat); } catch { /* ignora */ }
      try { ff.off('log', onBeat); } catch { /* ignora */ }
    });
  };
  (ff as unknown as { exec: unknown }).exec = wrappedExec;
}

async function loadCore(onStage?: FFLoadStage, onLog?: FFLog): Promise<FFmpeg> {
  onStage?.('Preparando...');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');

  const ff = new FFmpeg();
  if (onLog) ff.on('log', ({ message }) => onLog(message));

  attachExecWatchdog(ff, () => {
    if (instance === ff) {
      instance = null; // força reinit limpo no próximo getFFmpeg
      // CRÍTICO (fix 2026-07-03): zerar TAMBÉM o loadingPromise. Sem isto,
      // getFFmpeg cai em `if (loadingPromise) return loadingPromise` e devolve
      // a promise RESOLVIDA que aponta pra ESTA instância JÁ TERMINADA (zumbi)
      // — todo exec seguinte "resolve" mas não produz nada → montado 1KB /
      // takes 0KB persistidos como sucesso, em TODAS as tasks seguintes do
      // mesmo tab (foi a raiz do lote 02.07 com 4 montados 1KB em série).
      // cancelFFmpeg já zera os dois; o kill do watchdog não zerava.
      loadingPromise = null;
    }
  });

  let lastErr: unknown = null;
  for (let i = 0; i < CDNS.length; i++) {
    const baseURL = CDNS[i];
    try {
      onStage?.('Carregando...');
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
    'Não consegui carregar o motor de vídeo. Confira sua internet e recarregue a página.',
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

/**
 * exec com rc virando ERRO. O exec do @ffmpeg/ffmpeg 0.12 NÃO lança quando o
 * ffmpeg falha — resolve normalmente com rc≠0 (descoberto no Normalizador,
 * 13.08). Sem esta conversão, todo helper tratava falha como sucesso e podia
 * ler/entregar uma saída truncada ou cair num erro críptico do readFile
 * (família do bug "montado 1KB"). Use em todo exec cuja SAÍDA será lida;
 * probes que toleram rc≠0 por design (readDurationFromLogs, silencedetect)
 * chamam ff.exec direto e tratam o rc no local.
 */
async function execOrThrow(ff: FFmpeg, args: string[], ctx: string): Promise<void> {
  const rc = await ff.exec(args);
  if (rc !== 0) throw new Error(`ffmpeg falhou (rc=${rc}) em ${ctx}`);
}

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
    const encodeArgs = (withAudio: boolean) => [
      '-i', inputName,
      '-filter:v', `setpts=PTS/${speed}`,
      ...(withAudio
        ? ['-filter:a', atempoChain(speed), '-c:a', 'aac', '-b:a', '128k']
        : ['-an']),
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'fastdecode',
      '-crf', '23',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputName,
    ];
    try {
      await execOrThrow(ff, encodeArgs(true), 'aceleração do vídeo');
      const data = await ff.readFile(outputName);
      assertValidMp4(data as Uint8Array, 'vídeo acelerado');
      return toBlob(data, 'video/mp4');
    } catch (e) {
      // Cancelamento/watchdog (instância morta) não tem retry que salve.
      const msg = e instanceof Error ? e.message : String(e);
      if (/terminat|abort|cancel|travad|travou/i.test(msg)) throw e;
      // Vídeo SEM trilha de áudio: o -filter:a derruba o exec inteiro. Uma
      // re-tentativa sem áudio salva o job em vez de falhar com erro cru.
      await safeDelete(ff, outputName);
      await execOrThrow(ff, encodeArgs(false), 'aceleração do vídeo (sem áudio)');
      const data = await ff.readFile(outputName);
      assertValidMp4(data as Uint8Array, 'vídeo acelerado');
      return toBlob(data, 'video/mp4');
    }
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
    await execOrThrow(ff, args, 'aceleração do áudio');
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
    await execOrThrow(ff, args, 'extração do áudio');
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
    await execOrThrow(ff, args, 'compressão do vídeo');
    const data = await ff.readFile(outputName);
    // Sem isto, um encode que estourou a memória do wasm entregava MP4
    // truncado (sem moov) como job "done" — o cliente baixava arquivo morto.
    assertValidMp4(data as Uint8Array, 'vídeo comprimido');
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
    await execOrThrow(ff, [
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
    ], 'troca do áudio do vídeo');
    const data = await ff.readFile(outputName);
    // GARANTIA (mesma política do concat/corte, fix 2026-07-03): instância
    // zumbi/OOM pode "terminar" com a saída TRUNCADA — valida ANTES de
    // devolver. O erro sobe pro retry do caller (a camuflagem re-tenta com
    // instância limpa) em vez de entregar um vídeo que não abre.
    assertValidMp4(data as Uint8Array, 'vídeo com áudio trocado');
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
    await execOrThrow(ff, [
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
      // 256k: a voz já vem nivelada (prepareVoiceForDecupagem), então este
      // re-encode do corte é a última geração AAC — bitrate alto o mantém
      // transparente (sem acumular artefato/"xiado" do tandem-encode).
      '-b:a', '256k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outName,
    ], 'corte dos segmentos');
  }

  const batchOutputs: string[] = [];
  try {
    await ff.writeFile(inputName, await fetchFile(file));

    // Caminho rápido: poucos segmentos → 1 passada só (comportamento antigo).
    if (segments.length <= MAX_SEGMENTS_PER_PASS) {
      await cutBatch(segments, 'out.mp4');
      const data = await ff.readFile('out.mp4');
      await safeDelete(ff, 'out.mp4');
      assertValidMp4(data as Uint8Array, 'vídeo decupado');
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

    // O input já cumpriu o papel (todos os lotes cortados) — sai do MEMFS
    // ANTES do concat pra devolver o heap dele (o finally re-deleta sem dor).
    await safeDelete(ff, inputName);

    // Concatena os sub-vídeos via concat demuxer. Como cada batch saiu com
    // codec/SR/dimensões idênticos (mesmo encode), o -c copy junta sem dor.
    const listName = 'cut_concat_list.txt';
    const list = batchOutputs.map((n) => `file '${n}'`).join('\n');
    await ff.writeFile(listName, new TextEncoder().encode(list));
    opts.onStage?.(`Juntando ${numBatches} lotes decupados...`);
    await execOrThrow(ff, [
      '-fflags', '+genpts',
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      'out.mp4',
    ], 'junção dos lotes decupados');
    const data = await ff.readFile('out.mp4');
    await safeDelete(ff, listName);
    await safeDelete(ff, 'out.mp4');
    assertValidMp4(data as Uint8Array, 'vídeo decupado');
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    for (const n of batchOutputs) await safeDelete(ff, n);
  }
}

// ---------- Decupagem GRANDE sem servidor: dividir → processar → juntar ---
//
// Arquivo grande não cabe com folga no ffmpeg-wasm de uma vez (heap ~2GB; o
// pipeline chega a precisar de ~3× o tamanho do arquivo em memória). Em vez
// de servidor pago, o arquivo é DIVIDIDO em partes de ~160MB com `-c copy`
// (segment muxer: sem re-encode, sem perda, cada pacote vai pra EXATAMENTE
// uma parte — contíguo, sem duplicar nem pular frame), cada parte passa pelo
// pipeline normal da decupagem e os resultados são JUNTADOS com o mesmo
// concat demuxer que o cutVideoSegments já usa nos lotes internos.
//
// O pulo do gato é o WORKERFS: o arquivo ORIGINAL é MONTADO no FS do wasm e
// lido por streaming direto do disco do cliente — SEM ocupar o heap. Só as
// partes de saída ocupam memória. Se o mount não existir no core (raro), cai
// num fallback via MEMFS com teto de segurança — e acima do teto devolve um
// erro humano em vez de estourar memória e corromper.

// Alvo de ~160MB por parte: o pipeline (nivelar + cortar) precisa de ~3× a
// parte em memória → pico ~500MB, folga enorme contra o teto de ~2GB do wasm.
export const DECUP_CHUNK_TARGET_BYTES = 160 * 1024 * 1024;

// Teto do fallback SEM WORKERFS (arquivo inteiro no MEMFS + partes = 2×).
const CHUNK_FALLBACK_BYTE_CAP = 420 * 1024 * 1024;

/**
 * Planeja a divisão: devolve os tempos de corte INTERIORES (segundos,
 * crescentes). Vazio = arquivo cabe numa parte só. Função PURA (testável):
 * nº de partes por TAMANHO (teto por parte), cortes por TEMPO proporcional.
 */
export function planDecupChunks(sizeBytes: number, durationSec: number): number[] {
  const count = Math.max(1, Math.ceil(sizeBytes / DECUP_CHUNK_TARGET_BYTES));
  if (count === 1 || !Number.isFinite(durationSec) || durationSec <= 1) return [];
  const step = durationSec / count;
  const times: number[] = [];
  for (let i = 1; i < count; i++) times.push(Math.round(i * step * 1000) / 1000);
  return times;
}

/** Container das partes por extensão do original (sempre `-c copy`). */
export function chunkContainerFor(srcExt: string): { ext: string; format: string } {
  const e = (srcExt || '').toLowerCase();
  if (e === 'mp4' || e === 'mov' || e === 'm4a') return { ext: 'mp4', format: 'mp4' };
  if (e === 'webm') return { ext: 'webm', format: 'webm' };
  if (e === 'mkv') return { ext: 'mkv', format: 'matroska' };
  if (e === 'mp3') return { ext: 'mp3', format: 'mp3' };
  if (e === 'wav') return { ext: 'wav', format: 'wav' };
  // Resto (aac/ogg/opus/flac...): matroska aceita qualquer codec em -c copy;
  // o decodeAudioRobust lê .mka pelo fallback FFmpeg sem drama.
  return { ext: 'mka', format: 'matroska' };
}

/** Lê a duração pelo log do ffmpeg (exec sem output imprime "Duration:"). */
async function readDurationFromLogs(ff: FFmpeg, path: string): Promise<number> {
  let dur = 0;
  const h = ({ message }: { message: string }) => {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(message);
    if (m) {
      const d = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
      if (d > dur) dur = d;
    }
  };
  ff.on('log', h);
  try {
    await ff.exec(['-hide_banner', '-i', path]);
  } catch { /* exit != 0 é esperado (sem output) — o log já saiu */ } finally {
    ff.off('log', h);
  }
  return dur;
}

/**
 * Disponibiliza blobs pro ffmpeg SEM ocupar heap: monta WORKERFS (leitura por
 * streaming do disco). Fallback = MEMFS com teto (acima do teto: erro humano,
 * nunca corrupção silenciosa). Retorna o dir e um cleanup idempotente.
 */
async function makeInputsAvailable(
  ff: FFmpeg,
  entries: Array<{ name: string; data: Blob }>,
): Promise<{ dir: string; mounted: boolean; cleanup: () => Promise<void> }> {
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const mdir = `/decupmnt_${uniq}`;
  try {
    await ff.createDir(mdir);
    await ff.mount(
      'WORKERFS' as unknown as Parameters<FFmpeg['mount']>[0],
      { blobs: entries } as Parameters<FFmpeg['mount']>[1],
      mdir,
    );
    console.log('[decup-chunked] WORKERFS montado (input fora do heap).');
    return {
      dir: mdir,
      mounted: true,
      cleanup: async () => {
        try { await ff.unmount(mdir); } catch { /* já desmontado */ }
        try { await ff.deleteDir(mdir); } catch { /* já removido */ }
      },
    };
  } catch (e) {
    if (isCancellationError(e)) throw e;
    try { await ff.unmount(mdir); } catch { /* nunca montou */ }
    try { await ff.deleteDir(mdir); } catch { /* nunca criou */ }
    console.warn('[decup-chunked] WORKERFS indisponível — fallback MEMFS:', (e as Error)?.message);
  }
  const total = entries.reduce((a, x) => a + x.data.size, 0);
  if (total > CHUNK_FALLBACK_BYTE_CAP) {
    throw new Error(
      'Esse arquivo é pesado demais pra preparar no navegador nesse aparelho. Comprime o vídeo no Compressor e tenta de novo.',
    );
  }
  const { fetchFile } = await import('@ffmpeg/util');
  const wdir = `/decupmem_${uniq}`;
  await ff.createDir(wdir);
  for (const e2 of entries) {
    await ff.writeFile(`${wdir}/${e2.name}`, await fetchFile(e2.data));
  }
  return {
    dir: wdir,
    mounted: false,
    cleanup: async () => {
      for (const e2 of entries) await safeDelete(ff, `${wdir}/${e2.name}`);
      try { await ff.deleteDir(wdir); } catch { /* ok */ }
    },
  };
}

/**
 * Divide um arquivo grande em partes de ~160MB SEM re-encode (segment muxer,
 * corte em keyframe, partes contíguas). Retorna Files nomeados em ordem.
 */
export async function splitMediaForChunks(
  file: Blob,
  opts: RunOptions = {},
): Promise<File[]> {
  const srcExt = guessExt(file, 'mp4');
  const { ext: chunkExt, format: chunkFormat } = chunkContainerFor(srcExt);

  // Duração: HTMLVideo primeiro (rápido, sem wasm); fallback = log do ffmpeg.
  let durationSec = (await probeVideoMetadata(file))?.durationSec || 0;

  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { dir, cleanup } = await makeInputsAvailable(ff, [{ name: `in.${srcExt}`, data: file }]);
  const inputPath = `${dir}/in.${srcExt}`;
  const progressHandler = wireProgress(ff, opts.onProgress);
  const made: string[] = [];
  try {
    if (durationSec <= 0) durationSec = await readDurationFromLogs(ff, inputPath);
    if (durationSec <= 0) {
      throw new Error('Não consegui ler a duração do arquivo (arquivo corrompido?).');
    }

    const times = planDecupChunks(file.size, durationSec);
    if (times.length === 0) {
      // Cabe numa parte só — nada a dividir.
      return [new File([file], `decup_chunk_000.${srcExt}`, { type: file.type || undefined })];
    }

    opts.onStage?.(`Dividindo em ${times.length + 1} partes (sem re-encode)...`);
    const rc = await ff.exec([
      '-i', inputPath,
      '-map', '0:v?', '-map', '0:a?', '-dn', '-sn',
      '-c', 'copy',
      '-f', 'segment',
      '-segment_times', times.map((t) => t.toFixed(3)).join(','),
      '-reset_timestamps', '1',
      '-segment_format', chunkFormat,
      `decup_chunk_%03d.${chunkExt}`,
    ]);
    if (rc !== 0) {
      throw new Error('Não consegui dividir esse arquivo (formato não suportado pra divisão).');
    }

    // Lê as partes em ORDEM e apaga cada uma JÁ, liberando o heap aos poucos.
    const mimeOut = chunkExt === 'mp4' ? 'video/mp4' : chunkExt === 'webm' ? 'video/webm' : chunkExt === 'mp3' ? 'audio/mpeg' : chunkExt === 'wav' ? 'audio/wav' : 'application/octet-stream';
    const parts: File[] = [];
    for (let i = 0; ; i++) {
      const name = `decup_chunk_${String(i).padStart(3, '0')}.${chunkExt}`;
      let data: Uint8Array | string;
      try {
        data = await ff.readFile(name);
      } catch {
        break; // primeiro índice ausente = fim das partes
      }
      made.push(name);
      parts.push(new File([toBlob(data, mimeOut)], name, { type: mimeOut }));
      await safeDelete(ff, name);
    }
    if (parts.length === 0) {
      throw new Error('A divisão do arquivo não produziu partes (arquivo corrompido?).');
    }
    return parts;
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    for (const n of made) await safeDelete(ff, n);
    await cleanup();
  }
}

/**
 * Junta os RESULTADOS decupados das partes num arquivo final, com `-c copy`
 * (as partes saem do MESMO encode → codecs/params idênticos, mesma técnica
 * já validada no concat de lotes do cutVideoSegments).
 */
export async function concatDecupChunks(
  parts: Blob[],
  format: 'mp4' | 'mp3' | 'wav',
  opts: RunOptions = {},
): Promise<Blob> {
  if (parts.length === 0) throw new Error('Nenhuma parte pra juntar.');
  if (parts.length === 1) return parts[0];

  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const entries = parts.map((p, i) => ({
    name: `part_${String(i).padStart(3, '0')}.${format}`,
    data: p,
  }));
  const { dir, cleanup } = await makeInputsAvailable(ff, entries);
  const progressHandler = wireProgress(ff, opts.onProgress);
  const listName = 'decup_join_list.txt';
  const outName = `decup_join_out.${format}`;
  try {
    opts.onStage?.(`Juntando ${parts.length} partes...`);
    const list = entries.map((e) => `file '${dir}/${e.name}'`).join('\n');
    await ff.writeFile(listName, new TextEncoder().encode(list));
    const args: string[] = [];
    if (format === 'mp4') args.push('-fflags', '+genpts');
    args.push('-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy');
    if (format === 'mp4') args.push('-avoid_negative_ts', 'make_zero', '-movflags', '+faststart');
    args.push(outName);
    const rc = await ff.exec(args);
    if (rc !== 0) throw new Error('Não consegui juntar as partes decupadas.');
    const data = await ff.readFile(outName);
    if (format === 'mp4') assertValidMp4(data as Uint8Array, 'vídeo decupado');
    return toBlob(
      data,
      format === 'mp4' ? 'video/mp4' : format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
    );
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, listName);
    await safeDelete(ff, outName);
    await cleanup();
  }
}

// ---------- Corte por TEMPO + mux de áudio (removedor de legenda) --------
//
// O motor de remoção de legenda só aceita trechos curtos, então o vídeo é
// picado em pedaços ≤~alvo (por keyframe, SEM re-encode = rápido/grande),
// cada pedaço é limpo e no fim tudo é juntado + o ÁUDIO ORIGINAL é re-muxado
// (o áudio de cada pedaço tem micro-gap nas emendas; o original é contínuo).
// Tudo com WORKERFS pra aguentar arquivos grandes fora do heap.

/** Lê o frame rate (fps) do vídeo pelo log do ffmpeg. 0 se não achar. */
async function probeFps(ff: FFmpeg, path: string): Promise<number> {
  let fps = 0;
  const h = ({ message }: { message: string }) => {
    // "... 30 fps, 30 tbr ..." — pega o "fps" (não o tbr).
    const m = /(\d+(?:\.\d+)?)\s*fps\b/.exec(message);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 0 && v <= 240) fps = v;
    }
  };
  ff.on('log', h);
  try {
    await ff.exec(['-hide_banner', '-i', path]);
  } catch {
    /* rc≠0 esperado (sem output) — o log já saiu */
  } finally {
    ff.off('log', h);
  }
  return fps;
}

/** Detecta se o arquivo tem faixa de áudio (via log do ffmpeg). */
async function probeHasAudio(ff: FFmpeg, path: string): Promise<boolean> {
  let hasAudio = false;
  const h = ({ message }: { message: string }) => {
    if (/Stream #\d+:\d+.*: Audio:/.test(message)) hasAudio = true;
  };
  ff.on('log', h);
  try {
    await ff.exec(['-hide_banner', '-i', path]);
  } catch {
    /* rc≠0 esperado (sem output) — o log já saiu */
  } finally {
    ff.off('log', h);
  }
  return hasAudio;
}

/** Overlap (s) entre trechos vizinhos: cada trecho leva um pedacinho do começo
 *  do próximo pro motor, pra o crossfade na junção ter conteúdo dos DOIS lados
 *  do mesmo instante (é o que apaga o salto de reconstrução na emenda). */
export const SEG_OVERLAP_SEC = 1.0;
/** Duração do crossfade na junção (s). Curto = imperceptível, mas suaviza o
 *  salto. Precisa caber no overlap com folga. */
export const SEG_XFADE_SEC = 0.4;

export type SplitResult = {
  /** Trechos na ORDEM, cada um com ~SEG_OVERLAP_SEC a mais no fim (menos o último). */
  parts: File[];
  /** offsets[i] = duração NOMINAL do trecho i (ponto onde começa o overlap com
   *  o trecho i+1). Um valor por emenda (parts.length-1 no total). O join usa
   *  a soma acumulada como offset do xfade — alinhamento EXATO, sem depender de
   *  onde os keyframes caíram. */
  offsets: number[];
};

/**
 * Pica um vídeo em trechos de ~maxSec com OVERLAP entre vizinhos, tudo por
 * keyframe (`-c copy` = rápido, sem re-encode, sem perda). Estratégia:
 *   1. Segment muxer contíguo (cortes EXATOS em keyframe) → mede as durações
 *      reais → conhece os pontos de junção com precisão (offsets).
 *   2. A cada trecho (menos o último) ANEXA a cabeça (~overlap s) do trecho
 *      seguinte. Como os segmentos vêm do MESMO encode do original, esse concat
 *      é `-c copy` limpo. Assim o overlap existe SEM re-encodar nada.
 * O motor reconstrói cada trecho (incluindo o overlap); na junção, o crossfade
 * funde as duas reconstruções do mesmo instante → emenda imperceptível.
 * Distribui uniforme (nº mínimo de trechos). Vídeo ≤ teto → 1 trecho, sem overlap.
 */
export async function splitVideoByTime(
  file: Blob,
  maxSec = 25,
  hardLimitSec = 29,
  opts: RunOptions = {},
): Promise<SplitResult> {
  const srcExt = guessExt(file, 'mp4');
  const { ext: chunkExt, format: chunkFormat } = chunkContainerFor(srcExt);
  const overlap = SEG_OVERLAP_SEC;

  let durationSec = (await probeVideoMetadata(file))?.durationSec || 0;

  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { dir, cleanup } = await makeInputsAvailable(ff, [{ name: `in.${srcExt}`, data: file }]);
  const inputPath = `${dir}/in.${srcExt}`;
  const progressHandler = wireProgress(ff, opts.onProgress);
  const made: string[] = [];
  try {
    if (durationSec <= 0) durationSec = await readDurationFromLogs(ff, inputPath);
    if (durationSec <= 0) throw new Error('Não consegui ler a duração do vídeo (arquivo corrompido?).');

    // Cabe num trecho só → nada a picar (sem overlap, sem emenda).
    if (durationSec <= hardLimitSec + 0.5) {
      return { parts: [new File([file], `seg_000.${srcExt}`, { type: file.type || undefined })], offsets: [] };
    }

    // Distribui uniforme; o nominal por trecho deixa folga pro overlap caber no teto.
    const usable = Math.max(6, maxSec - overlap);
    const numParts = Math.max(2, Math.ceil(durationSec / usable));
    const segTime = durationSec / numParts;

    opts.onStage?.('Preparando o vídeo...');
    const rc = await ff.exec([
      '-i', inputPath,
      '-map', '0:v?', '-map', '0:a?', '-dn', '-sn',
      '-c', 'copy',
      '-f', 'segment',
      '-segment_time', segTime.toFixed(3),
      '-reset_timestamps', '1',
      '-segment_format', chunkFormat,
      `seg_%03d.${chunkExt}`,
    ]);
    if (rc !== 0) throw new Error('Não consegui preparar esse vídeo (formato não suportado).');

    const mimeOut = chunkExt === 'mp4' ? 'video/mp4' : chunkExt === 'webm' ? 'video/webm' : chunkExt === 'mkv' ? 'video/x-matroska' : 'video/mp4';
    // Coleta os nomes dos segmentos contíguos (ficam no FS) e mede as durações.
    const segNames: string[] = [];
    const segDurs: number[] = [];
    for (let i = 0; ; i++) {
      const name = `seg_${String(i).padStart(3, '0')}.${chunkExt}`;
      let data: Uint8Array | string;
      try {
        data = await ff.readFile(name);
      } catch {
        break;
      }
      made.push(name);
      segNames.push(name);
      const d = data instanceof Uint8Array ? data : new Uint8Array();
      segDurs.push((await probeVideoMetadata(new Blob([toBlob(d, mimeOut)])))?.durationSec || segTime);
    }
    if (segNames.length === 0) throw new Error('A preparação do vídeo não produziu trechos.');

    // Monta cada trecho = segmento + cabeça (overlap) do próximo. O último vai
    // sem overlap. Concat -c copy (mesmo encode → limpo). offsets = durações
    // nominais dos trechos que têm emenda depois (todos menos o último).
    const parts: File[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < segNames.length; i++) {
      if (i === segNames.length - 1) {
        const data = await ff.readFile(segNames[i]);
        parts.push(new File([toBlob(data as Uint8Array, mimeOut)], `part_${i}.${chunkExt}`, { type: mimeOut }));
        break;
      }
      // cabeça (~overlap) do próximo segmento
      const headName = `head_${i}.${chunkExt}`;
      await ff.exec(['-i', segNames[i + 1], '-t', String(overlap + 0.5), '-c', 'copy', '-y', headName]);
      // concat segmento + cabeça
      const listName = `cl_${i}.txt`;
      const outName = `part_${i}.${chunkExt}`;
      await ff.writeFile(listName, new TextEncoder().encode(`file '${segNames[i]}'\nfile '${headName}'\n`));
      const crc = await ff.exec(['-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', '-y', outName]);
      let partData: Uint8Array;
      if (crc === 0) {
        partData = (await ff.readFile(outName)) as Uint8Array;
      } else {
        // fallback raríssimo: manda o segmento sem overlap (a junção cai no
        // concat simples pra essa emenda, mas nunca falha).
        partData = (await ff.readFile(segNames[i])) as Uint8Array;
      }
      parts.push(new File([toBlob(partData, mimeOut)], outName, { type: mimeOut }));
      offsets.push(segDurs[i]);
      await safeDelete(ff, headName);
      await safeDelete(ff, listName);
      await safeDelete(ff, outName);
    }
    return { parts, offsets };
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    for (const n of made) await safeDelete(ff, n);
    await cleanup();
  }
}

/**
 * Junta os trechos limpos e re-muxa o ÁUDIO ORIGINAL. Quando há overlap
 * (offsets preenchidos), a junção é um CROSSFADE encadeado nos pontos exatos —
 * apaga o salto de reconstrução do motor na emenda (imperceptível), mantendo a
 * duração e a sincronia. 1 trecho só (vídeo curto) → sem re-encode do vídeo
 * (qualidade intacta), só troca o áudio. O áudio original é contínuo (zero
 * clique de emenda), ancorado em t=0; drift residual vira um atempo imperceptível.
 */
export async function joinCleanedWithOriginalAudio(
  cleanedParts: Blob[],
  original: Blob,
  offsets: number[] = [],
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const srcExt = guessExt(original, 'mp4');

  // ── monta o VÍDEO final (xfade se houver overlap; senão o trecho único) ──
  const useXfade = cleanedParts.length > 1 && offsets.length === cleanedParts.length - 1;

  const entries: Array<{ name: string; data: Blob }> = cleanedParts.map((p, i) => ({ name: `cp_${i}.mp4`, data: p }));
  entries.push({ name: `orig.${srcExt}`, data: original });
  const { dir, cleanup } = await makeInputsAvailable(ff, entries);
  const progressHandler = wireProgress(ff, opts.onProgress);
  const origPath = `${dir}/orig.${srcExt}`;
  const outName = 'final_join.mp4';
  try {
    const hasAudio = await probeHasAudio(ff, origPath);
    const A = (await probeVideoMetadata(original))?.durationSec || 0;

    if (!useXfade) {
      // 1 trecho: vídeo intacto (copy), só re-muxa o áudio original.
      if (cleanedParts.length === 1) {
        const vPath = `${dir}/cp_0.mp4`;
        if (!hasAudio) return cleanedParts[0];
        const V = (await probeVideoMetadata(cleanedParts[0]))?.durationSec || 0;
        const factor = V > 0 && A > 0 ? A / V : 1;
        const useTempo = Number.isFinite(factor) && Math.abs(factor - 1) > 0.0005 && factor >= 0.5 && factor <= 2;
        const args = ['-i', vPath, '-i', origPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'];
        if (useTempo) args.push('-af', atempoChain(factor));
        args.push('-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', '-y', outName);
        await execOrThrow(ff, args, 'mux do áudio (trecho único)');
        const data = await ff.readFile(outName);
        assertValidMp4(data as Uint8Array, 'vídeo final');
        return toBlob(data, 'video/mp4');
      }
      // fallback (offsets ausentes): concat simples + mux.
      const videoOnly = await concatDecupChunks(cleanedParts, 'mp4', opts);
      return muxAudioOnly(ff, dir, videoOnly, origPath, hasAudio, A, outName, opts);
    }

    // ── CROSSFADE encadeado nos offsets acumulados ──
    opts.onStage?.('Finalizando...');
    const n = cleanedParts.length;
    const inputs: string[] = [];
    for (let i = 0; i < n; i++) { inputs.push('-i', `${dir}/cp_${i}.mp4`); }
    inputs.push('-i', origPath);

    // O motor devolve trechos com FPS levemente diferentes entre si (ex.: 30 vs
    // 29.97) e o xfade EXIGE fps idêntico nos dois lados → normaliza TODOS pro
    // fps do vídeo original antes de cruzar (settb=AVTB alinha o timebase junto).
    const fps = (await probeFps(ff, origPath)) || 30;
    const norm: string[] = [];
    for (let i = 0; i < n; i++) norm.push(`[${i}:v]fps=${fps},settb=AVTB[n${i}]`);

    // filtro: encadeia xfade; offset acumulado = soma das durações nominais.
    let acc = 0;
    const chain: string[] = [...norm];
    let prev = 'n0';
    for (let i = 1; i < n; i++) {
      acc += offsets[i - 1];
      const out = i === n - 1 ? 'vout' : `vx${i}`;
      chain.push(`[${prev}][n${i}]xfade=transition=fade:duration=${SEG_XFADE_SEC}:offset=${acc.toFixed(3)}[${out}]`);
      prev = out;
    }
    chain.push(`[vout]format=yuv420p[vf]`);
    const filter = chain.join(';');

    const audioIdx = n; // o áudio original é o último input
    const args = [
      ...inputs,
      '-filter_complex', filter,
      '-map', '[vf]',
    ];
    if (hasAudio) args.push('-map', `${audioIdx}:a:0`, '-c:a', 'aac', '-b:a', '160k');
    args.push(
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-shortest', '-y', outName,
    );
    await execOrThrow(ff, args, 'crossfade das emendas + mux');
    const data = await ff.readFile(outName);
    assertValidMp4(data as Uint8Array, 'vídeo final');
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, outName);
    await cleanup();
  }
}

/** Mux só do áudio original num vídeo já montado (fallback do concat simples). */
async function muxAudioOnly(
  ff: FFmpeg,
  dir: string,
  videoOnly: Blob,
  origPath: string,
  hasAudio: boolean,
  audioDur: number,
  outName: string,
  opts: RunOptions,
): Promise<Blob> {
  if (!hasAudio) return videoOnly;
  await ff.writeFile('vonly.mp4', await (await import('@ffmpeg/util')).fetchFile(videoOnly));
  const V = (await probeVideoMetadata(videoOnly))?.durationSec || 0;
  const factor = V > 0 && audioDur > 0 ? audioDur / V : 1;
  const useTempo = Number.isFinite(factor) && Math.abs(factor - 1) > 0.0005 && factor >= 0.5 && factor <= 2;
  opts.onStage?.('Finalizando...');
  const args = ['-i', 'vonly.mp4', '-i', origPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy'];
  if (useTempo) args.push('-af', atempoChain(factor));
  args.push('-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', '-y', outName);
  await execOrThrow(ff, args, 'mux do áudio original');
  const data = await ff.readFile(outName);
  assertValidMp4(data as Uint8Array, 'vídeo final');
  await safeDelete(ff, 'vonly.mp4');
  return toBlob(data, 'video/mp4');
}

// ---------- Normalizador de Volume --------------------------------------
//
// A implementacao real (motor de duas passadas) esta mais abaixo, junto de
// `normalizeVolume`. Veja o bloco de doc do LEVEL_PREFILTER / normalizeVolume
// para a estrategia completa (medição EBU R128 na passada 1 + ganho ESTÁTICO
// medido + brickwall na passada 2 — ver buildFinalGain).

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

// Teto de bytes do audio enviado ao servidor (limite Vercel ~4.4MB, com
// folga pra overhead do container opus).
const TRANSCRIBE_AUDIO_BUDGET_BYTES = 3_800_000;

/**
 * Calcula o MAIOR bitrate de audio (kbps) que ainda cabe no budget pra dada
 * duracao. Audio melhor = ASR mais preciso (menos erro de marca, timestamps
 * mais confiaveis). Vai de 12kbps (videos longos, ~40min) ate 64kbps
 * (videos curtos), onde a qualidade ja e' excelente pra fala.
 *
 * ⚠ O teto e' 64, nao 128: o encode roda com `-vbr on`, entao o `-b:a` e' uma
 * MEDIA, nao um limite — audio denso estoura o nominal. Um AD de 3:46 saiu com
 * 4.3MB pedindo 128k (nominal 3.6MB) e bateu no limite de 4.4MB do servidor.
 * Em mono 16kHz, opus ja e' transparente pra fala bem antes de 64k, entao
 * baixar o teto nao custa precisao de ASR nenhuma — so' tira o risco de estouro.
 */
export function pickTranscribeBitrateKbps(durationSec?: number): number {
  if (!durationSec || durationSec <= 0) return 64;
  const maxBps = (TRANSCRIBE_AUDIO_BUDGET_BYTES * 8) / durationSec;
  const kbps = Math.floor(maxBps / 1000);
  return Math.max(12, Math.min(64, kbps));
}

export async function extractAudioForTranscription(
  file: Blob,
  opts: RunOptions = {},
  durationSec?: number,
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.opus';
  const progressHandler = wireProgress(ff, opts.onProgress);

  // Bitrate adaptativo: maximiza a qualidade sem estourar o limite do servidor.
  const kbps = pickTranscribeBitrateKbps(durationSec);
  // Acima de ~24k vale o modo 'audio' (preserva timbre/consoantes); abaixo, o
  // 'voip' e' mais inteligivel no bitrate baixo.
  const application = kbps >= 24 ? 'audio' : 'voip';

  try {
    opts.onStage?.('Carregando...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.(`Extraindo audio (${kbps}kbps) pra transcricao...`);
    await execOrThrow(ff, [
      '-i', inputName,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', `${kbps}k`,
      '-ac', '1',
      '-ar', '16000',
      '-application', application,
      '-vbr', 'on',
      outputName,
    ], 'extração do áudio pra transcrição');
    const data = await ff.readFile(outputName);
    return toBlob(data, 'audio/ogg');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Audio pra DIARIZAÇÃO (speaker_labels) — diferente da transcrição:
 * separar locutores depende do TIMBRE da voz, e o opus 12k 'voip' da
 * extractAudioForTranscription apaga exatamente essas características
 * (otimiza só inteligibilidade) → AssemblyAI confundia Doutor com
 * Depoimento (user reportou 2026-06-11: fragmentos do Doutor rotulados
 * como a mulher). 48kbps modo 'audio' preserva o timbre: ~360KB/min,
 * então até ~12min de AD cabem no limite de 4.5MB do Vercel.
 */
export async function extractAudioForDiarization(
  file: Blob,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out_diar.opus';
  const progressHandler = wireProgress(ff, opts.onProgress);

  try {
    opts.onStage?.('Carregando...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.('Extraindo...');
    await execOrThrow(ff, [
      '-i', inputName,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ac', '1',
      '-ar', '16000',
      '-application', 'audio',
      '-vbr', 'on',
      outputName,
    ], 'extração do áudio pra diarização');
    const data = await ff.readFile(outputName);
    return toBlob(data, 'audio/ogg');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Igual à extractAudioForTranscription, mas mantém os DOIS canais (estéreo) intactos — sem
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
    opts.onStage?.('Extraindo...');
    await ff.writeFile(inputName, await fetchFile(file));
    await execOrThrow(ff, [
      '-i', inputName,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-ac', '2',
      '-ar', '16000',
      '-application', 'audio',
      outputName,
    ], 'extração do áudio estéreo');
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
    opts.onStage?.('Carregando...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.('Escaneando cortes de cena (1 passada)...');
    // 1a passada: usa scdet (Scene Change Detection) que e mais
    // assertivo que select=gt(scene,N) — usa color histogram, nao
    // so luminance diff. Threshold scdet vai de 0-100 (default 10).
    // Mapeamos nosso 0.05-0.95 (compat com UI antiga) → 5-95.
    const scdetThreshold = Math.round(threshold * 100);
    // rc≠0 aqui = scan que nem rodou (decode/filtro quebrado) — sem esta
    // checagem o resultado era "0 cortes" e o vídeo inteiro voltava como 1
    // take único, parecendo sucesso.
    await execOrThrow(ff, [
      '-i', inputName,
      '-filter:v', `scdet=threshold=${scdetThreshold}`,
      '-an',
      '-f', 'null',
      '-',
    ], 'scan de cortes de cena');

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
      await execOrThrow(ff, [
        '-ss', seg.start.toFixed(3),
        '-to', seg.end.toFixed(3),
        '-i', inputName,
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        '-movflags', '+faststart',
        outName,
      ], `extração do take ${i + 1}`);
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
    opts.onStage?.('Carregando...');
    await ff.writeFile(inputName, await fetchFile(file));

    opts.onStage?.('Aplicando...');
    await execOrThrow(ff, [
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
    ], 'remoção das regiões');
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
    await execOrThrow(ff, [
      '-ss', timeSec.toFixed(2),
      '-i', inputName,
      '-vframes', '1',
      '-vf', `scale=${maxW}:-2:flags=fast_bilinear`,
      '-q:v', String(q),
      outputName,
    ], 'extração do frame');
    const data = await ff.readFile(outputName);
    return toBlob(data, 'image/jpeg');
  } finally {
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Pré-filtros de leveling — aplicados IDÊNTICOS na passada de análise e na
 * de aplicação, pra que os valores medidos pelo loudnorm batam com o que o
 * loudnorm realmente recebe na hora de aplicar (requisito do two-pass).
 *
 *  1. `highpass=f=75`   — corta rumble (ar-condicionado, mesa, plosivas
 *                          graves) abaixo da fundamental da voz.
 *  2. [denoise]         — prefixado em runtime (RNNoise/afftdn), ANTES do
 *                          leveling, pra limpar o chão de ruído primeiro.
 *  3. `dynaudnorm`      — leveling MACRO: traz cada trecho pro mesmo nível
 *                          percebido com janela gaussiana suave (g=17 ~3.4s),
 *                          sem bombear o ruído das pausas. m=8 / r=0.6 (RMS).
 *  4. `speechnorm`      — leveling MICRO específico de FALA: iguala meia-onda
 *                          a meia-onda. É o que fecha a diferença entre uma
 *                          voz alta e uma baixa. Calibrado NATURAL:
 *                          · e=6  → expansão moderada (não vira "loudness war")
 *                          · c=2  → compressão das partes altas
 *                          · t=0.001 → threshold baixíssimo de propósito: a
 *                            voz baixa PRECISA estar acima do threshold pra
 *                            ser equalizada; quem protege o ruído é o denoise
 *                            (passo 2), não o threshold.
 *                          · r=f=0.0008 → subida/descida de ganho suave, sem
 *                            clique/distorção.
 *
 * Medido (caso extremo, gap de 16 LUFS entre as 2 vozes): a diferença cai pra
 * ~2.7 LUFS (quase imperceptível) mantendo LRA ~4.5 (dinâmica natural de voz).
 *
 * Depois, o estágio de ganho FINAL (buildFinalGain) crava a loudness em -16
 * LUFS com true-peak -1.5dB aplicando um ganho ESTÁTICO medido + brickwall —
 * NUNCA loudnorm dinâmico (que bombeava as pausas = ET/fade). Ver buildFinalGain.
 */
// Leveling completo (macro + micro de fala). É o preferido.
const LEVEL_FULL =
  'dynaudnorm=f=200:g=17:p=0.9:m=8:r=0.6:s=6,' +
  'speechnorm=p=0.95:e=6:c=2:t=0.001:r=0.0008:f=0.0008';
// Leveling de segurança (só macro) — usado se o speechnorm não existir no
// build. Continua equalizando bem, só um pouco menos cirúrgico.
const LEVEL_SAFE = 'dynaudnorm=f=200:g=17:p=0.9:m=8:r=0.6:s=6';

// Leveling do perfil 'natural' (DECUPAGEM + nivelamento por-parte do HeyGen).
// IGUALA o volume parte-a-parte ("ajeitar parte a parte") SEM bombear o ruído:
//   · m=4   → maxgain capado (+12dB). Era m=8 (+18dB) — o que inflava o chão de
//             ruído de um áudio baixo virando "voz de ET". Capar mata isso.
//   · s=0   → ZERO compressão (s=6 era um compressor extra que criava artefato).
//   · r=0.9 → alvo RMS alto: equaliza bem palavra-baixa↔palavra-alta.
// O ganho ABSOLUTO final é ESTÁTICO (ver buildFinalGain) — nunca loudnorm
// dinâmico. Medido (ffmpeg nativo, voz a -53 LUFS + chiado): com o motor antigo
// o gap fala↔ruído nas pausas caía pra 0dB (ruído no nível da fala = "ET"); com
// este, fica em +13dB (ruído limpo bem abaixo da fala). Sem fade/swell.
const LEVEL_NATURAL = 'dynaudnorm=f=200:g=17:p=0.9:m=4:r=0.9:s=0';

// --- Reforço pra caso EXTREMO (só o perfil 'full' do Normalizador) ----------
// Se APÓS o leveling padrão a medição da passada 1 ainda acusar LRA alto
// (oscilação macro residual — ex.: 2 vozes MUITO díspares alternando, tipo
// -22dB↔0dB), encadeia um 2º dynaudnorm RÁPIDO (janela g=7×f=100 ≈ 0.7s vs
// 3.4s do 1º estágio) COM GATE: t=0.02 (≈-34dBFS) impede que pausas/ruído
// sejam amplificados — só FALA é nivelada. Medido (voz TTS real, blocos
// -22dB↔0dB, LRA de entrada 22.2 LU): cadeia padrão sozinha → LRA 11.8 e
// piso -48.8; + este estágio → LRA 3.5 com piso -52.4 (intacto). Variantes
// sem o gate t chegavam ao mesmo LRA mas BOMBEAVAM o piso pra -33 ("ET").
// s=0 (sem compressão extra) → não robotiza; o ganho final segue ESTÁTICO
// (re-medido com a cadeia reforçada). Arquivo normal nunca entra aqui —
// caminho padrão intocado.
const EXTREME_LRA_LU = 8;
const LEVEL_EXTREME_STAGE2 = 'dynaudnorm=f=100:g=7:p=0.95:m=10:r=0.8:s=0:t=0.02';

// Alvo de loudness final (padrão broadcast/streaming pra voz).
const LOUDNORM_TARGET = 'I=-16:TP=-1.5:LRA=11';

// --- Estágio de ganho FINAL: ESTÁTICO (um único ganho), nunca dinâmico. ------
// O loudnorm two-pass, mesmo com linear=true, CAÍA pra modo dinâmico em quase
// todo arquivo (a aplicação do ganho linear estouraria o true-peak → ffmpeg
// volta pro dinâmico) e o dinâmico BOMBEava as pausas: o ruído subia até o
// nível da fala (a "voz de ET" em áudio baixo) e as partes baixas "incham"
// depois das altas (os FADES que o user reclamou). A correção é aplicar um
// ganho fixo medido + um brickwall de true-peak, garantindo que cada pausa
// fique EXATAMENTE o mesmo tanto abaixo da fala — sem swell, sem ET, sem fade.
const LOUDNESS_TARGET_LUFS = -16;
const TRUE_PEAK_TARGET_DB = -1.5;
// Quanto de ganho EXTRA além do "no-clip" o limiter pode cobrir. Deixa arquivos
// normais chegarem em -16 (o limiter segura os picos) sem blast em áudio quieto.
const LIMITER_HEADROOM_DB = 6;
// Teto ABSOLUTO de ganho. Voz baixa real (ex.: -53 LUFS) precisa de ~+37dB e
// passa de boa; acima disso o arquivo é basicamente mudo/quebrado e amplificar
// só inflaria ruído. Backstop pra nunca "blastar" um input patológico.
const MAX_STATIC_GAIN_DB = 40;
// Brickwall true-peak a -1.5 dBTP (limit linear = 10^(-1.5/20) ≈ 0.841).
// level=false → NÃO auto-normaliza (só corta pico). Transparente na fala.
// (`false` é o token bool canônico — válido em qualquer build, incl. o WASM.)
const TRUE_PEAK_LIMITER =
  'alimiter=level_in=1:level_out=1:limit=0.841:level=false:attack=5:release=50';

/**
 * Monta o estágio de ganho FINAL a partir da loudness/true-peak JÁ medidos do
 * sinal pré-filtrado (input_i / input_tp do loudnorm da passada 1). Ganho:
 *   ganho = min( alvoLUFS − I ,  (alvoTP − TP) + headroom )
 * Sem medição (raro) cai no loudnorm de sempre — não pior que hoje.
 */
function computeStaticGainDb(
  stats: LoudnormStats | null,
  withLimiter: boolean,
): number | null {
  if (!stats) return null;
  const inI = parseFloat(stats.input_i);
  const inTP = parseFloat(stats.input_tp);
  const gainToTarget = LOUDNESS_TARGET_LUFS - (Number.isFinite(inI) ? inI : LOUDNESS_TARGET_LUFS);
  const headroom = withLimiter ? LIMITER_HEADROOM_DB : 0;
  const gainNoClip =
    TRUE_PEAK_TARGET_DB - (Number.isFinite(inTP) ? inTP : TRUE_PEAK_TARGET_DB) + headroom;
  return Math.min(gainToTarget, gainNoClip, MAX_STATIC_GAIN_DB);
}

function buildFinalGain(stats: LoudnormStats | null, withLimiter: boolean): string {
  const gainDb = computeStaticGainDb(stats, withLimiter);
  if (gainDb === null) return `loudnorm=${LOUDNORM_TARGET}`;
  const vol = `volume=${gainDb.toFixed(2)}dB`;
  return withLimiter ? `${vol},${TRUE_PEAK_LIMITER}` : vol;
}

// Candidatos de DENOISE (limpeza de ruído de fundo), em ordem de qualidade.
// Tudo roda LOCAL (no navegador), sem custo e sem subir áudio pra nuvem.
//
//  1. RNNoise (`arnndn`) — denoiser por REDE NEURAL treinada em voz, o melhor
//     pra fala. Crucial pro requisito "NUNCA robótico": a rede foi treinada
//     pra PRESERVAR a fala, então NÃO cria o "musical noise"/metálico/warbling
//     que a subtração espectral (afftdn) pode criar. `mix=0.85` = 85% limpo +
//     15% original — a margem de sinal seco preservado é a garantia extra de
//     naturalidade. `aresample=48000` porque o RNNoise é treinado a 48kHz.
//     Medido (voz real + hiss pesado): hiss -35.8dB → -45.9dB, ABAIXO do piso
//     natural da voz (-43.4dB), com a banda da voz preservada em ~0.3dB.
//     NÃO encadear afftdn aqui: o ganho era só ~1.6dB de hiss (o RNNoise já
//     resolve) e afftdn é o filtro com maior risco de soar robótico.
//  2. `afftdn` puro — só como FALLBACK quando o modelo RNNoise não carrega
//     (raro; o .rnnn está em public/models). nr=12 gentil pra minimizar
//     artefato mesmo nesse caminho.
//  3. '' — sem denoise (último recurso; nunca deixa o tool falhar).
const DENOISE_ARNNDN = 'aresample=48000,arnndn=m=denoise.rnnn:mix=0.85';
const DENOISE_AFFTDN = 'afftdn=nr=12:nf=-35:tn=1';

/**
 * Monta o pré-filtro completo: highpass (rumble) → [denoise] → leveling.
 * O denoise vem ANTES do leveling pra que ele não realce um ruído que já
 * podia ter sido removido.
 */
function buildPrefilter(denoise: string, level: string): string {
  const parts = ['highpass=f=75'];
  if (denoise) parts.push(denoise);
  parts.push(level);
  return parts.join(',');
}

// Uma falha de init do arnndn (modelo corrompido/instalação estranha) vem
// como ABORT do ffmpeg — e cada abort degrada a instância WASM (single
// thread; abortos repetidos terminam em "memory access out of bounds").
// Depois da 1ª falha, paramos de insistir no arnndn NESTA sessão: cai direto
// pro afftdn, sem novos aborts.
let arnndnFailedThisSession = false;

/**
 * Tenta carregar o modelo RNNoise (public/models/denoise.rnnn) no FS do
 * FFmpeg. Retorna a string do filtro `arnndn` se conseguir, senão null —
 * nesse caso o pipeline cai pro `afftdn`, que não precisa de modelo.
 */
async function loadDenoiseModel(ff: FFmpeg): Promise<string | null> {
  if (arnndnFailedThisSession) return null;
  try {
    // TIMEOUT curto (8s): sem teto, se o Service Worker/rede travar (típico quando a
    // aba volta do background e o SW re-registra) este fetch consumia os 150s do
    // withTimeout do leveling da PARTE → a parte saía SEM nivelamento (volumes
    // desiguais) sem erro visível, multiplicando por N partes. 8s é folgado pra um
    // arquivo estático local; ao estourar, cai no DENOISE_AFFTDN (não precisa modelo).
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 8_000);
    try {
      const res = await fetch('/models/denoise.rnnn', { signal: ac.signal });
      if (!res.ok) return null;
      let buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 1024) return null; // arquivo vazio/erro de rota
      // VALIDA que é mesmo um modelo RNNoise: o header canônico começa com
      // "rnnoise". Sem isso, uma resposta 200 que NÃO é o modelo (redirect de
      // auth devolvendo HTML do login, página de erro de CDN) ia direto pro
      // arnndn → abort do ffmpeg → instância WASM degradada (a raiz do
      // "memory access out of bounds" em lote).
      const head = String.fromCharCode(...buf.slice(0, 7)).toLowerCase();
      if (head !== 'rnnoise') return null;
      // O modelo é TEXTO ASCII parseado byte-exato pelo arnndn: um \r de CRLF
      // (autocrlf do git no Windows, proxy que reescreve, etc.) quebra o
      // "Error initializing filter 'arnndn'". Normaliza pra LF sempre.
      if (buf.includes(13)) buf = buf.filter((b) => b !== 13);
      await ff.writeFile('denoise.rnnn', buf);
      return DENOISE_ARNNDN;
    } finally {
      clearTimeout(to);
    }
  } catch {
    return null;
  }
}

export type NormalizeOutFormat = 'mp4' | 'mp3' | 'wav';

/**
 * O que o motor DECIDIU nesse arquivo — alimenta o relatório do Normalizador
 * (badges "IA denoise", "reforço extremo", ganho aplicado). Só informativo:
 * nenhum caller é obrigado a consumir.
 */
export type NormalizeEngineInfo = {
  /** Denoise usado: rede neural (rnnoise), espectral (afftdn) ou nenhum. */
  denoise: 'rnnoise' | 'afftdn' | 'none';
  /** true quando o 2º estágio de caso extremo entrou na cadeia. */
  extremeMode: boolean;
  /** Ganho estático final aplicado (dB); null se a medição da passada 1 falhou. */
  gainDb: number | null;
  /** true se o brickwall de true-peak (−1.5 dBTP) ficou na saída final. */
  limiterOn: boolean;
  /** Medição EBU R128 do sinal pré-filtrado (passada 1). */
  measuredLufs: number | null;
  measuredLra: number | null;
  measuredTruePeakDb: number | null;
};

type LoudnormStats = {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
};

/**
 * Extrai o bloco JSON impresso pelo `loudnorm=print_format=json` das linhas
 * de log do FFmpeg. O JSON do loudnorm é plano (sem chaves aninhadas), então
 * varremos do fim pro começo pegando o último `{...}` que contém input_i.
 */
function parseLoudnormStats(logText: string): LoudnormStats | null {
  const blocks = logText.match(/\{[^{}]*\}/g);
  if (!blocks) return null;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (!blocks[i].includes('input_i')) continue;
    try {
      const j = JSON.parse(blocks[i]);
      if (
        j &&
        typeof j.input_i === 'string' &&
        typeof j.target_offset === 'string'
      ) {
        return j as LoudnormStats;
      }
    } catch {
      /* tenta o proximo bloco */
    }
  }
  return null;
}


/**
 * Equaliza o volume de vozes diferentes num mesmo arquivo E limpa o ruído
 * de fundo, em qualidade máxima. Motor de DUAS PASSADAS (EBU R128):
 *
 *   Passada 1 — análise: roda denoise + leveling + loudnorm em modo
 *     `print_format=json` jogando a saída no muxer null. Lê a loudness e o
 *     true-peak reais JÁ com o pré-filtro aplicado (input_i / input_tp).
 *   Passada 2 — aplicação: mesmo pré-filtro + ganho ESTÁTICO medido
 *     (`volume` + brickwall true-peak) → crava -16 LUFS / -1.5 dBTP SEM
 *     bombear pausa nenhuma. Nada de loudnorm dinâmico (a causa do "ET" em
 *     áudio baixo e dos fades/swells). Ver buildFinalGain.
 *
 * Escada de fallback dupla — denoise (RNNoise → afftdn → nenhum) × leveling
 * (full com speechnorm → safe só dynaudnorm). Tenta a melhor combinação e
 * vai degradando até uma rodar; se a medição falhar, o ganho final cai pro
 * loudnorm de sempre. Ou seja: NUNCA devolve erro por causa de um filtro
 * indisponível ou da medição.
 *
 * Caso típico: vídeo com 2 avatares — um gravado alto, outro baixo, com
 * chiado de fundo. Sai daqui com ambos no mesmo nível confortável, natural,
 * limpo, sem ruído inflado.
 *
 * - MP4: mantém o vídeo SEM perda (`-c:v copy`, com fallback de re-encode
 *   só se o stream for incompatível com o container mp4, ex.: webm/vp9).
 * - MP3/WAV: descarta o vídeo e gera só o áudio normalizado.
 */
/**
 * Perfil de leveling:
 *  - 'full'    → macro (dynaudnorm) + micro de FALA (speechnorm). É o mais
 *                agressivo a igualar timbres/níveis MUITO diferentes (ex.: 2
 *                vozes num arquivo). Usado pelo Normalizador.
 *  - 'natural' → SÓ macro (dynaudnorm capado m=4) + ganho final ESTÁTICO. Sem
 *                speechnorm — o filtro que mais "marca"/processa a voz. É o
 *                perfil da DECUPAGEM e do nivelamento por-parte do HeyGen:
 *                regula o nível e limpa o ruído de forma transparente, iguala
 *                parte-a-parte, sem robotizar e sem fade/ET.
 */
export type NormalizeProfile = 'full' | 'natural';

export async function normalizeVolume(
  file: Blob,
  params: {
    output: NormalizeOutFormat;
    profile?: NormalizeProfile;
    onEngineInfo?: (info: NormalizeEngineInfo) => void;
  },
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'in.' + guessExt(file, 'mp4');
  const outputName = 'out.' + params.output;

  try {
    opts.onStage?.('Carregando arquivo...');
    await ff.writeFile(inputName, await fetchFile(file));

    // Tenta carregar o modelo de IA de denoise; monta a ordem de candidatos.
    const arnndn = await loadDenoiseModel(ff);
    const denoises = [arnndn ?? DENOISE_AFFTDN, DENOISE_AFFTDN, ''].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    // Combinações (leveling × denoise) da melhor pra mais segura: primeiro o
    // leveling completo (com speechnorm) com cada denoise; depois o leveling
    // de segurança (só dynaudnorm), caso o speechnorm não exista no build.
    // No perfil 'natural' (decupagem/HeyGen): SÓ o LEVEL_NATURAL (dynaudnorm
    // capado m=4, sem speechnorm) → iguala parte-a-parte sem inflar ruído nem
    // robotizar. O ganho final é estático (buildFinalGain) — sem fade/ET.
    const levels = params.profile === 'natural' ? [LEVEL_NATURAL] : [LEVEL_FULL, LEVEL_SAFE];
    const candidates: Array<{ denoise: string; level: string }> = [];
    for (const level of levels) {
      for (const denoise of denoises) candidates.push({ denoise, level });
    }

    // -------- Passada 1: análise de loudness (two-pass) ------------------
    // Tenta cada combinação até uma rodar; a que rodar define o pré-filtro da
    // passada 2 (medição válida) e garante que todos os filtros funcionam.
    opts.onStage?.('Limpando ruído + analisando volume (1/2)...');
    let measured: LoudnormStats | null = null;
    let denoiseUsed = '';
    let levelUsed = LEVEL_SAFE;
    for (const cand of candidates) {
      const logLines: string[] = [];
      const logHandler = ({ message }: { message: string }) => {
        logLines.push(message);
      };
      try {
        ff.on('log', logHandler);
        let rc = -1;
        try {
          rc = await ff.exec([
            '-i', inputName,
            '-af', `${buildPrefilter(cand.denoise, cand.level)},loudnorm=${LOUDNORM_TARGET}:print_format=json`,
            '-f', 'null', '-',
          ]);
        } finally {
          ff.off('log', logHandler);
        }
        // CRÍTICO: o exec do ffmpeg-wasm NÃO lança quando o ffmpeg falha —
        // resolve com rc≠0. Sem esta checagem, um filtro indisponível
        // "vencia" a escada (combinação quebrada ia pra passada 2, que
        // gerava saída truncada de 1KB como se fosse sucesso).
        if (rc !== 0) {
          console.warn(
            `[ffmpeg-worker] normalizeVolume: combinação de filtros falhou (rc=${rc}) — tentando a próxima.`,
            logLines.slice(-8).join('\n'),
          );
          // arnndn quebrado aborta o ffmpeg e degrada a instância — não
          // insiste nele pelo resto da sessão (próximos jobs vão direto
          // pro afftdn, sem acumular aborts).
          if (cand.denoise === DENOISE_ARNNDN) arnndnFailedThisSession = true;
          continue;
        }
        // Exec rodou → essa combinação é válida. Usa ela na passada 2.
        denoiseUsed = cand.denoise;
        levelUsed = cand.level;
        measured = parseLoudnormStats(logLines.join('\n'));
        if (!measured) {
          // Exec rodou mas o parse do loudnorm falhou (log perdido/formato
          // diferente). buildFinalGain vai cair no loudnorm DINÂMICO — o
          // bombeamento (ET/fade) que esse refactor existe pra matar. É raro,
          // mas tem que ser visível no campo pra diagnosticar (não silencioso).
          console.warn('[ffmpeg-worker] normalizeVolume: medição de loudness não parseou — caindo no loudnorm dinâmico (ganho estático indisponível). Verificar formato do print_format=json no build WASM.');
        }
        break;
      } catch (e) {
        if (isCancellationError(e)) throw e;
        // Combinação falhou (ex.: filtro indisponível) — tenta a próxima.
        if (cand.denoise === DENOISE_ARNNDN) arnndnFailedThisSession = true;
      }
    }

    // -------- Escalada pra caso EXTREMO (só perfil 'full') ---------------
    // A medição da passada 1 é do sinal JÁ nivelado: se o LRA ainda passa do
    // teto, o leveling padrão não deu conta (oscilação brutal no original).
    // Re-mede com o 2º estágio encadeado; só troca a cadeia se a nova medição
    // parsear (senão segue exatamente como está — nunca pior que hoje).
    let extremeMode = false;
    if (params.profile !== 'natural' && measured) {
      const lraAfterLevel = parseFloat(measured.input_lra);
      if (Number.isFinite(lraAfterLevel) && lraAfterLevel > EXTREME_LRA_LU) {
        opts.onStage?.('Oscilação alta detectada — reforçando nivelamento...');
        const escalatedLevel = `${levelUsed},${LEVEL_EXTREME_STAGE2}`;
        const logLines: string[] = [];
        const logHandler = ({ message }: { message: string }) => {
          logLines.push(message);
        };
        try {
          ff.on('log', logHandler);
          let rc = -1;
          try {
            rc = await ff.exec([
              '-i', inputName,
              '-af', `${buildPrefilter(denoiseUsed, escalatedLevel)},loudnorm=${LOUDNORM_TARGET}:print_format=json`,
              '-f', 'null', '-',
            ]);
          } finally {
            ff.off('log', logHandler);
          }
          const reMeasured = rc === 0 ? parseLoudnormStats(logLines.join('\n')) : null;
          if (reMeasured) {
            measured = reMeasured;
            levelUsed = escalatedLevel;
            extremeMode = true;
          }
        } catch (e) {
          if (isCancellationError(e)) throw e;
          // Reforço indisponível → segue com a cadeia padrão já medida.
        }
      }
    }

    // -------- Passada 2: aplicação (ganho ESTÁTICO, nunca dinâmico) ------
    // filterFor(true)  = prefiltro + volume(ganho medido) + brickwall true-peak.
    // filterFor(false) = sem o limiter (ganho já é no-clip) — fallback se o
    //   alimiter não existir no build WASM. Garante que NUNCA volta pro loudnorm
    //   dinâmico (que bombeava as pausas = ET/fade), exceto se a medição falhou.
    const prefilter = buildPrefilter(denoiseUsed, levelUsed);
    const filterFor = (withLimiter: boolean) =>
      `${prefilter},${buildFinalGain(measured, withLimiter)}`;

    const progressHandler = wireProgress(ff, opts.onProgress);
    try {
      // exec com rc virando ERRO: o exec do wasm resolve com rc≠0 em falha
      // (não lança) — sem converter, a escada de fallback daqui nunca
      // dispararia e uma saída truncada passaria como sucesso.
      const execStrict = async (args: string[]) => {
        const rc = await ff.exec(args);
        if (rc !== 0) throw new Error(`ffmpeg falhou (rc=${rc}) na aplicação do ganho`);
      };

      const runApply = async (filter: string) => {
        if (params.output === 'mp4') {
          opts.onStage?.('Normalizando + remontando vídeo (2/2)...');
          // 1ª tentativa: copia o vídeo SEM reencode (lossless, rápido).
          const copyArgs = [
            '-i', inputName,
            '-af', filter,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '256k',
            '-movflags', '+faststart',
            outputName,
          ];
          try {
            await execStrict(copyArgs);
          } catch (e) {
            if (isCancellationError(e)) throw e;
            // Stream de vídeo incompatível com mp4 (ex.: webm/vp9). Reencoda.
            opts.onStage?.('Stream incompatível — remontando vídeo (2/2)...');
            await safeDelete(ff, outputName);
            await execStrict([
              '-i', inputName,
              '-af', filter,
              '-c:v', 'libx264',
              '-preset', 'veryfast',
              '-crf', '18',
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac',
              '-b:a', '256k',
              '-movflags', '+faststart',
              outputName,
            ]);
          }
        } else if (params.output === 'mp3') {
          opts.onStage?.('Normalizando e exportando MP3 (2/2)...');
          await execStrict([
            '-i', inputName, '-af', filter,
            '-vn', '-c:a', 'libmp3lame', '-q:a', '0',
            outputName,
          ]);
        } else {
          opts.onStage?.('Normalizando e exportando WAV (2/2)...');
          // pcm 24-bit, sem forçar sample-rate (preserva o do source → sem
          // resample desnecessário).
          await execStrict([
            '-i', inputName, '-af', filter,
            '-vn', '-c:a', 'pcm_s24le',
            outputName,
          ]);
        }
      };

      let limiterOn = true;
      try {
        await runApply(filterFor(true));
      } catch (e) {
        if (isCancellationError(e)) throw e;
        // alimiter indisponível (raro) → refaz sem o limiter; o ganho do
        // caminho sem-limiter já é no-clip, então segue seguro.
        await safeDelete(ff, outputName);
        await runApply(filterFor(false));
        limiterOn = false;
      }

      // Telemetria pro relatório (nunca derruba o processamento).
      if (params.onEngineInfo) {
        try {
          const inI = measured ? parseFloat(measured.input_i) : NaN;
          const inTP = measured ? parseFloat(measured.input_tp) : NaN;
          const inLRA = measured ? parseFloat(measured.input_lra) : NaN;
          params.onEngineInfo({
            denoise:
              denoiseUsed === DENOISE_ARNNDN
                ? 'rnnoise'
                : denoiseUsed === DENOISE_AFFTDN
                  ? 'afftdn'
                  : 'none',
            extremeMode,
            gainDb: computeStaticGainDb(measured, limiterOn),
            limiterOn,
            measuredLufs: Number.isFinite(inI) ? inI : null,
            measuredLra: Number.isFinite(inLRA) ? inLRA : null,
            measuredTruePeakDb: Number.isFinite(inTP) ? inTP : null,
          });
        } catch {
          /* callback do caller não pode quebrar o processamento */
        }
      }
    } finally {
      if (progressHandler) ff.off('progress', progressHandler);
    }

    const data = await ff.readFile(outputName);
    // GARANTIA: saída mp4 truncada (OOM/instância zumbi) vira ERRO aqui — quem
    // chama (prepareVoiceForDecupagem → regularVoz do pipeline) cai no arquivo
    // ORIGINAL em vez de levar um clipe quebrado pro concat da montagem (que
    // corromperia/derrubaria a montagem inteira de forma silenciosa).
    if (params.output === 'mp4') assertValidMp4(data as Uint8Array, 'vídeo nivelado');
    // Mesma garantia pra áudio: um mp3/wav de <1KB é lixo de exec abortado
    // (nem 0.1s de áudio cabe nisso) — erro honesto em vez de entrega muda.
    if (params.output !== 'mp4' && (data as Uint8Array).byteLength < 1024) {
      throw new Error('A saída de áudio veio truncada — tenta processar de novo.');
    }
    const mime =
      params.output === 'mp4'
        ? 'video/mp4'
        : params.output === 'mp3'
          ? 'audio/mpeg'
          : 'audio/wav';
    return toBlob(data, mime);
  } finally {
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

/**
 * Prepara a voz pra DECUPAGEM: regula o nível e limpa o ruído de forma
 * transparente (perfil 'natural' — denoise + dynaudnorm capado + ganho
 * ESTÁTICO, SEM speechnorm e SEM loudnorm dinâmico). É o passo que garante que:
 *   - voz baixa/alta sai sempre no mesmo nível confortável (-16 LUFS) →
 *     nenhuma parte vira "silêncio" e é cortada;
 *   - chiado/ruído de fundo (inclusive o que vem do HeyGen em alguns trechos)
 *     é removido ANTES de amplificar, então não há "xiado" inflado;
 *   - o ganho final é estático (sem bombeamento) → as pausas ficam sempre o
 *     mesmo tanto abaixo da fala: nada de "voz de ET" nem fade in/out;
 *   - sem compressão agressiva → nada de voz robótica.
 *
 * NUNCA lança: se o leveling falhar/timeout, devolve o arquivo ORIGINAL, pra a
 * decupagem seguir como antes (degradação graciosa, nunca pior que hoje).
 *
 * `format`: 'mp4' mantém o vídeo (`-c:v copy`); 'wav'/'mp3' só áudio.
 */
// ---------- Relatório antes × depois do Normalizador ----------------------

/** Sample-rate do PCM de análise do relatório (mono, s16le). */
export const REPORT_PCM_RATE = 8000;

export type ReportPcm = {
  /** PCM mono 16-bit (cópia própria, desacoplada do FS do WASM). */
  pcm: Int16Array;
  sampleRate: number;
  /** Medição EBU R128 REAL desse áudio (loudnorm print_format=json), se parseou. */
  loudnorm: LoudnormStats | null;
};

/**
 * Extrai os dados de análise pro relatório do Normalizador em UMA passada:
 * duas saídas no mesmo exec — (1) loudnorm em modo medição jogado no muxer
 * null (LUFS/true-peak/LRA reais do arquivo, sem alterar nada) e (2) PCM
 * mono 8kHz s16le pro desenho das ondas/curvas no navegador.
 *
 * 8kHz mono é de sobra pra envelope visual e métricas de janela (fala vive
 * abaixo de 4kHz), e mantém a memória pequena (~1MB/min). Se a passada
 * combinada falhar (muxer/filtro indisponível), cai num decode simples sem a
 * medição — o relatório usa então só as métricas calculadas em JS.
 */
export async function extractReportPcm(
  file: Blob,
  opts: RunOptions = {},
): Promise<ReportPcm> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'rep_in.' + guessExt(file, 'mp4');
  const outputName = 'rep_out.pcm';

  try {
    await ff.writeFile(inputName, await fetchFile(file));

    let loudnorm: LoudnormStats | null = null;
    let gotPcm = false;

    const logLines: string[] = [];
    const logHandler = ({ message }: { message: string }) => {
      logLines.push(message);
    };
    ff.on('log', logHandler);
    try {
      // -vn nas DUAS saídas: sem ele, um mp4 decodaria o vídeo inteiro só
      // pra jogar fora no muxer null (lento à toa em vídeo longo).
      const rc = await ff.exec([
        '-i', inputName,
        '-vn', '-af', `loudnorm=${LOUDNORM_TARGET}:print_format=json`, '-f', 'null', '-',
        '-vn', '-af', `aresample=${REPORT_PCM_RATE}`, '-ac', '1', '-c:a', 'pcm_s16le', '-f', 's16le', outputName,
      ]);
      if (rc === 0) {
        gotPcm = true;
        loudnorm = parseLoudnormStats(logLines.join('\n'));
      } else {
        console.warn(
          '[ffmpeg-worker] extractReportPcm: passada combinada rc=' + rc,
          logLines.slice(-25).join('\n'),
        );
      }
    } catch (e) {
      if (isCancellationError(e)) throw e;
      console.warn('[ffmpeg-worker] extractReportPcm: passada combinada lançou:', e, logLines.slice(-25).join('\n'));
    } finally {
      ff.off('log', logHandler);
    }

    if (!gotPcm) {
      // Fallback: só o PCM (relatório sai sem a medição EBU, nunca sem gráfico).
      await safeDelete(ff, outputName);
      const fbLines: string[] = [];
      const fbHandler = ({ message }: { message: string }) => {
        fbLines.push(message);
      };
      ff.on('log', fbHandler);
      let rc = -1;
      try {
        rc = await ff.exec([
          '-i', inputName,
          '-vn', '-ac', '1', '-ar', String(REPORT_PCM_RATE),
          '-c:a', 'pcm_s16le', '-f', 's16le', outputName,
        ]);
      } finally {
        ff.off('log', fbHandler);
      }
      if (rc !== 0) {
        console.warn(
          '[ffmpeg-worker] extractReportPcm: fallback rc=' + rc,
          fbLines.slice(-25).join('\n'),
        );
        throw new Error('Não consegui decodar o áudio pro relatório.');
      }
    }

    const data = (await ff.readFile(outputName)) as Uint8Array;
    // Cópia alinhada (byteOffset do FS pode não ser múltiplo de 2).
    const bytes = new Uint8Array(data.byteLength);
    bytes.set(data);
    const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
    return { pcm, sampleRate: REPORT_PCM_RATE, loudnorm };
  } finally {
    await safeDelete(ff, inputName);
    await safeDelete(ff, outputName);
  }
}

export async function prepareVoiceForDecupagem(
  file: Blob,
  opts: RunOptions = {},
  format: NormalizeOutFormat = 'mp4',
): Promise<Blob> {
  try {
    opts.onStage?.('Regulando a voz (nível + limpeza)...');
    return await normalizeVolume(file, { output: format, profile: 'natural' }, opts);
  } catch (e) {
    if (isCancellationError(e)) throw e;
    console.warn('[ffmpeg-worker] prepareVoiceForDecupagem falhou, usando áudio original:', (e as Error)?.message);
    return file;
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

// ---------- Validação de integridade do MP4 -------------------------------
//
// Rede de segurança: se o encode estourar a memória do navegador (arquivo
// grande), o ffmpeg-wasm pode "terminar" mas deixar a saída TRUNCADA — sem o
// átomo `moov` (o índice). Esse é exatamente o arquivo que "não abre". Em vez
// de entregar lixo, validamos a estrutura ANTES de devolver e, se estiver
// quebrado, lançamos um erro CLARO. Pior caso = aviso honesto, nunca um MP4
// corrompido silencioso.

/** Procura a assinatura de 4 bytes de um átomo MP4 dentro de um trecho. */
function scanAtom(data: Uint8Array, sig: string, from: number, to: number): boolean {
  const s0 = sig.charCodeAt(0), s1 = sig.charCodeAt(1), s2 = sig.charCodeAt(2), s3 = sig.charCodeAt(3);
  const end = Math.min(to, data.length) - 3;
  for (let i = Math.max(0, from); i < end; i++) {
    if (data[i] === s0 && data[i + 1] === s1 && data[i + 2] === s2 && data[i + 3] === s3) return true;
  }
  return false;
}

/**
 * Garante que `data` é um MP4 estruturalmente íntegro (ftyp + moov + mdat).
 * Lança erro humano se estiver truncado/vazio. Exportada pra ser testável.
 *
 * Como SEMPRE gravamos com `-movflags +faststart`, o `moov` fica no começo do
 * arquivo — mas varremos o início E o fim por garantia (cobre o caso raro do
 * faststart não ter movido o índice).
 */
export function assertValidMp4(data: Uint8Array, ctx = 'vídeo'): void {
  if (!data || data.length < 4096) {
    throw new Error(
      `O ${ctx} saiu vazio/incompleto. O navegador provavelmente ficou sem memória com um arquivo grande — comprime o vídeo no Compressor e tenta de novo.`,
    );
  }
  // ftyp: todo MP4 abre com ele, nos primeiros bytes.
  const hasFtyp = scanAtom(data, 'ftyp', 0, 64);
  // moov: o índice. Sem ele o player não abre. Varre 64MB do início (faststart)
  // e, se não achar, os últimos 32MB (índice no fim).
  const FRONT = Math.min(data.length, 64 * 1024 * 1024);
  let hasMoov = scanAtom(data, 'moov', 0, FRONT);
  if (!hasMoov && data.length > FRONT) {
    hasMoov = scanAtom(data, 'moov', data.length - 32 * 1024 * 1024, data.length);
  }
  if (!hasFtyp || !hasMoov) {
    throw new Error(
      `O ${ctx} saiu corrompido (${!hasFtyp ? 'sem cabeçalho ftyp' : 'sem o índice moov'}). ` +
        `Não vou te entregar um arquivo que não abre: o vídeo é pesado demais pra processar no navegador. ` +
        `Comprime ele no Compressor primeiro e tenta de novo.`,
    );
  }
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
    await execOrThrow(ff, [
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
      '-b:a', '256k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      outputName,
    ], 'concat das partes do avatar');
    const data = await ff.readFile(outputName);
    // GARANTIA (fix 2026-07-03): valida a saída ANTES de devolver. Se a instância
    // ffmpeg estava zumbi/travou, o readFile pode voltar vazio/parcial — sem isto
    // um concat de 0/1KB virava "montagem OK" e era persistido. assertValidMp4
    // exige ≥4KB + ftyp + moov (toda montagem real tem) → o erro sobe pro catch
    // do pipeline, que marca errors.assemble e NÃO conta como okMontagens.
    assertValidMp4(data as Uint8Array, 'montagem do avatar');
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    for (const n of inputNames) await safeDelete(ff, n);
    await safeDelete(ff, outputName);
  }
}

/**
 * Re-encoda UMA parte pros params UNIFORMES da montagem (1080x1920@30, yuv420p,
 * aac 48k stereo). Usado pra normalizar cada parte INDIVIDUALMENTE antes de um
 * fast-concat (copy) — evita o concatAvatarParts monolitico (N inputs num
 * filter_complex de uma vez) que ESTOURA a memoria do ffmpeg-wasm em montagem
 * grande/multi-avatar (user reportou AD46: 13 partes, Avatar 1 + Avatar 2 com
 * codecs diferentes, concat falhava → "INCOMPLETO 0 montagens"). Memoria por
 * chamada = 1 parte pequena, nunca estoura.
 */
export async function normalizeForConcat(file: Blob, opts: RunOptions = {}): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');
  const inputName = 'norm_in.' + guessExt(file, 'mp4');
  const outputName = 'norm_out.mp4';
  const progressHandler = wireProgress(ff, opts.onProgress);
  try {
    await ff.writeFile(inputName, await fetchFile(file));
    await execOrThrow(ff, [
      '-i', inputName,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,setpts=PTS-STARTPTS',
      '-af', 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '22',
      '-x264-params', 'bframes=0:ref=1:rc-lookahead=10:aq-mode=1',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
      '-movflags', '+faststart',
      outputName,
    ], 'normalização da parte pro concat');
    const data = await ff.readFile(outputName);
    // GARANTIA (fix 2026-07-03): saída de instância zumbi vira erro, não parte
    // fantasma que corrompe o fast-concat seguinte (que copia sem re-encodar).
    assertValidMp4(data as Uint8Array, 'parte normalizada');
    return toBlob(data, 'video/mp4');
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    await safeDelete(ff, inputName);
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
    // rc≠0 vira throw → o caller cai no concatAvatarParts (re-encode), que é
    // exatamente a escada documentada acima pra partes divergentes.
    await execOrThrow(ff, [
      '-fflags', '+genpts',
      '-f', 'concat',
      '-safe', '0',
      '-i', listName,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '256k',
      '-af', 'aresample=async=1:first_pts=0',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
      outputName,
    ], 'concat rápido');
    const data = await ff.readFile(outputName);
    // GARANTIA (fix 2026-07-03): o fast-concat (-c:v copy) sobre instância zumbi
    // podia produzir MP4 sem moov/vazio e devolver "sucesso" → validamos aqui.
    // O caller (concatRobust/pipeline) cai no re-encode se isto lançar.
    assertValidMp4(data as Uint8Array, 'montagem (concat rápido)');
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
  await execOrThrow(ff, [
    '-ss', timeSec.toFixed(2),
    '-i', inputName,
    '-vframes', '1',
    '-vf', 'scale=384:-2:flags=fast_bilinear',
    '-q:v', '6',
    outName,
  ], 'extração do frame pra IA');
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

    await execOrThrow(ff, args, 'overlay dos segmentos lipsync');
    const data = await ff.readFile(outputName);
    // Saída truncada (OOM/instância zumbi) vira erro → o vaFFmpegRetry do
    // caller re-tenta com instância limpa em vez de entregar vídeo quebrado.
    assertValidMp4(data as Uint8Array, 'vídeo com lipsync aplicado');
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

// Quanto de cada silencio fica preservado em CADA borda ao remover a pausa.
// Mantem um respiro natural (sem corte seco) e protege a consoante inicial/
// final da fala adjacente de ser comida.
const SILENCE_KEEP_PAD = 0.08;

export async function removeAvatarSilences(
  file: Blob,
  toleranceSec = 0.05,
  opts: RunOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = 'avatar_in.' + guessExt(file, 'mp4');

  // ATENCAO (bug historico): NAO usar `silenceremove` (filtro so de audio) +
  // re-encode do video. Ele encurta SO o audio; o video mantem todos os frames
  // → audio e video dessincronizam progressivamente a cada pausa removida.
  //
  // Abordagem sync-safe: detecta os silencios (silencedetect), monta os
  // segmentos de FALA e corta video+audio EM LOCKSTEP via cutVideoSegments
  // (que trima [0:v] e [0:a] juntos). A sincronia e' preservada por construcao.

  let durationSec = 0;
  const silences: Array<{ start: number; end: number }> = [];
  let pendingStart: number | null = null;
  const logHandler = ({ message }: { message: string }) => {
    const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(message);
    if (dm) {
      const d = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]);
      if (d > durationSec) durationSec = d;
    }
    const ss = /silence_start:\s*(-?[\d.]+)/.exec(message);
    if (ss) pendingStart = Math.max(0, parseFloat(ss[1]));
    const se = /silence_end:\s*(-?[\d.]+)/.exec(message);
    if (se && pendingStart !== null) {
      const end = parseFloat(se[1]);
      if (end > pendingStart) silences.push({ start: pendingStart, end });
      pendingStart = null;
    }
    opts.onLog?.(message);
  };

  try {
    opts.onStage?.(`Detectando silencios (tolerancia ${toleranceSec}s)...`);
    await ff.writeFile(inputName, await fetchFile(file));

    ff.on('log', logHandler);
    let scanRc = -1;
    try {
      // -32dB = ruido ambiente; d = duracao minima do silencio pra contar.
      scanRc = await ff.exec([
        '-i', inputName,
        '-af', `silencedetect=noise=-32dB:d=${toleranceSec.toFixed(3)}`,
        '-f', 'null', '-',
      ]);
    } finally {
      ff.off('log', logHandler);
    }
    // Scan que falhou (rc≠0) pode ter parado no MEIO do arquivo — a lista de
    // silêncios estaria incompleta e o corte comeria fala válida. Fallback
    // real: devolve o original SEM cortar (remoção de silêncio é melhoria,
    // não requisito) — mesmo degrade já usado quando não há silêncio nenhum.
    if (scanRc !== 0) {
      console.warn(`[ffmpeg-worker] removeAvatarSilences: silencedetect falhou (rc=${scanRc}) — devolvendo o vídeo sem corte de silêncios.`);
      await safeDelete(ff, inputName);
      return file;
    }

    // Sem duracao confiavel ou sem silencios → nada a cortar, devolve original.
    if (durationSec <= 0 || silences.length === 0) {
      await safeDelete(ff, inputName);
      return file;
    }

    // Monta os segmentos a MANTER: fala + um respiro (SILENCE_KEEP_PAD) em
    // cada borda do silencio removido.
    silences.sort((a, b) => a.start - b.start);
    const keep: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const sil of silences) {
      const segEnd = Math.min(sil.end, sil.start + SILENCE_KEEP_PAD);
      if (segEnd > cursor + 0.05) keep.push({ start: cursor, end: segEnd });
      cursor = Math.max(segEnd, sil.end - SILENCE_KEEP_PAD);
    }
    if (durationSec - cursor > 0.05) keep.push({ start: cursor, end: durationSec });

    // Nada sobrou pra cortar (silencios curtos demais) → devolve original.
    if (keep.length === 0) {
      await safeDelete(ff, inputName);
      return file;
    }

    await safeDelete(ff, inputName);

    // Corte lockstep A/V — sincronia garantida por construcao.
    opts.onStage?.(`Removendo silencios (${keep.length} trechos de fala)...`);
    return await cutVideoSegments(file, keep, opts);
  } catch (e) {
    await safeDelete(ff, inputName);
    throw e;
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
        await execOrThrow(ff, [
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
        ], `recorte do take ${take.n}`);
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

        await execOrThrow(ff, [
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
        ], `montagem do take broll ${take.n}`);
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
    await execOrThrow(ff, [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatName,
      '-c', 'copy',
      '-movflags', '+faststart',
      concatedName,
    ], 'concat dos segmentos');

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
      await execOrThrow(ff, [
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
      ], 'processamento do hook');

      // Concat hook + concated
      const concatList2 = `file '${hookProcessed}'\nfile '${concatedName}'`;
      const concatName2 = 'concat2.txt';
      tempFiles.push(concatName2);
      await ff.writeFile(concatName2, new TextEncoder().encode(concatList2));

      await execOrThrow(ff, [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatName2,
        '-c', 'copy',
        '-movflags', '+faststart',
        finalWithHook,
      ], 'concat do hook');

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

      await execOrThrow(ff, [
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
      ], 'mix da música de fundo');
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
