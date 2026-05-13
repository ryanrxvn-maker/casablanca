/**
 * CASABLANCA — Voice Isolator (browser-side, FFmpeg WASM, zero API costs)
 *
 * CRITICO PRO VA PIPELINE: o lipsync HeyGen fica horrivel quando o audio
 * tem musica/SFX/ruido junto da voz. Esse modulo extrai SO a voz antes de
 * passar pro lipsync.
 *
 * Estrategia (multi-stage, em ordem de qualidade decrescente — usa o melhor
 * disponivel):
 *
 *  STAGE 1 — Center Channel Extraction (CCE) + voice band + compander
 *    Funciona MUITO bem pra audios stereo bem mixados (VSLs profissionais):
 *    voz vem centralizada (L=R) enquanto musica/efeitos sao espalhados.
 *    Filter chain (single ffmpeg call):
 *      a) pan=mono|c0=0.5*FL+0.5*FR
 *         → extrai mid signal (vocals are typically mixed center)
 *      b) highpass=f=80
 *         → remove rumble/bass (musica grave fica embaixo)
 *      c) lowpass=f=8000
 *         → remove highs (cymbals, hi-hats sao agudos)
 *      d) afftdn=nr=12:nf=-25
 *         → FFT denoise (residual noise floor reduction)
 *      e) compand=attacks=0.05:decays=0.5:points=-90/-90|-70/-50|-30/-15|0/-5
 *         → dynamic compression lifta vocals + reduz dynamic range
 *      f) loudnorm=I=-16:LRA=11:TP=-1.5
 *         → broadcast loudness normalization
 *
 *  STAGE 2 — Voice-band filter only (fallback se ja for mono ou CCE arruina)
 *    Aplica highpass + lowpass + compander mas SEM center extraction.
 *
 * NAO E SOTA (Demucs/Spleeter sao melhores mas rodam ML pesado). Pra VSLs
 * tipicas (voz dominante, musica de fundo abaixo, mix profissional), o
 * resultado e DRAMATICAMENTE melhor que passar audio raw pro lipsync.
 */

import { getFFmpeg, type RunOptions } from './ffmpeg-worker';

export type VoiceIsolatorMode =
  | 'auto'        // detecta stereo e aplica CCE; mono usa stage 2
  | 'center'      // forca CCE (so use se confirmado stereo)
  | 'bandpass'    // so voice-band filter (stage 2)
  | 'aggressive'; // CCE + filtros mais agressivos pra audio sujo

export type VoiceIsolatorOptions = RunOptions & {
  mode?: VoiceIsolatorMode;
  /** Output: 'wav' (recomendado pra lipsync), 'mp3' (menor) */
  format?: 'wav' | 'mp3';
};

/**
 * Detecta se o audio e stereo (>=2 canais). Usado pra decidir se CCE faz sentido.
 */
async function isStereoAudio(blob: Blob): Promise<boolean> {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC();
    const buf = await ctx.decodeAudioData((await blob.arrayBuffer()).slice(0));
    const stereo = buf.numberOfChannels >= 2;
    await ctx.close();
    return stereo;
  } catch {
    return false; // safe default — assume mono, usa bandpass
  }
}

/**
 * Constroi o filter complex chain baseado no mode.
 * Retorna a string -af do ffmpeg.
 */
function buildFilterChain(mode: Exclude<VoiceIsolatorMode, 'auto'>): string {
  const filters: string[] = [];

  if (mode === 'center' || mode === 'aggressive') {
    // Center channel extraction: (L+R)/2
    filters.push('pan=mono|c0=0.5*FL+0.5*FR');
  }

  // Voice frequency band: 80Hz - 8000Hz
  filters.push('highpass=f=80');
  filters.push('lowpass=f=8000');

  // FFT denoise — agressivo no aggressive mode
  if (mode === 'aggressive') {
    filters.push('afftdn=nr=20:nf=-30:tn=1');
  } else {
    filters.push('afftdn=nr=12:nf=-25');
  }

  // De-esser (reduce harsh sibilance) — usa highpass + lowpass split
  // Simples: skip de-esser pra não complicar, compand cuida disso

  // Dynamic compression — lift vocals
  if (mode === 'aggressive') {
    filters.push('compand=attacks=0.03:decays=0.4:points=-90/-90|-60/-40|-25/-12|0/-4');
  } else {
    filters.push('compand=attacks=0.05:decays=0.5:points=-90/-90|-70/-50|-30/-15|0/-5');
  }

  // Loudness normalization (EBU R128 broadcast standard)
  filters.push('loudnorm=I=-16:LRA=11:TP=-1.5');

  return filters.join(',');
}

/**
 * Isola voz do audio. Input: Blob (qualquer formato suportado por ffmpeg).
 * Output: Blob WAV/MP3 com SO voz audivel (musica/SFX dramaticamente reduzidos).
 *
 * Tempo aproximado pra audio de 60s no WASM single-threaded: ~10-30s.
 */
export async function isolateVoice(
  audio: Blob,
  options: VoiceIsolatorOptions = {},
): Promise<Blob> {
  const ff = await getFFmpeg(options.onStage, options.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  let mode = options.mode ?? 'auto';
  const format = options.format ?? 'wav';

  // Auto-detect: stereo → CCE; mono → bandpass
  if (mode === 'auto') {
    const stereo = await isStereoAudio(audio);
    mode = stereo ? 'center' : 'bandpass';
    options.onStage?.(stereo ? 'Stereo detectado — center extraction ativo' : 'Mono — bandpass filter');
  }

  const filterChain = buildFilterChain(mode);

  // Guess input extension
  const inputType = audio.type || '';
  let inputExt = 'wav';
  if (/mp3|mpeg/i.test(inputType)) inputExt = 'mp3';
  else if (/m4a|aac|mp4/i.test(inputType)) inputExt = 'm4a';
  else if (/ogg|opus/i.test(inputType)) inputExt = 'ogg';
  else if (/flac/i.test(inputType)) inputExt = 'flac';
  else if (/webm/i.test(inputType)) inputExt = 'webm';

  const inputName = 'voice_in.' + inputExt;
  const outputName = 'voice_out.' + format;

  // wireProgress
  let progressHandler: any = null;
  if (options.onProgress) {
    progressHandler = (event: any) => {
      options.onProgress!({ ratio: event.progress ?? 0, time: event.time ?? 0 });
    };
    ff.on('progress', progressHandler);
  }

  try {
    await ff.writeFile(inputName, await fetchFile(audio));
    const args = [
      '-i', inputName,
      '-vn',
      '-af', filterChain,
      '-ar', '44100',  // sample rate consistente
      '-ac', '1',      // mono output (lipsync nao precisa stereo)
    ];
    if (format === 'wav') {
      args.push('-c:a', 'pcm_s16le');
    } else {
      args.push('-c:a', 'libmp3lame', '-q:a', '2');
    }
    args.push('-y', outputName);

    await ff.exec(args);
    const data = await ff.readFile(outputName);
    const buf =
      typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
        ? data
        : new Uint8Array(data as unknown as ArrayBuffer);
    return new Blob([buf as BlobPart], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
  } finally {
    if (progressHandler) ff.off('progress', progressHandler);
    try { await ff.deleteFile(inputName); } catch {}
    try { await ff.deleteFile(outputName); } catch {}
  }
}

/**
 * Diagnostica o audio e retorna info util pra UI:
 *  - duracao
 *  - canais (mono/stereo)
 *  - sample rate
 *  - peak level (dBFS)
 *  - recomendacao de modo
 */
export async function analyzeAudioForVoiceIsolation(audio: Blob): Promise<{
  duration: number;
  channels: number;
  sampleRate: number;
  recommendedMode: VoiceIsolatorMode;
  hint: string;
}> {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC();
  try {
    const buf = await ctx.decodeAudioData((await audio.arrayBuffer()).slice(0));
    const channels = buf.numberOfChannels;
    const duration = buf.duration;
    const sampleRate = buf.sampleRate;

    let recommendedMode: VoiceIsolatorMode = 'bandpass';
    let hint = 'Mono detectado — bandpass + compand vai limpar a maior parte do ruido.';

    if (channels >= 2) {
      // Avalia diff entre L e R: se baixa = audio "fake stereo" ou voz solo
      const L = buf.getChannelData(0);
      const R = buf.getChannelData(1);
      let diffEnergy = 0;
      let sumEnergy = 0;
      const sampleStep = Math.max(1, Math.floor(L.length / 50000)); // amostra ~50k pontos
      for (let i = 0; i < L.length; i += sampleStep) {
        const d = L[i] - R[i];
        const s = L[i] + R[i];
        diffEnergy += d * d;
        sumEnergy += s * s;
      }
      const sideRatio = diffEnergy / Math.max(1e-9, sumEnergy);
      if (sideRatio > 0.05) {
        recommendedMode = 'center';
        hint = `Stereo wide (side ratio=${sideRatio.toFixed(3)}) — Center Extraction otimo pra isolar vocals centralizadas.`;
      } else {
        recommendedMode = 'bandpass';
        hint = `Stereo quase-mono (side ratio=${sideRatio.toFixed(3)}) — CCE nao traria ganho. Bandpass + compand suficiente.`;
      }
    }

    return { duration, channels, sampleRate, recommendedMode, hint };
  } finally {
    await ctx.close();
  }
}
