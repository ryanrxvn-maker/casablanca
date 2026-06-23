/**
 * scripts/test-dreamface.mjs — teste E2E server-side do motor DreamFace.
 *
 * Roda o pipeline REAL de lib/dreamface-api.ts (mesmo que a rota
 * /api/tools/lipsync usa) contra a conta DreamFace, sem subir o Next.
 * Prova que o cookie + headers + uploads + submit + poll + resolve do
 * MP4 funcionam server-to-server.
 *
 * USO:
 *   1. Preencha DREAMFACE_COOKIE / DREAMFACE_ACCOUNT_ID / DREAMFACE_USER_ID
 *      no .env.local (ver .env.local.example).
 *   2. node scripts/test-dreamface.mjs
 *      (opcional) node scripts/test-dreamface.mjs <video_url> <audio_url> <audio_ms>
 *
 * Defaults usam um rosto + áudio públicos só pra validar o caminho.
 */

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── carrega .env.local (sem dep externa) ──
function loadEnv(file) {
  if (!existsSync(file)) return;
  const txt = readFileSync(file, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined && val !== '') process.env[key] = val;
  }
}
loadEnv('.env.local');

const VIDEO_URL =
  process.argv[2] ||
  'https://cdns3.dreamfaceapp.com/web/common/material/d6acae3fdaf0453e848e842ac768e003.mp4';
const AUDIO_URL =
  process.argv[3] ||
  'https://uss3.dreamfaceapp.com/web/avatar/audio/5dbb86bc-6bf2-4a10-8bdb-803c1dd8fb8f.mp3';
const AUDIO_MS = Number(process.argv[4] || 3000);

function mask(s) {
  if (!s) return '(vazio)';
  return s.length <= 8 ? '***' : s.slice(0, 4) + '…' + s.slice(-2);
}

async function main() {
  console.log('── DreamFace E2E ──');
  console.log('cookie:', process.env.DREAMFACE_COOKIE ? 'presente (opcional)' : 'não usado — auth é por account_id/user_id ✓');
  console.log('account_id:', process.env.DREAMFACE_ACCOUNT_ID || 'FALTANDO');
  console.log('user_id:', process.env.DREAMFACE_USER_ID || 'FALTANDO');
  console.log('proxy:', process.env.DREAMFACE_PROXY_URL ? 'ativo' : 'direto (sem proxy)');
  console.log('');

  if (!process.env.DREAMFACE_ACCOUNT_ID || !process.env.DREAMFACE_USER_ID) {
    console.error('❌ Faltam DREAMFACE_ACCOUNT_ID / DREAMFACE_USER_ID no .env.local.');
    process.exit(1);
  }

  // bundle a lib TS -> ESM temporário e importa
  const outfile = join(mkdtempSync(join(tmpdir(), 'df-')), 'lib.mjs');
  await build({
    entryPoints: ['lib/dreamface-api.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    external: ['undici'],
    logLevel: 'silent',
  });
  const lib = await import(pathToFileURL(outfile).href);

  console.log('1) baixando vídeo + áudio de teste…');
  const [vr, ar] = await Promise.all([fetch(VIDEO_URL), fetch(AUDIO_URL)]);
  if (!vr.ok) throw new Error('vídeo HTTP ' + vr.status);
  if (!ar.ok) throw new Error('áudio HTTP ' + ar.status);
  const videoBuffer = Buffer.from(await vr.arrayBuffer());
  const audioBuffer = Buffer.from(await ar.arrayBuffer());
  console.log(`   vídeo ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB · áudio ${(audioBuffer.length / 1024).toFixed(0)}KB`);

  // ── Testa o CAMINHO ASSÍNCRONO REAL (o mesmo que a rota web usa agora):
  //    startLipsync (submete e volta) → checkLipsyncStatus (poll leve em loop)
  //    → resolveMp4. Prova que start + status + resolve funcionam separados. ──
  const t0 = Date.now();

  console.log('2) START (upload + registra avatar + submit)…');
  const { animateId, avatarId } = await lib.startLipsync({
    videoBuffer,
    videoName: 'e2e_face.mp4',
    videoType: vr.headers.get('content-type')?.split(';')[0] || 'video/mp4',
    audioBuffer,
    audioName: 'e2e_voice.mp3',
    audioType: ar.headers.get('content-type')?.split(';')[0] || 'audio/mpeg',
    audioMs: AUDIO_MS,
    onStage: (s) => console.log('   …', s),
  });
  const submitSecs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`   ✓ submetido em ${submitSecs}s (sem esperar render) — animate_id ${mask(animateId)} · avatar ${mask(avatarId)}`);

  console.log('3) POLL /status (cada checagem é leve, igual à rota web)…');
  const POLL_TIMEOUT_MS = 280_000;
  const POLL_EVERY_MS = 3000;
  let workId = '';
  for (;;) {
    if (Date.now() - t0 > POLL_TIMEOUT_MS) throw new Error('poll estourou o timeout do teste');
    const st = await lib.checkLipsyncStatus(
      { accountId: process.env.DREAMFACE_ACCOUNT_ID, userId: process.env.DREAMFACE_USER_ID,
        appVersion: process.env.DREAMFACE_APP_VERSION || '4.7.1',
        templateId: process.env.DREAMFACE_TEMPLATE_ID || '6606889f54e4e700070db4b1',
        cookie: process.env.DREAMFACE_COOKIE, proxyUrl: process.env.DREAMFACE_PROXY_URL },
      animateId,
    );
    if (st.status === 'done') { workId = st.workId; break; }
    if (st.status === 'failed') throw new Error('o motor reportou falha (web_work_status -1)');
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
  }

  console.log('');
  console.log('4) RESOLVE MP4…');
  const url = await lib.resolveMp4(
    { accountId: process.env.DREAMFACE_ACCOUNT_ID, userId: process.env.DREAMFACE_USER_ID,
      appVersion: process.env.DREAMFACE_APP_VERSION || '4.7.1',
      templateId: process.env.DREAMFACE_TEMPLATE_ID || '6606889f54e4e700070db4b1',
      cookie: process.env.DREAMFACE_COOKIE, proxyUrl: process.env.DREAMFACE_PROXY_URL },
    workId,
  );

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`✅ MP4 pronto em ${secs}s (total) — work_id ${mask(workId)}`);

  // confirma que o MP4 é baixável
  const head = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  console.log('   MP4 fetch:', head.status, head.headers.get('content-type'));
  console.log('   url host:', new URL(url).host);
  console.log('');
  console.log(head.ok ? '🎉 E2E ASSÍNCRONO OK — start + status + resolve funcionando server-to-server.' : '⚠ MP4 não baixou (verifique).');
}

main().catch((e) => {
  console.error('');
  console.error('❌ Falhou:', e?.code ? `[${e.code}] ` : '', e?.message || e);
  process.exit(1);
});
