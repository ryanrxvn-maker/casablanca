import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const dir = path.join(root, '.test-tmp', 'downloader-live');
await mkdir(dir, { recursive: true });
const install = path.join(process.env.LOCALAPPDATA, 'AutoEditDownloader');
const base = 'http://127.0.0.1:47940';
const child = spawn(process.execPath, ['engine/dist/server.cjs'], { windowsHide: true, env: {
  ...process.env, AUTOEDIT_ENGINE_CONFIG_DIR: dir, DARKO_PORT: '47940',
  YTDLP_PATH: path.join(install, 'bin', 'yt-dlp.exe'), FFMPEG_PATH: path.join(install, 'bin', 'ffmpeg.exe'),
  PLAYWRIGHT_BROWSERS_PATH: path.join(install, 'ms-playwright'),
} });
let log = '';
child.stdout.on('data', data => { log += data; });
child.stderr.on('data', data => { log += data; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await pause(100); }
  const health = await (await fetch(base + '/health')).json();
  assert.equal(health.version, '1.2.1');
  assert.ok(health.capabilities.includes('download-jobs-v1'));
  const { token } = await (await fetch(base + '/pair')).json();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'chrome-extension://autoedit-test' };
  assert.equal((await fetch(base + '/jobs', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await fetch(base + '/pair', { headers: { origin: 'https://untrusted.example' } })).status, 403);
  const modes = process.argv.includes('--all') ? ['video', 'audio-mp3', 'audio-wav'] : ['video'];
  const results = [];
  for (const mode of modes) {
    const input = { url: 'https://www.youtube.com/watch?v=NIGgXN7YMM4&list=RDNIGgXN7YMM4&start_radio=1', mode, quality: '480', requestId: `live-${mode}-${Date.now()}` };
    const start = Date.now();
    const res = await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(res.status, 202);
    const queued = await res.json();
    assert.ok(Date.now() - start < 5000, 'submission must return immediately');
    const duplicate = await (await fetch(base + '/jobs', { method: 'POST', headers, body: JSON.stringify(input) })).json();
    assert.equal(duplicate.id, queued.id);
    let job;
    for (let i = 0; i < 600; i++) {
      job = await (await fetch(base + '/jobs/' + queued.id, { headers })).json();
      if (['ready', 'error'].includes(job.state)) break;
      if (i % 15 === 0) console.log(`${mode}: ${job.state} (${Math.round((Date.now() - start) / 1000)}s)`);
      await pause(1000);
    }
    assert.equal(job.state, 'ready', job.error || 'timed out');
    const url = `${base}/jobs/${job.id}/file?t=${encodeURIComponent(token)}`;
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), job.size);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, job.size);
    const dest = path.join(dir, job.filename);
    await writeFile(dest, bytes);
    const range = await fetch(url, { headers: { range: 'bytes=100-199' } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(100, 200));
    assert.equal((await fetch(url, { headers: { range: `bytes=${job.size}-` } })).status, 416);
    const result = { mode, filename: job.filename, size: job.size, mime: job.mime, seconds: Math.round((Date.now() - start) / 1000), path: dest };
    console.log(JSON.stringify(result)); results.push(result);
  }
  await writeFile(path.join(dir, 'verification.json'), JSON.stringify({ health, results, verifiedAt: new Date().toISOString() }, null, 2));
} finally {
  child.kill();
  await writeFile(path.join(dir, 'engine-test.log'), log);
}
