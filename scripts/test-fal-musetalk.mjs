/**
 * Teste rapido do fal-ai/musetalk com TESTE LIP ME.mp4 chunk 25s.
 * Saldo Fal atual: ~$0.55. MuseTalk: ~$0.20-0.40 por 25s.
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fal } from '@fal-ai/client';

const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';
const FAL_KEY = (await readFile('.env.local', 'utf-8'))
  .match(/^FAL_KEY=(.+)$/m)?.[1].trim();
if (!FAL_KEY) { console.error('FAL_KEY nao encontrada'); process.exit(1); }
fal.config({ credentials: FAL_KEY });

const tmpDir = join(tmpdir(), `fal-musetalk-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-500)))));
  });
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

/* 1. Chunk 25s */
console.log('═══ 1. Chunk 25s otimizado ═══');
const t0 = Date.now();
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
console.log(`✓ Chunk em ${fmt(Date.now() - t0)}\n`);

/* 2. Upload pro Fal */
console.log('═══ 2. Upload Fal storage ═══');
const t1 = Date.now();
const videoBytes = await readFile(chunkPath);
const audioBytes = await readFile(audioPath);
const videoFile = new File([videoBytes], 'chunk.mp4', { type: 'video/mp4' });
const audioFile = new File([audioBytes], 'audio.wav', { type: 'audio/wav' });
const [video_url, audio_url] = await Promise.all([
  fal.storage.upload(videoFile),
  fal.storage.upload(audioFile),
]);
console.log(`✓ Upload em ${fmt(Date.now() - t1)}`);
console.log(`  Video: ${video_url}`);
console.log(`  Audio: ${audio_url}\n`);

/* 3. Roda fal-ai/musetalk */
console.log('═══ 3. fal-ai/musetalk ═══');
const t2 = Date.now();
try {
  const result = await fal.subscribe('fal-ai/musetalk', {
    input: {
      source_video_url: video_url,
      audio_url,
    },
    logs: false,
  });
  const outputUrl = result.data?.video?.url || result.data?.video_url;
  if (!outputUrl) {
    console.error('Sem output:', JSON.stringify(result.data).slice(0, 500));
    process.exit(1);
  }
  console.log(`✓ Geracao em ${fmt(Date.now() - t2)}`);
  console.log(`  Output: ${outputUrl}\n`);

  /* 4. Download + copia pra Desktop */
  console.log('═══ 4. Download + copia ═══');
  const out = await fetch(outputUrl);
  const buf = Buffer.from(await out.arrayBuffer());
  const desktopPath = 'D:\\Área de Trabalho\\TESTE LIP ME - RESULTADO MUSETALK FAL.mp4';
  await writeFile(desktopPath, buf);
  const size = (buf.length / 1024 / 1024).toFixed(1);
  console.log(`✓ Salvo: ${desktopPath} (${size}MB)\n`);

  console.log('═══════════════════════════════════════════════');
  console.log('✅ MUSETALK FAL COMPLETO');
  console.log('═══════════════════════════════════════════════');
  console.log(`Tempo total: ${fmt(Date.now() - t0)}`);
  console.log(`🎬 Arquivo: ${desktopPath}`);
} catch (e) {
  console.error('ERRO:', e?.message || e);
  if (String(e).match(/balance|credit|insufficient/i)) {
    console.error('\n💸 Saldo Fal insuficiente. Recarregue em https://fal.ai/dashboard/billing');
  }
  process.exit(1);
}
