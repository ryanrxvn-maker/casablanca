/**
 * lib/lipsync-preprocess — pre-processamento client-side pro lipsync.
 *
 * APROACH SINCRONIZADO: gera UM SO arquivo otimizado (mp4 com video
 * 720p@25fps + audio limpo embutido) e usa o MESMO arquivo como
 * video_url E audio_url no Sync.so. Sync.so extrai o audio do mp4
 * automaticamente → sincronia perfeita matematicamente garantida.
 *
 * Antes a gente gerava 2 arquivos separados (video opt + audio mp3)
 * que podiam ter durations ligeiramente diferentes apos o ffmpeg, o
 * que causava chunks dessincronizados (3 chunks video + 4 chunks
 * audio no caso TESTE LIP ME).
 *
 * VIDEO (mesmo arquivo final):
 *  - Resolucao 720p (lado maior 1280px) com aspect preservado
 *  - FPS 25 (lipsync nao precisa de 60fps)
 *  - libx264 CRF 23 preset veryfast + yuv420p
 *
 * AUDIO embutido no mesmo mp4:
 *  - highpass 80Hz + dynaudnorm leve + loudnorm I=-16
 *  - AAC 192k mono 44.1kHz (Sync.so processa mono melhor)
 *
 * NOTA: -shortest e -async 1 forcam alinhamento exato entre stream
 * de video e audio (evita drift de milissegundos).
 */

import { getFFmpeg, type FFLoadStage, type FFLog } from './ffmpeg-worker';

export interface PreprocessOptions {
  onStage?: FFLoadStage;
  onLog?: FFLog;
}

/**
 * Pre-processa video PARA LIPSYNC.
 *
 * Aceita:
 *  - File de video (mp4/mov) → otimiza tudo
 *  - File de audio (mp3/wav/m4a) + video separado → muxa audio limpo no video
 *
 * Quando audioOverride eh dado, o audio do video original eh descartado
 * e o audioOverride eh usado em vez disso (pos-processamento de limpeza).
 */
export async function preprocessForLipSync(
  videoFile: File,
  audioOverride: File | null,
  opts: PreprocessOptions = {},
): Promise<File> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const videoIn = `v_${uniq}.mp4`;
  const audioIn = audioOverride ? `a_${uniq}.${guessExt(audioOverride)}` : null;
  const outputName = `out_${uniq}.mp4`;

  await ff.writeFile(videoIn, await fetchFile(videoFile));
  if (audioIn && audioOverride) {
    await ff.writeFile(audioIn, await fetchFile(audioOverride));
  }

  /*
   * Comando ffmpeg unico que produz mp4 sincronizado:
   *
   *   - Stream video: do videoIn, aplica scale + fps + libx264
   *   - Stream audio: do audioIn (se override) OU do videoIn,
   *                   aplica highpass + dynaudnorm + loudnorm + aac mono
   *   - -shortest: corta no menor stream (garante mesma duracao)
   *   - -async 1: re-amostra audio pra alinhar com video (sem drift)
   */
  const args: string[] = ['-i', videoIn];
  if (audioIn) args.push('-i', audioIn);

  args.push(
    // Video filters
    '-vf', "scale='min(1280,iw)':-2,fps=25",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'fastdecode',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    // Audio filters
    '-af', 'highpass=f=80,dynaudnorm=p=0.9:m=10,loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '1',
    '-ar', '44100',
  );

  // Map streams: se tem audio override, audio vem do segundo input
  if (audioIn) {
    args.push('-map', '0:v:0', '-map', '1:a:0');
  } else {
    args.push('-map', '0:v:0', '-map', '0:a:0?'); // ? = opcional (caso video nao tenha audio)
  }

  args.push(
    '-shortest', // corta no menor stream
    '-async', '1', // alinha audio com video sem drift
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-y',
    outputName,
  );

  await ff.exec(args);

  const data = await ff.readFile(outputName);
  await safeDelete(ff, videoIn);
  if (audioIn) await safeDelete(ff, audioIn);
  await safeDelete(ff, outputName);

  const bytes: ArrayBuffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : new ArrayBuffer(0);
  return new File([bytes], videoFile.name.replace(/\.[^.]+$/, '_sync.mp4'), {
    type: 'video/mp4',
  });
}

function guessExt(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp3')) return 'mp3';
  if (name.endsWith('.wav')) return 'wav';
  if (name.endsWith('.m4a')) return 'm4a';
  if (name.endsWith('.aac')) return 'aac';
  if (name.endsWith('.ogg')) return 'ogg';
  if (name.endsWith('.flac')) return 'flac';
  if (name.endsWith('.mp4') || name.endsWith('.mov')) return 'mp4';
  return 'mp4';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeDelete(ff: any, name: string) {
  try {
    await ff.deleteFile(name);
  } catch {
    /* ignore */
  }
}

/* Compat: mantem nomes antigos pra nao quebrar imports */
export const preprocessVideo = (file: File, opts?: PreprocessOptions) =>
  preprocessForLipSync(file, null, opts);
export const preprocessAudio = (file: File, opts?: PreprocessOptions) =>
  preprocessForLipSync(file, file, opts);
