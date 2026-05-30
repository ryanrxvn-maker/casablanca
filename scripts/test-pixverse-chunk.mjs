/**
 * Teste do pixverse/lipsync com chunk de 25s (limite do modelo).
 * Mede custo real pra calcular extrapolacao.
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';

const envText = await readFile('.env.local', 'utf-8');
const TOKEN = envText.match(/^REPLICATE_API_TOKEN=(.+)$/m)[1].trim();

const tmpDir = join(tmpdir(), `pixverse-test-${Date.now()}`);
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
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.slice(-500)));
      else resolve();
    });
  });
}

/* 1. Cria chunk de 25s otimizado (720p@25fps, audio limpo) */
console.log('═══ 1. CRIA CHUNK 25s OTIMIZADO ═══');
const tPre = Date.now();
const chunkPath = join(tmpDir, 'chunk_25s.mp4');
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
const chunkStat = await stat(chunkPath);
console.log(`✓ Chunk em ${fmtTime(Date.now()-tPre)} — ${(chunkStat.size/1024/1024).toFixed(1)}MB\n`);

/* 2. Extrai audio */
const audioPath = join(tmpDir, 'audio.wav');
await runCmd('ffmpeg', ['-i', chunkPath, '-vn', '-c:a', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', audioPath]);

/* 3. Upload */
async function uploadToReplicate(filePath, type) {
  const bytes = await readFile(filePath);
  const fd = new FormData();
  fd.append('content', new Blob([bytes], { type }), filePath.split(/[\\/]/).pop());
  fd.append('type', type);
  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Token ${TOKEN}` },
    body: fd,
  });
  const data = await res.json();
  return data.urls?.get || `https://api.replicate.com/v1/files/${data.id}`;
}

console.log('═══ 2. UPLOAD ═══');
const tUp = Date.now();
const [videoUrl, audioUrl] = await Promise.all([
  uploadToReplicate(chunkPath, 'video/mp4'),
  uploadToReplicate(audioPath, 'audio/wav'),
]);
console.log(`✓ Upload em ${fmtTime(Date.now()-tUp)}\n`);

/* 4. Roda Pixverse */
console.log('═══ 3. RODA pixverse/lipsync ═══');
const tGen = Date.now();
const predRes = await fetch('https://api.replicate.com/v1/models/pixverse/lipsync/predictions', {
  method: 'POST',
  headers: { Authorization: `Token ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ input: { video: videoUrl, audio: audioUrl } }),
});
const pred = await predRes.json();
if (!predRes.ok) { console.error('Erro:', JSON.stringify(pred).slice(0,500)); process.exit(1); }

console.log(`Prediction: ${pred.id} · ${pred.status}`);

let final = pred;
while (final.status === 'starting' || final.status === 'processing') {
  await new Promise(r => setTimeout(r, 3000));
  const r = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
    headers: { Authorization: `Token ${TOKEN}` }
  });
  final = await r.json();
  process.stdout.write('.');
}
console.log();

if (final.status !== 'succeeded') {
  console.error('Falhou:', final.status);
  console.error('Error:', final.error);
  console.error('Logs:', final.logs?.slice(-500));
  process.exit(1);
}

const outputUrl = typeof final.output === 'string' ? final.output : final.output?.[0];
console.log(`\n✓ Geracao em ${fmtTime(Date.now()-tGen)}`);
console.log(`Predict time GPU: ${final.metrics?.predict_time?.toFixed(1) || '?'}s`);

/* 5. Download + post-process */
console.log('\n═══ 4. DOWNLOAD + POSTPROCESS ═══');
const outBuf = Buffer.from(await (await fetch(outputUrl)).arrayBuffer());
const rawPath = join(tmpDir, 'raw.mp4');
await writeFile(rawPath, outBuf);
console.log(`Raw: ${(outBuf.length/1024/1024).toFixed(1)}MB`);

const finalPath = join(tmpDir, 'pixverse_final.mp4');
await runCmd('ffmpeg', [
  '-i', rawPath,
  '-vf', 'hqdn3d=1:1:4:4,unsharp=5:5:0.7:5:5:0.0,eq=contrast=1.04:saturation=1.05:gamma=0.98,format=yuv420p',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'copy', '-movflags', '+faststart', '-y', finalPath,
]);
const finalStat = await stat(finalPath);
console.log(`Final: ${(finalStat.size/1024/1024).toFixed(1)}MB\n`);

console.log('═══════════════════════════════════════════════');
console.log('✅ PIXVERSE TESTE COMPLETO');
console.log('═══════════════════════════════════════════════');
console.log(`Chunk de 25s × ratio = ${final.metrics?.predict_time?.toFixed(1) || '?'}s GPU`);
console.log(`Custo desse chunk: medindo pelo Replicate billing...`);
console.log(`\nArquivo local: ${finalPath}`);
console.log(`\n🎬 Workspace: ${tmpDir}`);
