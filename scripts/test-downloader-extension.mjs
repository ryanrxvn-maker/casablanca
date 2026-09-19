import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import path from 'node:path';
const root = process.cwd();
const utils = await fs.readFile(path.join(root, 'extension-downloader/download-utils.js'), 'utf8');
const background = await fs.readFile(path.join(root, 'extension-downloader/bg.js'), 'utf8');
const bridge = await fs.readFile(path.join(root, 'extension-downloader/bridge.js'), 'utf8');
const contentScript = await fs.readFile(path.join(root, 'extension-downloader/content.js'), 'utf8');
let passed = 0;
async function check(name, test) { await test(); console.log(`PASS ${name}`); passed++; }
function harness(options = {}) {
  const stored = options.stored || {};
  const records = options.records || [];
  const listeners = { changes: [], alarm: [], message: [] };
  const requests = [];
  let calls = 0;
  let nextId = records.length + 1;
  const timers = new Map(); let timerId = 0;
  const chrome = {
    runtime: { id: 'test-extension', getManifest: () => ({ version: '1.9.0' }),
      onMessage: { addListener: f => listeners.message.push(f) },
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      sendMessage: (_msg, cb) => cb?.() },
    tabs: { sendMessage: (_id, _msg, cb) => cb?.() },
    alarms: { create() {}, onAlarm: { addListener: f => listeners.alarm.push(f) } },
    storage: { local: {
      get: async keys => Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, structuredClone(stored[key])])),
      set: async values => Object.assign(stored, structuredClone(values))
    } },
    downloads: {
      onChanged: { addListener: f => listeners.changes.push(f) },
      search: (query, cb) => cb(records.filter(r => query.id == null || query.id === r.id)),
      cancel: (id, cb) => { const r = records.find(r => r.id === id); if (r) { r.state = 'interrupted'; r.error = 'USER_CANCELED'; } cb?.(); },
      download: (input, cb) => {
        calls++;
        const record = { id: nextId++, url: input.url, filename: input.filename, mime: options.browserMime || 'video/mp4', state: options.instant ? 'complete' : 'in_progress', bytesReceived: options.instant ? 2000 : 0, totalBytes: 2000, fileSize: options.instant ? 2000 : 0 };
        records.push(record);
        if (options.instant) for (const f of listeners.changes) f({ id: record.id, state: { current: 'complete' } });
        cb(record.id);
      }
    }
  };
  const fetch = async (input, opts = {}) => {
    const url = new URL(input); requests.push({ url: url.href, method: opts.method || 'GET', headers: opts.headers });
    if (options.fetch) { const override = await options.fetch(url, opts); if (override) return override; }
    if (url.pathname === '/health') return Response.json({ app: 'darkolab-downloader-engine', version: '1.2.1', capabilities: options.legacy ? [] : ['download-jobs-v1'] });
    if (url.pathname === '/pair') return Response.json({ token: 'fresh-token' });
    if (url.pathname === '/jobs' && opts.method === 'POST') return Response.json({ id: 'server-job', state: 'processing' });
    if (url.pathname === '/jobs/server-job') return Response.json({ id: 'server-job', state: options.remoteState || 'ready', filename: options.filename || 'video.mp4', mime: options.mime || 'video/mp4', size: 2000, error: options.remoteError });
    if (url.pathname === '/jobs/server-job/file') return new Response(null, { headers: { 'content-type': options.headMime || 'video/mp4', 'content-length': '2000' } });
    throw new Error('Unexpected URL: ' + input);
  };
  const context = vm.createContext({ chrome, fetch, Response, URL, URLSearchParams, AbortSignal, AbortController, crypto: webcrypto, structuredClone, TextDecoder, Uint8Array, ArrayBuffer, console,
    setTimeout: (f, _ms) => { const id = ++timerId; timers.set(id, f); return id; }, clearTimeout: id => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
    btoa: s => Buffer.from(s, 'binary').toString('base64') });
  context.importScripts = () => vm.runInContext(utils, context);
  vm.runInContext(background, context);
  const api = vm.runInContext('({ enqueue, tick, advance, loadJobs, inspectDownload, startBrowserDownload, discoverEngine, terminal, normalizeUrl, isMedia, humanError, persist, publicJob })', context);
  return { api, stored, records, requests, chrome, listeners, timers, context, get calls() { return calls; } };
}
await check('normalize YouTube watch/list/radio into one video; reject invalid protocols', () => {
  const h = harness(); assert.equal(h.api.normalizeUrl('https://www.youtube.com/watch?v=NIGgXN7YMM4&list=RDNIGgXN7YMM4&start_radio=1'), 'https://www.youtube.com/watch?v=NIGgXN7YMM4');
  assert.throws(() => h.api.normalizeUrl('javascript:alert(1)')); assert.throws(() => h.api.normalizeUrl('https://user:secret@host.test/a'));
});
await check('enqueue is durable and repeated clicks share one job', async () => {
  const h = harness(); const a = await h.api.enqueue({ url: 'https://youtu.be/example', reqId: 'req1' });
  const b = await h.api.enqueue({ url: 'https://youtu.be/example', reqId: 'req2' });
  assert.equal(a.id, b.id); assert.equal(h.stored.downloadJobsV2.length, 1); assert.equal(h.calls, 0);
});
await check('preparation is asynchronous, short requests never send /get into browser', async () => {
  const h = harness({ remoteState: 'processing' }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'preparing'); assert.equal(h.calls, 0); assert.ok(h.requests.some(r => r.method === 'POST' && r.url.endsWith('/jobs'))); assert.ok(!h.requests.some(r => new URL(r.url).pathname === '/get'));
});
await check('browser initiation is not reported as completion', async () => {
  const h = harness(); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(h.calls, 1); assert.equal(job.state, 'downloading'); assert.equal(job.phase, 'saving');
  h.records[0].state = 'complete'; h.records[0].bytesReceived = 2000; await h.api.tick(); assert.equal(job.state, 'complete');
});
await check('instant Chrome completion before id persistence is recovered', async () => {
  const h = harness({ instant: true }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'complete'); assert.equal(job.pct, 100); assert.equal(h.calls, 1);
});
await check('popup closure / service worker restart resumes same browser download', async () => {
  const first = harness(); const job = await first.api.enqueue({ url: 'https://youtu.be/a' }); await first.api.tick();
  first.records[0].state = 'complete'; first.records[0].bytesReceived = 2000;
  const restarted = harness({ stored: first.stored, records: first.records }); await restarted.api.tick();
  const saved = (await restarted.api.loadJobs()).find(j => j.id === job.id);
  assert.equal(saved.state, 'complete'); assert.equal(restarted.calls, 0);
});
await check('crash between Chrome invocation and id persistence avoids duplicate file', async () => {
  const h = harness(); const job = await h.api.enqueue({ url: 'https://youtu.be/a' });
  job.state = 'delivering'; job.filename = 'video.mp4'; job.delivery = { url: 'http://127.0.0.1:47923/jobs/server-job/file?t=token', startedAt: Date.now() };
  h.records.push({ id: 99, url: job.delivery.url, filename: 'video.mp4', state: 'in_progress', bytesReceived: 1, totalBytes: 2000 });
  await h.api.advance(job); assert.equal(job.downloadId, 99); assert.equal(h.calls, 0);
});
await check('JSON metadata is rejected without creating get.json', async () => {
  const h = harness({ filename: 'get.json', mime: 'application/json' }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'error'); assert.equal(h.calls, 0); assert.equal(job.code, 'INVALID_MEDIA');
});
await check('HEAD media mismatch rejected even if job claims ready video', async () => {
  const h = harness({ headMime: 'application/json' }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'error'); assert.equal(h.calls, 0);
});
await check('existing Pinterest JPEG/PNG/WebP/GIF downloads still complete through preflight and Chrome', async () => {
  for (const [extension, mime] of [['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'], ['gif', 'image/gif']]) {
    const h = harness({ filename: `pinterest.${extension}`, mime, headMime: mime, browserMime: mime, instant: true });
    const job = await h.api.enqueue({ url: 'https://www.pinterest.com/pin/1234567890/', mode: 'video' });
    await h.api.tick();
    assert.equal(job.state, 'complete', extension); assert.equal(h.calls, 1, extension); assert.equal(job.filename, `pinterest.${extension}`);
    assert.equal(h.api.isMedia('application/octet-stream', `pinterest.${extension}`, 2000), true);
  }
});
await check('image support does not admit JSON, HTML, SVG, fake MIME prefixes or empty media', () => {
  const h = harness();
  for (const [mime, filename, size] of [
    ['application/json', 'pinterest.jpg', 2000], ['text/html', 'pinterest.png', 2000],
    ['image/jpeg', 'get.json', 2000], ['image/png', 'error.html', 2000],
    ['image/svg+xml', 'document.svg', 2000], ['application/octet-stream+json', 'pinterest.jpg', 2000],
    ['image/jpeg', 'video.mp4', 2000], ['video/mp4', 'pinterest.jpg', 2000],
    ['image/webp', 'pinterest.webp', 0], ['image/jpeg', 'pinterest.jpg', Infinity],
  ]) assert.equal(h.api.isMedia(mime, filename, size), false, `${mime} ${filename} ${size}`);
  assert.equal(h.api.isMedia('image/jpeg; charset=binary', 'pinterest.jpg', 2000), true);
});
await check('browser JSON / empty transfer never receives success', async () => {
  const h = harness({ instant: true, browserMime: 'application/json' }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'error'); assert.equal(job.code, 'INVALID_MEDIA');
});
await check('legacy motor requires update without unsafe fallback', async () => {
  const h = harness({ legacy: true }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'error'); assert.equal(job.code, 'ENGINE_UPDATE_REQUIRED'); assert.equal(h.calls, 0);
});
await check('newest compatible engine wins when old and new installations coexist', async () => {
  const h = harness({ fetch: (url) => url.pathname === '/health' ? Response.json({ app: 'darkolab-downloader-engine', version: url.port === '47925' ? '1.2.1' : '1.2.0', capabilities: ['download-jobs-v1'] }) : null });
  assert.equal((await h.api.discoverEngine(47923)).port, 47925);
});
await check('expired token repairs once and retries same idempotent request', async () => {
  let unauthorized = true;
  const h = harness({ fetch: (url, options) => { if (url.pathname === '/jobs' && unauthorized) { unauthorized = false; return Response.json({ error: 'expired' }, { status: 401 }); } return null; } });
  const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick(); assert.equal(job.state, 'downloading');
  const posts = h.requests.filter(r => r.method === 'POST'); assert.equal(posts.length, 2);
});
await check('engine restarts recover missing server job and stop after bounded retries', async () => {
  const h = harness({ fetch: url => url.pathname === '/jobs/server-job' ? Response.json({ error: 'missing' }, { status: 404 }) : null });
  const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick(); assert.equal(job.engineRestarts, 1); assert.equal(job.engineJobId, null);
  await h.api.tick(); assert.equal(job.engineRestarts, 2);
});
await check('interrupted network retries are bounded; user cancellation never retries', async () => {
  const h = harness(); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  h.records[0].state = 'interrupted'; h.records[0].error = 'NETWORK_FAILED'; await h.api.inspectDownload(job); assert.equal(job.retries, 1); assert.equal(job.downloadId, null);
  job.downloadId = h.records[0].id; job.retries = 2; await h.api.inspectDownload(job); assert.equal(job.state, 'error');
  h.records[0].error = 'USER_CANCELED'; job.retries = 0; await h.api.inspectDownload(job); assert.equal(job.state, 'canceled'); assert.equal(job.retries, 0);
});
await check('public job never leaks local engine token or delivery URL', async () => {
  const h = harness(); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  const visible = JSON.stringify(h.api.publicJob(job)); assert.ok(!visible.includes('fresh-token')); assert.ok(!visible.includes('/file?t='));
});
await check('a stored queued job is recovered by top-level worker startup', async () => {
  const h = harness(); await h.api.enqueue({ url: 'https://youtu.be/a' });
  const restarted = harness({ stored: h.stored, instant: true }); await restarted.api.tick(); assert.equal(restarted.stored.downloadJobsV2[0].state, 'complete');
});
await check('queue creation and retry paths preserve actual error detail', async () => {
  const h = harness({ remoteState: 'error', remoteError: 'Este vídeo foi removido pelo autor.' }); const job = await h.api.enqueue({ url: 'https://youtu.be/a' }); await h.api.tick();
  assert.equal(job.state, 'error'); assert.equal(job.error, 'Este vídeo foi removido pelo autor.'); assert.equal(h.calls, 0);
});
await check('removed / stale extension content script does not announce installed', async () => {
  const announcements = []; const initial = [];
  const context = vm.createContext({ window: { postMessage: msg => announcements.push(msg), addEventListener() {} }, location: { origin: 'https://www.darkoautoedit.com' },
    chrome: { runtime: { id: undefined, getManifest: () => ({ version: '1.8.0' }), sendMessage() { throw new Error('invalidated'); }, onMessage: { addListener() {} } } },
    setTimeout: callback => { initial.push(callback); return initial.length; }, clearTimeout() {}, setInterval() {}, atob: value => Buffer.from(value, 'base64').toString('binary'), Uint8Array, ArrayBuffer });
  vm.runInContext(bridge, context); for (const callback of initial.slice()) await callback();
  assert.equal(announcements.length, 0);
});
await check('YouTube query cleanup preserves active job; a different video detaches it', () => {
  const intervals = []; let clears = 0;
  const location = { href: 'https://www.youtube.com/watch?v=original&list=radio', hostname: 'www.youtube.com' };
  const context = vm.createContext({ location, URL, refreshCalls: 0,
    window: { addEventListener() {} }, chrome: { runtime: { onMessage: { addListener() {} } } },
    setInterval: callback => { intervals.push(callback); return intervals.length; }, clearInterval: () => clears++,
  });
  // Stub rendering only; execute the shipped navigation and progress handlers.
  const testSource = contentScript.replace('async function refresh() {', 'async function refresh() { globalThis.refreshCalls++; return;')
    .replace(/\s*refresh\(\);\s*\}\)\(\);\s*$/, '\n globalThis.contentTest = { setCurrent: id => { currentJobId = id; }, getCurrent: () => currentJobId, progress }; refresh(); })();');
  vm.runInContext(testSource, context);
  context.contentTest.setCurrent('active-job');
  location.href = 'https://www.youtube.com/watch?v=original'; intervals[0]();
  assert.equal(context.contentTest.getCurrent(), 'active-job'); assert.equal(clears, 0); assert.equal(context.refreshCalls, 1);
  location.href = 'https://www.youtube.com/watch?v=different'; intervals[0]();
  assert.equal(context.contentTest.getCurrent(), null); assert.equal(clears, 1); assert.equal(context.refreshCalls, 2);
  context.contentTest.progress({ id: 'active-job', state: 'complete' });
  assert.equal(context.contentTest.getCurrent(), null, 'Old video completion must not attach to new video');
});
console.log(`\n${passed} downloader extension behavior checks passed.`);
