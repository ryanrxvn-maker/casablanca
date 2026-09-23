import assert from 'node:assert/strict';
import vm from 'node:vm';
import { Blob, File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const bridgeCode = buildSync({
  entryPoints: [fileURLToPath(new URL('../lib/stockframe-extension-bridge.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'cjs', target: 'es2022',
}).outputFiles[0].text;
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
let checks = 0;

function environment({ extensions = [{ id: 'stockframe-latest', version: '4.46.2' }], autoDiscovery = true } = {}) {
  const timers = new Map();
  const listeners = [];
  const posted = [];
  const discoveries = [];
  let now = 0;
  let nextTimer = 0;
  let nextUuid = 0;
  const module = { exports: {} };
  class FakeDate extends Date { static now() { return now; } }
  const win = {
    location: { origin: 'https://darkoautoedit.com' },
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(message, origin) {
      if (message.type !== 'SF_PING') { posted.push({ ...message, origin }); return; }
      discoveries.push(message);
      if (!autoDiscovery) return;
      for (const extension of extensions) {
        send(message, 'SF_PONG', undefined, { data: { extensionId: extension.id, version: extension.version } });
      }
    },
  };
  function send(request, type, payload, overrides = {}) {
    const { data, ...eventOverrides } = overrides;
    const event = {
      source: win, origin: win.location.origin, ...eventOverrides,
      data: { source: 'stockframe-extension', requestId: request.requestId,
        extensionId: request.extensionId || 'stockframe-latest', type, payload, ...data },
    };
    for (const listener of listeners) listener(event);
  }
  vm.runInNewContext(bridgeCode, {
    module, exports: module.exports, window: win, Blob, File, Uint8Array, URL, Date: FakeDate,
    atob, btoa, Error, TypeError, console,
    crypto: { randomUUID: () => `bridge-test-${++nextUuid}` },
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + Math.max(0, Number(delay)) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  }, { filename: 'stockframe-bridge-test-bundle.js' });
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      await flush();
    }
    now = until;
    await flush();
  }
  return { api: module.exports, posted, discoveries, timers, send, advance, now: () => now };
}

function observe(promise) {
  const result = { state: 'pending', value: undefined, error: undefined };
  result.finished = promise.then((value) => { result.state = 'resolved'; result.value = value; },
    (error) => { result.state = 'rejected'; result.error = error; });
  return result;
}
async function start(env, action = 'stockFrameStatus', ...args) {
  const observed = observe(env.api[action](...args));
  await env.advance(420);
  assert.equal(env.posted.length, 1, 'discovery dispatches exactly one operation');
  return { observed, request: env.posted[0] };
}
function chunk(env, request, index, bytes) {
  env.send(request, 'SF_DOWNLOAD_CHUNK', { index, data: Buffer.from(bytes).toString('base64') });
}
const take = { id: 'take-test', title: 'Take de teste', code: 'ST-TEST' };
const run = async (name, fn) => { await fn(); checks++; console.log(`  ok ${name}`); };

await run('discovers the newest 4.46.2 instance and dispatches only to it', async () => {
  const env = environment({ extensions: [
    { id: 'legacy', version: '4.45.9' }, { id: 'previous', version: '4.46.1' }, { id: 'stockframe-latest', version: '4.46.2' },
  ] });
  assert.equal(manifest.version, '4.46.2', 'downloadable extension has the reliability version');
  assert.equal(env.api.MIN_STOCKFRAME_VERSION, manifest.version, 'bridge requires the same reliability version');
  const { observed, request } = await start(env);
  assert.equal(request.extensionId, 'stockframe-latest');
  assert.equal(request.action, 'status');
  env.send(request, 'SF_RESULT', { configured: false, version: '4.46.2' });
  await observed.finished;
  assert.equal(observed.value.version, '4.46.2');
  assert.equal(env.timers.size, 0, 'success cleans all operation/discovery timers');
});

await run('rejects an outdated extension before any account or download request', async () => {
  const env = environment({ extensions: [{ id: 'outdated', version: '4.46.0' }] });
  const observed = observe(env.api.stockFrameStatus());
  await env.advance(420);
  assert.equal(observed.state, 'rejected');
  assert.match(observed.error.message, /4\.46\.2/);
  assert.equal(env.posted.length, 0);
  assert.equal(env.timers.size, 0);
});

await run('missing extension fails at six seconds, including a download request', async () => {
  const env = environment({ autoDiscovery: false });
  const observed = observe(env.api.stockFrameDownload(take));
  await env.advance(5999);
  assert.equal(observed.state, 'pending');
  await env.advance(1);
  assert.equal(observed.state, 'rejected');
  assert.match(observed.error.message, /extensão Hey Auto não respondeu/);
  assert.equal(env.posted.length, 0);
  assert.equal(env.timers.size, 0);
});

await run('ignores responses from foreign origins, windows, extension IDs and request IDs', async () => {
  const env = environment();
  const { observed, request } = await start(env);
  const forged = { configured: true, version: 'forged' };
  for (const overrides of [
    { origin: 'https://evil.example' }, { source: {} },
    { data: { extensionId: 'another-extension' } }, { data: { requestId: 'sf_unrelated' } },
    { data: { source: 'another-bridge' } },
  ]) {
    env.send(request, 'SF_RESULT', forged, overrides);
    await flush();
    assert.equal(observed.state, 'pending');
  }
  env.send(request, 'SF_RESULT', { configured: false });
  await observed.finished;
  assert.equal(observed.value.configured, false);
});

await run('reassembles out-of-order chunks into the exact File and ignores duplicate chunks', async () => {
  const env = environment();
  const { observed, request } = await start(env, 'stockFrameDownload', take);
  chunk(env, request, 1, [4, 5]);
  chunk(env, request, 0, [1, 2, 3]);
  chunk(env, request, 0, [99, 99, 99]);
  env.send(request, 'SF_RESULT', { totalChunks: 2, bytes: 5, mimeType: 'video/mp4', filename: 'stockframe.mp4' });
  await observed.finished;
  assert.equal(observed.state, 'resolved');
  assert.ok(observed.value instanceof File);
  assert.equal(observed.value.name, 'stockframe.mp4');
  assert.equal(observed.value.type, 'video/mp4');
  assert.deepEqual([...new Uint8Array(await observed.value.arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(env.timers.size, 0);
});

await run('rejects noncontiguous chunk indexes even when count and bytes match', async () => {
  const env = environment();
  const { observed, request } = await start(env, 'stockFrameDownload', take);
  chunk(env, request, 0, [1]);
  chunk(env, request, 2, [2]);
  env.send(request, 'SF_RESULT', { totalChunks: 2, bytes: 2, mimeType: 'video/mp4' });
  await observed.finished;
  assert.equal(observed.state, 'rejected');
  assert.match(observed.error.message, /Faltam partes/);
});

await run('rejects missing chunks, malformed totals and declared byte-count mismatches', async () => {
  for (const payload of [
    { totalChunks: 2, bytes: 2 }, { totalChunks: 1, bytes: 99 },
    { totalChunks: 1, bytes: '1' }, { totalChunks: 0, bytes: 1 }, { totalChunks: 513, bytes: 1 },
  ]) {
    const env = environment();
    const { observed, request } = await start(env, 'stockFrameDownload', take);
    chunk(env, request, 0, [1]);
    env.send(request, 'SF_RESULT', { ...payload, mimeType: 'video/mp4' });
    await observed.finished;
    assert.equal(observed.state, 'rejected');
    assert.match(observed.error.message, /Faltam partes/);
    assert.equal(env.timers.size, 0);
  }
});

await run('catalog progress keeps a rate-limit queue alive beyond the old 45-second timeout', async () => {
  const env = environment();
  const { observed, request } = await start(env, 'stockFrameList', { search: 'joelho' });
  for (let index = 0; index < 3; index++) {
    await env.advance(40_000);
    env.send(request, 'SF_PROGRESS', { message: 'Aguardando próxima janela…', percent: 4 });
    await flush();
    assert.equal(observed.state, 'pending');
  }
  assert.ok(env.now() > 45_000);
  env.send(request, 'SF_RESULT', { data: { videos: [{ id: 'take-authorized', title: 'Take autorizado' }], total: 1 } });
  await observed.finished;
  assert.equal(observed.state, 'resolved');
  assert.equal(observed.value.videos[0].id, 'take-authorized');
  assert.equal(env.timers.size, 0);
});

await run('untrusted progress cannot postpone the ordinary 45-second timeout', async () => {
  const env = environment();
  const { observed, request } = await start(env);
  await env.advance(40_000);
  env.send(request, 'SF_PROGRESS', { message: 'forged' }, { data: { extensionId: 'another-extension' } });
  await env.advance(45000 - env.now());
  assert.equal(observed.state, 'rejected');
  assert.match(observed.error.message, /não respondeu/);
});

for (const [action, args, deadline] of [
  ['stockFrameStatus', [], 3 * 60_000], ['stockFrameDownload', [take], 12 * 60_000],
]) {
  await run(`${action} progress cannot exceed its absolute ${deadline / 60_000}-minute deadline`, async () => {
    const env = environment();
    const { observed, request } = await start(env, action, ...args);
    while (env.now() < deadline - 1) {
      env.send(request, 'SF_PROGRESS', { message: 'Still waiting', percent: 4 });
      await env.advance(Math.min(5000, deadline - 1 - env.now()));
      assert.equal(observed.state, 'pending');
    }
    await env.advance(1);
    assert.equal(observed.state, 'rejected');
    assert.match(observed.error.message, /dentro do prazo/);
    assert.equal(env.timers.size, 0);
    env.send(request, 'SF_PROGRESS', { message: 'Late event' });
    assert.equal(env.timers.size, 0, 'late progress cannot revive a settled operation');
  });
}

console.log(`StockFrame bridge: ${checks} scenarios passed with virtual time.`);
