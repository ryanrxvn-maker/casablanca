/**
 * lib/lipsync-preprocess — pre-processamento client-side pro lipsync.
 *
 * A qualidade do resultado do Sync.so v2 (lipsync-2) eh MUITO mais sensivel
 * ao input do que aos parametros do modelo. Esta lib aplica as transformacoes
 * que comprovadamente melhoram o output:
 *
 *   VIDEO:
 *   - Resolucao 720p (lado maior 1280px) — sweet spot qualidade/custo
 *   - FPS 25 (lipsync nao precisa de 60fps; output do Fal ja eh ~25fps)
 *   - Bitrate ~3 Mbps + CRF 23 — nitidez de dentes preservada
 *   - yuv420p — compat universal
 *
 *   AUDIO:
 *   - Extrai pra mp3 limpo (mesmo se input for video)
 *   - Highpass 80Hz — remove rumble/wind/fan que confunde o modelo
 *   - Normalize loudness -16 LUFS — voz no nivel certo
 *   - Mono 44.1kHz — Sync.so processa melhor mono
 *   - Bitrate 192k — qualidade de fonema preservada
 *
 * Tudo roda no client com ffmpeg.wasm que ja temos. Custo:
 * +10-30s no client por arquivo, MUITO mais qualidade no output.
 */

import { getFFmpeg, type FFLoadStage, type FFLog } from './ffmpeg-worker';

export interface PreprocessOptions {
  onStage?: FFLoadStage;
  onLog?: FFLog;
}

/**
 * Otimiza o video pro modelo de lipsync:
 *  - downscale pra 720p (lado maior = 1280) se for maior
 *  - 25fps
 *  - CRF 23, preset ultrafast (rapido no wasm sem perder qualidade
 *    perceptivel — diferenca medium→ultrafast pra video de talking head
 *    eh ~5% de tamanho, imperceptivel visualmente)
 */
export async function preprocessVideo(file: File, opts: PreprocessOptions = {}): Promise<File> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inputName = `vin_${uniq}.mp4`;
  const outputName = `vout_${uniq}.mp4`;

  await ff.writeFile(inputName, await fetchFile(file));

  // -vf chain:
  //   scale=-2:720:force_original_aspect_ratio=decrease — downscale pra
  //     720p mantendo aspect; -2 garante par. force_original_aspect_ratio
  //     impede aumentar se ja eh menor.
  //   fps=25 — fixa em 25fps; lipsync nao se beneficia de mais
  // -c:v libx264 com CRF 23 + ultrafast
  // -c:a aac 128k mono — audio limpo embutido (Sync.so vai extrair)
  await ff.exec([
    '-i', inputName,
    '-vf', "scale='min(1280,iw)':-2,fps=25",
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'fastdecode',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '1',
    '-ar', '44100',
    '-movflags', '+faststart',
    '-y',
    outputName,
  ]);

  const data = await ff.readFile(outputName);
  await safeDelete(ff, inputName);
  await safeDelete(ff, outputName);

  const bytes: ArrayBuffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : new ArrayBuffer(0);
  return new File([bytes], file.name.replace(/\.[^.]+$/, '_opt.mp4'), {
    type: 'video/mp4',
  });
}

/**
 * Otimiza o audio (ou extrai do video):
 *  - highpass 80Hz: remove rumble baixo (vento, fan, mesa)
 *  - dynaudnorm leve: emparelha voz alta/baixa sem distorcer transientes
 *  - loudnorm I=-16: padrao streaming, voz cai no "alvo" que o modelo espera
 *  - mp3 192k mono 44.1kHz: limpo, compatible com Sync.so
 */
export async function preprocessAudio(file: File, opts: PreprocessOptions = {}): Promise<File> {
  const ff = await getFFmpeg(opts.onStage, opts.onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ext = guessExt(file);
  const inputName = `ain_${uniq}.${ext}`;
  const outputName = `aout_${uniq}.mp3`;

  await ff.writeFile(inputName, await fetchFile(file));

  // -af chain (audio filter):
  //   highpass=f=80      — corta rumble
  //   dynaudnorm=p=0.9:m=10 — leve normalizacao dinamica (p=peak target,
  //                          m=max gain factor). Evita drift que dynaudnorm
  //                          tradicional causa.
  //   loudnorm=I=-16:TP=-1.5:LRA=11 — pass-1 (sem analise dupla pra
  //                                   speed), alvo broadcast/streaming
  //   highpass de novo no fim — pra garantir que loudnorm nao re-adicionou
  //                            rumble por brick-wall
  //
  // -vn: descarta video (se input for mp4)
  // -ac 1: mono (Sync.so processa melhor)
  // -ar 44100: sample rate padrao
  // -b:a 192k: bitrate alto pra fonemas claros
  await ff.exec([
    '-i', inputName,
    '-vn',
    '-af', 'highpass=f=80,dynaudnorm=p=0.9:m=10,loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60',
    '-ac', '1',
    '-ar', '44100',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    '-y',
    outputName,
  ]);

  const data = await ff.readFile(outputName);
  await safeDelete(ff, inputName);
  await safeDelete(ff, outputName);

  const bytes: ArrayBuffer =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : new ArrayBuffer(0);
  return new File([bytes], file.name.replace(/\.[^.]+$/, '_clean.mp3'), {
    type: 'audio/mpeg',
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
