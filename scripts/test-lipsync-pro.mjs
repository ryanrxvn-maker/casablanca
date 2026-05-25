/**
 * Test lipsync-2-pro vs lipsync-2 — qualidade comparativa.
 *
 * Usa o MESMO video que ja foi uploadado nos testes anteriores
 * (URL do Fal storage do upload de `TESTE LIP ME.mp4`).
 */

import { fal } from '@fal-ai/client';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
const envContent = await readFile(envPath, 'utf-8');
const falKey = envContent.match(/^FAL_KEY=(.+)$/m)?.[1]?.trim();
fal.config({ credentials: falKey });

const VIDEO_PATH = 'C:/Users/Silas/OneDrive/Área de Trabalho/TESTE LIP ME.mp4';

console.log('Subindo arquivo de teste...');
const videoBytes = await readFile(VIDEO_PATH);
const videoFile = new File([new Blob([videoBytes])], 'TESTE LIP ME.mp4', { type: 'video/mp4' });
const url = await fal.storage.upload(videoFile);
console.log(`Upload OK: ${url}`);

console.log('\nChamando fal-ai/sync-lipsync/v2 com model=lipsync-2-pro...');
const t0 = Date.now();

try {
  const result = await fal.subscribe('fal-ai/sync-lipsync/v2', {
    input: {
      video_url: url,
      audio_url: url, // mesmo video pra extrair audio
      model: 'lipsync-2-pro',
      sync_mode: 'cut_off',
    },
    logs: false,
    onQueueUpdate: (update) => {
      if (update.status === 'IN_PROGRESS') process.stdout.write('.');
    },
  });
  console.log(`\n✓ Geracao OK em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('Output:', JSON.stringify(result.data, null, 2));
} catch (err) {
  console.error(`\n✗ ERRO: ${err.message}`);
  if (err.body) console.error('Body:', JSON.stringify(err.body, null, 2));
}
