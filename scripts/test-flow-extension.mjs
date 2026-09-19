import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const origin = 'https://www.darkoautoedit.com';
const bridgeSource = readFileSync('extension/flow-bridge.js', 'utf8');
const workerSource = readFileSync('extension/flow-background.js', 'utf8');
const contentSource = readFileSync('extension/flow-content.js', 'utf8');
function bridge(id = 'flow-current') {
  const requests = [], replies = [];
  let pageListener, backgroundListener, healthy = true;
  const window = { location: { origin }, addEventListener: (_, listener) => { pageListener = listener; }, postMessage: message => replies.push(message) };
  const runtime = { id, getManifest: () => ({ version: '4.44.0' }), onMessage: { addListener: listener => { backgroundListener = listener; } },
    sendMessage(message, callback) { requests.push(message); callback(healthy ? (message.type === 'FLOW_HEALTH' ? { ok: true } : { accepted: true }) : undefined); } };
  vm.runInNewContext(bridgeSource, { window, chrome: { runtime }, Set, console });
  return { requests, replies, window, unhealthy: () => { healthy = false; }, receive: (data, extra = {}) => pageListener({ source: window, origin, data: { source: 'pilot-flow', ...data }, ...extra }),
    background: message => backgroundListener(message) };
}
test('Flow discovery requires the currently running worker', () => {
  const h = bridge();
  h.receive({ type: 'FLOW_PING', requestId: 'probe' });
  assert.equal(h.replies.at(-1).type, 'FLOW_PONG');
  assert.equal(h.replies.at(-1).extensionId, 'flow-current');
  h.unhealthy(); h.receive({ type: 'FLOW_PING', requestId: 'probe-2' });
  assert.equal(h.replies.length, 1);
});
test('only the explicitly selected extension forwards generation', () => {
  const a = bridge('first'), b = bridge('second');
  const message = { type: 'FLOW_REQUEST', requestId: 'gen-1', action: 'generate', extensionId: 'second' };
  a.receive(message); b.receive(message);
  assert.equal(a.requests.length, 0);
  assert.equal(b.requests.length, 1);
  assert.equal(b.replies[0].type, 'FLOW_ACK');
  b.receive({ ...message, extensionId: undefined });
  assert.equal(b.requests.length, 1);
});
test('Flow bridge rejects frames, other origins and unknown actions', () => {
  const h = bridge();
  const message = { type: 'FLOW_REQUEST', requestId: 'gen', action: 'generate', extensionId: 'flow-current' };
  h.receive(message, { source: {} });
  h.receive(message, { origin: 'https://attacker.example' });
  h.receive({ ...message, action: 'eval' });
  assert.equal(h.requests.length, 0);
});
test('Flow responses use an independent envelope and retain ordered chunk metadata', () => {
  const h = bridge();
  h.background({ source: 'darkolab-bg', type: 'HG_RESULT' });
  assert.equal(h.replies.length, 0);
  h.background({ source: 'flow-background', type: 'FLOW_DOWNLOAD_CHUNK', requestId: 'download-1', payload: { index: 2, total: 4, data: 'YQ==' } });
  assert.equal(h.replies[0].source, 'flow-extension');
  assert.equal(h.replies[0].payload.index, 2);
});

function worker(saved = {}, options = {}) {
  let listener;
  const output = [], tabs = [], store = { 'autoedit.flow.jobs.v1': saved };
  const chrome = {
    runtime: { onMessage: { addListener: value => { listener = value; } }, getManifest: () => ({ version: '4.44.0' }) },
    debugger: { onDetach: { addListener() {} }, onEvent: { addListener() {} } },
    tabs: { sendMessage: async (id, value) => { output.push(value); }, query: async () => { tabs.push('query'); return options.query ? options.query() : []; } },
    storage: { local: { get: async key => ({ [key]: store[key] }), set: async data => Object.assign(store, data) } },
  };
  vm.runInNewContext(workerSource, { chrome, Map, Set, Promise, URL, Number, Date, Object, String, Array, Math, setTimeout, clearTimeout, console, Uint8Array });
  return { output, tabs, request: async (message, source = `${origin}/tools/clickup-pilot`) => {
    let ack;
    listener({ type: 'FLOW_REQUEST', requestId: 'request-1', ...message }, { url: source, tab: { id: 7, url: source } }, response => { ack = response; });
    await new Promise(resolve => setImmediate(resolve));
    return ack;
  } };
}
const valid = { mode: 'video', model: 'Omni 1.1 Flash', aspectRatio: '9:16', resolution: '720p', durationSeconds: 8, count: 1, prompt: 'Test', references: [], expectedAccountEmail: 'test@example.com', maxCredits: 15 };
test('worker rejects requests from sites outside the Pilot', async () => {
  const h = worker();
  assert.equal((await h.request({ action: 'generate', payload: valid }, 'https://attacker.example')).accepted, false);
  assert.equal(h.tabs.length, 0);
  assert.equal(h.output.length, 0);
});
for (const [name, patch] of [
  ['count outside 1–4', { count: 5 }], ['missing account', { expectedAccountEmail: '' }],
  ['unknown credit estimate', { maxCredits: null }], ['invalid aspect', { aspectRatio: '1:1' }],
  ['too many references', { references: Array(5).fill({}) }], ['invalid reference', { references: [{ mimeType: 'text/html', dataUrl: 'data:text/html;base64,YQ==' }] }],
  ['unresolved animation image', { animateMediaId: 'image-1', references: [] }],
  ['too many start/end frames', { videoMode: 'frames', references: Array(3).fill({ mimeType: 'image/png', dataUrl: 'data:image/png;base64,YQ==' }) }],
]) {
  test(`generation validates ${name} before opening Flow or spending`, async () => {
    const h = worker();
    await h.request({ action: 'generate', payload: { ...valid, ...patch } });
    assert.equal(h.output.at(-1)?.type, 'FLOW_ERROR');
    assert.equal(h.tabs.length, 0);
  });
}
test('repeated successful request reuses persisted results without generation', async () => {
  const h = worker({ 'request-1': { state: 'completed', assets: [{ id: 'existing-result' }], projectUrl: 'https://flow.google.com/project/test' } });
  await h.request({ action: 'generate', payload: valid });
  assert.equal(h.output.at(-1)?.type, 'FLOW_RESULT');
  assert.equal(h.output.at(-1).payload.recovered, true);
  assert.equal(h.tabs.length, 0);
});
test('uncertain submitted request cannot be dispatched a second time', async () => {
  const h = worker({ 'request-1': { state: 'needs_attention', submitted: true } });
  await h.request({ action: 'generate', payload: valid });
  assert.equal(h.output.at(-1)?.type, 'FLOW_ERROR');
  assert.equal(h.tabs.length, 0);
});
test('status and cancel target payload.requestId instead of the new transport id', async () => {
  const h = worker({ existing: { requestId: 'existing', state: 'generating', submitted: true } });
  await h.request({ action: 'status', payload: { requestId: 'existing' } });
  assert.equal(h.output.at(-1).payload.job.requestId, 'existing');
  await h.request({ action: 'cancel', payload: { requestId: 'existing' } });
  assert.equal(h.output.at(-1).payload.cancelled, true);
  assert.equal(h.output.at(-1).payload.submitted, true);
});
test('a persisted uncertain job blocks a new transport id after worker restart', async () => {
  const h = worker({ earlier: { requestId: 'earlier', state: 'needs_attention', submitted: true } });
  await h.request({ action: 'generate', payload: valid });
  assert.equal(h.output.at(-1).type, 'FLOW_ERROR');
  assert.match(h.output.at(-1).error, /pedido anterior/);
  assert.equal(h.tabs.length, 0);
});
test('explicit user acknowledgement releases uncertainty and preserves its audit state', async () => {
  const h = worker({ earlier: { requestId: 'earlier', state: 'needs_attention', submitted: true } });
  await h.request({ action: 'cancel', payload: { requestId: 'earlier', acknowledgeUncertain: true } });
  assert.equal(h.output.at(-1).payload.acknowledged, true);
  await h.request({ action: 'status', payload: { requestId: 'earlier' } });
  assert.equal(h.output.at(-1).payload.job.state, 'acknowledged');
  await h.request({ action: 'generate', payload: valid });
  assert.equal(h.tabs.length, 1, 'new generation is allowed to connect instead of blocked by acknowledged history');
});
test('a request interrupted before submission is safe to retry after restart', async () => {
  const h = worker({ earlier: { requestId: 'earlier', state: 'preparing', submitted: false } });
  await h.request({ action: 'status', payload: { requestId: 'earlier' } });
  assert.equal(h.output.at(-1).payload.job.state, 'failed');
  assert.equal(h.output.at(-1).payload.job.submitted, false);
});
test('busy Flow rejects a second request immediately instead of silently queueing it', async () => {
  let release;
  const h = worker({}, { query: () => new Promise(resolve => { release = resolve; }) });
  await h.request({ requestId: 'first', action: 'quote', payload: valid });
  await h.request({ requestId: 'second', action: 'generate', payload: valid });
  assert.equal(h.output.at(-1).requestId, 'second');
  assert.equal(h.output.at(-1).type, 'FLOW_ERROR');
  assert.match(h.output.at(-1).error, /não será enviado mais tarde/);
  release([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.tabs.length, 1);
});

function declaration(name, source = workerSource) {
  const ast = ts.createSourceFile('flow-module.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(found, `function ${name}`);
  return found;
}
function configureHarness(dropFinalControl = '', initialModel = 'old') {
  let selected = new Set(), model = initialModel;
  const actions = [];
  const ctx = { openSettings: async () => {}, openModelMenu: async () => { actions.push('model menu'); }, closeSettings: async () => {},
    waitDom: async () => ({}),
    choose: async (_, name) => { selected.add(name); actions.push(name); },
    dom: async (_, op, payload) => {
      if (op === 'activateModel') { model = payload.name; selected = new Set([...selected].filter(item => ['Imagem', 'Vídeo'].includes(item))); actions.push('model selected'); return {}; }
      return { model, credits: 15, selected: [...selected].filter(item => item !== dropFinalControl) };
    } };
  vm.runInNewContext(declaration('verifyConfigured') + declaration('configure') + ';this.configure = configure;', ctx);
  return { actions, configure: payload => ctx.configure(1, payload) };
}
test('model changes may reset options; configure restores and verifies all requested controls', async () => {
  const h = configureHarness();
  const result = await h.configure({ ...valid, videoMode: 'ingredients' });
  assert.deepEqual([...result.selected].sort(), ['Vídeo', 'Elementos', '9:16', '720p', '8s', 'x1'].sort());
  assert.ok(h.actions.indexOf('model selected') < h.actions.indexOf('9:16'));
});
test('configure refuses a model that silently drops a requested control', async () => {
  const h = configureHarness('9:16');
  await assert.rejects(h.configure({ ...valid, videoMode: 'ingredients' }), /alterou uma opção/);
});
test('inactive-tab menu rendering may take seconds; openSettings clicks once and waits for semantic readiness', async () => {
  let now = 0, clicks = 0, reads = 0;
  const ctx = {
    Date: { now: () => now }, sleep: async ms => { now += ms; }, errorText: error => error.message,
    clickButton: async (_, name) => { assert.equal(name, 'Gatilho de configurações'); clicks++; },
    dom: async (_, op) => { assert.equal(op, 'uiState'); reads++; return { settingsOpen: now >= 2400 }; },
  };
  vm.runInNewContext(declaration('waitDom') + declaration('openSettings') + ';this.openSettings=openSettings;', ctx);
  await ctx.openSettings(1);
  assert.equal(clicks, 1);
  assert.ok(now >= 2400);
  assert.ok(reads > 2);
});
test('opening an already-open settings menu never toggles it closed', async () => {
  let clicks = 0;
  const ctx = { dom: async () => ({ settingsOpen: true }), clickButton: async () => { clicks++; }, waitDom: async () => { throw new Error('must not wait'); } };
  vm.runInNewContext(declaration('openSettings') + ';this.openSettings=openSettings;', ctx);
  await ctx.openSettings(1);
  assert.equal(clicks, 0);
});
test('failed menu opening reports the real missing state without repeating the click', async () => {
  let now = 0, clicks = 0;
  const ctx = { Date: { now: () => now }, sleep: async ms => { now += ms; }, errorText: error => error.message,
    clickButton: async () => { clicks++; }, dom: async () => ({ settingsOpen: false }) };
  vm.runInNewContext(declaration('waitDom') + declaration('openSettings') + ';this.openSettings=openSettings;', ctx);
  await assert.rejects(ctx.openSettings(1), /abertura das configurações/);
  assert.equal(clicks, 1);
});
test('account panel failure is not swallowed before trying the settings menu', async () => {
  let settingsCalls = 0;
  const ctx = { Number, closeSettings: async () => { settingsCalls++; }, dom: async (_, op) => op === 'account' ? null : ({ accountOpen: false }),
    waitDom: async (_, op) => { if (op === 'uiState') throw new Error('a abertura da conta Google'); return {}; } };
  vm.runInNewContext(declaration('readAccount') + ';this.readAccount=readAccount;', ctx);
  await assert.rejects(ctx.readAccount(1), /abertura da conta Google/);
  assert.equal(settingsCalls, 1);
});
test('configure keeps the current model menu closed when the requested motor is already active', async () => {
  const h = configureHarness('', valid.model);
  await h.configure({ ...valid, videoMode: 'ingredients' });
  assert.equal(h.actions.includes('model menu'), false);
  assert.equal(h.actions.includes('model selected'), false);
});
test('download readiness is transient and receives the extended preparation window', async () => {
  let now = 0;
  const ctx = {
    Date: { now: () => now }, sleep: async ms => { now += ms; },
    chrome: {
      tabs: { get: async () => ({ url: 'https://flow.google.com/project/project-a/edit/6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e', status: 'complete' }), reload: async () => {} },
      scripting: { executeScript: async () => {} }, runtime: { getManifest: () => ({ version: '4.45.5' }) },
    },
    isFlow: () => true,
    dom: async (_, op) => op === 'ping' ? { version: '4.45.5' } : { ready: false },
  };
  vm.runInNewContext(declaration('waitReady') + ';this.waitReady=waitReady;', ctx);
  const error = await ctx.waitReady(7, 'downloadReady', 180000).then(() => null, value => value);
  assert.equal(error.code, 'FLOW_MEDIA_NOT_READY');
  assert.match(error.message, /continuará acompanhando automaticamente/);
  assert.ok(now >= 180000);
});
test('account connection uses the nested Google role button before the inert visual shell', () => {
  const google = { ariaLabel: 'Conta do Google: Silas Ryan (ryanrxvn@gmail.com), Assinatura do Google' };
  const shell = { ariaLabel: 'Detalhes da conta' };
  const ctx = {
    all: selector => selector === 'button,[role="button"]' ? [shell, google] : [],
    label: element => element.ariaLabel,
    one: elements => elements[0],
  };
  vm.runInNewContext(declaration('accountControl', contentSource) + ';this.accountControl=accountControl;', ctx);
  assert.equal(ctx.accountControl(), google);
});
test('account identity is parsed from the current Flow role button before the panel mounts', () => {
  const header = {
    getAttribute: name => name === 'aria-label' ? 'Conta do Google: Silas Ryan (ryanrxvn@gmail.com), Assinatura do Google' : null,
  };
  const ctx = {
    Number,
    all: () => [],
    text: () => '',
    accountAvatar: () => 'avatar.png',
    document: {
      querySelector: selector => selector.includes('[role="button"]') ? header : null,
    },
  };
  vm.runInNewContext(declaration('account', contentSource) + ';this.account=account;', ctx);
  assert.deepEqual({ ...ctx.account() }, { name: 'Silas Ryan', email: 'ryanrxvn@gmail.com', avatarUrl: 'avatar.png', credits: null });
});
test('background account lookup keeps the verified header identity if Flow defers its overlay', async () => {
  const identity = { name: 'Silas Ryan', email: 'ryanrxvn@gmail.com', credits: null };
  const ctx = {
    Number,
    closeSettings: async () => {},
    dom: async (_, op) => op === 'account' ? identity : op === 'uiState' ? { accountOpen: false } : null,
    waitDom: async (_, op) => { if (op === 'accountButton') throw new Error('Conta Google não foi encontrado'); return null; },
  };
  vm.runInNewContext(declaration('readAccount') + ';this.readAccount=readAccount;', ctx);
  assert.deepEqual({ ...(await ctx.readAccount(1)) }, identity);
});
test('Flow model names remove only the observed banana prefix', () => {
  const ctx = {};
  vm.runInNewContext(declaration('cleanModelName', contentSource) + ';this.cleanModelName=cleanModelName;', ctx);
  for (const [input, expected] of [
    ['🍌 Nano Banana Pro', 'Nano Banana Pro'], [' 🍌 Nano Banana 2 ', 'Nano Banana 2'],
    ['🍌 Nano Banana 2 Lite', 'Nano Banana 2 Lite'], ['Nano Banana Pro', 'Nano Banana Pro'],
    ['Veo 3.1 - Quality', 'Veo 3.1 - Quality'], ['Omni 1.1 Flash', 'Omni 1.1 Flash'],
    ['🍎 Nano Banana Pro', '🍎 Nano Banana Pro'], ['Nano 🍌 Banana Pro', 'Nano 🍌 Banana Pro'],
  ]) assert.equal(ctx.cleanModelName(input), expected);
});

function labelledButtonFixture({ ariaLabel = null, tooltip = null, visibleText = '', icon = null } = {}) {
  return {
    getAttribute: name => name === 'aria-label' ? ariaLabel : name === 'mattooltip' ? tooltip : null,
    cloneNode: () => {
      let decoration = icon;
      return {
        get textContent() { return `${decoration?.text || ''}${visibleText}`; },
        querySelectorAll: selector => {
          assert.equal(selector, '[aria-hidden="true"],mat-icon:not([aria-label]):not([aria-labelledby])');
          return decoration && (decoration.hidden || (decoration.tag === 'mat-icon' && !decoration.label)) ? [{ remove() { decoration = null; } }] : [];
        },
      };
    },
  };
}

test('upload button ignores the decorative Material upload ligature without needing aria-label', () => {
  const upload = labelledButtonFixture({ tooltip: 'Enviar mídia', visibleText: 'Enviar mídia', icon: { text: 'upload', hidden: true, tag: 'mat-icon' } });
  const ctx = { text: element => element.textContent.trim(), normalize: value => value.toLowerCase(), all: () => [upload] };
  vm.runInNewContext(declaration('label', contentSource) + declaration('one', contentSource) + declaration('button', contentSource) + ';this.button=button;this.label=label;', ctx);
  assert.equal(ctx.label(upload), 'Enviar mídia');
  assert.equal(ctx.button('Enviar mídia'), upload);
});

test('button naming respects real aria-label and text instead of replacing them with a matching tooltip', () => {
  const ctx = { text: element => element.textContent.trim() };
  vm.runInNewContext(declaration('label', contentSource) + ';this.label=label;', ctx);
  assert.equal(ctx.label(labelledButtonFixture({ ariaLabel: 'Excluir mídia', tooltip: 'Enviar mídia', visibleText: 'Enviar mídia' })), 'Excluir mídia');
  assert.equal(ctx.label(labelledButtonFixture({ tooltip: 'Enviar mídia', visibleText: 'Remover mídia', icon: { text: 'delete', hidden: true, tag: 'mat-icon' } })), 'Remover mídia');
  assert.equal(ctx.label(labelledButtonFixture({ tooltip: 'Enviar mídia', icon: { text: 'upload', hidden: true, tag: 'mat-icon' } })), 'Enviar mídia');
});

test('two accessible upload names remain ambiguous after decorative icon removal', () => {
  const upload = labelledButtonFixture({ visibleText: 'Enviar mídia', icon: { text: 'upload', hidden: true, tag: 'mat-icon' } });
  const duplicate = labelledButtonFixture({ ariaLabel: 'Enviar mídia' });
  const ctx = { text: element => element.textContent.trim(), normalize: value => value.toLowerCase(), all: () => [upload, duplicate] };
  vm.runInNewContext(declaration('label', contentSource) + declaration('one', contentSource) + declaration('button', contentSource) + ';this.button=button;', ctx);
  assert.throws(() => ctx.button('Enviar mídia'), /mais de um controle/);
});
test('model listing and exact selection agree for Flow labels with banana prefix', () => {
  const elements = ['🍌 Nano Banana Pro', '🍌 Nano Banana 2', '🍌 Nano Banana 2 Lite'].map(value => ({ value, querySelector() { return null; } }));
  const ctx = { all: () => elements, text: element => element.value, normalize: value => value.toLowerCase(),
    one: values => { assert.equal(values.length, 1); return values[0]; } };
  vm.runInNewContext(declaration('cleanModelName', contentSource) + declaration('modelControl', contentSource) + declaration('modelOptions', contentSource) + ';this.modelControl=modelControl;this.modelOptions=modelOptions;', ctx);
  assert.deepEqual([...ctx.modelOptions()], ['Nano Banana Pro', 'Nano Banana 2', 'Nano Banana 2 Lite']);
  assert.equal(ctx.modelControl('Nano Banana Pro'), elements[0]);
  assert.equal(ctx.modelControl('Nano Banana 2 Lite'), elements[2]);
  assert.equal(ctx.modelControl('🍌 Nano Banana 2'), elements[1]);
});
test('capabilities include enabled unselected radios and exclude disabled combinations', () => {
  const radio = (value, selected = false, disabled = false) => ({ value, disabled,
    querySelector: () => ({ value }), getAttribute: name => name === 'aria-checked' ? String(selected) : name === 'aria-disabled' ? String(disabled) : null });
  const radios = [radio('Imagem', true), radio('Vídeo'), radio('9:16', true), radio('16:9'), radio('x1', true), radio('x2'), radio('x4', false, true)];
  const modelButton = { value: '🍌 Nano Banana Pro', querySelector() { return null; } };
  const ctx = { Set, text: element => element?.value || '', all: selector => selector === '[role="radio"]' ? radios : selector.startsWith('button[') ? [modelButton] : [] };
  vm.runInNewContext(declaration('cleanModelName', contentSource) + declaration('settings', contentSource) + ';this.settings=settings;', ctx);
  const result = ctx.settings();
  assert.deepEqual([...result.available], ['Imagem', 'Vídeo', '9:16', '16:9', 'x1', 'x2']);
  assert.deepEqual([...result.disabled], ['x4']);
  assert.deepEqual([...result.selected], ['Imagem', '9:16', 'x1']);
  assert.equal(result.model, 'Nano Banana Pro');
});
function inspectHarness() {
  let mode = 'video', model = 'Omni 1.1 Flash';
  const actions = [];
  const options = () => mode === 'image' ? ['Nano Banana Pro', 'Nano Banana 2 Lite'] : ['Omni 1.1 Flash', 'Veo 3.1 - Quality'];
  const read = (op) => op === 'inspect' ? { projectUrl: 'https://flow.google.com/project/test', models: options() }
    : op === 'uiState' ? { settingsOpen: true, modelMenuOpen: false }
      : { model, selected: [mode === 'image' ? 'Imagem' : 'Vídeo', '9:16', 'x1'], available: mode === 'image' ? ['Imagem', 'Vídeo', '9:16', '16:9', 'x1', 'x2'] : ['Imagem', 'Vídeo', 'Frames', 'Elementos', '9:16', '16:9', '720p', '8s', 'x1'], credits: 15 };
  const ctx = { tabFor: async () => 7, readAccount: async () => ({ email: 'test@example.com' }),
    openSettings: async () => actions.push('settings'), openModelMenu: async () => actions.push('models'), closeSettings: async () => actions.push('close'), detach: async () => {},
    choose: async (_, name) => { mode = name === 'Imagem' ? 'image' : 'video'; model = options()[0]; actions.push(name); },
    dom: async (_, op, payload) => { assert.equal(op, 'activateModel'); assert.ok(options().includes(payload.name)); model = payload.name; actions.push(model); return {}; },
    waitDom: async (_, op, payload, accept) => { const value = read(op); assert.ok(accept(value), op); return value; } };
  vm.runInNewContext(declaration('inspect') + ';this.inspect=inspect;', ctx);
  return { actions, inspect: payload => ctx.inspect(payload) };
}
test('inspect selects requested mode and model, then returns their real capabilities without generation', async () => {
  const h = inspectHarness();
  const result = await h.inspect({ mode: 'image', model: 'Nano Banana 2 Lite' });
  assert.equal(result.mode, 'image');
  assert.equal(result.controls.model, 'Nano Banana 2 Lite');
  assert.deepEqual([...result.models], ['Nano Banana Pro', 'Nano Banana 2 Lite']);
  assert.ok(result.controls.available.includes('x2'));
  assert.ok(!result.controls.available.includes('720p'));
  assert.deepEqual(h.actions, ['settings', 'Imagem', 'models', 'Nano Banana 2 Lite', 'close']);
});
test('inspect refuses an unavailable requested model instead of silently changing it', async () => {
  const h = inspectHarness();
  await assert.rejects(h.inspect({ mode: 'image', model: 'Veo 3.1 - Quality' }), /não está disponível neste modo/);
  assert.ok(!h.actions.includes('Veo 3.1 - Quality'));
});
test('uploaded references receive unique filenames and image IDs ignore signed URL query changes', () => {
  const ctx = { URL, location: { href: 'https://flow.google.com/project/test' } };
  vm.runInNewContext(declaration('uniqueReferenceName') + declaration('referenceImageId', contentSource) + ';this.uniqueReferenceName=uniqueReferenceName;this.referenceImageId=referenceImageId;', ctx);
  const first = ctx.uniqueReferenceName('flow-request-1', 0, 'image/png', 'abcdef123456');
  const second = ctx.uniqueReferenceName('flow-request-1', 1, 'image/png', 'abcdef123456');
  assert.notEqual(first, second);
  assert.match(first, /^pilot-flow-flow-request-1-1-abcdef123456\.png$/);
  const id = '3ed83851-13a7-4bb1-b4ca-07420faea7c9';
  assert.equal(ctx.referenceImageId(`https://flow.google.com/image/${id}?Expires=old`), id);
  assert.equal(ctx.referenceImageId(`https://flow.google.com/image/${id}?Expires=new&Signature=changed`), id);
  assert.equal(ctx.referenceImageId(`https://flow.google.com/image/unrelated?imageId=${id}`), null);
});
test('account avatar prefers the real Google profile and excludes the decorative plan ring', () => {
  const ctx = {};
  vm.runInNewContext(declaration('accountAvatar', contentSource) + ';this.accountAvatar=accountAvatar;', ctx);
  const image = (src, alt = '', className = '') => ({ src, className, getAttribute: () => alt, getBoundingClientRect: () => ({ width: 40, height: 40 }) });
  const ring = image('https://example.com/ring.svg', 'Google AI plan ring', 'plan-ring');
  const photo = image('https://example.com/person.png', 'Foto do perfil', 'gb_X');
  assert.equal(ctx.accountAvatar({ querySelector: () => photo, querySelectorAll: () => [ring, photo] }), photo.src);
  assert.equal(ctx.accountAvatar({ querySelector: () => null, querySelectorAll: () => [ring, photo] }), photo.src);
  assert.equal(ctx.accountAvatar({ querySelector: () => null, querySelectorAll: () => [ring] }), undefined);
});
test('upload selects the exact new resource and verifies preview plus composer identity before succeeding', async () => {
  const correct = '3ed83851-13a7-4bb1-b4ca-07420faea7c9', old = '00000000-0000-4000-8000-000000000000';
  const actions = [], choosers = new Map();
  let uploadedName, included = false, selected = false;
  const ctx = { choosers, deadline: promise => promise, uniqueReferenceName: () => 'pilot-flow-unique.png',
    dom: async (_, op, payload) => {
      if (op === 'commandReferences') return { count: 0, ids: [], busy: false };
      if (op === 'selectUploadedResource') { assert.equal(payload.name, uploadedName); selected = true; actions.push('select exact file'); return {}; }
      throw new Error(`unexpected DOM operation ${op}`);
    },
    cdp: async (_, op, payload) => {
      if (op === 'DOM.resolveNode') return { object: { objectId: 'real-input' } };
      if (op === 'Runtime.callFunctionOn') { uploadedName = payload.arguments[0].value.name; return { result: { value: 1 } }; }
      return {};
    },
    clickButton: async (_, name) => { if (name === 'Incluir no comando') { assert.ok(selected); included = true; actions.push('include'); } },
    activateWithUserGesture: async (_, kind, name, id) => { assert.equal(kind, 'upload'); assert.equal(name, 'Enviar mídia'); assert.equal(id, 'request-1:0'); choosers.get(7)({ backendNodeId: 91 }); },
    waitDom: async (_, op, payload, accept) => {
      if (op === 'uploadedResource') { assert.equal(payload.name, uploadedName); const result = { imageId: correct }; assert.ok(accept(result)); return result; }
      if (op === 'referencePlacementState') {
        assert.ok(selected); assert.equal(included, false);
        assert.equal(payload.name, uploadedName);
        const references = { count: 0, ids: [], busy: false };
        assert.equal(accept({ previewMatches: false, imageId: correct, references }), false, 'the old visible preview cannot authorize inclusion');
        assert.equal(accept({ previewMatches: true, imageId: old, references }), false, 'a different image cannot authorize inclusion');
        const result = { previewMatches: true, imageId: correct, references };
        assert.ok(accept(result)); actions.push('verify new preview'); return result;
      }
      if (op === 'commandReferences') {
        assert.ok(included);
        assert.equal(accept({ count: 1, ids: [old], busy: false }), false, 'increased count alone is not proof');
        assert.equal(accept({ count: 1, ids: [correct], busy: true }), false, 'an uploading chip is not ready');
        const result = { count: 1, ids: [correct], busy: false }; assert.ok(accept(result)); actions.push('verify composer identity'); return result;
      }
      throw new Error(`unexpected wait ${op}`);
    } };
  vm.runInNewContext(declaration('sameReferenceIds') + declaration('confirmReferencePlacement') + declaration('injectReferenceFile') + declaration('uploadReference') + ';this.uploadReference=uploadReference;', ctx);
  const result = await ctx.uploadReference(7, { name: 'original.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,YQ==' }, 'request-1', 0);
  assert.equal(result, correct);
  assert.equal(uploadedName, 'pilot-flow-unique.png');
  assert.deepEqual(actions, ['select exact file', 'verify new preview', 'include', 'verify composer identity']);
  assert.equal(choosers.size, 0);
});

test('submission clicks the exact current prompt once and never retries an uncertain activation', () => {
  let clicks = 0, currentPrompt = 'Cena de teste', disabled = false;
  const ctx = { submissionAttempts: new Set(), readPrompt: () => currentPrompt,
    button: name => { assert.equal(name, 'Iniciar geração'); return { disabled, getAttribute: () => null }; },
    activate: () => { clicks++; } };
  vm.runInNewContext(declaration('submitGeneration', contentSource) + ';this.submitGeneration=submitGeneration;', ctx);
  assert.equal(ctx.submitGeneration('gen-1', 'Cena de teste').activated, true);
  assert.throws(() => ctx.submitGeneration('gen-1', 'Cena de teste'), /não será repetido/);
  currentPrompt = 'Outro prompt';
  assert.throws(() => ctx.submitGeneration('gen-2', 'Cena de teste'), /prompt.*mudou/);
  disabled = true;
  assert.throws(() => ctx.submitGeneration('gen-2', 'Outro prompt'), /indisponível/);
  assert.equal(clicks, 1);
});

test('generation submission evidence matches encoded prompt values and excludes unrelated endpoints', () => {
  const ctx = { URL };
  vm.runInNewContext(declaration('requestContainsPrompt') + declaration('generationEndpoint') + ';this.requestContainsPrompt=requestContainsPrompt;this.generationEndpoint=generationEndpoint;', ctx);
  const prompt = 'Uma "imagem"\ncom ação';
  assert.equal(ctx.requestContainsPrompt(JSON.stringify({ request: { prompt } }), prompt), true);
  assert.equal(ctx.requestContainsPrompt(JSON.stringify({ nested: JSON.stringify({ prompt }) }), prompt), true);
  assert.equal(ctx.requestContainsPrompt(JSON.stringify({ prompt: 'Outra cena' }), prompt), false);
  for (const url of ['https://flow.google.com/api/generateImages', 'https://aisandbox-pa.googleapis.com/v1/video:batchAsyncGenerateVideoText']) assert.equal(ctx.generationEndpoint(url), true);
  for (const url of ['https://flow.google.com/api/autosaveGenerateDraft', 'https://flow.google.com/analytics/generate', 'https://attacker.test/generate', 'https://flow.google.com/rpc', 'http://flow.google.com/generate']) assert.equal(ctx.generationEndpoint(url), false);
});

test('the sent stage waits for a real submission request and times out without another activation', async () => {
  let now = 1000;
  const evidence = { requests: new Set(), sentAt: null, error: null }, jobs = new Map();
  const ctx = { Date: { now: () => now }, jobs, sleep: async ms => { now += ms; if (now >= 2200) { evidence.requests.add('network-1'); evidence.sentAt = now; } } };
  vm.runInNewContext(declaration('waitForSubmission') + ';this.waitForSubmission=waitForSubmission;', ctx);
  await ctx.waitForSubmission({ requestId: 'gen' }, evidence);
  assert.equal(now, 2200);
  ctx.sleep = async ms => { now += ms; };
  await assert.rejects(ctx.waitForSubmission({ requestId: 'gen' }, { requests: new Set(), sentAt: null }, 20000), /não confirmou o envio.*não repetiu o clique/);
  await assert.rejects(ctx.waitForSubmission({ requestId: 'gen' }, { ...evidence, error: 'HTTP 429' }), /HTTP 429/);
  jobs.set('gen', { cancelRequested: true });
  await assert.rejects(ctx.waitForSubmission({ requestId: 'gen' }, evidence), /cancelado/);
});

test('exact prompt appearing in a new pending card confirms submission when network bodies are unavailable', async () => {
  let now = 1000, reads = 0;
  const evidence = { prompt: 'Our exact prompt', requests: new Set(), sentAt: null };
  const job = { requestId: 'gen', tabId: 7, baselinePromptMatches: 1 };
  const ctx = { Date: { now: () => now }, jobs: new Map(), sleep: async ms => { now += ms; }, save: async () => {},
    dom: async (_, op, payload) => { assert.equal(op, 'generationObservation'); assert.equal(payload.prompt, evidence.prompt); reads++; return { promptMatches: now >= 1800 ? 2 : 1 }; } };
  vm.runInNewContext(declaration('observeSubmission') + declaration('waitForSubmission') + ';this.observeSubmission=observeSubmission;this.waitForSubmission=waitForSubmission;', ctx);
  await ctx.waitForSubmission(job, evidence, 20000, () => ctx.observeSubmission(job, evidence));
  assert.ok(reads > 1); assert.equal(now, 1800); assert.equal(evidence.domObserved, true);
  assert.equal(job.submissionDiagnostics.domPromptObservedAt, 1800);
});

test('prompt evidence is scoped to visible media cards and requires the entire prompt text', () => {
  const cards = [{ children: [{ innerText: 'Our exact prompt' }] }, { children: [{ innerText: 'Our exact prompt plus unrelated text' }] }];
  const ctx = { all: (selector, root) => selector === 'flow-tile-container' ? cards : root.children };
  vm.runInNewContext(declaration('generationObservation', contentSource) + ';this.generationObservation=generationObservation;', ctx);
  assert.equal(ctx.generationObservation('Our exact prompt').promptMatches, 1);
  assert.equal(ctx.generationObservation('our exact prompt').promptMatches, 0);
  assert.equal(ctx.generationObservation('A prompt only present in the composer').promptMatches, 0);
});

test('command verification clears old matching text, activates only the exact card and verifies references', async () => {
  let prompt = 'Our exact prompt', references = ['reference-1'];
  const actions = [];
  const ctx = { crypto: webcrypto, TextEncoder, Uint8Array,
    clickButton: async (_, name) => { assert.equal(name, 'Apagar comando'); actions.push('clear'); prompt = ''; references = []; },
    dom: async (_, op, payload) => {
      assert.equal(op, 'reuseMediaCommand'); assert.equal(payload.asset.id, 'new-exact-id');
      assert.equal(prompt, ''); assert.deepEqual(references, []); actions.push('reuse exact card');
      prompt = 'Our exact prompt'; references = ['reference-1'];
    },
    waitDom: async (_, op, payload, accept) => {
      const value = op === 'prompt' ? prompt : { count: references.length, ids: references, busy: false };
      assert.ok(accept(value), op); return value;
    } };
  vm.runInNewContext(declaration('promptFingerprint') + declaration('sameReferenceIds') + declaration('verifyAssetCommand') + ';this.promptFingerprint=promptFingerprint;this.verifyAssetCommand=verifyAssetCommand;', ctx);
  const hash = await ctx.promptFingerprint('Our exact prompt');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await ctx.verifyAssetCommand(7, { id: 'new-exact-id' }, hash, ['reference-1']), true);
  assert.deepEqual(actions, ['clear', 'reuse exact card']);
  assert.equal(await ctx.verifyAssetCommand(7, { id: 'new-exact-id' }, hash, ['wrong-reference']), false);
  assert.equal(await ctx.verifyAssetCommand(7, { id: 'new-exact-id' }, await ctx.promptFingerprint('Another prompt'), ['reference-1']), false);
});

test('failed clear cannot reuse a stale matching composer as evidence for a result', async () => {
  let activations = 0;
  const ctx = { clickButton: async () => { throw new Error('clear failed'); }, dom: async (_, op) => { if (op === 'prompt') return 'Our exact prompt'; activations++; } };
  vm.runInNewContext(declaration('verifyAssetCommand') + ';this.verifyAssetCommand=verifyAssetCommand;', ctx);
  await assert.rejects(ctx.verifyAssetCommand(7, { id: 'new-id' }, 'hash', []), /clear failed/);
  assert.equal(activations, 0);
});

test('reuse resolves the observed hidden hotbar button only inside the exact media tile', () => {
  const control = {}, tile = { querySelectorAll: selector => { assert.equal(selector, 'button[aria-label="Reutilizar comando"]'); return [control]; } };
  const ctx = { locateMedia: asset => { assert.equal(asset.id, 'exact-id'); return { closest: selector => { assert.equal(selector, 'flow-tile-container'); return tile; } }; },
    one: elements => { assert.equal(elements.length, 1); return elements[0]; }, activate: element => { assert.equal(element, control); return { activated: true }; } };
  vm.runInNewContext(declaration('reuseMediaCommand', contentSource) + ';this.reuseMediaCommand=reuseMediaCommand;', ctx);
  assert.equal(ctx.reuseMediaCommand({ id: 'exact-id' }).activated, true);
});

test('legacy submitted jobs recover only new exact-command results and ignore later uploads', async () => {
  const known = { id: 'old-id', kind: 'image' }, candidate = { id: 'new-id', kind: 'image' }, uploaded = { id: 'uploaded-later', kind: 'image', canReuseCommand: false };
  const job = { requestId: 'legacy', submitted: true, state: 'needs_attention', expectedCount: 1, mode: 'image', baselineIds: ['old-id'], account: { email: 'Test@Example.com' }, projectUrl: 'https://flow.google.com/project/test' };
  let opens = 0, verified = 0, writes = 0;
  const ctx = { crypto: webcrypto, TextEncoder, Uint8Array, busyOperation: null, Date, sleep: async () => {},
    tabFor: async () => { opens++; return 7; }, readAccount: async () => ({ email: 'test@example.com' }),
    dom: async (_, op) => op === 'media' ? { assets: [uploaded, known, candidate], busy: false } : ({}),
    verifyAssetCommand: async (_, asset, hash, refs) => { verified++; assert.equal(asset.id, 'new-id'); assert.equal(hash, await ctx.promptFingerprint('Saved original prompt')); assert.deepEqual([...refs], []); return true; },
    save: async () => { writes++; }, detach: async () => {}, errorText: error => error.message };
  vm.runInNewContext(declaration('promptFingerprint') + declaration('refreshResultAccount') + declaration('recoverJob') + ';this.promptFingerprint=promptFingerprint;this.recoverJob=recoverJob;', ctx);
  const unavailable = await ctx.recoverJob({ ...job }, 1);
  assert.equal(unavailable.state, 'needs_attention'); assert.equal(opens, 0);
  const recovered = await ctx.recoverJob(job, 1, 'Saved original prompt');
  assert.equal(recovered.state, 'completed'); assert.equal(recovered.assets[0].id, 'new-id');
  assert.equal(verified, 1); assert.equal(writes, 2); assert.equal(ctx.busyOperation, null);
  assert.match(recovered.promptHash, /^[a-f0-9]{64}$/);
});

test('canvas video detail exposes a poster and pending preview, never an image or HTML URL as video', () => {
  const assetId = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e';
  const poster = { getAttribute: () => 'Prévia do vídeo da cena', src: 'https://flow.google.com/asb/verified-poster' };
  const ctx = { location: { pathname: `/project/example/edit/${assetId}` }, all: selector => selector === 'video' ? [] : [poster] };
  vm.runInNewContext(declaration('detailPreview', contentSource) + ';this.detailPreview=detailPreview;', ctx);
  const preview = ctx.detailPreview({ kind: 'video', assetId });
  assert.equal(preview.kind, 'video'); assert.equal(preview.previewPending, true);
  assert.equal(preview.posterUrl, poster.src); assert.equal(Object.hasOwn(preview, 'url'), false);
  assert.throws(() => ctx.detailPreview({ kind: 'video', assetId: '00000000-0000-4000-8000-000000000000' }), /não pertence/);
});

test('native video detail still supplies a playable URL, while multiple players stay pending instead of choosing arbitrarily', () => {
  const assetId = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e';
  let videos = [{ currentSrc: 'https://flow.google.com/video/actual.mp4', videoWidth: 1080, videoHeight: 1920 }];
  const ctx = { location: { pathname: `/project/example/edit/${assetId}` }, all: selector => selector === 'video' ? videos : [] };
  vm.runInNewContext(declaration('detailPreview', contentSource) + ';this.detailPreview=detailPreview;', ctx);
  const preview = ctx.detailPreview({ kind: 'video', assetId });
  assert.equal(preview.url, videos[0].currentSrc); assert.equal(preview.previewPending, false);
  videos = [...videos, { currentSrc: 'https://flow.google.com/video/other.mp4' }];
  const ambiguous = ctx.detailPreview({ kind: 'video', assetId });
  assert.equal(ambiguous.previewPending, true); assert.equal(Object.hasOwn(ambiguous, 'url'), false);
});

test('video result IDs must come from the exact project origin and detail path', () => {
  const ctx = { URL };
  vm.runInNewContext(declaration('videoDetailId') + ';this.videoDetailId=videoDetailId;', ctx);
  const project = 'https://flow.google.com/project/project-a', id = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e';
  assert.equal(ctx.videoDetailId(project, `${project}/edit/${id}?view=video`), id);
  for (const url of [`https://attacker.test/project/project-a/edit/${id}`, `https://flow.google.com/project/project-b/edit/${id}`, `${project}/edit/not-a-uuid`, `${project}/edit/${id}/other`, `${project}/edit/${id}/../../other`]) {
    assert.throws(() => ctx.videoDetailId(project, url), /não confirmou o vídeo/);
  }
});

function videoResultHarness({ assetId = 'video_thumbnail-hash', navigateDuringPreview = false } = {}) {
  const projectUrl = 'https://flow.google.com/project/project-a', id = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e';
  let currentUrl = `${projectUrl}/edit/${id}`;
  const actions = [];
  const asset = { id: assetId, kind: 'video', url: 'https://flow.google.com/asb/exact-tile-thumbnail', width: 512, height: 910 };
  const ctx = { URL, chrome: { tabs: { get: async () => ({ url: currentUrl }) } },
    click: async () => actions.push('open exact tile'), waitReady: async (_, mode) => assert.equal(mode, 'downloadReady'),
    dom: async (_, op, payload) => {
      if (op === 'mediaOpen') { assert.equal(payload.asset, asset); return { x: 10, y: 20 }; }
      if (op === 'detailPreview') {
        actions.push('read preview'); assert.equal(payload.kind, 'video'); assert.equal(payload.assetId, id);
        if (navigateDuringPreview) currentUrl = `${projectUrl}/edit/00000000-0000-4000-8000-000000000000`;
        return { kind: 'video', previewPending: true, posterUrl: 'https://flow.google.com/asb/exact-scene-poster' };
      }
      throw Error(`Unexpected operation (must not generate): ${op}`);
    },
  };
  vm.runInNewContext(declaration('videoDetailId') + declaration('resolveVideoAsset') + ';this.resolveVideoAsset=resolveVideoAsset;', ctx);
  return { id, actions, run: () => ctx.resolveVideoAsset(7, asset, projectUrl) };
}

test('confirmed canvas result preserves its UUID and poster with no fake playable URL', async () => {
  const h = videoResultHarness(); const result = await h.run();
  assert.equal(result.id, h.id); assert.equal(result.previewPending, true); assert.equal(result.kind, 'video');
  assert.equal(Object.hasOwn(result, 'url'), false); assert.equal(result.posterUrl, 'https://flow.google.com/asb/exact-scene-poster');
  assert.deepEqual(h.actions, ['open exact tile', 'read preview']);
});

test('video resolution rejects a known UUID mismatch and navigation during preview', async () => {
  const wrong = videoResultHarness({ assetId: '00000000-0000-4000-8000-000000000000' });
  await assert.rejects(wrong.run(), /abriu outro vídeo/); assert.deepEqual(wrong.actions, ['open exact tile']);
  await assert.rejects(videoResultHarness({ navigateDuringPreview: true }).run(), /mudou de vídeo/);
});

for (const accountFails of [false, true]) test(`paid canvas job recovers without another submit and persists before account refresh (${accountFails ? 'lookup fails' : 'fresh balance'})`, async () => {
  const id = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e', projectUrl = 'https://flow.google.com/project/project-a';
  const job = { requestId: 'flow-paid', submitted: true, state: 'needs_attention', error: 'O Flow gerou o vídeo, mas a prévia ainda não está disponível.', expectedCount: 1, mode: 'video', promptHash: 'saved-exact-prompt-hash', referenceIds: ['exact-frame'], referenceMode: 'frames', baselineIds: ['old'], account: { email: 'test@example.com', credits: 250 }, projectUrl };
  const saved = [], verified = [], opened = [];
  let accountReads = 0;
  const ctx = { busyOperation: null, Date, sleep: async () => {}, tabFor: async () => 7,
    readAccount: async () => {
      accountReads++;
      if (accountReads === 2) {
        assert.equal(saved[0]?.state, 'completed'); assert.equal(saved[0]?.assets[0]?.id, id);
        if (accountFails) throw Error('Account panel unavailable after paid result');
      }
      return { email: 'test@example.com', credits: 243 };
    },
    dom: async (_, op) => {
      if (op === 'media') return { assets: [{ id: 'unrelated', kind: 'video' }, { id: 'target', kind: 'video' }], busy: false };
      if (op === 'galleryTop') return {};
      throw Error(`Unexpected operation: ${op}`);
    },
    verifyAssetCommand: async (_, asset, hash, references, mode) => { verified.push(asset.id); assert.equal(hash, job.promptHash); assert.deepEqual([...references], ['exact-frame']); assert.equal(mode, 'frames'); return asset.id === 'target'; },
    resolveVideoAsset: async (_, asset) => { opened.push(asset.id); return { id, kind: 'video', projectUrl, previewPending: true, posterUrl: 'https://flow.google.com/asb/poster' }; },
    chrome: { tabs: { update: async (_, update) => assert.equal(update.url, projectUrl) } }, waitReady: async () => {},
    save: async state => { saved.push(JSON.parse(JSON.stringify(state))); }, detach: async () => {}, errorText: error => error.message,
  };
  vm.runInNewContext(declaration('refreshResultAccount') + declaration('recoverJob') + ';this.recoverJob=recoverJob;', ctx);
  const recovered = await ctx.recoverJob(job, 1);
  assert.equal(recovered.state, 'completed'); assert.equal(recovered.assets[0].id, id); assert.equal(recovered.assets[0].previewPending, true);
  assert.equal(recovered.error, '', 'a recovered result must not retain the previous preview failure');
  assert.ok(saved.every(snapshot => snapshot.error === ''), 'both persisted completed states clear the old error before account lookup');
  assert.equal(recovered.account.credits, accountFails ? null : 243); assert.equal(saved.length, 2);
  assert.deepEqual(verified, ['unrelated', 'target']); assert.deepEqual(opened, ['target']); assert.equal(ctx.busyOperation, null);
});

test('persisted network UUID recovers a paid result without the slower command-reuse inspection', async () => {
  const id = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e', projectUrl = 'https://flow.google.com/project/project-a';
  const job = { requestId: 'flow-network-proof', submitted: true, state: 'generating', expectedCount: 1, mode: 'image', promptHash: 'hash', referenceIds: [], referenceMode: 'ingredients', baselineIds: [], evidenceIds: [id], account: { email: 'test@example.com' }, projectUrl };
  let verifies = 0;
  const ctx = { busyOperation: null, Date, sleep: async () => {}, tabFor: async () => 7,
    readAccount: async () => ({ email: 'test@example.com', credits: 80 }),
    dom: async (_, op) => op === 'media' ? { assets: [{ id, kind: 'image', width: 768, height: 1376 }], busy: false } : {},
    verifyAssetCommand: async () => { verifies++; return false; }, resolveVideoAsset: async () => { throw Error('must not open image'); },
    chrome: { tabs: { update: async () => {} } }, waitReady: async () => {},
    save: async () => {}, detach: async () => {}, errorText: error => error.message,
    refreshResultAccount: async (_, account) => account,
  };
  vm.runInNewContext(declaration('recoverJob') + ';this.recoverJob=recoverJob;', ctx);
  const result = await ctx.recoverJob(job, 1);
  assert.equal(result.state, 'completed');
  assert.equal(result.assets[0].id, id);
  assert.equal(verifies, 0);
});

test('video detail still preparing stays in automatic recovery instead of becoming an error', async () => {
  const id = '6a2a3747-0ba8-4ec3-b911-1d0d7a30ef0e', projectUrl = 'https://flow.google.com/project/project-a';
  const job = { requestId: 'flow-preparing-video', submitted: true, state: 'needs_attention', expectedCount: 1, mode: 'video', promptHash: 'hash', referenceIds: [], referenceMode: 'ingredients', baselineIds: [], evidenceIds: [id], account: { email: 'test@example.com' }, projectUrl };
  const saved = [];
  const pending = new Error('still preparing'); pending.code = 'FLOW_MEDIA_NOT_READY';
  const ctx = { busyOperation: null, Date, sleep: async () => {}, tabFor: async () => 7,
    readAccount: async () => ({ email: 'test@example.com', credits: 80 }),
    dom: async (_, op) => op === 'media' ? { assets: [{ id, kind: 'video', width: 720, height: 1280 }], busy: false } : {},
    verifyAssetCommand: async () => { throw Error('network proof must be enough'); }, resolveVideoAsset: async () => { throw pending; },
    chrome: { tabs: { update: async () => {} } }, waitReady: async () => {},
    save: async state => saved.push({ ...state }), detach: async () => {}, errorText: error => error.message,
  };
  vm.runInNewContext(declaration('recoverJob') + ';this.recoverJob=recoverJob;', ctx);
  const result = await ctx.recoverJob(job, 1);
  assert.equal(result.state, 'generating');
  assert.match(result.stage, /verificará novamente automaticamente/);
  assert.equal(saved.at(-1).state, 'generating');
});

test('post-generation account refresh never reuses a stale balance or another account identity', async () => {
  let current = { email: 'other@example.com', credits: 999 };
  const ctx = { readAccount: async () => current };
  vm.runInNewContext(declaration('refreshResultAccount') + ';this.refreshResultAccount=refreshResultAccount;', ctx);
  const previous = { email: 'original@example.com', name: 'Original', credits: 250 };
  const changed = await ctx.refreshResultAccount(7, previous);
  assert.equal(changed.email, previous.email); assert.equal(changed.credits, null);
  current = { email: 'ORIGINAL@example.com', name: 'Original', credits: 243 };
  assert.equal((await ctx.refreshResultAccount(7, previous)).credits, 243);
  current = { email: previous.email };
  assert.equal((await ctx.refreshResultAccount(7, previous)).credits, null);
});

test('Frames preserves first/last order, including a single first frame', () => {
  const ctx = {};
  vm.runInNewContext(declaration('sameFrameIds') + ';this.sameFrameIds=sameFrameIds;', ctx);
  assert.equal(ctx.sameFrameIds(['first', null], ['first']), true);
  assert.equal(ctx.sameFrameIds([null, 'first'], ['first']), false);
  assert.equal(ctx.sameFrameIds(['first', 'last'], ['first', 'last']), true);
  assert.equal(ctx.sameFrameIds(['last', 'first'], ['first', 'last']), false);
  assert.equal(ctx.sameFrameIds([null, null], []), true);
  assert.equal(ctx.sameFrameIds(null, []), false);
});

test('Frames binds a gallery UUID to the same ASB token across Flow and Google CDN hosts', () => {
  const id = '2b4e1baa-e9d4-493c-bd92-ce0869faea64', otherId = 'efc8b5c5-3cce-4a6a-ace2-1896317f840d';
  const ctx = { URL, location: { href: 'https://flow.google.com/project/test' }, galleryMediaIdentities: new Map(),
    document: { querySelectorAll: selector => { assert.equal(selector, 'img[data-media-id]'); return [{ getAttribute: () => id, src: 'https://flow.google.com/asb/AB-real_token-123=s512-rw' }]; } } };
  vm.runInNewContext(declaration('referenceImageId', contentSource) + declaration('asbIdentity', contentSource) + declaration('rememberGalleryMediaIdentities', contentSource) + declaration('matchesFrameIdentity', contentSource) + ';this.rememberGalleryMediaIdentities=rememberGalleryMediaIdentities;this.matchesFrameIdentity=matchesFrameIdentity;this.asbIdentity=asbIdentity;', ctx);
  const pickerUrl = 'https://lh3.googleusercontent.com/asb/AB-real_token-123';
  assert.equal(ctx.matchesFrameIdentity(id, pickerUrl), false, 'an unobserved UUID cannot be inferred from a CDN token');
  ctx.rememberGalleryMediaIdentities();
  assert.equal(ctx.matchesFrameIdentity(id, pickerUrl), true);
  assert.equal(ctx.matchesFrameIdentity(id, `${pickerUrl}=s2048`), true);
  assert.equal(ctx.matchesFrameIdentity(id, 'https://lh3.googleusercontent.com/asb/AB-other_token'), false);
  assert.equal(ctx.matchesFrameIdentity(otherId, pickerUrl), false);
  assert.equal(ctx.matchesFrameIdentity(id, 'https://attacker.example/asb/AB-real_token-123'), false);
  assert.equal(ctx.matchesFrameIdentity(id, `https://flow-content.google/image/${otherId}`), false);
  assert.equal(ctx.matchesFrameIdentity(id, `https://flow-content.google/image/${id}`), true);
  assert.equal(ctx.asbIdentity(`${pickerUrl}/other`), null);
});

test('Frames selects and previews the UUID-linked ASB asset even when another option has the same name', () => {
  const id = '2b4e1baa-e9d4-493c-bd92-ce0869faea64';
  const option = token => ({ querySelector: selector => selector === '.asset-title' ? { value: 'Pot of honey' } : { src: `https://lh3.googleusercontent.com/asb/${token}` } });
  const correct = option('correct-token'), wrong = option('different-token');
  let previewToken = 'correct-token';
  const ctx = { URL, location: { href: 'https://flow.google.com/project/test' }, galleryMediaIdentities: new Map([[id, 'asb:correct-token']]),
    rememberGalleryMediaIdentities: () => {}, text: element => element.value,
    all: selector => selector === '[role="option"]' ? [wrong, correct] : [{ getAttribute: () => 'Prévia de Pot of honey', src: `https://lh3.googleusercontent.com/asb/${previewToken}` }],
    one: elements => { assert.equal(elements.length, 1); return elements[0]; } };
  vm.runInNewContext(declaration('referenceImageId', contentSource) + declaration('asbIdentity', contentSource) + declaration('matchesFrameIdentity', contentSource) + declaration('frameResource', contentSource) + declaration('frameReferenceSelection', contentSource) + ';this.frameResource=frameResource;this.frameReferenceSelection=frameReferenceSelection;', ctx);
  assert.equal(ctx.frameResource(id).option, correct);
  assert.equal(ctx.frameReferenceSelection(id).previewMatches, true);
  previewToken = 'different-token';
  assert.equal(ctx.frameReferenceSelection(id).previewMatches, false, 'the same displayed name never overrides a different asset token');
});

test('uploaded ASB references require unique gallery identity and matching preview, never only the filename', () => {
  const id = '2b4e1baa-e9d4-493c-bd92-ce0869faea64', otherId = 'efc8b5c5-3cce-4a6a-ace2-1896317f840d';
  const filename = 'pilot-flow-request-unique.png';
  let previewSrc = 'https://lh3.googleusercontent.com/asb/upload-token';
  const option = { querySelector: selector => selector === '.asset-title' ? { value: filename } : { src: 'https://lh3.googleusercontent.com/asb/upload-token=s512-rw' } };
  const identities = new Map([[id, 'asb:upload-token']]);
  const ctx = { URL, location: { href: 'https://flow.google.com/project/test' }, galleryMediaIdentities: identities,
    rememberGalleryMediaIdentities: () => {}, text: element => element.value,
    all: selector => selector === '[role="option"]' ? [option] : [{ getAttribute: () => `Prévia de ${filename}`, src: previewSrc }],
    one: elements => { assert.equal(elements.length, 1); return elements[0]; } };
  vm.runInNewContext(declaration('referenceImageId', contentSource) + declaration('asbIdentity', contentSource) + declaration('referenceIdentity', contentSource) + declaration('uploadedResource', contentSource) + declaration('resourceSelection', contentSource) + ';this.uploadedResource=uploadedResource;this.resourceSelection=resourceSelection;', ctx);
  assert.equal(ctx.uploadedResource(filename).imageId, id);
  assert.equal(ctx.resourceSelection(filename).previewMatches, true);
  previewSrc = 'https://lh3.googleusercontent.com/asb/other-token';
  assert.equal(ctx.resourceSelection(filename).previewMatches, false);
  previewSrc = 'blob:https://flow.google.com/unmapped-preview';
  assert.equal(ctx.resourceSelection(filename).previewMatches, false, 'matching alt without provable image identity is insufficient');
  previewSrc = `https://flow-content.google/image/${id}?Expires=new`;
  assert.equal(ctx.resourceSelection(filename).previewMatches, true);
  identities.set(otherId, 'asb:upload-token');
  assert.throws(() => ctx.uploadedResource(filename), /não confirmou/, 'an ASB token mapped to two UUIDs is ambiguous');
  identities.clear();
  assert.throws(() => ctx.uploadedResource(filename), /não confirmou/, 'a filename alone cannot provide the UUID');
});

test('Frames places an existing image into the exact slot without uploading or generating', async () => {
  const imageId = 'efc8b5c5-3cce-4a6a-ace2-1896317f840d';
  const actions = [];
  const ctx = { dom: async (_, op, payload) => {
    if (op === 'commandReferences') return { count: 0, ids: [], frameIds: [null, null], busy: false };
    if (op === 'openFrameSlot') { assert.equal(payload.index, 0); actions.push('open start'); return {}; }
    if (op === 'selectFrameResource') { assert.equal(payload.imageId, imageId); actions.push('select exact image'); return {}; }
    throw new Error(`Unexpected ${op}`);
  }, clickButton: async (_, name) => { assert.equal(name, 'Incluir no comando'); actions.push('include'); },
  waitDom: async (_, op, payload, accept) => {
    if (op === 'frameResource') { assert.equal(payload.imageId, imageId); return { imageId }; }
    if (op === 'referencePlacementState') { const value = { previewMatches: true, imageId, references: { count: 0, ids: [], frameIds: [null, null], busy: false } }; assert.ok(accept(value)); return value; }
    if (op === 'commandReferences') {
      assert.equal(accept({ count: 1, ids: [imageId], frameIds: [null, imageId], busy: false }), false, 'the same image in the last slot is not the requested first frame');
      const value = { count: 1, ids: [imageId], frameIds: [imageId, null], busy: false }; assert.ok(accept(value)); actions.push('verify start identity'); return value;
    }
    throw new Error(`Unexpected ${op}`);
  } };
  vm.runInNewContext(declaration('sameFrameIds') + declaration('sameReferenceIds') + declaration('confirmReferencePlacement') + declaration('placeFrameReference') + ';this.placeFrameReference=placeFrameReference;', ctx);
  assert.equal(await ctx.placeFrameReference(7, 0, { imageId }), imageId);
  assert.deepEqual(actions, ['open start', 'select exact image', 'include', 'verify start identity']);
});

function framePlacementHarness({ before, after, preview = false, included } = {}) {
  const imageId = '2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4';
  const empty = { count: 0, ids: [], frameIds: [null, null], busy: false };
  const complete = { count: 1, ids: [imageId], frameIds: [imageId, null], busy: false };
  let references = before || empty, now = 0;
  const actions = [];
  const ctx = { Date: { now: () => now }, sleep: async ms => { now += ms; }, errorText: error => error.message,
    dom: async (_, op, payload) => {
      if (op === 'commandReferences') return references;
      if (op === 'openFrameSlot') { actions.push('open'); return {}; }
      if (op === 'frameResource') { assert.equal(payload.imageId, imageId); return { imageId }; }
      if (op === 'selectFrameResource') { actions.push('select'); references = after || complete; return {}; }
      if (op === 'referencePlacementState') return { imageId, references, previewMatches: preview };
      throw Error(`Unexpected DOM operation ${op}`);
    },
    clickButton: async (_, name) => { assert.equal(name, 'Incluir no comando'); actions.push('include'); references = included || complete; },
  };
  vm.runInNewContext(declaration('sameFrameIds') + declaration('sameReferenceIds') + declaration('waitDom') + declaration('confirmReferencePlacement') + declaration('placeFrameReference') + ';this.placeFrameReference=placeFrameReference;', ctx);
  return { imageId, actions, run: (index = 0) => ctx.placeFrameReference(7, index, { imageId }) };
}

test('Frames accepts immediate insertion into the exact first slot without trying a vanished picker or Include', async () => {
  const h = framePlacementHarness();
  assert.equal(await h.run(), h.imageId);
  assert.deepEqual(h.actions, ['open', 'select']);
});

test('Frames immediate insertion preserves the existing first frame when adding the last frame', async () => {
  const old = '11111111-1111-4111-8111-111111111111', imageId = '2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4';
  const h = framePlacementHarness({ before: { count: 1, ids: [old], frameIds: [old, null], busy: false }, after: { count: 2, ids: [old, imageId], frameIds: [old, imageId], busy: false } });
  assert.equal(await h.run(1), imageId); assert.deepEqual(h.actions, ['open', 'select']);
});

for (const [label, after] of [
  ['wrong slot', { count: 1, ids: ['2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4'], frameIds: [null, '2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4'], busy: false }],
  ['wrong UUID', { count: 1, ids: ['wrong-id'], frameIds: ['wrong-id', null], busy: false }],
  ['busy chip', { count: 1, ids: ['2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4'], frameIds: ['2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4', null], busy: true }],
  ['unidentified extra reference', { count: 2, ids: ['2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4'], frameIds: ['2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4', null], busy: false }],
]) test(`Frames rejects direct insertion with ${label}, even when a matching preview is reported`, async () => {
  const h = framePlacementHarness({ after, preview: true });
  await assert.rejects(h.run(), /não confirmou/); assert.deepEqual(h.actions, ['open', 'select']);
});

test('Frames rejects replacement of another reference during direct insertion', async () => {
  const old = '11111111-1111-4111-8111-111111111111', wrong = '22222222-2222-4222-8222-222222222222', imageId = '2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4';
  const h = framePlacementHarness({ before: { count: 1, ids: [old], frameIds: [old, null], busy: false }, after: { count: 2, ids: [wrong, imageId], frameIds: [wrong, imageId], busy: false }, preview: true });
  await assert.rejects(h.run(1), /não confirmou/); assert.deepEqual(h.actions, ['open', 'select']);
});

test('Frames old preview plus Include remains supported and still verifies the final composer', async () => {
  const h = framePlacementHarness({ after: { count: 0, ids: [], frameIds: [null, null], busy: false }, preview: true });
  assert.equal(await h.run(), h.imageId); assert.deepEqual(h.actions, ['open', 'select', 'include']);
});

test('content reports exact composer evidence after direct selection closes the picker', () => {
  const imageId = '2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4';
  const references = { count: 1, ids: [imageId], frameIds: [imageId, null], busy: false };
  const ctx = { commandReferences: () => references, frameReferenceSelection: () => { throw Error('Picker option disappeared after immediate insertion'); }, resourceSelection: () => { throw Error('Picker closed'); } };
  vm.runInNewContext(declaration('referencePlacementState', contentSource) + ';this.referencePlacementState=referencePlacementState;', ctx);
  assert.equal(ctx.referencePlacementState(imageId).references, references);
  assert.equal(ctx.referencePlacementState(imageId).previewMatches, false);
  assert.equal(ctx.referencePlacementState(imageId, 'unique-file.png').references, references);
});

test('the shared upload proof accepts direct insertion only after preserving every previous UUID and the exact count', async () => {
  const old = '11111111-1111-4111-8111-111111111111', imageId = '2ae8782d-2da4-4eb5-a32e-ddbd48d37ee4';
  let now = 0, references = { count: 2, ids: [old, imageId], busy: false }, includes = 0;
  const ctx = { Date: { now: () => now }, sleep: async ms => { now += ms; }, errorText: error => error.message,
    dom: async (_, op, payload) => {
      if (op === 'commandReferences') return references;
      assert.equal(op, 'referencePlacementState'); assert.equal(payload.name, 'pilot-flow-unique.png');
      return { imageId, references, previewMatches: false };
    }, clickButton: async () => { includes++; } };
  vm.runInNewContext(declaration('sameReferenceIds') + declaration('waitDom') + declaration('confirmReferencePlacement') + ';this.confirmReferencePlacement=confirmReferencePlacement;', ctx);
  const before = { count: 1, ids: [old], busy: false };
  await ctx.confirmReferencePlacement(7, before, imageId, { name: 'pilot-flow-unique.png' });
  assert.equal(includes, 0);
  references = { count: 2, ids: ['wrong-old-reference', imageId], busy: false };
  await assert.rejects(ctx.confirmReferencePlacement(7, before, imageId, { name: 'pilot-flow-unique.png' }), /não confirmou/);
  assert.equal(includes, 0);
});

test('new Frames files use the library upload menu and preserve the model and empty composer', async () => {
  const choosers = new Map(), actions = [];
  const ctx = { choosers, uniqueReferenceName: () => 'pilot-flow-unique.png', deadline: promise => promise,
    clickButton: async (_, name) => { assert.equal(name, 'Menu para adicionar arquivos'); actions.push('library menu'); },
    cdp: async () => ({}),
    activateWithUserGesture: async (_, kind, name, id) => { assert.equal(kind, 'libraryUpload'); assert.equal(name, 'Enviar'); assert.equal(id, 'request:0'); actions.push('upload gesture'); choosers.get(7)({ backendNodeId: 1 }); },
    injectReferenceFile: async (_, event, upload) => { assert.equal(event.backendNodeId, 1); assert.equal(upload.name, 'pilot-flow-unique.png'); actions.push('file selected'); } };
  vm.runInNewContext(declaration('uploadLibraryReference') + ';this.uploadLibraryReference=uploadLibraryReference;', ctx);
  const name = await ctx.uploadLibraryReference(7, { mimeType: 'image/png', dataUrl: 'data:image/png;base64,YQ==' }, 'request', 0);
  assert.equal(name, 'pilot-flow-unique.png'); assert.equal(choosers.size, 0);
  assert.deepEqual(actions, ['library menu', 'upload gesture', 'file selected']);
});

test('gesture activation reserves exactly one allowed download or upload control', () => {
  const attrs = new Map();
  const element = { disabled: false, getAttribute: name => attrs.get(name), setAttribute: (name, value) => attrs.set(name, value) };
  const ctx = { gestureAttempts: new Set(), button: () => element, downloadControl: () => element };
  vm.runInNewContext(declaration('prepareGestureActivation', contentSource) + ';this.prepareGestureActivation=prepareGestureActivation;', ctx);
  assert.equal(ctx.prepareGestureActivation('download', '1080p', 'download-1', 'token-1').prepared, true);
  assert.equal(attrs.get('data-pilot-flow-activation'), 'token-1');
  assert.throws(() => ctx.prepareGestureActivation('download', '1080p', 'download-1', 'token-2'), /não será repetido/);
  assert.throws(() => ctx.prepareGestureActivation('download', '720p', 'download-2', 'token-3'), /não autorizado/);
  assert.throws(() => ctx.prepareGestureActivation('upload', 'Iniciar geração', 'upload-1', 'token-4'), /não autorizado/);
  assert.equal(ctx.prepareGestureActivation('upload', 'Enviar mídia', 'upload-1:0', 'token-5').prepared, true);
});

test('semantic gesture reaches the prepared DOM control once with browser user activation', async () => {
  let clicks = 0, prepared = false, commands = 0;
  const element = { disabled: false, getAttribute: () => null, removeAttribute: name => assert.equal(name, 'data-pilot-flow-activation'), click: () => { clicks++; } };
  const ctx = { crypto: { randomUUID: () => 'unique-token' }, waitDom: async () => ({}),
    dom: async (_, op, payload) => { assert.equal(op, 'prepareGestureActivation'); assert.equal(payload.requestId, 'download-1'); prepared = true; },
    cdp: async (_, method, params) => {
      commands++; assert.ok(prepared); assert.equal(method, 'Runtime.evaluate'); assert.equal(params.userGesture, true);
      const value = vm.runInNewContext(params.expression, { document: { querySelector: selector => { assert.equal(selector, '[data-pilot-flow-activation="unique-token"]'); return element; } } });
      return { result: { value } };
    } };
  vm.runInNewContext(declaration('activateWithUserGesture') + ';this.activateWithUserGesture=activateWithUserGesture;', ctx);
  await ctx.activateWithUserGesture(7, 'download', '1080p', 'download-1');
  assert.equal(clicks, 1); assert.equal(commands, 1);
  ctx.cdp = async () => { commands++; return { exceptionDetails: { text: 'detached' } }; };
  await assert.rejects(ctx.activateWithUserGesture(7, 'download', '1080p', 'download-1'), /não será repetido/);
  assert.equal(commands, 2);
});

test('1080p download stays in the video editor where Escape would return to the project', async () => {
  const projectUrl = 'https://flow.google.com/project/project-1';
  const asset = { id: '74a8b5ff-0cc4-450d-91b3-143db55a711f', kind: 'video' };
  const detailUrl = `${projectUrl}/edit/${asset.id}`;
  let currentUrl = projectUrl, escapes = 0;
  const downloads = new Map(), actions = [];
  const ctx = { URL, Uint8Array, downloads, tabFor: async () => 7,
    chrome: { tabs: { get: async () => ({ url: currentUrl }), update: async (_, value) => { currentUrl = value.url; actions.push('open detail'); } } },
    waitReady: async () => {}, key: async (_, name) => { if (name === 'Escape') { escapes++; currentUrl = projectUrl; } },
    cdp: async () => ({}), clickButton: async (_, name) => { assert.equal(currentUrl, detailUrl, 'Escape must not close the video editor before download'); assert.equal(name, 'Baixar mídia'); actions.push('open download menu'); },
    activateWithUserGesture: async (_, kind, resolution, id, expectedUrl) => { assert.equal(kind, 'download'); assert.equal(resolution, '1080p'); assert.equal(currentUrl, expectedUrl); assert.equal(expectedUrl, detailUrl); actions.push('select 1080p'); downloads.get(7).resolve({ url: 'https://flow.google.com/video.mp4' }); },
    waitDom: async (_, op, payload, accept) => { assert.equal(op, 'downloadSelectionState'); const value = { menuOpen: false }; assert.ok(accept(value)); return value; },
    emit: async () => {}, deadline: promise => promise, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }),
    mediaMime: () => 'video/mp4', toBase64: () => 'bWVkaWE=', dom: async (_, op) => { assert.equal(op, 'dimensions'); return { width: 1920, height: 1080 }; }, detach: async () => {} };
  vm.runInNewContext(declaration('assertDownloadRoute') + declaration('download') + ';this.download=download;', ctx);
  const result = await ctx.download('download-1', { asset, projectUrl }, 1);
  assert.equal(escapes, 0); assert.equal(currentUrl, detailUrl); assert.equal(result.downloadResolution, '1080p');
  assert.deepEqual(actions, ['open detail', 'open download menu', 'select 1080p']);
});

test('download rejects a different asset or project even when a download button is present', async () => {
  let currentUrl = 'https://flow.google.com/project/project-1/edit/asset-1';
  const ctx = { URL, chrome: { tabs: { get: async () => ({ url: currentUrl }) } } };
  vm.runInNewContext(declaration('assertDownloadRoute') + ';this.assertDownloadRoute=assertDownloadRoute;', ctx);
  await ctx.assertDownloadRoute(7, currentUrl);
  await assert.rejects(ctx.assertDownloadRoute(7, 'https://flow.google.com/project/project-1/edit/asset-2'), /saiu do resultado/);
  await assert.rejects(ctx.assertDownloadRoute(7, 'https://flow.google.com/project/project-2/edit/asset-1'), /saiu do resultado/);
  currentUrl = 'https://flow.google.com/project/project-1';
  await assert.rejects(ctx.assertDownloadRoute(7, 'https://flow.google.com/project/project-1/edit/asset-1'), /saiu do resultado/);
});

test('navigation during menu preparation prevents the final download click atomically', async () => {
  let clicks = 0;
  const detailUrl = 'https://flow.google.com/project/project-1/edit/asset-1';
  const location = { origin: 'https://flow.google.com', pathname: '/project/project-1/edit/asset-1' };
  const ctx = { URL, crypto: { randomUUID: () => 'unique-token' }, waitDom: async () => ({}), assertDownloadRoute: async () => {},
    dom: async () => { location.pathname = '/project/project-1'; },
    cdp: async (_, method, params) => {
      try {
        const value = vm.runInNewContext(params.expression, { location, document: { querySelector: () => ({ disabled: false, getAttribute: () => null, removeAttribute() {}, click: () => { clicks++; } }) } });
        return { result: { value } };
      } catch (error) { return { exceptionDetails: { text: error.message } }; }
    } };
  vm.runInNewContext(declaration('activateWithUserGesture') + ';this.activateWithUserGesture=activateWithUserGesture;', ctx);
  await assert.rejects(ctx.activateWithUserGesture(7, 'download', '1080p', 'download-1', detailUrl), /não será repetido/);
  assert.equal(clicks, 0);
  location.pathname = '/project/project-1/edit/asset-1';
  ctx.dom = async () => ({});
  await ctx.activateWithUserGesture(7, 'download', '1080p', 'download-2', detailUrl);
  assert.equal(clicks, 1);
});

test('adapter reinjection skips the same version and replaces its own listener after an update', () => {
  let version = '4.44.1';
  const listeners = new Set();
  const ctx = { chrome: { runtime: { getManifest: () => ({ version }), onMessage: { addListener: value => listeners.add(value), removeListener: value => listeners.delete(value) } } } };
  vm.createContext(ctx);
  vm.runInContext(contentSource, ctx);
  const first = [...listeners][0];
  vm.runInContext(contentSource, ctx);
  assert.equal(listeners.size, 1); assert.equal([...listeners][0], first);
  version = '4.44.2';
  vm.runInContext(contentSource, ctx);
  assert.equal(listeners.size, 1); assert.notEqual([...listeners][0], first);
  assert.equal(ctx.__autoeditFlowAdapter.version, '4.44.2');
});

test('distribution includes every isolated Flow module and keeps HeyGen scripts', () => {
  const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
  const packaging = readFileSync('app/api/extension/download/route.ts', 'utf8');
  const sync = readFileSync('scripts/ext-sync.mjs', 'utf8');
  for (const file of ['flow-background.js', 'flow-bridge.js', 'flow-content.js', 'heygen-content.js', 'bridge.js', 'inject.js']) {
    assert.ok(packaging.includes(`'${file}'`), file);
    assert.ok(sync.includes(`'${file}'`), file);
  }
  assert.ok(manifest.content_scripts.some(script => script.js.includes('flow-bridge.js')));
  assert.ok(manifest.content_scripts.some(script => script.js.includes('heygen-content.js')));
  assert.ok(workerSource.includes('const debuggers = new Map()'));
  assert.ok(!workerSource.includes('cdpAttach('));
});
