/**
 * Test end-to-end do chunking:
 *   1. Split video local em chunks de 25s com ffmpeg -c copy
 *   2. Upload cada chunk pro Fal storage (paralelo)
 *   3. Chama fal-ai/sync-lipsync/v2 lipsync-2-pro pra cada par (paralelo)
 *   4. Baixa outputs
 *   5. Concat com ffmpeg -c copy
 *   6. Sobe final pro Fal storage
 *   7. Imprime URL final pro user revisar
 */

import { fal } from '@fal-ai/client';
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ───────── Config ───────── */
const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';
const CHUNK_SEC = 25;
const CONCURRENCY = 3;
const MODEL = 'lipsync-2-pro';
const SYNC_MODE = 'cut_off';

/* ───────── Load FAL_KEY ───────── */
const envPath = join(__dirname, '..', '.env.local');
const envContent = await readFile(envPath, 'utf-8');
const falKey = envContent.match(/^FAL_KEY=(.+)$/m)?.[1]?.trim();
if (!falKey) {
  console.error('FAL_KEY nao achada');
  process.exit(1);
}
fal.config({ credentials: falKey });

/* ───────── Helpers ───────── */
function runCmd(cmd, args, label = '') {
  return new Promise((resolve, reject) => {
    if (label) process.stdout.write(`[${label}] `);
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function probeDuration(file) {
  // ffprobe nao disponivel — usa ffmpeg que sempre tem
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error('Duration not found in ffmpeg output'));
      const [, h, mm, s] = m;
      resolve(parseInt(h) * 3600 + parseInt(mm) * 60 + parseFloat(s));
    });
  });
}

async function runWithConcurrency(items, fn, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

/* ───────── Pipeline ───────── */
const T0 = Date.now();

if (!existsSync(VIDEO_PATH)) {
  console.error(`Arquivo nao encontrado: ${VIDEO_PATH}`);
  process.exit(1);
}

const tmpDir = join(tmpdir(), `lipsync-test-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });
console.log(`Workspace: ${tmpDir}\n`);

/* 1. PROBE */
console.log('═══ 1. PROBE ═══');
const duration = await probeDuration(VIDEO_PATH);
const fileStat = await stat(VIDEO_PATH);
const sizeMB = (fileStat.size / 1024 / 1024).toFixed(1);
const numChunks = Math.ceil(duration / CHUNK_SEC);
console.log(`Duracao: ${duration.toFixed(1)}s · Tamanho: ${sizeMB}MB · Chunks: ${numChunks}\n`);

/* 2. SPLIT */
console.log('═══ 2. SPLIT (ffmpeg -c copy -f segment) ═══');
const tSplit = Date.now();
const segmentPattern = join(tmpDir, 'chunk_%03d.mp4');
await runCmd('ffmpeg', [
  '-i', VIDEO_PATH,
  '-c', 'copy',
  '-map', '0',
  '-segment_time', String(CHUNK_SEC),
  '-f', 'segment',
  '-reset_timestamps', '1',
  '-y',
  segmentPattern,
], 'ffmpeg');
console.log(); // newline apos progress
const chunkFiles = (await readdir(tmpDir))
  .filter((n) => n.startsWith('chunk_') && n.endsWith('.mp4'))
  .sort()
  .map((n) => join(tmpDir, n));
console.log(`✓ Split em ${fmtTime(Date.now() - tSplit)} — ${chunkFiles.length} chunks\n`);

/* 3. UPLOAD PARALELO (video e audio sao o mesmo arquivo neste teste) */
console.log(`═══ 3. UPLOAD PARALELO (concurrency=${CONCURRENCY}) ═══`);
const tUpload = Date.now();
const uploadUrls = await runWithConcurrency(
  chunkFiles,
  async (chunkPath, i) => {
    const bytes = await readFile(chunkPath);
    const file = new File([bytes], `chunk_${i}.mp4`, { type: 'video/mp4' });
    // Sobe 1x e usa pra video E audio (Fal extrai audio do mp4 ok)
    const url = await fal.storage.upload(file);
    process.stdout.write(`  ✓ chunk ${i + 1}/${chunkFiles.length} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)\n`);
    return url;
  },
  CONCURRENCY,
);
console.log(`✓ Upload em ${fmtTime(Date.now() - tUpload)}\n`);

/* 4. GERA PARALELO */
console.log(`═══ 4. GERA PARALELO (${MODEL}, concurrency=${CONCURRENCY}) ═══`);
const tGen = Date.now();
const outputUrls = await runWithConcurrency(
  uploadUrls,
  async (url, i) => {
    const chunkT0 = Date.now();
    const result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
      input: {
        video_url: url,
        audio_url: url,
        model: MODEL,
        sync_mode: SYNC_MODE,
      },
      logs: false,
    });
    const outUrl = result.data?.video?.url;
    if (!outUrl) throw new Error(`Chunk ${i}: sem output`);
    process.stdout.write(`  ✓ chunk ${i + 1}/${chunkFiles.length} em ${fmtTime(Date.now() - chunkT0)}\n`);
    return outUrl;
  },
  CONCURRENCY,
);
console.log(`✓ Geracao em ${fmtTime(Date.now() - tGen)}\n`);

/* 5. DOWNLOAD OUTPUTS */
console.log('═══ 5. DOWNLOAD OUTPUTS ═══');
const tDownload = Date.now();
const downloadedPaths = await Promise.all(
  outputUrls.map(async (url, i) => {
    const path = join(tmpDir, `out_${String(i).padStart(3, '0')}.mp4`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Download ${i} falhou: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await writeFile(path, buf);
    process.stdout.write(`  ✓ chunk ${i + 1}/${chunkFiles.length} (${(buf.length / 1024 / 1024).toFixed(1)}MB)\n`);
    return path;
  }),
);
console.log(`✓ Download em ${fmtTime(Date.now() - tDownload)}\n`);

/* 6. CONCAT */
console.log('═══ 6. CONCAT (ffmpeg -c copy) ═══');
const tConcat = Date.now();
const listPath = join(tmpDir, 'concat_list.txt');
const listContent = downloadedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
await writeFile(listPath, listContent);
const finalPath = join(tmpDir, 'lipsync_final.mp4');
await runCmd('ffmpeg', [
  '-fflags', '+genpts',
  '-f', 'concat',
  '-safe', '0',
  '-i', listPath,
  '-c', 'copy',
  '-avoid_negative_ts', 'make_zero',
  '-movflags', '+faststart',
  '-y',
  finalPath,
], 'ffmpeg');
console.log();
const finalStat = await stat(finalPath);
console.log(`✓ Concat em ${fmtTime(Date.now() - tConcat)} — Final: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB\n`);

/* 7. UPLOAD FINAL */
console.log('═══ 7. UPLOAD FINAL PRO FAL STORAGE ═══');
const tFinal = Date.now();
const finalBytes = await readFile(finalPath);
const finalFile = new File([finalBytes], 'lipsync_final.mp4', { type: 'video/mp4' });
const finalUrl = await fal.storage.upload(finalFile);
console.log(`✓ Upload final em ${fmtTime(Date.now() - tFinal)}\n`);

/* ───────── Summary ───────── */
const totalSec = (Date.now() - T0) / 1000;
console.log('═══════════════════════════════════════════════');
console.log('✅ PIPELINE COMPLETO');
console.log('═══════════════════════════════════════════════');
console.log(`Tempo total: ${fmtTime(Date.now() - T0)}`);
console.log(`Chunks processados: ${chunkFiles.length} × ${CHUNK_SEC}s`);
console.log(`Modelo: ${MODEL}`);
console.log(`Output: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB`);
console.log();
console.log('🎬 URL FINAL:');
console.log(finalUrl);
console.log();

/* Cleanup workspace? Deixa la pra inspecionar */
console.log(`Workspace: ${tmpDir}`);
