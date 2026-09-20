import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const worker = readFileSync(new URL('../extension/stockframe-background.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../extension/stockframe-bridge.js', import.meta.url), 'utf8');
const coreWorker = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/extension/download/route.ts', import.meta.url), 'utf8');
const sync = readFileSync(new URL('./ext-sync.mjs', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/tools/clickup-pilot/page.tsx', import.meta.url), 'utf8');
const component = readFileSync(new URL('../components/PilotStockFrame.tsx', import.meta.url), 'utf8');

assert.ok(manifest.host_permissions.includes('https://biblioteca.stockframe.space/*'), 'extension owns the official StockFrame API origin');
assert.ok(manifest.content_scripts.some((entry) => entry.js.includes('stockframe-bridge.js')), 'Pilot receives the StockFrame bridge');
assert.ok(coreWorker.includes("importScripts('stockframe-background.js')"), 'background loads the isolated StockFrame module');
for (const file of ['stockframe-background.js', 'stockframe-bridge.js']) {
  assert.ok(route.includes(`'${file}'`), `${file} is shipped in the downloadable zip`);
  assert.ok(sync.includes(`'${file}'`), `${file} is synced into the live unpacked extension`);
}
assert.ok(worker.includes("chrome.storage.local.set({ [KEY_STORE]: apiKey })"), 'API key remains in extension storage');
assert.ok(worker.includes("Authorization: `Bearer ${apiKey}`"), 'official API receives bearer auth');
assert.ok(!bridge.includes('apiKey:'), 'bridge never stores or re-broadcasts the API key');
assert.ok(worker.includes("'/me'"), 'configuration validates the paid account through /api/v1/me');
assert.ok(worker.includes('/videos/${encodeURIComponent(videoId)}/download'), 'download uses the documented account-scoped endpoint');
assert.ok(worker.includes('const DOWNLOAD_LIMIT = 18'), 'client stays below the official 20 downloads/minute limit');
assert.ok(worker.includes('const REQUEST_LIMIT = 56'), 'client stays below the official 60 requests/minute limit');
assert.ok(worker.includes('Esta conta n\u00e3o tem um plano StockFrame ativo'), 'paid-plan failures are explicit');
assert.ok(bridge.includes('message.extensionId !== extensionId'), 'only the selected extension instance receives a request');

assert.equal((page.match(/\{janelaDeStockFrame\(\)\}/g) || []).length, 1, 'one StockFrame root modal is mounted');
assert.ok(page.includes('insertsAtivosNaMontagem(lista, isFlowEnabled(taskId), isStockFrameEnabled(taskId))'), 'actual compositor gates Flow and StockFrame independently');
assert.ok(page.includes("setInsertsDaOrigem(taskId, value, 'stockframe')"), 'StockFrame inserts persist with their own provenance');
assert.ok(page.includes('saved.size !== f.size'), 'download enters the plan only after an IndexedDB byte-for-byte roundtrip');
assert.ok(component.includes('planSmartStockSegments(parts, { coverage, pace })'), 'Smart Stocks derives moments from copy and selected intensity/rhythm');
assert.ok(component.includes('rankStockFrameVideos(segment'), 'Smart Stocks semantically ranks the API catalog');
assert.ok(component.includes('Nenhum download foi consumido ainda'), 'analysis is preview-only and does not burn download quota');
assert.ok(component.includes('current.filter((insert) => !insert.stockFrame?.smart)'), 're-running Smart replaces only the previous smart plan');
assert.ok(component.includes('account.downloadsLimit - account.downloadsToday'), 'plan checks remaining paid-account quota before applying');

const premium = { name: 'Premium Test', email: 'premium@test.dev', downloads_today: 3, downloads_limit: 130, plan: 'premium' };
function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function videoResponse(headers = {}) {
  return new Response(new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]), {
    status: 200, headers: { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="take-premium.mp4"', ...headers },
  });
}

function defaultFetch(url) {
  if (String(url).endsWith('/me')) return jsonResponse(premium);
  if (String(url).includes('/videos/') && String(url).endsWith('/download')) return videoResponse();
  if (String(url).includes('/videos?')) return jsonResponse({ videos: [{ id: 'take-1', title: 'Take autorizado' }], total: 1 });
  throw new Error(`fetch inesperado: ${url}`);
}

// Run the real worker with virtual time. Advancing a minute never waits a real
// minute, and every observed provider call retains its virtual timestamp.
function createWorkerHarness(initialKey = '') {
  const stored = initialKey ? { 'autoedit.stockframe.api-key.v1': initialKey } : {};
  const emitted = [];
  const fetches = [];
  const terminal = new Map();
  const timers = new Map();
  let now = Date.UTC(2026, 8, 19, 12);
  let timerSequence = 0;
  let sequence = 0;
  let listener = null;
  let fetchHandler = defaultFetch;
  class FakeDate extends Date { static now() { return now; } }
  function schedule(fn, delay, interval = 0) {
    const id = ++timerSequence;
    timers.set(id, { fn, at: now + Math.max(1, delay), interval });
    return id;
  }
  function tick() {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) return false;
    const [id, timer] = next;
    now = timer.at;
    if (timer.interval) timer.at += timer.interval; else timers.delete(id);
    timer.fn();
    return true;
  }
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } }, getManifest() { return { version: manifest.version }; } },
    storage: { local: {
      async get(key) { return { [key]: stored[key] }; },
      async set(value) { Object.assign(stored, value); },
      async remove(key) { delete stored[key]; },
    } },
    tabs: { async sendMessage(_tabId, message) {
      emitted.push({ ...message, at: now });
      if (message.type === 'SF_RESULT' || message.type === 'SF_ERROR') terminal.get(message.requestId)?.(message);
    } },
  };
  vm.runInNewContext(worker, {
    chrome, fetch: async (url, options = {}) => {
      fetches.push({ url: String(url), options, at: now });
      return fetchHandler(String(url), options);
    }, Response, URL, URLSearchParams, Uint8Array, Date: FakeDate, Math, JSON, Promise, String, Number,
    Object, Array, Set, Map, RegExp, Error, encodeURIComponent, decodeURIComponent, btoa, AbortController,
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: (id) => timers.delete(id),
    console: { log() {} },
  });
  assert.equal(typeof listener, 'function', 'worker registers one StockFrame request listener');

  async function request(action, payload = {}, senderUrl = 'https://darkoautoedit.com/tools/clickup-pilot') {
    const requestId = `sf_test_${++sequence}`;
    let message;
    let accepted = null;
    terminal.set(requestId, (result) => { message = result; terminal.delete(requestId); });
    const owns = listener({ type: 'SF_REQUEST', requestId, action, payload }, { tab: { id: 7, url: senderUrl } }, (value) => { accepted = value; });
    if (owns !== true) { terminal.delete(requestId); return { owns, accepted, message: null }; }
    for (let tickCount = 0; !message && tickCount < 2000; tickCount++) {
      // Flush promises and Response body reads before moving virtual timers.
      await new Promise((resolve) => setImmediate(resolve));
      if (!message) tick();
    }
    assert.ok(message, `worker completed ${action} within bounded virtual time`);
    return { owns, accepted, message };
  }
  return { stored, emitted, fetches, request, now: () => now, setFetch(fn) { fetchHandler = fn; } };
}

const harness = createWorkerHarness();
const { stored, emitted, fetches, request: workerRequest } = harness;
/* The page receives only results/chunks, the key stays in storage, and a free
 * account cannot be persisted. */
let mePayload = premium;
harness.setFetch((url, options) => {
  if (String(url).endsWith('/me')) return new Response(JSON.stringify(mePayload), { status: 200, headers: { 'content-type': 'application/json' } });
  return defaultFetch(url, options);
});

const foreign = await workerRequest('status', {}, 'https://evil.example/tools/clickup-pilot');
assert.equal(foreign.owns, false, 'foreign sites cannot call the StockFrame worker');

const emptyStatus = await workerRequest('status');
assert.equal(emptyStatus.accepted?.accepted, true, 'trusted Pilot request is acknowledged');
assert.equal(emptyStatus.message.payload.configured, false, 'empty extension starts disconnected');

const secret = 'sf_live_personal_secret_123';
const configured = await workerRequest('configure', { apiKey: secret });
assert.equal(configured.message.type, 'SF_RESULT', 'paid account can be configured');
assert.equal(stored['autoedit.stockframe.api-key.v1'], secret, 'personal key is persisted only in extension storage');
assert.equal(fetches.at(-1).options.headers.Authorization, `Bearer ${secret}`, 'StockFrame API receives the personal Bearer key');
assert.ok(!JSON.stringify(emitted).includes(secret), 'personal key is never emitted into the Pilot page');

const listed = await workerRequest('list', { filters: { search: 'dor no joelho', perPage: 24, rogue: 'never-send' } });
assert.equal(listed.message.payload.data.videos[0].id, 'take-1', 'catalog response returns through the isolated bridge');
const listUrl = fetches.at(-1).url;
assert.ok(listUrl.includes('search=dor+no+joelho') && listUrl.includes('per_page=24'), 'documented catalog filters reach the API');
assert.ok(!listUrl.includes('rogue'), 'unknown query fields never reach the API');

const downloaded = await workerRequest('download', { videoId: 'take-1' });
assert.equal(downloaded.message.payload.filename, 'take-premium.mp4', 'download preserves the safe API filename');
assert.ok(emitted.some((message) => message.requestId === downloaded.message.requestId && message.type === 'SF_DOWNLOAD_CHUNK'), 'video bytes cross the bridge in bounded chunks');

await workerRequest('disconnect');
mePayload = { name: 'Free Test', plan: 'free', downloads_limit: 0 };
const rejectedFree = await workerRequest('configure', { apiKey: 'sf_free_personal_key_123' });
assert.equal(rejectedFree.message.type, 'SF_ERROR', 'free or inactive StockFrame accounts are rejected');
assert.match(rejectedFree.message.error, /conta StockFrame paga e ativa/i, 'paid-account requirement is explicit');
assert.equal(stored['autoedit.stockframe.api-key.v1'], undefined, 'a rejected free key is never persisted');

function assertRollingLimit(events, limit, label) {
  for (const event of events) {
    assert.ok(events.filter((candidate) => candidate.at <= event.at && candidate.at > event.at - 60_000).length <= limit, label);
  }
}

const bulkDownloads = createWorkerHarness(secret);
for (let index = 0; index < 23; index++) {
  const result = await bulkDownloads.request('download', { videoId: `bulk-${index}` });
  assert.equal(result.message.type, 'SF_RESULT', `Smart download ${index + 1} completes without aborting at the preventive limit`);
}
assert.equal(bulkDownloads.fetches.length, 23, 'every requested take is downloaded exactly once');
assert.ok(bulkDownloads.fetches[18].at - bulkDownloads.fetches[0].at >= 60_000, 'nineteenth download waits for its own slot');
assertRollingLimit(bulkDownloads.fetches, 18, 'download slot never exceeds 18 calls in a rolling minute');
const waitProgress = bulkDownloads.emitted.filter((event) => event.type === 'SF_PROGRESS' && event.payload?.message.includes('janela'));
assert.ok(waitProgress.length >= 12, 'minute-long wait emits Chrome heartbeat progress in short blocks');
for (let index = 1; index < waitProgress.length; index++) assert.ok(waitProgress[index].at - waitProgress[index - 1].at <= 5000, 'waiting heartbeat gaps stay under the worker idle limit');

const bulkCatalog = createWorkerHarness(secret);
for (let index = 0; index < 60; index++) {
  const result = await bulkCatalog.request('list', { filters: { search: `query-${index}` } });
  assert.equal(result.message.type, 'SF_RESULT', `catalog request ${index + 1} completes`);
}
assert.equal(bulkCatalog.fetches.length, 60, 'distinct catalog pages each complete once');
assert.ok(bulkCatalog.fetches[56].at - bulkCatalog.fetches[0].at >= 60_000, 'request 57 waits instead of failing');
assertRollingLimit(bulkCatalog.fetches, 56, 'API slot never exceeds 56 calls in a rolling minute');

for (const headerKind of ['seconds', 'date', 'invalid']) {
  const rateLimited = createWorkerHarness(secret);
  const start = rateLimited.now();
  let attempts = 0;
  const retryAfter = headerKind === 'seconds' ? '7' : headerKind === 'date' ? new Date(start + 9000).toUTCString() : 'not-a-date';
  rateLimited.setFetch(() => ++attempts === 1 ? jsonResponse({ error: 'rate_limited' }, 429, { 'retry-after': retryAfter }) : videoResponse());
  const result = await rateLimited.request('download', { videoId: 'limited' });
  assert.equal(result.message.type, 'SF_RESULT', `explicit 429 with ${headerKind} Retry-After can recover`);
  assert.equal(attempts, 2, 'only an explicitly rejected request is retried');
  const minimum = headerKind === 'seconds' ? 7000 : headerKind === 'date' ? 9000 : 60_000;
  assert.ok(rateLimited.fetches[1].at - rateLimited.fetches[0].at >= minimum, 'Retry-After is never shortened');
}

const repeated429 = createWorkerHarness(secret);
repeated429.setFetch(() => jsonResponse({ error: 'rate_limited' }, 429, { 'retry-after': '1' }));
assert.equal((await repeated429.request('download', { videoId: 'always-limited' })).message.type, 'SF_ERROR', 'persistent 429 eventually returns a recoverable error');
assert.equal(repeated429.fetches.length, 3, '429 retries are bounded');

const exhausted = createWorkerHarness(secret);
exhausted.setFetch(() => jsonResponse({ error: 'download_quota_exceeded' }, 429, { 'retry-after': '1' }));
assert.match((await exhausted.request('download', { videoId: 'daily-quota' })).message.error, /cota diária/i, 'daily quota exhaustion is explained');
assert.equal(exhausted.fetches.length, 1, 'daily quota exhaustion is not retried');

const networkFailure = createWorkerHarness(secret);
networkFailure.setFetch(() => { throw new TypeError('network connection interrupted'); });
assert.equal((await networkFailure.request('download', { videoId: 'ambiguous' })).message.type, 'SF_ERROR', 'ambiguous network failure is returned to the user');
assert.equal(networkFailure.fetches.length, 1, 'ambiguous failure never repeats a quota-consuming download');

const hanging = createWorkerHarness(secret);
hanging.setFetch((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))));
assert.match((await hanging.request('download', { videoId: 'timeout' })).message.error, /demorou demais/i, 'stalled API fetch times out with an actionable error');
assert.equal(hanging.fetches.length, 1, 'timed-out download is never retried');

const oversized = createWorkerHarness(secret);
let bodyReads = 0;
oversized.setFetch(() => ({ ok: true, headers: new Headers({ 'content-type': 'video/mp4', 'content-length': String(257 * 1024 * 1024) }),
  async arrayBuffer() { bodyReads++; throw new Error('body must not be read'); } }));
assert.match((await oversized.request('download', { videoId: 'too-large' })).message.error, /256 MB/i, 'oversized Content-Length is rejected');
assert.equal(bodyReads, 0, 'size is validated before allocating the arrayBuffer');

const signedDownload = createWorkerHarness(secret);
signedDownload.setFetch((url) => url.includes('/api/v1/') ? jsonResponse({ download_url: 'https://cdn.stockframe.example/signed-take' }) : videoResponse({ 'content-type': 'application/octet-stream; charset=binary' }));
const signedResult = await signedDownload.request('download', { videoId: 'signed' });
assert.equal(signedResult.message.type, 'SF_RESULT', 'signed CDN download accepts octet-stream with parameters');
assert.equal(signedResult.message.payload.mimeType, 'video/mp4', 'octet-stream is normalized to a video MIME');
assert.equal(signedDownload.fetches[1].options.headers, undefined, 'personal Bearer is never forwarded to the signed CDN');
assert.equal(signedDownload.fetches.filter((item) => item.url.includes('/api/v1/')).length, 1, 'signed media does not debit a second API download');

console.log('StockFrame integration: paid-account isolation, packaging, Smart/compositor, virtual-time request/download queues, 429, timeout, CDN and size guards OK.');
