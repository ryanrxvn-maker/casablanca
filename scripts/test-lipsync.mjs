/**
 * Test script — chama o Fal.ai direto pra reproduzir o erro 422
 * que aparece em produção.
 *
 * Usage:
 *   node scripts/test-lipsync.mjs v1
 *   node scripts/test-lipsync.mjs v2
 */

import { fal } from '@fal-ai/client';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Le FAL_KEY do .env.local
const envPath = join(__dirname, '..', '.env.local');
const envContent = await readFile(envPath, 'utf-8');
const falKey = envContent.match(/^FAL_KEY=(.+)$/m)?.[1]?.trim();
if (!falKey) {
  console.error('FAL_KEY nao achada em .env.local');
  process.exit(1);
}

fal.config({ credentials: falKey });

const version = process.argv[2] ?? 'v1';
const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';

if (!existsSync(VIDEO_PATH)) {
  console.error(`Arquivo nao encontrado: ${VIDEO_PATH}`);
  process.exit(1);
}

console.log(`\n=== Teste LipSync ${version.toUpperCase()} ===`);
console.log(`Video: ${VIDEO_PATH}`);

const videoBytes = await readFile(VIDEO_PATH);
console.log(`Tamanho: ${(videoBytes.length / 1024 / 1024).toFixed(1)}MB`);

// Upload o video pro Fal storage
console.log('\n[1/3] Subindo video pro Fal storage...');
const t0 = Date.now();
const videoBlob = new Blob([videoBytes], { type: 'video/mp4' });
const videoFile = new File([videoBlob], 'TESTE LIP ME.mp4', { type: 'video/mp4' });
const video_url = await fal.storage.upload(videoFile);
console.log(`✓ Upload video em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  URL: ${video_url}`);

// Usa o MESMO arquivo como audio (o Fal aceita extrair audio de video)
console.log('\n[2/3] Subindo o mesmo arquivo como audio (testar se Fal extrai audio do video)...');
const t1 = Date.now();
const audio_url = await fal.storage.upload(videoFile);
console.log(`✓ Upload audio em ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(`  URL: ${audio_url}`);

// Chama o modelo
console.log(`\n[3/3] Chamando modelo ${version}...`);
const t2 = Date.now();

try {
  let result;
  if (version === 'v1') {
    result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
      input: {
        video_url,
        audio_url,
        model: 'lipsync-2',
        sync_mode: 'cut_off',
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          process.stdout.write('.');
        }
      },
    });
  } else {
    result = await fal.subscribe('fal-ai/latentsync', {
      input: {
        video_url,
        audio_url,
        guidance_scale: 1.5,
        loop_mode: 'loop',
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === 'IN_PROGRESS') {
          process.stdout.write('.');
        }
      },
    });
  }

  console.log(`\n✓ Geracao OK em ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  console.log('Output:', JSON.stringify(result.data, null, 2));
} catch (err) {
  console.error(`\n✗ ERRO: ${err.message}`);
  if (err.body) {
    console.error('Body:', JSON.stringify(err.body, null, 2));
  }
  if (err.status) {
    console.error('Status:', err.status);
  }
  if (err.cause) {
    console.error('Cause:', err.cause);
  }
  process.exit(1);
}
