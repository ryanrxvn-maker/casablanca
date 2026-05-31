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
  normalizeVolume,
  probeVideoMetadata,
  concatVideosFast,
  type FFLoadStage,
} from './ffmpeg-worker';
import { postprocessLipSyncOutput } from './lipsync-postprocess';

/**
 * Máx por trecho. NÃO é o limite do motor (que aceita ~180s) — é o limite
 * de TEMPO DE RENDER: cada trecho roda numa função serverless (Vercel, teto
 * 300s) que espera o motor renderizar. Render de áudio longo demora — um
 * trecho de ~175s estourou o timeout. Trechos de ~100s renderizam com folga
 * dentro do orçamento. Áudio de 10min → ~6 trechos costurados.
 */
export const MAX_CHUNK_SEC = 100;
/** Acima disso, o áudio é dividido em trechos. */
export const CHUNK_THRESHOLD_SEC = 108;

/** Limite seguro do Supabase Storage (cap ~50MB) — abaixo disso vai nativo. */
const STORAGE_SAFE_BYTES = 44 * 1024 * 1024;

function ffToFile(data: Uint8Array | string, name: string, type: string): File {
  if (typeof data === 'string') return new File([data], name, { type });
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return new File([copy.buffer], name, { type });
}

/**
 * SERIALIZA ffmpeg.wasm. O core é single-thread e a instância é um
 * SINGLETON (getFFmpeg) — dois `exec()` concorrentes corrompem o FS
 * virtual / quebram. Como agora o usuário pode disparar VÁRIAS gerações
 * ao mesmo tempo (cards não-bloqueantes), toda etapa de ffmpeg passa por
 * esta fila: roda uma de cada vez, na ordem em que chegou. A geração no
 * motor (rede) continua paralela — só o ffmpeg é serial.
 */
let ffChain: Promise<unknown> = Promise.resolve();
export function withFFLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = ffChain.then(() => fn());
  // A corrente segue mesmo se um job falhar (não trava a fila).
  ffChain = result.then(() => undefined, () => undefined);
  return result;
}

/** Cronometra uma etapa e empilha em window.__lipTimings (debug/medição). */
function track<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return fn().finally(() => {
    const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    try {
      const w = window as unknown as { __lipTimings?: { label: string; ms: number }[] };
      w.__lipTimings = w.__lipTimings || [];
      w.__lipTimings.push({ label, ms });
    } catch {
      /* ignore */
    }
  });
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
  return track('pre_cleanAudio', async () =>
    withFFLock(async () => {
      const blob = await normalizeVolume(file, { output: 'mp3' }, { onStage });
      return new File([blob], 'voz_limpa.mp3', { type: 'audio/mpeg' });
    }),
  );
}

/**
 * PRÉ-PRODUÇÃO (vídeo): só comprime o rosto quando o arquivo é grande
 * (> limite do storage). Vídeo pequeno passa NATIVO (instantâneo, ZERO
 * perda) — é o caso comum. Quando precisa comprimir, PRESERVA a qualidade:
 * mantém a resolução (até 1080p) no melhor bitrate que cabe no upload, em
 * preset veryfast (rápido). Nunca baixa pra 720p à toa.
 */
export async function prepareFaceVideo(file: File, onStage?: FFLoadStage): Promise<File> {
  // ≤ limite do storage → VÍDEO NATIVO (qualidade máxima, zero espera).
  if (file.size <= STORAGE_SAFE_BYTES) return file;
  // > limite → comprime RÁPIDO só pra caber no upload. Passa pela fila do
  // ffmpeg (não colide com outras gerações).
  return track('pre_compressFace', async () => withFFLock(() => compressFaceHQ(file, onStage)));
}

/**
 * Compressão RÁPIDA do rosto pra caber no storage. Como o motor SEMPRE
 * entrega 720p, comprimir o rosto pra 720p não muda a qualidade final —
 * então só comprimimos quando NÃO cabe no upload, e do jeito que PRESERVA
 * o máximo de qualidade: MANTÉM a resolução (até 1080p) com um BITRATE-ALVO
 * calculado pra caber no limite na duração real do vídeo (máxima qualidade
 * possível pro tamanho — sem chutar CRF nem baixar resolução à toa) +
 * preset veryfast (rápido e bem melhor que ultrafast no mesmo bitrate) +
 * SEM áudio (o motor usa o áudio separado). Fallback raro pra 720p só se o
 * vídeo for tão longo que nem 1080p caiba.
 */
async function compressFaceHQ(file: File, onStage?: FFLoadStage): Promise<File> {
  const ff = await getFFmpeg(onStage);
  const { fetchFile } = await import('@ffmpeg/util');
  const meta = await probeVideoMetadata(file).catch(() => null);
  const h = meta?.height || 0;
  const durSec = meta?.durationSec || 0;
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inName = `fhq_${uniq}.mp4`;
  const outName = `fhqo_${uniq}.mp4`;
  await ff.writeFile(inName, await fetchFile(file));

  const encode = async (maxH: number): Promise<Uint8Array> => {
    // bitrate-alvo: cabe em ~42MB (margem sob o limite) na duração real do
    // vídeo, entre 2 e 9 Mbps. Vídeo curto (caso comum do rosto) → 9Mbps =
    // 1080p praticamente sem perda visível.
    const budgetBits = 42 * 1024 * 1024 * 8;
    let vbps = durSec > 1 ? Math.floor((budgetBits / durSec) * 0.92) : 6_000_000;
    vbps = Math.max(2_000_000, Math.min(9_000_000, vbps));
    const args = ['-i', inName];
    if (!h || h > maxH) args.push('-vf', `scale=-2:${maxH}:flags=bicubic`); // só desce se >1080p
    args.push(
      '-an', // sem áudio: o motor usa o áudio separado → menor + mais rápido
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-b:v', String(vbps), '-maxrate', String(Math.floor(vbps * 1.3)), '-bufsize', String(vbps * 2),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', outName,
    );
    await ff.exec(args);
    const d = await ff.readFile(outName);
    return d instanceof Uint8Array ? d : new Uint8Array();
  };

  let data = await encode(1080); // mantém resolução (≤1080p), qualidade máxima pro tamanho
  if (data.length > STORAGE_SAFE_BYTES) data = await encode(720); // raríssimo (vídeo muito longo)

  try { await ff.deleteFile(inName); } catch { /* ignore */ }
  try { await ff.deleteFile(outName); } catch { /* ignore */ }
  return ffToFile(data, 'rosto_hq.mp4', 'video/mp4');
}

/**
 * Divide o áudio (mp3) em trechos ≤chunkSec via segment muxer (stream-copy
 * = rápido, sem re-encode). Retorna a lista de Files na ordem.
 */
export async function splitAudioChunks(
  file: File,
  maxChunkSec = MAX_CHUNK_SEC,
  onStage?: FFLoadStage,
): Promise<File[]> {
  return withFFLock(async () => {
  const ff = await getFFmpeg(onStage);
  const { fetchFile } = await import('@ffmpeg/util');
  const uniq = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const inName = `csplit_${uniq}.mp3`;
  await ff.writeFile(inName, await fetchFile(file));

  // 1. Detecta silêncios — pra cortar SEM partir fala no meio.
  const silences: { start: number; end: number }[] = [];
  let duration = 0;
  const onLog = ({ message }: { message: string }) => {
    const ss = /silence_start:\s*(-?[\d.]+)/.exec(message);
    if (ss) silences.push({ start: parseFloat(ss[1]), end: -1 });
    const se = /silence_end:\s*(-?[\d.]+)/.exec(message);
    if (se && silences.length) silences[silences.length - 1].end = parseFloat(se[1]);
    const dm = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(message);
    if (dm) duration = +dm[1] * 3600 + +dm[2] * 60 + parseFloat(dm[3]);
  };
  ff.on('log', onLog);
  try {
    await ff.exec(['-i', inName, '-af', 'silencedetect=noise=-32dB:d=0.35', '-f', 'null', '-']);
  } finally {
    ff.off('log', onLog);
  }
  if (!duration) duration = await probeDurationSec(file);

  // 2. Pontos de corte no MEIO de um silêncio perto de cada limite (≤170s),
  //    pra nunca cortar no meio da fala. Sem silêncio na janela → corta no limite.
  const mids = silences.filter((s) => s.end > s.start).map((s) => (s.start + s.end) / 2);
  const points: number[] = [0];
  let target = maxChunkSec;
  while (target < duration - 4) {
    const lo = target - 25;
    const hi = Math.min(target + 8, duration - 1);
    const last = points[points.length - 1];
    const cands = mids.filter((m) => m >= lo && m <= hi && m > last + 5);
    const cut = cands.length
      ? cands.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a))
      : Math.min(target, duration);
    if (cut > last + 5 && cut < duration - 1) points.push(cut);
    target = cut + maxChunkSec;
  }
  points.push(duration);

  if (points.length <= 2) {
    try { await ff.deleteFile(inName); } catch { /* ignore */ }
    return [file];
  }

  // 3. Corta cada trecho exato (re-encode mp3 → duração precisa).
  const chunks: File[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const out = `cseg_${uniq}_${i}.mp3`;
    await ff.exec([
      '-i', inName,
      '-ss', points[i].toFixed(2),
      '-to', points[i + 1].toFixed(2),
      '-c:a', 'libmp3lame', '-q:a', '3',
      '-y', out,
    ]);
    let data: Uint8Array | string;
    try {
      data = await ff.readFile(out);
    } catch {
      continue;
    }
    chunks.push(ffToFile(data, `chunk_${i}.mp3`, 'audio/mpeg'));
    try { await ff.deleteFile(out); } catch { /* ignore */ }
  }
  try { await ff.deleteFile(inName); } catch { /* ignore */ }
  return chunks.length > 0 ? chunks : [file];
  });
}

/**
 * PÓS-PRODUÇÃO: realça o lip do resultado (esconde "máscara" do queixo,
 * devolve nitidez aos dentes, grading sutil). Roda por trecho (curto).
 */
export async function enhanceLipVideo(blob: Blob, onStage?: FFLoadStage): Promise<Blob> {
  return track('post_enhance', async () => withFFLock(() => postprocessLipSyncOutput(blob, { onStage })));
}

/**
 * Costura os MP4s dos trechos num só. concatVideosFast copia o vídeo
 * (sem re-encode = leve/rápido) e só normaliza o áudio — como todos os
 * trechos saíram do mesmo encode (pós-produção idêntica), junta liso.
 */
export async function concatLipVideos(blobs: Blob[], onStage?: FFLoadStage): Promise<Blob> {
  if (blobs.length === 1) return blobs[0];
  return track('post_concat', async () => withFFLock(() => concatVideosFast(blobs, { onStage })));
}
