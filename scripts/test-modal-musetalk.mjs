/**
 * Teste do pipeline Modal MuseTalk end-to-end.
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';
const MODAL_BASE = 'https://ryanrxvn-maker--casablanca-musetalk-web.modal.run';

const tmpDir = join(tmpdir(), `musetalk-modal-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
};

const runCmd = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  p.stderr.on('data', (d) => (stderr += d.toString()));
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-500)))));
});

/* 1. Chunk 25s otimizado */
console.log('═══ 1. PREPROCESS chunk 25s ═══');
const tPre = Date.now();
const chunkPath = join(tmpDir, 'chunk.mp4');
await runCmd('ffmpeg', [
  '-i', VIDEO_PATH,
  '-t', '25',
  '-vf', "scale='min(1280,iw)':-2,fps=25",
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-af', 'highpass=f=80,dynaudnorm=p=0.9:m=10,loudnorm=I=-16:TP=-1.5:LRA=11',
  '-c:a', 'aac', '-b:a', '192k', '-ac', '1', '-ar', '44100',
  '-shortest', '-async', '1', '-movflags', '+faststart', '-y', chunkPath,
]);
const audioPath = join(tmpDir, 'audio.wav');
await runCmd('ffmpeg', ['-i', chunkPath, '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioPath]);
console.log(`✓ Preproc em ${fmtTime(Date.now() - tPre)}\n`);

/* 2. Upload */
async function modalUpload(filePath, ext) {
  const body = await readFile(filePath);
  const res = await fetch(`${MODAL_BASE}/up?ext=${ext}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!res.ok) throw new Error(`Upload falhou: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

console.log('═══ 2. UPLOAD ═══');
const tUp = Date.now();
const [videoId, audioId] = await Promise.all([
  modalUpload(chunkPath, 'mp4'),
  modalUpload(audioPath, 'wav'),
]);
console.log(`✓ Upload em ${fmtTime(Date.now() - tUp)}\n`);

/* 3. Generate */
console.log('═══ 3. MuseTalk inference ═══');
const tGen = Date.now();
const genRes = await fetch(`${MODAL_BASE}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    video_url: `${MODAL_BASE}/file?id=${videoId}`,
    audio_url: `${MODAL_BASE}/file?id=${audioId}`,
    bbox_shift: 0,
  }),
});
if (!genRes.ok) {
  console.error(`Generate falhou: ${genRes.status}`);
  console.error(await genRes.text());
  process.exit(1);
}
const gen = await genRes.json();
if (!gen.success) {
  console.error('Erro:', gen.error);
  process.exit(1);
}
const elapsedGen = Date.now() - tGen;
console.log(`✓ Geracao em ${fmtTime(elapsedGen)}`);
console.log(`  Output id: ${gen.id} · ${gen.size_mb}MB\n`);

/* 4. Download */
const outRes = await fetch(`${MODAL_BASE}/file?id=${gen.id}`);
const outBuf = Buffer.from(await outRes.arrayBuffer());
const rawPath = join(tmpDir, 'raw.mp4');
await writeFile(rawPath, outBuf);

/* 5. Post-process */
const finalPath = join(tmpDir, 'final.mp4');
await runCmd('ffmpeg', [
  '-i', rawPath,
  '-vf', 'hqdn3d=1:1:4:4,unsharp=5:5:0.7:5:5:0.0,eq=contrast=1.04:saturation=1.05:gamma=0.98,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-movflags', '+faststart', '-y', finalPath,
]);

const desktopPath = 'D:\\Área de Trabalho\\TESTE LIP ME - RESULTADO MUSETALK MODAL.mp4';
await runCmd('cmd', ['/c', 'copy', '/Y', finalPath.replace(/\//g, '\\'), desktopPath]);

const finalStat = await stat(finalPath);
const gpuSec = elapsedGen / 1000;
// A10G = $0.000306/s
const costUSD = gpuSec * 0.000306;

console.log('═══════════════════════════════════════════════');
console.log('✅ MUSETALK MODAL COMPLETO');
console.log('═══════════════════════════════════════════════');
console.log(`Geracao GPU: ${fmtTime(elapsedGen)}`);
console.log(`Custo estimado: $${costUSD.toFixed(4)} (R$ ${(costUSD * 5.3).toFixed(3)})`);
console.log(`Output: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB`);
console.log(`Extrapolacao 250 min/mes (600 chunks): $${(costUSD * 600).toFixed(2)} = R$ ${(costUSD * 600 * 5.3).toFixed(2)}`);
console.log();
console.log(`🎬 ${desktopPath}`);
