/**
 * Test end-to-end do pipeline FINAL otimizado:
 *   1. PRE-PROCESS video local — 720p@25fps com ffmpeg
 *   2. PRE-PROCESS audio local — extrai mp3 limpo com highpass + loudnorm
 *   3. SPLIT video + audio em chunks de 25s (-c copy)
 *   4. UPLOAD chunks em paralelo (concurrency=3)
 *   5. GERA lipsync com modelo PADRAO (lipsync-2) em paralelo
 *   6. DOWNLOAD outputs
 *   7. CONCAT com ffmpeg -c copy
 *   8. UPLOAD final
 *
 * Modelo: lipsync-2 (PADRAO, $0.05/min — 6x mais barato que pro)
 * Pre-processing pesado faz qualidade ficar absurda mesmo no padrao.
 */

import { fal } from '@fal-ai/client';
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* Config */
const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';
const CHUNK_SEC = 25;
const CONCURRENCY = 3;
const MODEL = 'lipsync-2'; // PADRAO — sem pro
const SYNC_MODE = 'cut_off';

/* Load FAL_KEY */
const envPath = join(__dirname, '..', '.env.local');
const envContent = await readFile(envPath, 'utf-8');
const falKey = envContent.match(/^FAL_KEY=(.+)$/m)?.[1]?.trim();
if (!falKey) throw new Error('FAL_KEY missing');
fal.config({ credentials: falKey });

/* Helpers */
function runCmd(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label || cmd} exit ${code}: ${stderr.slice(-300)}`));
    });
  });
}

async function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error('Duration not found'));
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

/* Pipeline */
const T0 = Date.now();

if (!existsSync(VIDEO_PATH)) {
  console.error(`Arquivo nao encontrado: ${VIDEO_PATH}`);
  process.exit(1);
}

const tmpDir = join(tmpdir(), `lipsync-final-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });
console.log(`Workspace: ${tmpDir}\n`);

/* 1. PROBE */
console.log('═══ 1. PROBE ═══');
const duration = await probeDuration(VIDEO_PATH);
const origStat = await stat(VIDEO_PATH);
console.log(`Original: ${duration.toFixed(1)}s · ${(origStat.size / 1024 / 1024).toFixed(1)}MB\n`);

/* 2. PREPROCESS UNIFICADO (video 720p@25fps + audio limpo embutido) */
console.log('═══ 2. PREPROCESS UNIFICADO (1 arquivo, video+audio sync) ═══');
const tPre = Date.now();
const optPath = join(tmpDir, 'sync_opt.mp4');
await runCmd(
  'ffmpeg',
  [
    '-i', VIDEO_PATH,
    // Video filters
    '-vf', "scale='min(1280,iw)':-2,fps=25",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'fastdecode',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    // Audio filters (highpass + dynaudnorm + loudnorm)
    '-af', 'highpass=f=80,dynaudnorm=p=0.9:m=10,loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '1',
    '-ar', '44100',
    '-shortest', // garante duracao identica entre streams
    '-async', '1', // alinha audio sem drift
    '-avoid_negative_ts', 'make_zero',
    '-movflags', '+faststart',
    '-y',
    optPath,
  ],
  'preprocess-sync',
);
const optStat = await stat(optPath);
console.log(`✓ Otimizado em ${fmtTime(Date.now() - tPre)} — ${(optStat.size / 1024 / 1024).toFixed(1)}MB (era ${(origStat.size / 1024 / 1024).toFixed(1)}MB)\n`);

/* 3. SPLIT em chunks de 25s (1 arquivo so) */
console.log(`═══ 3. SPLIT (chunks de ${CHUNK_SEC}s) ═══`);
const tSplit = Date.now();
const segPattern = join(tmpDir, 'chunk_%03d.mp4');
await runCmd('ffmpeg', ['-i', optPath, '-c', 'copy', '-map', '0', '-segment_time', String(CHUNK_SEC), '-f', 'segment', '-reset_timestamps', '1', '-y', segPattern], 'split');
const all = await readdir(tmpDir);
const chunkFiles = all.filter((n) => n.startsWith('chunk_') && n.endsWith('.mp4')).sort().map((n) => join(tmpDir, n));
console.log(`✓ Split em ${fmtTime(Date.now() - tSplit)} — ${chunkFiles.length} chunks (mesmo arquivo serve pra video E audio)\n`);

/* 4. UPLOAD PARALELO (1x por chunk, usado pra video_url E audio_url) */
console.log(`═══ 4. UPLOAD PARALELO (concurrency=${CONCURRENCY}) ═══`);
const tUp = Date.now();
const uploads = await runWithConcurrency(
  chunkFiles,
  async (chunkPath, i) => {
    const bytes = await readFile(chunkPath);
    const file = new File([bytes], `chunk_${i}.mp4`, { type: 'video/mp4' });
    const url = await fal.storage.upload(file);
    process.stdout.write(`  ✓ chunk ${i + 1}/${chunkFiles.length} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)\n`);
    return { video_url: url, audio_url: url }; // MESMA URL — sync absoluta
  },
  CONCURRENCY,
);
console.log(`✓ Upload em ${fmtTime(Date.now() - tUp)}\n`);

const videoChunks = chunkFiles; // alias pra compat com codigo abaixo

/* 5. GERA PARALELO com lipsync-2 (PADRAO) */
console.log(`═══ 5. GERA com ${MODEL} (concurrency=${CONCURRENCY}) ═══`);
const tGen = Date.now();
const outputs = await runWithConcurrency(
  uploads,
  async (up, i) => {
    const cT0 = Date.now();
    const result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
      input: { video_url: up.video_url, audio_url: up.audio_url, model: MODEL, sync_mode: SYNC_MODE },
      logs: false,
    });
    const outUrl = result.data?.video?.url;
    if (!outUrl) throw new Error(`Chunk ${i}: sem output`);
    process.stdout.write(`  ✓ chunk ${i + 1}/${videoChunks.length} em ${fmtTime(Date.now() - cT0)}\n`);
    return outUrl;
  },
  CONCURRENCY,
);
console.log(`✓ Geracao em ${fmtTime(Date.now() - tGen)}\n`);

/* 6. DOWNLOAD outputs */
console.log('═══ 6. DOWNLOAD outputs ═══');
const tDown = Date.now();
const downPaths = await Promise.all(outputs.map(async (url, i) => {
  const path = join(tmpDir, `out_${String(i).padStart(3, '0')}.mp4`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download ${i}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(path, buf);
  process.stdout.write(`  ✓ ${(buf.length / 1024 / 1024).toFixed(1)}MB\n`);
  return path;
}));
console.log(`✓ Download em ${fmtTime(Date.now() - tDown)}\n`);

/* 7. CONCAT */
console.log('═══ 7. CONCAT ═══');
const tCat = Date.now();
const listPath = join(tmpDir, 'list.txt');
await writeFile(listPath, downPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
const finalPath = join(tmpDir, 'lipsync_final.mp4');
await runCmd('ffmpeg', ['-fflags', '+genpts', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-y', finalPath], 'concat');
const finalStat = await stat(finalPath);
console.log(`✓ Concat em ${fmtTime(Date.now() - tCat)} — Final: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB\n`);

/* 8. UPLOAD FINAL */
console.log('═══ 8. UPLOAD FINAL pro Fal storage ═══');
const tFin = Date.now();
const finalBytes = await readFile(finalPath);
const finalFile = new File([finalBytes], 'lipsync_final.mp4', { type: 'video/mp4' });
const finalUrl = await fal.storage.upload(finalFile);
console.log(`✓ Upload final em ${fmtTime(Date.now() - tFin)}\n`);

/* Summary */
console.log('═══════════════════════════════════════════════');
console.log('✅ PIPELINE FINAL COMPLETO');
console.log('═══════════════════════════════════════════════');
console.log(`Tempo total: ${fmtTime(Date.now() - T0)}`);
console.log(`Chunks: ${videoChunks.length} × ${CHUNK_SEC}s`);
console.log(`Modelo: ${MODEL} (PADRAO)`);
console.log(`Pre-process: 720p@25fps + audio limpo`);
console.log(`Output: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB`);
console.log();
console.log('🎬 URL FINAL:');
console.log(finalUrl);
console.log();
console.log(`Workspace: ${tmpDir}`);
