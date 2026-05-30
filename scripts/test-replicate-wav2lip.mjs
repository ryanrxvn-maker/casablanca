/**
 * Teste end-to-end do pipeline Replicate Wav2Lip.
 *
 * Flow:
 *   1. Pre-process video (720p@25fps + audio limpo) com ffmpeg
 *   2. Upload pro Replicate Files API
 *   3. Lista versoes do modelo cjwbw/wav2lip e usa a mais recente
 *   4. Cria prediction com video+audio (mesmo arquivo, sync garantido)
 *   5. Polling ate completar
 *   6. Download output
 *   7. Pos-process com ffmpeg (unsharp + denoise + grading)
 *   8. Sobe final pro Replicate Files
 *   9. Imprime URL pra revisao
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';

/* Lê token do .env.local */
const envText = await readFile('.env.local', 'utf-8');
const tokenMatch = envText.match(/^REPLICATE_API_TOKEN=(.+)$/m);
if (!tokenMatch) {
  console.error('REPLICATE_API_TOKEN nao encontrada no .env.local');
  process.exit(1);
}
const TOKEN = tokenMatch[1].trim();

const tmpDir = join(tmpdir(), `replicate-test-${Date.now()}`);
await mkdir(tmpDir, { recursive: true });
console.log(`Workspace: ${tmpDir}\n`);

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function runCmd(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`${label} exit ${code}: ${stderr.slice(-500)}`));
      else resolve();
    });
  });
}

/* 1. PROBE */
console.log('═══ 1. PROBE ═══');
const origStat = await stat(VIDEO_PATH);
console.log(`Original: ${(origStat.size / 1024 / 1024).toFixed(1)}MB\n`);

/* 2. PRE-PROCESS UNIFICADO */
console.log('═══ 2. PREPROCESS (720p@25fps + audio limpo) ═══');
const tPre = Date.now();
const optPath = join(tmpDir, 'sync_opt.mp4');
await runCmd('ffmpeg', [
  '-i', VIDEO_PATH,
  '-vf', "scale='min(1280,iw)':-2,fps=25",
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-pix_fmt', 'yuv420p',
  '-g', '50',
  '-af', 'highpass=f=80,dynaudnorm=p=0.9:m=10,loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=60',
  '-c:a', 'aac',
  '-b:a', '192k',
  '-ac', '1',
  '-ar', '44100',
  '-shortest',
  '-async', '1',
  '-movflags', '+faststart',
  '-y',
  optPath,
], 'preproc');
const optStat = await stat(optPath);
console.log(`✓ Otimizado em ${fmtTime(Date.now() - tPre)} — ${(optStat.size / 1024 / 1024).toFixed(1)}MB\n`);

/* 3. EXTRAI AUDIO COMO ARQUIVO SEPARADO (Wav2Lip espera input separado) */
console.log('═══ 3. EXTRAI AUDIO ═══');
const tAud = Date.now();
const audioPath = join(tmpDir, 'audio.wav');
await runCmd('ffmpeg', [
  '-i', optPath,
  '-vn',
  '-c:a', 'pcm_s16le',
  '-ar', '16000',
  '-ac', '1',
  '-y',
  audioPath,
], 'extract-audio');
const audStat = await stat(audioPath);
console.log(`✓ Audio em ${fmtTime(Date.now() - tAud)} — ${(audStat.size / 1024 / 1024).toFixed(2)}MB\n`);

/* 4. UPLOAD pro Replicate Files API */
async function uploadToReplicate(filePath, type) {
  const bytes = await readFile(filePath);
  const fd = new FormData();
  const blob = new Blob([bytes], { type });
  fd.append('content', blob, filePath.split(/[\\/]/).pop());
  fd.append('type', type);

  const res = await fetch('https://api.replicate.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Token ${TOKEN}` },
    body: fd,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Upload falhou ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.urls?.get || `https://api.replicate.com/v1/files/${data.id}`;
}

console.log('═══ 4. UPLOAD pro Replicate Files API ═══');
const tUp = Date.now();
const [videoUrl, audioUrl] = await Promise.all([
  uploadToReplicate(optPath, 'video/mp4'),
  uploadToReplicate(audioPath, 'audio/wav'),
]);
console.log(`✓ Upload em ${fmtTime(Date.now() - tUp)}`);
console.log(`  Video: ${videoUrl}`);
console.log(`  Audio: ${audioUrl}\n`);

/* 5. CRIA PREDICTION direto no model endpoint (pixverse eh official) */
console.log('═══ 5. CRIA PREDICTION pixverse/lipsync ═══');
const tGen = Date.now();
const predRes = await fetch('https://api.replicate.com/v1/models/pixverse/lipsync/predictions', {
  method: 'POST',
  headers: {
    Authorization: `Token ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    input: {
      video: videoUrl,
      audio: audioUrl,
    },
  }),
});
if (!predRes.ok) {
  console.error('Falha criando prediction:', predRes.status, await predRes.text());
  process.exit(1);
}
const pred = await predRes.json();
console.log(`Prediction criada: ${pred.id} · status: ${pred.status}`);

/* 7. POLLING */
let final = pred;
let lastStatus = pred.status;
while (final.status === 'starting' || final.status === 'processing') {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
    headers: { Authorization: `Token ${TOKEN}` },
  });
  if (!r.ok) {
    console.error('Falha no polling:', r.status);
    break;
  }
  final = await r.json();
  if (final.status !== lastStatus) {
    process.stdout.write(`\n  → ${final.status}`);
    lastStatus = final.status;
  } else {
    process.stdout.write('.');
  }
}
console.log(`\n`);

if (final.status !== 'succeeded') {
  console.error('Prediction falhou:', final.status);
  console.error('Error:', final.error);
  console.error('Logs:', final.logs?.slice(-1000));
  process.exit(1);
}

const outputUrl = typeof final.output === 'string' ? final.output : final.output?.[0];
if (!outputUrl) {
  console.error('Sem output URL:', JSON.stringify(final.output).slice(0, 500));
  process.exit(1);
}

const metrics = final.metrics || {};
console.log(`✓ Geracao em ${fmtTime(Date.now() - tGen)}`);
console.log(`  Predict time: ${metrics.predict_time?.toFixed(1) || '?'}s`);
console.log(`  Output URL: ${outputUrl}\n`);

/* 8. DOWNLOAD OUTPUT */
console.log('═══ 7. DOWNLOAD OUTPUT ═══');
const tDown = Date.now();
const outRes = await fetch(outputUrl);
if (!outRes.ok) throw new Error(`Download falhou: ${outRes.status}`);
const outBuf = Buffer.from(await outRes.arrayBuffer());
const rawOutPath = join(tmpDir, 'raw_output.mp4');
await writeFile(rawOutPath, outBuf);
console.log(`✓ Download em ${fmtTime(Date.now() - tDown)} — ${(outBuf.length / 1024 / 1024).toFixed(1)}MB\n`);

/* 9. POS-PROCESSING (unsharp + denoise + grading) */
console.log('═══ 8. POS-PROCESSING (unsharp + denoise + grading) ═══');
const tPost = Date.now();
const polishedPath = join(tmpDir, 'lipsync_final.mp4');
await runCmd('ffmpeg', [
  '-i', rawOutPath,
  '-vf', 'hqdn3d=1:1:4:4,unsharp=5:5:0.7:5:5:0.0,eq=contrast=1.04:saturation=1.05:gamma=0.98,format=yuv420p',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'copy',
  '-movflags', '+faststart',
  '-y',
  polishedPath,
], 'postproc');
const finalStat = await stat(polishedPath);
console.log(`✓ Pos-process em ${fmtTime(Date.now() - tPost)} — Final: ${(finalStat.size / 1024 / 1024).toFixed(1)}MB\n`);

/* 10. UPLOAD FINAL PRA URL SERVIVEL */
console.log('═══ 9. UPLOAD FINAL ═══');
const tFinal = Date.now();
const finalUrl = await uploadToReplicate(polishedPath, 'video/mp4');
console.log(`✓ Upload em ${fmtTime(Date.now() - tFinal)}\n`);

console.log('═══════════════════════════════════════════════');
console.log('✅ PIPELINE REPLICATE COMPLETO');
console.log('═══════════════════════════════════════════════');
console.log(`Tempo total: ${fmtTime(Date.now() - tPre)}`);
console.log(`Predict time GPU: ${metrics.predict_time?.toFixed(1) || '?'}s`);
console.log(`Custo estimado: ~$${((metrics.predict_time || 100) * 0.000225).toFixed(4)} (~R$ ${((metrics.predict_time || 100) * 0.000225 * 5.3).toFixed(2)})`);
console.log();
console.log('🎬 URL FINAL:');
console.log(finalUrl);
console.log();
console.log(`Workspace: ${tmpDir}`);
