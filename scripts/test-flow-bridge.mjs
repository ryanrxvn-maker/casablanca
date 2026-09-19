import assert from 'node:assert/strict';
import vm from 'node:vm';
import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

function bundle(path) {
  return buildSync({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true,
    write: false, platform: 'browser', format: 'cjs', target: 'es2022' }).outputFiles[0].text;
}
const contractCode = bundle('../lib/pilot-flow.ts');
const bridgeCode = bundle('../lib/flow-extension-bridge.ts');
const PROJECT = 'https://flow.google.com/project/fixture-project';
const ACCOUNT = { name: 'Fixture', email: 'fixture@example.com', credits: 250 };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let checks = 0;

function environment(code = bridgeCode, { browser = true, width = 1920, height = 1080,
  autoDiscovery = true, extensions = [{ id: 'fixture-extension', version: '4.45.5' }], throwPost = '' } = {}) {
  const timers = new Map();
  const listeners = [];
  const posted = [];
  const discoveries = [];
  const revoked = [];
  let timerId = 0;
  let uuid = 0;
  const dimensions = { width, height, error: false, stall: false };
  const module = { exports: {} };
  class Media {
    onload = null; onloadedmetadata = null; onerror = null;
    removeAttribute() { this._src = ''; }
    load() {}
    set src(value) {
      this._src = value;
      if (!value || dimensions.stall) return;
      queueMicrotask(() => dimensions.error ? this.onerror?.() : this instanceof Video ? this.onloadedmetadata?.() : this.onload?.());
    }
  }
  class Video extends Media {
    get videoWidth() { return dimensions.width; }
    get videoHeight() { return dimensions.height; }
  }
  class Image extends Media {
    get naturalWidth() { return dimensions.width; }
    get naturalHeight() { return dimensions.height; }
  }
  class TestURL extends URL {
    static createObjectURL() { return `blob:fixture-${++uuid}`; }
    static revokeObjectURL(value) { revoked.push(value); }
  }
  const win = {
    location: { origin: 'https://darkoautoedit.com' },
    addEventListener(type, listener) { if (type === 'message') listeners.push(listener); },
    postMessage(message, origin) {
      if (message.type === throwPost) throw new Error('Fixture could not post message');
      if (message.type === 'FLOW_PING') {
        discoveries.push(message);
        if (!autoDiscovery) return;
        for (const extension of extensions) {
          for (const listener of listeners) listener({ source: win, origin: win.location.origin, data: {
            source: 'flow-extension', type: 'FLOW_PONG', requestId: message.requestId,
            extensionId: extension.id, version: extension.version,
          } });
        }
        for (const [id, timer] of [...timers]) if (timer.delay === 500 && timers.has(id)) {
          timers.delete(id); timer.callback();
        }
      } else posted.push({ ...message, origin });
    },
  };
  const sandbox = {
    module, exports: module.exports, Blob, File, URL: TestURL, Error, TypeError, Uint8Array,
    atob, btoa, console, HTMLVideoElement: Video,
    document: { createElement: type => type === 'video' ? new Video() : new Image() },
    crypto: { randomUUID: () => `fixture-${++uuid}` },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ...(browser ? { window: win } : {}),
  };
  vm.runInNewContext(code, sandbox, { filename: 'flow-test-bundle.js' });
  return {
    api: module.exports, posted, discoveries, timers, dimensions, revoked,
    send(request, type, payload, options = {}) {
      const event = { source: win, origin: win.location.origin,
        data: { source: 'flow-extension', requestId: request.requestId, extensionId: 'fixture-extension', type, payload }, ...options };
      for (const listener of listeners) listener(event);
    },
    fire(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay && timers.has(id)) {
        timers.delete(id); timer.callback();
      }
    },
  };
}

const contract = environment(contractCode).api;
const valid = (change = {}) => ({ ...contract.DEFAULT_FLOW_SETTINGS, prompt: 'An abstract blue sculpture', references: [], ...change });
const reference = (name = 'reference.png') => ({ name, mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID' });
const run = async (name, fn) => { await fn(); checks++; console.log(`  ok ${name}`); };

await run('inspection targets the selected mode and model without dispatching a generation', async () => {
  const env = environment();
  const result = env.api.flowInspect(PROJECT, { mode: 'image', model: 'Nano Banana 2' });
  await tick();
  assert.equal(env.posted.length, 1);
  assert.equal(env.posted[0].action, 'inspect');
  assert.equal(env.posted[0].payload.mode, 'image');
  assert.equal(env.posted[0].payload.model, 'Nano Banana 2');
  env.send(env.posted[0], 'FLOW_RESULT', { account: ACCOUNT, projectUrl: PROJECT, mode: 'image', models: ['Nano Banana 2'], controls: { available: ['Imagem', '9:16', 'x1'] } });
  assert.equal((await result).mode, 'image');
  assert.throws(() => env.api.flowInspect(PROJECT, { mode: 'audio' }), /Imagem ou Vídeo/);
  assert.throws(() => env.api.flowInspect(PROJECT, { mode: 'video', model: '' }), /motor/);
  assert.equal(env.posted.length, 1);
});

await run('settings accept 0 through 4 references and quantities 1 through 4', () => {
  for (let n = 0; n <= 4; n++) contract.validateFlowSettings(valid({ references: Array.from({ length: n }, () => reference()) }));
  for (let n = 1; n <= 4; n++) contract.validateFlowSettings(valid({ count: n }));
  assert.throws(() => contract.validateFlowSettings(valid({ references: Array(5).fill(reference()) })), /4/);
  for (const count of [0, 5, 1.5, NaN]) assert.throws(() => contract.validateFlowSettings(valid({ count })), /4/);
});
await run('settings reject malformed and oversized reference inputs', () => {
  for (const ref of [
    { ...reference(), mimeType: 'image/svg+xml' },
    { ...reference(), dataUrl: 'https://example.com/image.png' },
    { ...reference(), dataUrl: 'data:image/png;base64,!!!' },
    { ...reference(), dataUrl: 'data:image/png;base64,' },
    { ...reference(), dataUrl: `data:image/png;base64,${'A'.repeat(Math.ceil(contract.FLOW_REFERENCE_MAX_BYTES / .75) + 4)}` },
  ]) assert.throws(() => contract.validateFlowSettings(valid({ references: [ref] })));
});
await run('settings reject invalid controls and allow promptless quote only', () => {
  for (const settings of [{ mode: 'audio' }, { aspectRatio: '1:1' }, { resolution: '1080p' },
    { videoMode: 'invalid' }, { durationSeconds: 5 }, { model: '' }, { model: 'A'.repeat(101) },
    { prompt: 'A'.repeat(12001) }, { animateMediaId: '../escape' }]) {
    assert.throws(() => contract.validateFlowSettings(valid(settings)));
  }
  assert.throws(() => contract.validateFlowSettings(valid({ prompt: ' ' })), /prompt/);
  contract.validateFlowSettings(valid({ prompt: '' }), false);
});
await run('all generation-affecting settings invalidate credit quote fingerprint', () => {
  const original = valid();
  const fingerprint = contract.flowSettingsFingerprint(original, PROJECT);
  for (const change of [{ mode: 'image' }, { model: 'Veo 3.1 - Fast' }, { prompt: 'changed' },
    { count: 2 }, { durationSeconds: 10 }, { aspectRatio: '16:9' }, { resolution: '360p' },
    { videoMode: 'frames' }, { references: [reference()] }, { animateMediaId: 'generated-image' }]) {
    assert.notEqual(contract.flowSettingsFingerprint(valid(change), PROJECT), fingerprint);
  }
  assert.notEqual(contract.flowSettingsFingerprint(original, PROJECT + '-other'), fingerprint);
  assert.equal(contract.flowSettingsFingerprint(valid(), PROJECT), fingerprint);
  assert.notEqual(contract.flowSettingsFingerprint(valid({ references: [reference()] }), PROJECT),
    contract.flowSettingsFingerprint(valid({ references: [{ ...reference(), dataUrl: 'data:image/png;base64,BAUG' }] }), PROJECT));
});
await run('project URLs normalize trusted projects and reject alternate hosts/schemes/credentials', () => {
  assert.equal(contract.flowProjectUrl(PROJECT + '?token=hidden#hash'), PROJECT);
  assert.equal(contract.flowProjectUrl('https://labs.google/fx/tools/flow/project/fixture'), 'https://labs.google/fx/tools/flow/project/fixture');
  assert.equal(contract.flowProjectUrl('   '), undefined);
  for (const url of ['javascript:alert(1)', 'http://flow.google.com/project/id', 'https://flow.google.com.evil.test/project/id',
    'https://evil.test/project/id', 'https://user:secret@flow.google.com/project/id', 'https://flow.google.com/',
    'https://flow.google.com/project/id/extra', 'https://flow.google.com:8443/project/id']) {
    assert.throws(() => contract.flowProjectUrl(url), undefined, url);
  }
});
await run('real video requires 1080 short edge but still images retain native dimensions', () => {
  contract.validateFlowDimensions('video', 1920, 1080);
  contract.validateFlowDimensions('video', 1080, 1920);
  contract.validateFlowDimensions('image', 1376, 768);
  for (const dimensions of [[1920, 720], [1080, 0], [NaN, 1080], [Infinity, 1080]]) {
    assert.throws(() => contract.validateFlowDimensions('video', ...dimensions));
  }
});
await run('request validates settings before posting and supports SSR with clear error', async () => {
  const env = environment();
  assert.throws(() => env.api.flowGenerate(valid(), { projectUrl: '', expectedAccountEmail: ACCOUNT.email, maxCredits: 15 }));
  assert.throws(() => env.api.flowGenerate(valid({ count: 0 }), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15 }));
  assert.throws(() => env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: '', maxCredits: 15 }));
  assert.throws(() => env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: NaN }));
  assert.equal(env.posted.length, 0);
  await assert.rejects(environment(bridgeCode, { browser: false }).api.flowInspect(), /Chrome/);
});
await run('bridge filters foreign origin, frame, request id and other extension after ACK', async () => {
  const env = environment();
  let settled = false;
  const result = env.api.flowInspect(PROJECT).then(value => { settled = true; return value; });
  const request = env.posted[0];
  env.send(request, 'FLOW_RESULT', { account: ACCOUNT }, { origin: 'https://evil.test' });
  env.send(request, 'FLOW_RESULT', { account: ACCOUNT }, { source: {} });
  env.send({ requestId: 'unknown' }, 'FLOW_RESULT', { account: ACCOUNT });
  env.send(request, 'FLOW_ACK');
  env.send(request, 'FLOW_RESULT', { account: ACCOUNT }, { data: { source: 'flow-extension', requestId: request.requestId, extensionId: 'different-extension', type: 'FLOW_RESULT', payload: { wrong: true } } });
  await tick(); assert.equal(settled, false);
  env.send(request, 'FLOW_RESULT', { account: ACCOUNT, projectUrl: PROJECT });
  assert.equal((await result).account.email, ACCOUNT.email);
  assert.equal(env.timers.size, 0, 'successful settlement clears all timers');
});
await run('simultaneous request correlation cannot swap quote and account results', async () => {
  const env = environment();
  const inspect = env.api.flowInspect(PROJECT);
  const quote = env.api.flowQuote(valid(), PROJECT);
  const [first, second] = env.posted;
  assert.notEqual(first.requestId, second.requestId);
  env.send(second, 'FLOW_RESULT', { credits: 15, account: ACCOUNT });
  env.send(first, 'FLOW_RESULT', { projectUrl: PROJECT, account: ACCOUNT });
  assert.equal((await quote).credits, 15); assert.equal((await inspect).projectUrl, PROJECT);
});
await run('multiple installed extensions receive only one targeted generation command', async () => {
  const env = environment(bridgeCode, { extensions: [
    { id: 'older-extension', version: '4.9.9' },
    { id: 'fixture-extension', version: '4.45.5' },
    { id: 'middle-extension', version: '4.45.1' },
  ] });
  const generated = env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15 });
  assert.equal(env.discoveries.length, 1);
  assert.equal(env.posted.length, 1);
  const request = env.posted[0];
  assert.equal(request.extensionId, 'fixture-extension', 'numeric version wins rather than lexical version');
  assert.equal(request.action, 'generate');
  assert.equal(env.discoveries[0].payload, undefined, 'discovery does not broadcast prompt or spending operation');
  env.send(request, 'FLOW_PONG', undefined, { data: { source: 'flow-extension', type: 'FLOW_PONG', requestId: request.requestId, extensionId: 'late-extension', version: '9.0.0' } });
  env.fire(500);
  assert.equal(env.posted.length, 1, 'late discoveries never dispatch a second generation');
  env.send(request, 'FLOW_RESULT', { assets: [], projectUrl: PROJECT });
  await generated;
});
await run('extensions before the corrected Flow release cannot inspect, quote, generate or download', async () => {
  for (const version of ['4.44.0', '4.44.3', '4.44.4', '4.45.0', '4.45.1', '4.45.2', '4.45.3', '4.45.4', '4.9.9']) {
    const env = environment(bridgeCode, { extensions: [{ id: 'fixture-extension', version }] });
    await assert.rejects(env.api.flowInspect(PROJECT), /4\.45\.5 ou superior/);
    await assert.rejects(env.api.flowQuote(valid(), PROJECT), /4\.45\.5 ou superior/);
    await assert.rejects(env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15 }), /4\.45\.5 ou superior/);
    await assert.rejects(env.api.flowDownload({ id: 'existing-asset', kind: 'video' }, PROJECT), /4\.45\.5 ou superior/);
    assert.equal(env.posted.length, 0, 'incompatible extension receives no operation');
    assert.equal(env.timers.size, 0);
  }
});
await run('published extension version is the corrected Flow release', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '4.45.5');
});
await run('corrected release and newer versions can quote and generate exactly once', async () => {
  for (const version of ['4.45.5', '4.46.0', '5.0.0']) {
    const env = environment(bridgeCode, { extensions: [{ id: 'fixture-extension', version }] });
    const quote = env.api.flowQuote(valid(), PROJECT);
    assert.equal(env.posted.length, 1);
    assert.equal(env.posted[0].action, 'quote');
    env.send(env.posted[0], 'FLOW_RESULT', { credits: 7, account: ACCOUNT, projectUrl: PROJECT });
    assert.equal((await quote).credits, 7);
    const generated = env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 7 });
    assert.equal(env.posted.length, 2);
    assert.equal(env.posted[1].action, 'generate');
    env.send(env.posted[1], 'FLOW_RESULT', { assets: [], projectUrl: PROJECT });
    await generated;
    assert.equal(env.timers.size, 0);
  }
});
await run('older extensions retain status, cancel and open without resubmitting', async () => {
  for (const version of ['4.44.3', '4.44.4', '4.45.1', '4.45.2']) {
    const env = environment(bridgeCode, { extensions: [{ id: 'fixture-extension', version }] });
    const result = env.api.flowStatus('flow_previous-job');
    assert.equal(env.posted.length, 1);
    assert.equal(env.posted[0].action, 'status');
    env.send(env.posted[0], 'FLOW_RESULT', { job: { requestId: 'flow_previous-job', submitted: false, state: 'failed' } });
    assert.equal((await result).job.state, 'failed');
    const cancelled = env.api.flowCancel('flow_previous-job', { acknowledgeUncertain: true });
    assert.equal(env.posted[1].action, 'cancel');
    assert.equal(env.posted[1].payload.acknowledgeUncertain, true);
    env.send(env.posted[1], 'FLOW_RESULT', { acknowledged: true });
    assert.equal((await cancelled).acknowledged, true);
    const opened = env.api.flowOpen(PROJECT);
    assert.equal(env.posted[2].action, 'open');
    env.send(env.posted[2], 'FLOW_RESULT', { projectUrl: PROJECT });
    assert.equal((await opened).projectUrl, PROJECT);
    assert.equal(env.posted.length, 3, 'legacy recovery never sends a generation');
    assert.equal(env.timers.size, 0);
  }
});
await run('persisted generation ID passes unchanged and duplicate in-flight ID is rejected', async () => {
  const env = environment();
  const options = { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15, requestId: 'flow_persisted-job-123' };
  const first = env.api.flowGenerate(valid(), options);
  assert.equal(env.discoveries[0].requestId, options.requestId);
  assert.equal(env.posted[0].requestId, options.requestId);
  await assert.rejects(env.api.flowGenerate(valid(), options), /já está em andamento/);
  assert.equal(env.discoveries.length, 1, 'duplicate does not start another discovery');
  assert.equal(env.posted.length, 1, 'duplicate cannot post a second generation');
  env.send(env.posted[0], 'FLOW_RESULT', { assets: [], projectUrl: PROJECT });
  await first;
  assert.equal(env.timers.size, 0);
});
await run('malformed persisted request IDs are refused before discovery', async () => {
  const env = environment();
  for (const requestId of ['../escape', 'flow_with space', 'flow_' + 'a'.repeat(151)]) {
    await assert.rejects(env.api.flowGenerate(valid(), { projectUrl: PROJECT,
      expectedAccountEmail: ACCOUNT.email, maxCredits: 15, requestId }), /Identificação/);
  }
  assert.equal(env.discoveries.length, 0);
  assert.equal(env.posted.length, 0);
});
await run('no capable extension rejects discovery without ever broadcasting generate', async () => {
  const env = environment(bridgeCode, { autoDiscovery: false });
  const generated = env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15 });
  const rejected = assert.rejects(generated, /Atualize a extensão/);
  assert.equal(env.posted.length, 0);
  assert.equal(env.discoveries.length, 1);
  env.fire(8000); await rejected;
  assert.equal(env.timers.size, 0);
});
await run('postMessage failures at discovery or dispatch reject and clear timers', async () => {
  for (const type of ['FLOW_PING', 'FLOW_REQUEST']) {
    const env = environment(bridgeCode, { throwPost: type });
    await assert.rejects(env.api.flowInspect(PROJECT), /could not post/);
    assert.equal(env.timers.size, 0);
  }
});
await run('unknown messages and late PONG cannot disable the request ACK timeout', async () => {
  const env = environment();
  const inspect = env.api.flowInspect(PROJECT);
  const request = env.posted[0];
  const rejected = assert.rejects(inspect, /Atualize a extensão/);
  env.send(request, 'UNKNOWN_MESSAGE', {});
  env.send(request, 'FLOW_PONG', { version: '4.42.0' });
  env.fire(8000); await rejected;
  assert.equal(env.timers.size, 0);
});
await run('cancel and status keep target job identity separate from transport request identity', async () => {
  const env = environment();
  for (const action of ['cancel', 'status']) {
    const method = action === 'cancel' ? env.api.flowCancel : env.api.flowStatus;
    const result = method('flow_existing-generation');
    const request = env.posted.at(-1);
    assert.equal(request.action, action);
    assert.equal(request.payload.requestId, 'flow_existing-generation');
    assert.notEqual(request.requestId, 'flow_existing-generation');
    env.send(request, 'FLOW_RESULT', { status: action === 'cancel' ? 'cancelled' : 'running' });
    await result;
  }
});
await run('legacy recovery sends only the original prompt hint to status and never generates', async () => {
  const env = environment();
  const result = env.api.flowStatus('flow_existing-generation', { expectedPrompt: '  Original prompt.  ' });
  const sent = env.posted.at(-1);
  assert.equal(sent.action, 'status');
  assert.equal(sent.payload.expectedPrompt, 'Original prompt.');
  assert.equal(sent.payload.requestId, 'flow_existing-generation');
  env.send(sent, 'FLOW_RESULT', { job: { state: 'completed' } });
  await result;
  assert.equal(env.posted.length, 1);
  for (const expectedPrompt of ['', ' ', 12, 'x'.repeat(12001)]) {
    assert.throws(() => env.api.flowStatus('flow_existing-generation', { expectedPrompt }), /comando original/);
  }
  assert.equal(env.posted.length, 1);
});
await run('Frames refuses more than start and end images before dispatch', async () => {
  const env = environment();
  const settings = { ...valid(), mode: 'video', videoMode: 'frames', references: Array.from({length:3}, (_,i)=>({name:`ref-${i}.png`,mimeType:'image/png',dataUrl:'data:image/png;base64,UE5H'})) };
  assert.throws(() => env.api.flowGenerate(settings, {projectUrl:PROJECT,expectedAccountEmail:ACCOUNT.email,maxCredits:15}), /primeiro e último frame/);
  assert.equal(env.posted.length, 0);
  assert.equal(env.discoveries.length, 0);
});
await run('missing extension ACK rejects once without duplicate generate', async () => {
  const env = environment();
  const generated = env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15 });
  const rejection = assert.rejects(generated, /Atualize a extensão/);
  env.fire(8000); await rejection;
  env.fire(25 * 60 * 1000);
  assert.equal(env.posted.length, 1, 'timeouts never automatically submit again');
  assert.equal(env.timers.size, 0);
});
await run('generation timeout stays explicit and progress stays correlated', async () => {
  const env = environment();
  const progress = [];
  const generated = env.api.flowGenerate(valid(), { projectUrl: PROJECT, expectedAccountEmail: ACCOUNT.email, maxCredits: 15, onProgress: value => progress.push(value) });
  const request = env.posted[0];
  env.send(request, 'FLOW_ACK');
  env.send(request, 'FLOW_PROGRESS', { message: 'Generating fixture', percent: 40 });
  assert.equal(progress.at(-1).requestId, request.requestId);
  assert.equal(progress.at(-1).percent, 40);
  const rejection = assert.rejects(generated, /evitar gasto duplicado/);
  env.fire(25 * 60 * 1000); await rejection;
  env.send(request, 'FLOW_RESULT', { assets: [] });
  assert.equal(env.posted.length, 1); assert.equal(env.timers.size, 0);
});
await run('extension errors clear timers and reject with the actual provider reason', async () => {
  const env = environment();
  const result = env.api.flowQuote(valid(), PROJECT);
  const rejection = assert.rejects(result, /Conta foi alterada/);
  env.send(env.posted[0], 'FLOW_ERROR', { error: 'Conta foi alterada' });
  await rejection; assert.equal(env.timers.size, 0);
});
await run('download reassembles out-of-order chunks and ignores duplicate pieces', async () => {
  const env = environment();
  const result = env.api.flowDownload({ id: 'fixture/id', kind: 'video', url: 'https://flow.google.com/media/fixture' }, PROJECT);
  const request = env.posted[0];
  assert.equal(request.payload.resolution, '1080p');
  env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: 1, total: 2, data: btoa('BINARY') });
  env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: 1, total: 2, data: btoa('BINARY') });
  env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: 0, total: 2, data: btoa('VIDEO-') });
  env.send(request, 'FLOW_RESULT', { chunked: true, mimeType: 'video/mp4', width: 1, height: 1 });
  const file = await result;
  assert.equal(await file.text(), 'VIDEO-BINARY');
  assert.equal(file.type, 'video/mp4'); assert.match(file.name, /1920x1080\.mp4$/);
  assert.equal(env.revoked.length, 1); assert.equal(env.timers.size, 0);
});
await run('missing, mismatched and malformed chunks cannot be imported', async () => {
  for (const scenario of ['missing', 'changed-total', 'invalid-index', 'invalid-base64']) {
    const env = environment();
    const download = env.api.flowDownload({ id: 'fixture', kind: 'video', url: '' }, PROJECT);
    const rejected = assert.rejects(download, /download|Download|Flow|character/i);
    const request = env.posted[0];
    env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: 0, total: 2, data: btoa('first') });
    if (scenario === 'changed-total') env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: 1, total: 3, data: btoa('second') });
    if (scenario === 'invalid-index') env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: -1, total: 2, data: btoa('second') });
    if (scenario === 'invalid-base64') env.send(request, 'FLOW_DOWNLOAD_CHUNK', { index: 1, total: 2, data: '!!!' });
    if (scenario === 'missing') env.send(request, 'FLOW_RESULT', { chunked: true, mimeType: 'video/mp4' });
    await rejected; assert.equal(env.timers.size, 0);
  }
});
await run('oversized chunk and chunks from non-download operations are rejected', async () => {
  const env = environment();
  const download = env.api.flowDownload({ id: 'fixture', kind: 'video', url: '' }, PROJECT);
  const rejected = assert.rejects(download, /incompleto/);
  env.send(env.posted[0], 'FLOW_DOWNLOAD_CHUNK', { index: 0, total: 1, data: 'A'.repeat(2 * 1024 * 1024 + 1) });
  await rejected;
  const quote = env.api.flowQuote(valid(), PROJECT);
  const quoteRejected = assert.rejects(quote, /fora da operação/);
  env.send(env.posted.at(-1), 'FLOW_DOWNLOAD_CHUNK', { index: 0, total: 1, data: btoa('unexpected') });
  await quoteRejected;
});
await run('download validates decoded bytes dimensions rather than claimed 1080 metadata', async () => {
  const env = environment(bridgeCode, { width: 1280, height: 720 });
  const result = env.api.flowDownload({ id: 'low-res', kind: 'video', url: '' }, PROJECT);
  const rejection = assert.rejects(result, /1280 × 720/);
  env.send(env.posted[0], 'FLOW_RESULT', { dataUrl: 'data:video/mp4;base64,AQID', width: 1920, height: 1080 });
  await rejection; assert.equal(env.revoked.length, 1);
});
await run('still images keep native resolution and reject mismatched downloaded MIME', async () => {
  const env = environment(bridgeCode, { width: 1376, height: 768 });
  const image = env.api.flowDownload({ id: 'still', kind: 'image', url: '' }, PROJECT);
  env.send(env.posted[0], 'FLOW_RESULT', { dataUrl: 'data:image/png;base64,AQID' });
  assert.match((await image).name, /1376x768\.png$/);
  const bad = env.api.flowDownload({ id: 'still', kind: 'video', url: '' }, PROJECT);
  const rejection = assert.rejects(bad, /bytes/);
  env.send(env.posted.at(-1), 'FLOW_RESULT', { dataUrl: 'data:image/png;base64,AQID' });
  await rejection;
});
await run('media decode failure and timeout revoke blob URLs', async () => {
  for (const scenario of ['error', 'stall']) {
    const env = environment();
    env.dimensions[scenario] = true;
    const result = env.api.flowDownload({ id: 'bad', kind: 'video', url: '' }, PROJECT);
    const rejection = assert.rejects(result, /mídia|reproduzível/);
    env.send(env.posted[0], 'FLOW_RESULT', { dataUrl: 'data:video/mp4;base64,AQID' });
    await tick(); if (scenario === 'stall') env.fire(25000);
    await rejection; assert.equal(env.revoked.length, 1); assert.equal(env.timers.size, 0);
  }
});

console.log(`Flow contract and bridge: ${checks} scenarios passed.`);
