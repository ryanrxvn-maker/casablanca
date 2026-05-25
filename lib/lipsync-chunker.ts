/**
 * lib/lipsync-chunker — orchestra chunking + parallel lipsync + stitch.
 *
 * Estrategia pra vídeos longos (> 30s):
 *
 *   1. SPLIT — divide video + audio em N chunks de ~25-30s usando ffmpeg.wasm
 *      com `-c copy` (sem re-encode, super rapido)
 *   2. UPLOAD PARALELO — sobe os pares (video_chunk, audio_chunk) pro Fal storage
 *      em batches concorrentes (default 3 simultaneos)
 *   3. GERA PARALELO — chama fal-ai/sync-lipsync/v2 em batches concorrentes
 *   4. DOWNLOAD — baixa todos os outputs do Fal storage
 *   5. CONCAT — junta tudo com ffmpeg.wasm `-c copy` (sem re-encode)
 *
 * Resultado: video lipsync de qualquer tamanho com qualidade constante
 * do comeco ao fim (cada chunk fica dentro da "zona otima" do modelo).
 *
 * Trade-off: pode haver micro-pulo de 1 frame entre chunks (boca recalcula).
 * Mitigacao futura: corte inteligente em pausas/silencio.
 */

import { getFFmpeg, concatVideosFast, type FFLog, type FFLoadStage } from './ffmpeg-worker';

/** Tamanho default do chunk em segundos. Sweet spot pra qualidade/velocidade. */
export const DEFAULT_CHUNK_SEC = 25;

/** Maximo de chunks em paralelo (upload + generate). Fal aguenta + de 3 mas
 *  3 eh seguro pra nao estourar rate limit. */
export const DEFAULT_CONCURRENCY = 3;

export type ChunkStatus = 'pending' | 'splitting' | 'uploading' | 'generating' | 'concat' | 'done' | 'error';

export interface ChunkInfo {
  index: number;
  startSec: number;
  endSec: number;
  status: ChunkStatus;
  outputUrl?: string;
  error?: string;
}

export interface ChunkProgress {
  totalChunks: number;
  doneChunks: number;
  chunks: ChunkInfo[];
  phase: 'splitting' | 'uploading' | 'generating' | 'concat' | 'done';
}

export interface LipSyncChunkOptions {
  videoFile: File;
  audioFile: File;
  durationSec: number;
  pro: boolean;
  syncMode: 'cut_off' | 'loop' | 'bounce' | 'silence' | 'remap';
  chunkDurationSec?: number;
  concurrency?: number;
  onProgress?: (p: ChunkProgress) => void;
  onLog?: FFLog;
  onStage?: FFLoadStage;
}

/**
 * Divide um Blob de video/audio em chunks de `chunkSec` segundos usando
 * ffmpeg `-c copy` (sem re-encode). Retorna array de Blobs.
 *
 * Estrategia: gera UM comando ffmpeg com `-f segment` que cria todos
 * os chunks de uma vez (mais rapido que iterar com `-ss` + `-t`).
 */
async function splitFast(
  file: Blob,
  chunkSec: number,
  ext: string,
  mime: string,
  onLog?: FFLog,
  onStage?: FFLoadStage,
): Promise<Blob[]> {
  const ff = await getFFmpeg(onStage, onLog);
  const { fetchFile } = await import('@ffmpeg/util');

  const inputName = `chunk_in.${ext}`;
  const outputPattern = `chunk_out_%03d.${ext}`;

  await ff.writeFile(inputName, await fetchFile(file));

  // -f segment + -segment_time: corta em chunks de exatamente N segundos
  // -reset_timestamps 1: cada chunk comeca em 0 (essencial pro concat depois)
  // -c copy: sem re-encode (rapidissimo)
  await ff.exec([
    '-i', inputName,
    '-c', 'copy',
    '-map', '0',
    '-segment_time', String(chunkSec),
    '-f', 'segment',
    '-reset_timestamps', '1',
    outputPattern,
  ]);

  // Le arquivos gerados. Como nao sabemos quantos sairam, tenta ate falhar.
  const chunks: Blob[] = [];
  for (let i = 0; ; i++) {
    const name = `chunk_out_${String(i).padStart(3, '0')}.${ext}`;
    try {
      const data = await ff.readFile(name);
      const bytes: ArrayBuffer =
        data instanceof Uint8Array
          ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
          : new ArrayBuffer(0);
      chunks.push(new Blob([bytes], { type: mime }));
      try { await ff.deleteFile(name); } catch { /* ignore */ }
    } catch {
      break;
    }
  }

  try { await ff.deleteFile(inputName); } catch { /* ignore */ }

  return chunks;
}

/**
 * Sobe um arquivo pro Fal storage (via proxy interno).
 */
async function uploadChunk(file: File): Promise<string> {
  const { fal } = await import('@fal-ai/client');
  fal.config({ proxyUrl: '/api/fal/proxy' });
  return fal.storage.upload(file);
}

/**
 * Chama /api/tools/lipsync com um par video/audio (urls do Fal storage).
 */
async function generateChunk(
  video_url: string,
  audio_url: string,
  pro: boolean,
  syncMode: string,
): Promise<string> {
  const res = await fetch('/api/tools/lipsync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url, audio_url, pro, sync_mode: syncMode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  if (!data.output_video_url) throw new Error('Sem output_video_url');
  return data.output_video_url as string;
}

/**
 * Helper: roda promises em batches paralelos limitados por concurrency.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Faz o pipeline inteiro: split + upload + generate + concat.
 * Retorna a URL final do video gerado (Fal storage URL).
 */
export async function runChunkedLipSync(opts: LipSyncChunkOptions): Promise<string> {
  const chunkSec = opts.chunkDurationSec ?? DEFAULT_CHUNK_SEC;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  // Quantos chunks vamos ter (estimativa pra UI logo de cara)
  const estChunks = Math.max(1, Math.ceil(opts.durationSec / chunkSec));
  const chunks: ChunkInfo[] = Array.from({ length: estChunks }, (_, i) => ({
    index: i,
    startSec: i * chunkSec,
    endSec: Math.min((i + 1) * chunkSec, opts.durationSec),
    status: 'pending' as ChunkStatus,
  }));

  function emit(phase: ChunkProgress['phase']) {
    opts.onProgress?.({
      totalChunks: chunks.length,
      doneChunks: chunks.filter((c) => c.status === 'done').length,
      chunks: [...chunks],
      phase,
    });
  }

  /* ───────── 1. SPLIT ─────────
     Se video e audio sao o MESMO arquivo (caso do preprocess unificado),
     so splitamos 1 vez e usamos o mesmo chunk pra ambos. Garante numero
     identico de chunks e sincronia perfeita. */
  emit('splitting');
  chunks.forEach((c) => (c.status = 'splitting'));
  emit('splitting');

  const isSameFile = opts.videoFile === opts.audioFile;

  let videoChunks: Blob[];
  let audioChunks: Blob[];

  if (isSameFile) {
    videoChunks = await splitFast(opts.videoFile, chunkSec, 'mp4', 'video/mp4', opts.onLog, opts.onStage);
    audioChunks = videoChunks; // MESMOS blobs — sync absoluta
  } else {
    [videoChunks, audioChunks] = await Promise.all([
      splitFast(opts.videoFile, chunkSec, 'mp4', 'video/mp4', opts.onLog, opts.onStage),
      splitFast(opts.audioFile, chunkSec, guessAudioExt(opts.audioFile), opts.audioFile.type || 'audio/mpeg', opts.onLog, opts.onStage),
    ]);
  }

  // Ajusta numero real de chunks (pode diferir da estimativa).
  const realChunks = Math.min(videoChunks.length, audioChunks.length);
  if (realChunks < chunks.length) chunks.length = realChunks;

  /* ───────── 2. UPLOAD PARALELO ───────── */
  chunks.forEach((c) => (c.status = 'uploading'));
  emit('uploading');

  const uploadResults = await runWithConcurrency(
    chunks,
    async (chunk, i) => {
      try {
        const videoExt = 'mp4';
        const audioExt = guessAudioExt(opts.audioFile);
        const vFile = new File([videoChunks[i]], `chunk_${i}_video.${videoExt}`, { type: 'video/mp4' });
        const aFile = new File([audioChunks[i]], `chunk_${i}_audio.${audioExt}`, { type: opts.audioFile.type || 'audio/mpeg' });
        const [video_url, audio_url] = await Promise.all([uploadChunk(vFile), uploadChunk(aFile)]);
        return { video_url, audio_url };
      } catch (err) {
        chunk.status = 'error';
        chunk.error = err instanceof Error ? err.message : String(err);
        emit('uploading');
        throw err;
      }
    },
    concurrency,
  );

  /* ───────── 3. GERA PARALELO ───────── */
  chunks.forEach((c) => (c.status = 'generating'));
  emit('generating');

  await runWithConcurrency(
    chunks,
    async (chunk, i) => {
      try {
        const { video_url, audio_url } = uploadResults[i];
        const outputUrl = await generateChunk(video_url, audio_url, opts.pro, opts.syncMode);
        chunk.status = 'done';
        chunk.outputUrl = outputUrl;
        emit('generating');
      } catch (err) {
        chunk.status = 'error';
        chunk.error = err instanceof Error ? err.message : String(err);
        emit('generating');
        throw err;
      }
    },
    concurrency,
  );

  /* ───────── 4. CONCAT ───────── */
  chunks.forEach((c) => {
    if (c.status === 'done') c.status = 'concat';
  });
  emit('concat');

  // Baixa todos os outputs em paralelo
  const outputBlobs: Blob[] = await Promise.all(
    chunks.map(async (c) => {
      if (!c.outputUrl) throw new Error(`Chunk ${c.index} sem outputUrl`);
      const r = await fetch(c.outputUrl);
      if (!r.ok) throw new Error(`Falha baixando chunk ${c.index}: ${r.status}`);
      return r.blob();
    }),
  );

  // Concat sem re-encode
  const finalBlob = await concatVideosFast(outputBlobs, { onLog: opts.onLog, onStage: opts.onStage });

  // Sobe o vídeo final pro Fal storage pra ter uma URL servivel pelo player.
  // (Alternativa: criar object URL local, mas se a aba reload some.)
  const finalFile = new File([finalBlob], 'lipsync_final.mp4', { type: 'video/mp4' });
  const finalUrl = await uploadChunk(finalFile);

  chunks.forEach((c) => (c.status = 'done'));
  emit('done');

  return finalUrl;
}

function guessAudioExt(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith('.mp3')) return 'mp3';
  if (name.endsWith('.wav')) return 'wav';
  if (name.endsWith('.m4a')) return 'm4a';
  if (name.endsWith('.aac')) return 'aac';
  if (name.endsWith('.ogg')) return 'ogg';
  if (name.endsWith('.flac')) return 'flac';
  // se for video, usa mp4 (ffmpeg + sync.so extraem audio do mp4 ok)
  if (name.endsWith('.mp4') || name.endsWith('.mov')) return 'mp4';
  return 'mp3';
}
