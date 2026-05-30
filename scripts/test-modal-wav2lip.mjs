/**
 * Teste do pipeline Modal Wav2Lip end-to-end.
 * Mede custo REAL via tempo de execucao.
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';
const MODAL_BASE = 'https://ryanrxvn-maker--casablanca-lipsync-web.modal.run';

const tmpDir = join(tmpdir(), `modal-test-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-500)))));
  });
}

/* 1. Cria chunk 25s otimizado */
console.log('═══ 1. CHUNK 25s OTIMIZADO ═══');
const tPre = Date.now();
const chunkPath = join(tmpDir, 'chunk.mp4');
await runCmd('ffmpeg', [
  '-i', VIDEO_PATH,
  '-t', '25',
  '-vf', "scale='min(1280,iw)':-2,fps=25",
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
  '-af', 'highpass=f=80,dynaudnorm=p=0.9:m=10,loudnorm=I=-16:TP=-1.5:LRA=11',
  '-c:a', 'aac', '-b:a', '192k', '-ac', '1', '-ar', '44100',
  '-shortest', '-async', '1', '-movflags', '+faststart', '-y',
  chunkPath,
]);
const audioPath = join(tmpDir, 'audio.wav');
await runCmd('ffmpeg', ['-i', chunkPath, '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioPath]);
console.log(`✓ Preproc em ${fmtTime(Date.now() - tPre)}\n`);

/* 2. Upload pro Modal */
async function modalUpload(filePath, ext) {
  const body = await readFile(filePath);
  const res = await fetch(`${MODAL_BASE}/up?ext=${ext}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  if (!res.ok) throw new Error(`Upload ${ext} falhou: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

console.log('═══ 2. UPLOAD pro Modal ═══');
const tUp = Date.now();
const [videoId, audioId] = await Promise.all([
  modalUpload(chunkPath, 'mp4'),
  modalUpload(audioPath, 'wav'),
]);
console.log(`✓ Upload em ${fmtTime(Date.now() - tUp)}`);
console.log(`  Video id: ${videoId}`);
console.log(`  Audio id: ${audioId}\n`);

/* 3. Chama /generate */
const videoUrl = `${MODAL_BASE}/file?id=${videoId}`;
const audioUrl = `${MODAL_BASE}/file?id=${audioId}`;

console.log('═══ 3. RODA Wav2Lip no Modal ═══');
const tGen = Date.now();
const genRes = await fetch(`${MODAL_BASE}/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl }),
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
console.log('═══ 4. DOWNLOAD ═══');
const tDown = Date.now();
const outRes = await fetch(`${MODAL_BASE}/file?id=${gen.id}`);
if (!outRes.ok) throw new Error(`Download falhou: ${outRes.status}`);
const outBuf = Buffer.from(await outRes.arrayBuffer());
const rawPath = join(tmpDir, 'raw.mp4');
await writeFile(rawPath, outBuf);
console.log(`✓ Download em ${fmtTime(Date.now() - tDown)} — ${(outBuf.length / 1024 / 1024).toFixed(1)}MB\n`);

/* 5. Post-process */
console.log('═══ 5. POS-PROCESS (unsharp + denoise + grading) ═══');
const tPost = Date.now();
const finalPath = join(tmpDir, 'final.mp4');
await runCmd('ffmpeg', [
  '-i', rawPath,
  '-vf', 'hqdn3d=1:1:4:4,unsharp=5:5:0.7:5:5:0.0,eq=contrast=1.04:saturation=1.05:gamma=0.98,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-movflags', '+faststart', '-y', finalPath,
]);
console.log(`✓ Pos-process em ${fmtTime(Date.now() - tPost)}\n`);

/* 6. Copia pra Desktop */
const desktopPath = 'D:\\Área de Trabalho\\TESTE LIP ME - RESULTADO MODAL WAV2LIP.mp4';
await runCmd('cmd', ['/c', 'copy', '/Y', finalPath.replace(/\//g, '\\'), desktopPath]);

const finalStat = await stat(finalPath);

console.log('═══════════════════════════════════════════════');
console.log('✅ MODAL WAV2LIP COMPLETO');
console.log('═══════════════════════════════════════════════');
console.log(`Geracao GPU: ${fmtTime(elapsedGen)}`);
// Custo estimado: T4 = $0.000164/s
const gpuSec = elapsedGen / 1000;
const costUSD = gpuSec * 0.000164;
console.log(`Custo estimado: $${costUSD.toFixed(4)} (R$ ${(costUSD * 5.3).toFixed(3)})`);
console.log(`Output: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB`);
console.log();
console.log(`🎬 Arquivo: ${desktopPath}`);
console.log();
console.log(`Extrapolacao 300 min/mes (720 chunks 25s):`);
console.log(`  $${(costUSD * 720).toFixed(2)} = R$ ${(costUSD * 720 * 5.3).toFixed(2)}`);
