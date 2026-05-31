'use client';

/**
 * lib/lipsync-pipeline — pré/pós-produção client-side do LipSync, em cima
 * dos helpers ffmpeg.wasm que já existem (ffmpeg-worker + lipsync-postprocess).
 *
 * Tudo roda em WORKER (não trava a UI) e por TRECHO (chunk) curto — nunca
 * uma operação gigante de uma vez, então não estoura memória nem congela.
 *
 * Fases:
 *  - prepareFaceVideo: comprime o rosto pra ≤720p quando grande/alto-res
 *    (aceita input até 300MB, mas sobe leve — cabe nos limites de storage).
 *  - cleanAudioMp3: extrai+limpa o áudio (highpass+compress+loudnorm) → mp3
 *    pequeno (lip melhor + extrai áudio de mp4 também).
 *  - splitAudioChunks: divide áudio longo em trechos ≤~170s (motor processa
 *    até ~180s por vez → suportamos até 10min costurando os trechos).
 *  - enhanceLipVideo: realça o resultado (denoise+sharpen+grading).
 *  - concatLipVideos: costura os trechos (stream-copy de vídeo = leve).
 */

import {
  getFFmpeg,
  compressVideo,
  normalizeVolume,
  probeVideoMetadata,
  concatVideosFast,
  type FFLoadStage,
} from './ffmpeg-worker';
import { postprocessLipSyncOutput } from './lipsync-postprocess';

/** Máx por trecho — margem sob o limite do motor (~180s). */
export const MAX_CHUNK_SEC = 170;
/** Acima disso, o áudio é dividido em trechos. */
export const CHUNK_THRESHOLD_SEC = 178;

const FACE_COMPRESS_BYTES = 35 * 1024 * 1024; // comprime se vídeo > 35MB
const FACE_MAX_HEIGHT = 720;

function ffToFile(data: Uint8Array | string, name: string, type: string): File {
  if (typeof data === 'string') return new File([data], name, { type });
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new File([copy.buffer], name, { type });
}

/** Mede duração (s) de mídia via elemento HTML, sem ffmpeg. */
export function probeDurationSec(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio');
      el.preload = 'metadata';
      el.onloadedmetadata = () => {
        const d = el.duration || 0;
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) ? d : 0);
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      el.src = url;
    } catch {
      resolve(0);
    }
  });
}

/**
 * PRÉ-PRODUÇÃO (áudio): extrai + limpa + normaliza → mp3 pequeno.
 * Melhora o lip (voz nítida e em nível constante) e funciona com mp4
 * (usa só o áudio). Sempre roda — o áudio é leve.
 */
export async function cleanAudioMp3(file: File, onStage?: FFLoadStage): Promise<File> {
  const blob = await normalizeVolume(file, { output: 'mp3' }, { onStage });
  return new File([blob], 'voz_limpa.mp3', { type: 'audio/mpeg' });
}

/**
 * PRÉ-PRODUÇÃO (vídeo): comprime o rosto pra ≤720p só quando precisa
 * (arquivo grande ou alta resolução). Vídeo pequeno passa direto (rápido).
 * Garante que cabe nos limites de upload sem perder qualidade de lip (o
 * motor entrega 720p de qualquer jeito).
 */
export async function prepareFaceVideo(file: File, onStage?: FFLoadStage): Promise<File> {
  let height = 0;
  try {
    const meta = await probeVideoMetadata(file);
    height = meta?.height || 0;
  } catch {
    /* ignore */
  }
  const needCompress = file.size > FACE_COMPRESS_BYTES || (height > 0 && height > FACE_MAX_HEIGHT);
  if (!needCompress) return file;
  const blob = await compressVideo(file, { crf: 23, resolution: '720' }, { onStage });
  return new File([blob], 'rosto_opt.mp4', { type: 'video/mp4' });
}

/**
 * Divide o áudio (mp3) em trechos ≤chunkSec via segment muxer (stream-copy
 * = rápido, sem re-encode). Retorna a lista de Files na ordem.
 */
export async function splitAudioChunks(
  file: File,
  chunkSec = MAX_CHUNK_SEC,
  onStage?: FFLoadStage,
): Promise<File[]> {
  const ff = await getFFmpeg(onStage);
  const { fetchFile } = await import('@ffmpeg/util');
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inName = `csplit_${uniq}.mp3`;
  await ff.writeFile(inName, await fetchFile(file));
  const pattern = `cseg_${uniq}_%03d.mp3`;
  await ff.exec([
    '-i', inName,
    '-f', 'segment',
    '-segment_time', String(chunkSec),
    '-c', 'copy',
    '-reset_timestamps', '1',
    pattern,
  ]);
  const chunks: File[] = [];
  for (let i = 0; i < 300; i++) {
    const name = `cseg_${uniq}_${String(i).padStart(3, '0')}.mp3`;
    let data: Uint8Array | string;
    try {
      data = await ff.readFile(name);
    } catch {
      break;
    }
    chunks.push(ffToFile(data, `chunk_${i}.mp3`, 'audio/mpeg'));
    try {
      await ff.deleteFile(name);
    } catch {
      /* ignore */
    }
  }
  try {
    await ff.deleteFile(inName);
  } catch {
    /* ignore */
  }
  return chunks.length > 0 ? chunks : [file];
}

/**
 * PÓS-PRODUÇÃO: realça o lip do resultado (esconde "máscara" do queixo,
 * devolve nitidez aos dentes, grading sutil). Roda por trecho (curto).
 */
export async function enhanceLipVideo(blob: Blob, onStage?: FFLoadStage): Promise<Blob> {
  return postprocessLipSyncOutput(blob, { onStage });
}

/**
 * Costura os MP4s dos trechos num só. concatVideosFast copia o vídeo
 * (sem re-encode = leve/rápido) e só normaliza o áudio — como todos os
 * trechos saíram do mesmo encode (pós-produção idêntica), junta liso.
 */
export async function concatLipVideos(blobs: Blob[], onStage?: FFLoadStage): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  return concatVideosFast(blobs, { onStage });
}
