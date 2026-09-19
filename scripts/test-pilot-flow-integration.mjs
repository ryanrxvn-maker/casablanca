import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import JSZip from 'jszip';
import { randomFillSync } from 'node:crypto';

const source = readFileSync(new URL('../lib/pilot-inserts.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox, { filename: 'pilot-inserts.js' });
const { insertPadrao, mesclarInsertsDaOrigem, insertsAtivosNaMontagem, janelasDosInserts } = sandbox.exports;
const media = { key: 'fixture', nome: 'fixture.mp4', tipo: 'video', w: 1920, h: 1080 };
const manual = { ...insertPadrao('manual', 'BODY 1', media), palavraDe: 0, palavraAte: 1 };
const flow = { ...insertPadrao('flow', 'BODY 1', media), palavraDe: 2, palavraAte: 3, source: 'flow' };
const ids = (list) => Array.from(list, (insert) => insert.id);

assert.deepEqual(ids(insertsAtivosNaMontagem([manual, flow], false)), ['manual'], 'Flow OFF preserves manual inserts');
assert.deepEqual(ids(insertsAtivosNaMontagem([manual, flow], true)), ['manual', 'flow'], 'Flow ON composes both sources');
assert.deepEqual(ids(insertsAtivosNaMontagem([flow], true)), ['flow'], 'Flow composes when ordinary inserts list is empty');
assert.equal(insertsAtivosNaMontagem([flow], false).length, 0, 'disabled Flow cannot enter compositor');
assert.equal(flow.source, 'flow', 'toggle leaves persisted source intact');

const flowUpdated = { ...flow, palavraDe: 1, palavraAte: 2 };
const updated = mesclarInsertsDaOrigem([manual, flow], [flowUpdated], 'flow');
assert.deepEqual(ids(updated), ['manual', 'flow'], 'editing Flow preserves cross-source ordering');
assert.equal(updated[0], manual, 'manual insert reference/content stays intact');
assert.equal(updated[1].palavraDe, 1, 'new Flow placement reaches compositor data');
assert.deepEqual(ids(mesclarInsertsDaOrigem([manual, flow], [], 'manual')), ['flow'], 'clearing ordinary inserts preserves Flow');
assert.deepEqual(ids(mesclarInsertsDaOrigem([manual, flow], [], 'flow')), ['manual'], 'clearing Flow preserves ordinary inserts');
assert.equal(mesclarInsertsDaOrigem([], [{ ...manual, id: 'imported' }], 'flow')[0].source, 'flow', 'editor imports keep Flow provenance');
const independent = mesclarInsertsDaOrigem([manual, flow], [{ ...flow, id: 'sibling' }], 'flow');
assert.deepEqual(ids(independent), ['manual', 'sibling'], 'sibling override derives its own collection');
assert.deepEqual(ids([manual, flow]), ['manual', 'flow'], 'base collection is not mutated by override');

const parts = [{ label: 'BODY 1', text: 'Primeira segunda terceira quarta' }];
const asr = parts[0].text.split(' ').map((text, index) => ({ text, start: index, end: index + 0.9 }));
const windows = janelasDosInserts(insertsAtivosNaMontagem([manual, flow], true), parts, asr, 4);
assert.deepEqual(ids(windows), ['manual', 'flow'], 'both source types use existing text-to-time path');
assert.ok(windows[1].start >= windows[0].end, 'both sources respect existing collision protection');

const page = readFileSync(new URL('../app/tools/clickup-pilot/page.tsx', import.meta.url), 'utf8');
assert.equal((page.match(/\{janelaDeFlow\(\)\}/g) || []).length, 1, 'one root modal mount despite repeated toolbar');
assert.ok(page.includes('inserts: insertsDaMontagem(taskId)'), 'actual compositor receives enabled-filtered source list');
assert.ok(page.includes('const insDaTask = insertsDaMontagem(taskId)'), 'postprocessing activates for Flow-only tasks');
assert.ok(page.includes('salvo.size !== f.size'), 'Flow import checks IDB roundtrip size');
assert.ok(page.includes('Math.min(meta.w, meta.h) < 1080'), 'Flow video import rejects lower-resolution downloads');

// Execute the actual modal quote handler with a controlled extension boundary.
// In particular, a first account connection must not trigger a later inspection
// that clears the price and forces the user to click Consultar twice.
const modal = readFileSync(new URL('../components/PilotFlowInserts.tsx', import.meta.url), 'utf8');
assert.match(modal, /type Draft = \{[^\n]*account\?: FlowAccount \| null/, 'the persisted Flow draft retains the confirmed account card');
assert.ok(modal.includes("if (!sessionFor(taskId).account?.email && draft.account?.email) updateSession(taskId, { account: draft.account });"), 'F5 restores the confirmed Flow account before another quote');
assert.ok(modal.includes("if (!sessionFor(taskId).suggestedMotion && draft.suggestedMotion) updateSession(taskId, { suggestedMotion: draft.suggestedMotion });"), 'F5 restores the paired animation prompt before the image is animated');
assert.ok(modal.includes('suggestedMotion: session.suggestedMotion ||'), 'the paired animation prompt is part of every persisted draft snapshot');
assert.ok(modal.includes('assets, account: resultAccount, projectUrl: result.projectUrl || projectUrl, activeJob: null'), 'completed generation persists its refreshed account with the assets');
assert.ok(modal.includes('assets, account: refreshedAccount, projectUrl: actualProject, activeJob: null'), 'recovered generation persists its refreshed account before releasing the request lock');
assert.ok(modal.includes('void quote(true)'), 'valid prompt/settings trigger the automatic credit consultation');
assert.ok(modal.includes('1800'), 'an active paid request is polled automatically without a manual status click');
assert.ok(modal.includes('setPromptStudioOpen(true)') && modal.includes('generatePrompt(promptMode)') && modal.includes('applyPromptSuggestion'), 'the copy-range director opens a review studio before applying paired or direct-video prompts');
assert.ok(modal.includes('promptSuggestion.explanation') && modal.includes("copyGeneratedPrompt('video')"), 'the prompt studio explains and copies its generated direction');
assert.ok(modal.includes("document.execCommand('copy')"), 'prompt copy retains a user-gesture fallback when the modern clipboard API is denied');
assert.ok(modal.includes("mode === 'frames' ? 'START AND END' : 'Imagens'"), 'image inputs use the requested START AND END and Imagens labels');
assert.ok(!modal.includes('aria-label="Recalcular custo no Flow"'), 'credit calculation has no manual recalculate control');
assert.ok(modal.includes('poster !== media') && modal.includes("!pathname.includes('/video/')") && modal.includes("candidate.kind === 'image'"), 'video results reject MP4 poster URLs and inherit the nearest generated image as their thumbnail');
assert.ok(modal.includes('<video src={source} muted playsInline preload="auto"'), 'direct videos without a generated frame keep a playable thumbnail fallback');
assert.ok(modal.includes('data-flow-linked-take') && modal.includes('data-flow-copy-preview') && modal.includes('showCopyTakePreview') && modal.includes('imagePosterUrl(copyTakePreview.asset'), 'hovering a linked copy range shows the exact image/video thumbnail without reusing an MP4 as an image');
assert.ok(modal.includes('flowAssetId: asset.id'), 'an inserted take keeps its exact Flow identity for visible take-to-copy binding');
const modalAst = ts.createSourceFile('PilotFlowInserts.tsx', modal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const quoteNodes = [];
function findQuoteNodes(node) {
  if (ts.isFunctionDeclaration(node) && ['availableControls', 'settingsForInspection', 'quote'].includes(node.name?.text)) quoteNodes.push(node.getText(modalAst));
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => declaration.name.getText(modalAst) === 'controlLabel')) quoteNodes.push(node.getText(modalAst));
  ts.forEachChild(node, findQuoteNodes);
}
findQuoteNodes(modalAst);
assert.equal(quoteNodes.length, 4, 'quote regression executes the actual handler and capability normalization');
const quoteCode = ts.transpileModule(`${quoteNodes.join('\n')}\nexports.run = quote; exports.controls = availableControls;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const project = 'https://flow.google.com/project/quote-fixture';
const quoteSettings = {
  mode: 'video', prompt: 'Uma gota de mel sobre uma colher.', model: 'Omni 1.1 Flash',
  aspectRatio: '9:16', resolution: '720p', videoMode: 'ingredients', durationSeconds: 8, count: 1, references: [],
};
const quoteInspection = {
  projectUrl: project, mode: 'video', account: { name: 'Conta de teste', email: 'test@example.com', credits: 250 },
  controls: { model: quoteSettings.model, available: ['Vídeo', '9:16', '16:9', '720p', '6s', 'x1', 'x2', 'Elementos'], selected: ['Vídeo', '9:16', '720p', '6s', 'x1', 'Elementos'] },
};
function quoteHarness({ settings = quoteSettings, inspection = quoteInspection, inspectError, quoted = { credits: 0, account: { ...quoteInspection.account, credits: 249 }, projectUrl: project }, inspectGate } = {}) {
  let state = { busy: null, activeJob: null, quote: null, quoteKey: '', inspection: null };
  const calls = [];
  const context = {
    exports: {}, taskId: 'first-quote', settings, projectUrl: '', capabilitiesPending: false,
    capabilitiesUnsupported: false, referencesOverLimit: false,
    quoteRevision: { current: 0 },
    preferredModels: { current: {} }, inspectionAttempt: { current: '' },
    sessionFor: () => state,
    updateSession: (_, update) => { state = { ...state, ...update }; },
    setSettings: (value) => { context.settings = value; },
    setProjectUrl: (value) => { context.projectUrl = value; },
    setNotice: (value) => { context.notice = value; },
    errorText: (error) => error.message,
    flowInspect: async (url, preferences) => {
      calls.push({ action: 'inspect', url, preferences, busy: state.busy });
      if (inspectGate) await inspectGate;
      if (inspectError) throw inspectError;
      return inspection;
    },
    flowQuote: async (value, url) => { calls.push({ action: 'quote', settings: value, url, busy: state.busy }); return quoted; },
  };
  vm.runInNewContext(quoteCode, context, { filename: 'PilotFlowInserts.quote.js' });
  return { context, calls, run: context.exports.run, state: () => state };
}
let releaseInspection;
const firstQuote = quoteHarness({ inspectGate: new Promise((resolve) => { releaseInspection = resolve; }) });
const firstPending = firstQuote.run();
await firstQuote.run();
assert.equal(firstQuote.calls.length, 1, 'another click cannot duplicate the in-flight inspection or quote');
assert.equal(firstQuote.state().busy, 'quote', 'capability preflight keeps the quote lock');
releaseInspection();
await firstPending;
assert.deepEqual(firstQuote.calls.map((call) => call.action), ['inspect', 'quote'], 'first consultation checks capabilities then quotes exactly once');
assert.ok(firstQuote.calls.every((call) => call.busy === 'quote'), 'automatic inspection cannot interleave with first consultation');
assert.equal(firstQuote.calls[1].settings.durationSeconds, 6, 'quote uses the actual supported duration instead of stale defaults');
assert.equal(firstQuote.calls[1].url, project, 'quote is pinned to the project established by inspection');
assert.equal(firstQuote.state().quote.credits, 0, 'zero-credit prices remain valid');
assert.equal(firstQuote.state().inspection.account.credits, 249, 'account card uses the latest quote balance');
assert.equal(firstQuote.state().quoteKey, JSON.stringify({ settings: firstQuote.context.settings, projectUrl: firstQuote.context.projectUrl }), 'the first price fingerprint matches the settings now displayed');
assert.ok(firstQuote.context.exports.controls(firstQuote.state().inspection, firstQuote.context.settings).matches, 'settled first consultation already has capabilities so the automatic effect cannot clear its price');
assert.equal(firstQuote.state().busy, null, 'quote unlocks after publishing capabilities and price');

let releaseStaleInspection;
const staleQuote = quoteHarness({ inspectGate: new Promise((resolve) => { releaseStaleInspection = resolve; }) });
const stalePending = staleQuote.run();
staleQuote.context.quoteRevision.current += 1;
releaseStaleInspection();
await stalePending;
assert.deepEqual(staleQuote.calls.map((call) => call.action), ['inspect'], 'editing during an automatic quote discards the stale response before pricing the old prompt');
assert.equal(staleQuote.state().quote, null, 'a stale automatic quote cannot overwrite the newest prompt state');
assert.equal(staleQuote.state().busy, null, 'discarding a stale quote releases background pricing for the newest input');

const inspectionFailure = quoteHarness({ inspectError: new Error('Flow indisponível') });
await inspectionFailure.run();
assert.deepEqual(inspectionFailure.calls.map((call) => call.action), ['inspect'], 'failed account/capability preflight never sends a quote');
assert.equal(inspectionFailure.state().error, 'Flow indisponível');
assert.equal(inspectionFailure.state().busy, null);

const unsupportedAnimation = quoteHarness({ settings: { ...quoteSettings, videoMode: 'frames', animateMediaId: 'existing-image' } });
await unsupportedAnimation.run();
assert.deepEqual(unsupportedAnimation.calls.map((call) => call.action), ['inspect'], 'a motor without Frames cannot silently turn animation into ingredients');
assert.equal(unsupportedAnimation.state().quote, null);

const changedAccount = quoteHarness({ quoted: { credits: 7, account: { ...quoteInspection.account, email: 'other@example.com' }, projectUrl: project } });
await changedAccount.run();
assert.equal(changedAccount.state().quote, null, 'account changes between inspection and quote cannot authorize generation');
assert.match(changedAccount.state().error, /conta do Flow mudou/);
assert.equal(changedAccount.state().busy, null);

const mediaNodes = [];
function findMediaNodes(node) {
  if (ts.isFunctionDeclaration(node) && ['flowMediaKey', 'flowMediaStore', 'readFlowMedia', 'saveFlowMedia', 'flowMediaFile', 'assetUrl', 'mediaUrl'].includes(node.name?.text)) mediaNodes.push(node.getText(modalAst));
  ts.forEachChild(node, findMediaNodes);
}
findMediaNodes(modalAst);
assert.equal(mediaNodes.length, 7, 'media regression executes the real cache and source selection helpers');
const mediaCode = ts.transpileModule(`${mediaNodes.join('\n')}\nexports.file = flowMediaFile; exports.url = assetUrl; exports.key = flowMediaKey;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const savedMedia = new Map();
const downloadCalls = [];
function mediaHarness({ corruptWrites = false } = {}) {
  const context = { exports: {}, File, URL, setTimeout, clearTimeout, FLOW_DOWNLOAD_MAX_BYTES: 256 * 1024 * 1024,
    flowProjectUrl: (value) => {
      if (!value) return undefined;
      const url = new URL(value); url.search = ''; url.hash = ''; return url.toString();
    },
    indexedDB: { open() {
      const db = { close() {}, transaction() {
        const tx = { objectStore() { return {
          get(key) { const request = { result: savedMedia.get(key) }; queueMicrotask(() => tx.oncomplete?.()); return request; },
          put(value, key) { savedMedia.set(key, { ...value, ...(corruptWrites ? { size: value.size + 1 } : {}) }); const request = { result: key }; queueMicrotask(() => tx.oncomplete?.()); return request; },
        }; } };
        return tx;
      } };
      const request = { result: db }; queueMicrotask(() => request.onsuccess?.()); return request;
    } },
    flowDownload: async (asset, origin) => { downloadCalls.push({ asset, origin }); return new File([`verified-${asset.kind}-1080-bytes`], `Flow-${asset.id}.mp4`, { type: asset.kind === 'video' ? 'video/mp4' : 'image/jpeg' }); },
  };
  vm.runInNewContext(mediaCode, context, { filename: 'PilotFlowInserts.media.js' });
  return context.exports;
}
const pendingVideo = { id: 'canvas-video', kind: 'video', previewPending: true, projectUrl: project, accountEmail: 'test@example.com', posterUrl: 'https://example.com/poster.jpg' };
const firstMediaSession = mediaHarness();
assert.equal(firstMediaSession.url(pendingVideo), undefined, 'canvas video with no source does not become a broken video src');
assert.equal(firstMediaSession.url({ ...pendingVideo, url: `${project}/edit/canvas-video` }), undefined, 'pending preview never treats the HTML editor route as playable media');
assert.equal(firstMediaSession.url({ kind: 'image', url: 'https://example.com/image.jpg' }), 'https://example.com/image.jpg', 'existing image preview remains supported');
const previewFile = await firstMediaSession.file(pendingVideo, project, () => {});
assert.equal(previewFile.type, 'video/mp4');
assert.equal(downloadCalls.length, 1, 'canvas preview downloads one verified file');
const attachedFile = await firstMediaSession.file(pendingVideo, project, () => {});
assert.equal(await attachedFile.text(), await previewFile.text(), 'attachment receives the same bytes as the preview');
assert.equal(downloadCalls.length, 1, 'attachment reuses preview bytes without another Flow download');
const refreshedMediaSession = mediaHarness();
assert.equal(await (await refreshedMediaSession.file(pendingVideo, project, () => {})).text(), await previewFile.text(), 'a fresh module session recovers bytes from persistent storage');
assert.equal(downloadCalls.length, 1, 'F5 never downloads a cached preview again');
assert.equal(refreshedMediaSession.key({ ...pendingVideo, accountEmail: 'TEST@example.com' }), refreshedMediaSession.key(pendingVideo), 'cache identity normalizes account case');
await refreshedMediaSession.file({ ...pendingVideo, accountEmail: 'another@example.com' }, project, () => {});
await refreshedMediaSession.file({ ...pendingVideo, projectUrl: `${project}-other` }, `${project}-other`, () => {});
assert.equal(downloadCalls.length, 3, 'same media id in a different account or project cannot reuse another origin’s cache');
const stillImage = { ...pendingVideo, id: 'still-image', kind: 'image', previewPending: undefined };
await refreshedMediaSession.file(stillImage, project, () => {});
await refreshedMediaSession.file(stillImage, project, () => {});
assert.equal(downloadCalls.length, 4, 'image animation and attachment also reuse their 2K file');
await assert.rejects(mediaHarness({ corruptWrites: true }).file({ ...pendingVideo, id: 'corrupt-roundtrip' }, project, () => {}), /não foi salva por completo/, 'an incomplete cache roundtrip cannot be exposed as a saved preview');
assert.ok(modal.includes('URL.revokeObjectURL(objectUrl)'), 'the preview releases object URLs when closing or changing assets');
assert.equal((modal.match(/const file = await assetFile\(asset\);/g) || []).length, 2, 'both attachment and animation use the verified shared file path');

let animateNode;
function findAnimate(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'animate') animateNode = node.getText(modalAst); ts.forEachChild(node, findAnimate); }
findAnimate(modalAst);
const animateCode = ts.transpileModule(`${animateNode}\nexports.run = animate;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const imageSettings = { ...quoteSettings, mode: 'image', prompt: 'first-frame prompt', model: 'Nano Banana Pro', resolution: '2K', videoMode: 'ingredients' };
const imageAsset = { id: 'paired-image', kind: 'image', projectUrl: project, accountEmail: 'test@example.com' };
let animationState = { busy: null, suggestedMotion: 'camera pushes in while the recipe transforms naturally' };
let savedAnimationDraft;
let animationNotice = '';
const animationContext = {
  exports: {}, taskId: 'paired-animation', chosenAsset: imageAsset,
  draftRef: { current: { settings: imageSettings, projectUrl: project, range: null, assets: [imageAsset] } },
  preferredModels: { current: { image: 'Nano Banana Pro', video: 'Omni 1.1 Flash' } },
  sessionFor: () => animationState,
  updateSession: (_, update) => { animationState = { ...animationState, ...update }; },
  assetFile: async () => new File(['verified-image'], 'paired-image.jpg', { type: 'image/jpeg' }),
  fileDataUrl: async () => 'data:image/jpeg;base64,dmVyaWZpZWQ=',
  saveDraft: async (_, draft) => { savedAnimationDraft = draft; },
  setNotice: (value) => { animationNotice = value; },
  errorText: (error) => error.message,
};
vm.runInNewContext(animateCode, animationContext, { filename: 'PilotFlowInserts.animate.js' });
await animationContext.exports.run();
assert.equal(animationState.preparedSettings.prompt, 'camera pushes in while the recipe transforms naturally', 'Animate uses the paired motion prompt instead of reusing the still-frame prompt');
assert.equal(animationState.preparedSettings.videoMode, 'frames', 'Animate binds the generated image as a Flow frame');
assert.equal(savedAnimationDraft.settings.prompt, animationState.preparedSettings.prompt, 'the animation prompt is persisted before UI handoff');
assert.equal(savedAnimationDraft.suggestedMotion, '', 'the paired prompt is consumed exactly once');
assert.equal(animationState.suggestedMotion, '', 'session cannot accidentally reuse the prompt on another image');
assert.match(animationNotice, /prompt automático de movimento já está preenchido/, 'the UI confirms that animation guidance was filled automatically');

let generateNode;
function findGenerate(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'generate') generateNode = node.getText(modalAst); ts.forEachChild(node, findGenerate); }
findGenerate(modalAst);
const generateCode = ts.transpileModule(`${generateNode}\nexports.run = generate;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let generatedState = { busy: null, activeJob: null, assets: [], quote: { credits: 7, account: { ...quoteInspection.account, credits: 83 } } };
const generationContext = { exports: {}, taskId: 'generated-preview', settings: quoteSettings, projectUrl: project,
  referencesOverLimit: false, quoteValid: true, insufficient: false, session: generatedState,
  crypto: { randomUUID: () => 'generated-id' }, draftRef: { current: {} },
  sessionFor: () => generatedState, updateSession: (_, update) => { generatedState = { ...generatedState, ...update }; },
  saveDraft: async () => {}, setProjectUrl: () => {}, setSelected: () => {}, errorText: (error) => error.message,
  flowGenerate: async () => ({ assets: [pendingVideo], projectUrl: project, account: { ...quoteInspection.account, credits: 76 } }),
};
vm.runInNewContext(generateCode, generationContext, { filename: 'PilotFlowInserts.generate.js' });
await generationContext.exports.run();
assert.equal(generatedState.account.credits, 76, 'completed generation updates the account card with its fresh balance');
assert.equal(generatedState.assets[0].previewPending, true, 'canvas-only results are retained for 1080p preview preparation');
assert.equal(generatedState.activeJob, null, 'missing video src does not leave an already completed generation locked');
assert.equal(generatedState.quote, null, 'generation cannot reuse its old credit quote');

let montageNode;
function findMontage(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === 'atualizarMontagem') montageNode = node.getText(modalAst); ts.forEachChild(node, findMontage); }
findMontage(modalAst);
assert.ok(montageNode, 'Flow exposes an explicit montage update handler');
const montageCode = ts.transpileModule(`${montageNode}\nexports.run = atualizarMontagem;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function montageHarness(callback, { busy = null, externalBusy = false, shared } = {}) {
  const state = shared || { current: { busy, quote: { credits: 7 }, assets: [pendingVideo] } };
  const calls = { rebuild: 0, close: 0, provider: 0 };
  const context = { exports: {}, taskId: 'ready-task', atualizandoMontagem: externalBusy,
    sessionFor: () => state.current,
    updateSession: (_, update) => { state.current = { ...state.current, ...update }; },
    onAtualizarMontagem: callback ? async () => { calls.rebuild++; return callback(); } : undefined,
    onFechar: () => { calls.close++; },
    flowGenerate: () => { calls.provider++; throw new Error('Generation must never happen during montage update'); },
    errorText: (error) => error.message,
  };
  vm.runInNewContext(montageCode, context, { filename: 'PilotFlowInserts.montage.js' });
  return { run: context.exports.run, state, calls };
}
let finishMontage;
const successfulMontage = montageHarness(() => new Promise((resolve) => { finishMontage = resolve; }));
const originalQuote = successfulMontage.state.current.quote;
const pendingMontage = successfulMontage.run();
assert.equal(successfulMontage.state.current.montage.busy, true, 'rebuild marks its own lock immediately');
assert.equal(successfulMontage.state.current.busy, null, 'rebuilding never pretends the Flow provider is generating or downloading');
assert.equal(successfulMontage.state.current.montage.notice, '', 'success is never announced before the callback completes');
await successfulMontage.run();
const reopenedMontage = montageHarness(async () => true, { shared: successfulMontage.state });
await reopenedMontage.run();
assert.equal(successfulMontage.calls.rebuild, 1, 'repeated clicks dispatch only one montage update');
assert.equal(reopenedMontage.calls.rebuild, 0, 'closing and reopening retains the task-level rebuild lock');
finishMontage(true);
await pendingMontage;
assert.match(successfulMontage.state.current.montage.notice, /Montagem atualizada/);
assert.equal(successfulMontage.state.current.montage.error, '');
assert.equal(successfulMontage.state.current.montage.busy, false);
assert.equal(successfulMontage.state.current.quote, originalQuote, 'local montage leaves the Flow credit quote unchanged');
assert.equal(successfulMontage.calls.close, 0, 'the modal does not auto-close after completion');
assert.equal(successfulMontage.calls.provider, 0, 'montage does not generate another Flow asset');
for (const outcome of ['not-started', 'failed']) {
  const unsuccessful = montageHarness(async () => { if (outcome === 'failed') throw new Error('Os takes locais ainda não estão disponíveis.'); return false; });
  await unsuccessful.run();
  assert.equal(unsuccessful.state.current.montage.notice, '', 'false or rejected callback cannot claim success');
  assert.match(unsuccessful.state.current.montage.error, outcome === 'failed' ? /takes locais/ : /não foi atualizada/);
  assert.equal(unsuccessful.state.current.montage.busy, false, 'failed rebuild unlocks for a later explicit retry');
  assert.equal(unsuccessful.calls.close, 0, 'failures remain visible in the open dialog');
}
for (const options of [{ busy: 'download' }, { externalBusy: true }]) {
  const guarded = montageHarness(async () => true, options);
  await guarded.run();
  assert.equal(guarded.calls.rebuild, 0, 'active import or page rebuild prevents concurrent montage changes');
}
assert.ok(modal.includes('{onAtualizarMontagem && <button'), 'rebuild action appears only for a page-provided eligible task');
assert.ok(modal.includes('disabled={busy || montageBusy}>Editar inserts'), 'editing placement is paused while the montage reads its inputs');

console.log('Pilot Flow integration: source isolation, persistent previews, fresh credits and explicit, close-safe montage update passed.');

// Cached remount: exercise production page handlers, including failure preservation.
{

// Executes the exact production handler; jobs, IDB and FFmpeg outputs are
// controlled fixtures. Browser/compositor E2E remains a separate validation.
const root = new URL('../', import.meta.url);
const page = readFileSync(new URL('app/tools/clickup-pilot/page.tsx', root), 'utf8');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(name) {
  let found;
  function walk(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(ast);
    ts.forEachChild(n, walk);
  }
  walk(ast);
  assert.ok(found, `actual ${name} exists`);
  return found;
}
function compile(text) {
  return ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}
const helpers = { exports: {} };
vm.runInNewContext(compile(readFileSync(new URL('lib/montagem-sig.ts', root), 'utf8')), helpers);
const handler = compile(`${extract('rebuildMontage')}\nexports.run = rebuildMontage;`);
const video = new Blob([randomFillSync(Buffer.alloc(100_000))], { type: 'video/mp4' });
const oldZip = new Blob(['previous real deliverable']);
function BrowserBlobZip() {
  const zip = new JSZip();
  const file = zip.file.bind(zip);
  zip.file = (name, data) => file(name, data instanceof Blob ? data.arrayBuffer() : data);
  return zip;
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

function harness(options = {}) {
  const taskId = 'task-ready';
  const job = {
    taskId, taskName: 'AD fixture', baseAdId: 'AD99', genId: 'gen-current', phase: 'done',
    parts: [{ label: 'HOOK 1', videoId: 'video-hook', videoStatus: 'completed' }, { label: 'BODY 1', videoId: 'video-body', videoStatus: 'completed' }],
    replan: { parts: [{ label: 'HOOK 1', text: 'A primeira frase da copy' }, { label: 'BODY 1', text: 'A segunda frase da copy' }] },
    montadoZipUrl: 'blob:previous-mounted', montadoZipName: 'AD99_montado.zip',
    camufladoZipUrl: 'blob:previous-camo', dirtyParts: [],
  };
  Object.assign(job, options.job);
  const calls = { pipeline: 0, loads: [], persisted: [], signature: [], revoked: [], provider: 0, pos: 0, postOptions: [], history: [] };
  const stored = new Map([['batch:task-ready:montado', oldZip], ['insert:flow', video], ['insert:manual', video]]);
  for (const p of job.parts) stored.set(`take:${job.genId}:${p.label}`, video);
  for (const key of options.missing || []) stored.delete(key);
  const state = { current: { [taskId]: job } };
  const inserts = [{ id: 'flow-insert', source: 'flow', midiaKey: 'insert:flow', midiaNome: 'generated.mp4', ancora: 'HOOK 1', palavraDe: 0, palavraAte: 3 }];
  const refs = { current: { [taskId]: inserts } };
  const locks = { current: new Set() };
  let enabled = options.enabled !== false;
  let rebuilding = null;
  const context = {
    exports: {}, Blob, console, Date, Set, JSON, ...helpers.exports,
    crypto: { randomUUID: () => `fixture-nonce-${calls.persisted.length}` },
    flushSync: (fn) => {
      if (calls.signature.length) options.onReactCommit?.({ context, state, refs });
      else options.onReactStart?.({ context, state, refs });
      fn();
    },
    batchStates: state.current, batchStatesRef: state, flowRebuildLocksRef: locks,
    recoveredBatchIdsRef: { current: new Set([taskId]) },
    heygenPendingRef: { current: options.pendingRun ? { [taskId]: 'run' } : {} },
    insertsRef: refs, legendaCfgsRef: { current: {} }, zoomCfgsRef: { current: {} }, headlineRef: { current: {} }, CHAVE_PADRAO: 'default',
    captionTemplatesRef: { current: [] }, taskAnalysesRef: { current: {} },
    taskIdBaseDaVersao: (id) => id, isFlowEnabled: () => enabled,
    insertsDaMontagem: () => refs.current[taskId].filter((i) => i.source !== 'flow' || enabled),
    pilotPartKey: (id, gen, label) => `take:${gen}:${label}`,
    setBatchStates(update) { state.current = update(state.current); context.batchStates = state.current; },
    setRebuildingTaskId(update) { rebuilding = typeof update === 'function' ? update(rebuilding) : update; },
    getTaskCamuflagem: () => ({ camuflagem: !!options.camo, whiteAudio: null, camuflagemVolume: 0 }),
    camuflagemMode: !!options.camo,
    isDecupagemEnabled: () => !!options.decup, getDecupIntensity: () => 0.05, isNivelamentoEnabled: () => false,
    limparPosResultado: () => {}, makeClipCacheHooks: () => ({}),
    fazerPosProcessar(id, opts) {
      calls.postOptions.push(opts);
      if (!context.insertsDaMontagem().length && !options.postAlways) return undefined;
      return async () => {
        calls.pos++;
        if (options.postThrows) throw new Error(options.postThrows);
        return 'postResult' in options ? options.postResult : video;
      };
    },
    async runPostPipelineSerial(cfg, id) {
      calls.pipeline++;
      await options.onPipeline?.({ context, refs, state, cfg, setEnabled: (value) => { enabled = value; } });
      if (options.pipelineThrows) throw new Error(options.pipelineThrows);
      const item = { filename: 'AD99_H1.mp4', rawAssembled: video, decupado: options.decup ? video : undefined, camuflado: options.camo ? video : undefined, ...options.item };
      if (cfg.posProcessar && !options.skipPost) {
        try { item.decupado = await cfg.posProcessar(video, { filename: item.filename, partesSec: [2, 4] }); }
        catch (error) { item.errors = { ...item.errors, posproducao: error.message }; }
      }
      return { items: options.emptyOutput ? [] : [item], diagnostics: { summary: 'fixture pipeline' } };
    },
    canalDoTaskId: () => 'meta', versaoDoTaskId: () => 1,
    URL: { createObjectURL: () => `blob:new-${calls.persisted.length}`, revokeObjectURL: (url) => calls.revoked.push(url) },
    async persistDeliverableOrRescue(key, blob, filename) {
      calls.persisted.push({ key, blob, filename });
      if (options.persistFails || options.persistFailsKey === key || (options.persistFailsSuffix && key.endsWith(options.persistFailsSuffix))) return { persisted: false, rescued: true };
      stored.set(key, blob);
      await options.onPersist?.({ key, context, state, refs, calls });
      return { persisted: true, rescued: false };
    },
    chaveSigDoMontado: (id) => `batch:${id}:montado:sig`,
    async gravarSigDoMontado(id, sig, key = `batch:${id}:montado:sig`) {
      calls.signature.push(sig); if (!options.signatureFails) stored.set(key, new Blob([sig]));
      await options.onSignature?.({ key, context, state, refs, calls });
    },
    async lerSigDoMontado(id, key = `batch:${id}:montado:sig`) {
      const sig = await stored.get(key)?.text(); await options.onSignatureRead?.({ key, context, state, refs, calls }); return sig;
    },
    logHistory: (entry) => { if (options.historyThrows) throw new Error('history unavailable'); calls.history.push(entry); },
    runHeyGenGated() { calls.provider++; throw new Error('paid generation forbidden'); },
    resumeTaskBatch() { calls.provider++; throw new Error('paid resume forbidden'); },
    retomarTaskBatch() { calls.provider++; throw new Error('paid retomar forbidden'); },
    require(id) {
      if (id === 'jszip') return { default: BrowserBlobZip };
      if (id === '@/lib/zip-store') return { async loadBlob(key) {
        calls.loads.push(key); await options.onLoad?.({ key, state, refs, context }); return stored.get(key) || null;
      } };
      throw new Error(`Unexpected import: ${id}`);
    },
  };
  context.flowRebuildConfigRef = { current: () => ({
    decupagem: context.isDecupagemEnabled(), respiro: context.getDecupIntensity(),
    nivelamento: context.isNivelamentoEnabled(), ...context.getTaskCamuflagem(),
  }) };
  vm.runInNewContext(handler, context, { filename: 'actual-page.rebuildMontage.js' });
  return { taskId, context, state, refs, locks, stored, calls, run: (opts = { somenteCache: true }) => context.exports.run(taskId, opts), setEnabled(value) { enabled = value; } };
}
function unchanged(h) {
  assert.equal(h.stored.get('batch:task-ready:montado'), oldZip);
  assert.equal(h.state.current[h.taskId].montadoZipUrl, 'blob:previous-mounted');
  assert.ok(!h.calls.revoked.includes('blob:previous-mounted'));
  assert.equal(h.calls.provider, 0);
  assert.equal(h.locks.current.size, 0);
}

await test('successful cached remount persists actual video ZIP, signature and URL only after output', async () => {
  const h = harness();
  assert.equal(await h.run(), true);
  assert.equal(h.calls.pipeline, 1);
  assert.equal(h.calls.provider, 0);
  assert.equal(h.calls.pos, 1);
  assert.equal(h.calls.postOptions[0].exigirCompleta, true);
  assert.equal(h.calls.persisted.length, 1);
  const zip = await JSZip.loadAsync(await h.calls.persisted[0].blob.arrayBuffer());
  assert.equal((await zip.file('AD99_H1.mp4').async('uint8array')).byteLength, video.size);
  assert.equal(h.state.current[h.taskId].phase, 'done');
  assert.equal(h.calls.signature[0], helpers.exports.assinaturaMontagem(h.state.current[h.taskId].parts));
  const pointer = h.state.current[h.taskId].flowMontagem;
  assert.ok(pointer.montadoKey.startsWith('pilot:task-ready:g:gen-current:part:flow-montagem:'));
  assert.equal(h.stored.get(pointer.montadoKey), h.calls.persisted[0].blob);
  assert.equal(h.stored.get('batch:task-ready:montado'), oldZip, 'canonical previous ZIP was never overwritten');
  assert.equal(h.calls.history[0].ref[0].key, pointer.montadoKey, 'history downloads use the committed unique key');
  assert.equal(h.context.recoveredBatchIdsRef.current.has(h.taskId), false, 'committed pointer is eligible for normal durable persistence');
  assert.deepEqual(Array.from(h.state.current[h.taskId].dirtyParts), []);
  assert.ok(h.calls.revoked.includes('blob:previous-mounted'));
});
for (const scenario of [
  { name: 'missing take', options: { missing: ['take:gen-current:BODY 1'] } },
  { name: 'missing insert', options: { missing: ['insert:flow'] } },
  { name: 'pending take', mutate(h) { h.state.current[h.taskId].parts[0].videoStatus = 'pending'; } },
  { name: 'failed take', mutate(h) { h.state.current[h.taskId].parts[0].videoStatus = 'failed'; } },
  { name: 'missing video id', mutate(h) { h.state.current[h.taskId].parts[0].videoId = null; } },
  { name: 'missing generation id', options: { job: { genId: undefined } } },
  { name: 'missing saved copy', options: { job: { replan: undefined } } },
  { name: 'running job', options: { job: { phase: 'rendering' } } },
  { name: 'running HeyGen wrapper', options: { pendingRun: true } },
  { name: 'troca workflow', options: { job: { kind: 'troca' } } },
  { name: 'VA workflow', options: { job: { isVA: true } } },
  { name: 'copy and takes mismatch', mutate(h) { h.state.current[h.taskId].replan.parts[0].label = 'WRONG'; } },
  { name: 'empty expected copy', mutate(h) { h.state.current[h.taskId].replan.parts.forEach((p) => { p.text = ''; }); } },
]) await test(`${scenario.name}: no pipeline, no paid provider, no previous delivery mutation`, async () => {
  const h = harness(scenario.options); scenario.mutate?.(h);
  await assert.rejects(h.run()); assert.equal(h.calls.pipeline, 0); assert.equal(h.calls.persisted.length, 0); unchanged(h);
});

await test('disabled missing Flow media does not block rebuilding without Flow', async () => {
  const h = harness({ enabled: false, missing: ['insert:flow'] });
  assert.equal(await h.run(), true); assert.equal(h.calls.pos, 0); assert.equal(h.calls.provider, 0);
});
await test('manual and Flow assets coexist and both are read from cache', async () => {
  const h = harness(); h.refs.current[h.taskId].push({ id: 'manual', midiaKey: 'insert:manual' });
  assert.equal(await h.run(), true);
  assert.ok(h.calls.loads.includes('insert:flow')); assert.ok(h.calls.loads.includes('insert:manual'));
});
await test('immediate lock deduplicates before the first cache await and blocks legacy overlap', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ onLoad: async () => gate });
  const first = h.run(); assert.equal(h.locks.current.size, 1);
  assert.equal(await h.run(), false); assert.equal(await h.run(undefined), false);
  release(); assert.equal(await first, true); assert.equal(h.calls.pipeline, 1); assert.equal(h.locks.current.size, 0);
});
for (const mutation of ['inserts', 'enabled', 'copy', 'generation', 'take', 'caption']) await test(`${mutation} changing while cache is read aborts before pipeline`, async () => {
  let changed = false;
  const h = harness({ onLoad: async ({ refs, state, context }) => {
    if (changed) return; changed = true;
    if (mutation === 'inserts') refs.current['task-ready'][0].palavraAte++;
    if (mutation === 'enabled') h.setEnabled(false);
    if (mutation === 'copy') state.current['task-ready'].replan.parts[0].text += ' changed';
    if (mutation === 'generation') state.current['task-ready'].genId = 'other';
    if (mutation === 'take') state.current['task-ready'].parts[0].videoId = 'new-video';
    if (mutation === 'caption') context.legendaCfgsRef.current['task-ready'] = { on: true };
  } });
  await assert.rejects(h.run(), /mudaram/); assert.equal(h.calls.pipeline, 0); unchanged(h);
});
for (const scenario of [
  { name: 'empty output', emptyOutput: true },
  { name: 'missing part', item: { missingParts: ['BODY 1'] } },
  { name: 'assemble error', item: { errors: { assemble: 'decode failed' } } },
  { name: 'post-production skipped', skipPost: true },
  { name: 'post-production null output', postResult: null },
  { name: 'post-production tiny output', postResult: new Blob(['empty']) },
  { name: 'post-production warning failure', postThrows: 'insert did not open' },
  { name: 'small raw output', item: { rawAssembled: new Blob(['empty']) } },
  { name: 'decupagem error', decup: true, item: { errors: { decupagem: 'bad trim' } } },
  { name: 'camo error', camo: true, item: { camuflado: undefined, errors: { camuflagem: 'bad audio' } } },
]) await test(`${scenario.name}: previous complete delivery survives failed output`, async () => {
  const h = harness(scenario); await assert.rejects(h.run(), /incompleta/);
  assert.equal(h.calls.pipeline, 1); assert.equal(h.calls.persisted.length, 0); unchanged(h);
});
await test('config change while rendering rejects output before persisting', async () => {
  const h = harness({ onPipeline: async ({ refs }) => { refs.current['task-ready'][0].palavraDe++; } });
  await assert.rejects(h.run(), /mudaram/); assert.equal(h.calls.persisted.length, 0); unchanged(h);
});
await test('a newer generation is not reset to done by the old failed update', async () => {
  const h = harness({ onPipeline: async ({ state }) => { state.current['task-ready'] = { ...state.current['task-ready'], genId: 'new', phase: 'rendering' }; } });
  await assert.rejects(h.run(), /mudaram/); assert.equal(h.state.current[h.taskId].phase, 'rendering'); unchanged(h);
});
await test('persist failure cannot report success or replace the previous download URL', async () => {
  const h = harness({ persistFails: true }); await assert.rejects(h.run(), /salvar/);
  assert.equal(h.calls.signature.length, 0); unchanged(h);
});
await test('camo persistence failure cannot claim all deliveries saved', async () => {
  const h = harness({ camo: true, persistFailsSuffix: ':camo' });
  await assert.rejects(h.run(), /camuflado.*anterior foi preservada/);
  unchanged(h); assert.equal(h.state.current[h.taskId].flowMontagem, undefined);
  assert.equal(h.context.recoveredBatchIdsRef.current.has(h.taskId), true);
});
for (const stage of ['montado', 'camo', 'signature', 'signature-read']) {
  for (const mutation of ['generation', 'inserts', 'decupagem', 'respiro', 'nivelamento', 'camuflagem', 'white-audio', 'template', 'idioma']) {
    await test(`${mutation} changes during ${stage} save: old IDB/URL/pointer survive`, async () => {
      const mutate = ({ context, state, refs }) => {
        if (mutation === 'generation') state.current['task-ready'] = { ...state.current['task-ready'], genId: 'new-generation', phase: 'rendering' };
        if (mutation === 'inserts') refs.current['task-ready'][0].palavraDe++;
        if (mutation === 'decupagem') context.isDecupagemEnabled = () => true;
        if (mutation === 'respiro') context.getDecupIntensity = () => 0.12;
        if (mutation === 'nivelamento') context.isNivelamentoEnabled = () => true;
        if (mutation === 'camuflagem') context.getTaskCamuflagem = () => ({ camuflagem: false, whiteAudio: null, camuflagemVolume: 0 });
        if (mutation === 'white-audio') context.getTaskCamuflagem = () => ({ camuflagem: true, whiteAudio: new Blob(['different sound']), camuflagemVolume: 0 });
        if (mutation === 'template') context.captionTemplatesRef.current = [{ id: 'edited-template' }];
        if (mutation === 'idioma') context.taskAnalysesRef.current['task-ready'] = { drMillion: true, drLang: 'pl' };
      };
      const h = harness({ camo: true,
        onPersist: stage === 'montado' || stage === 'camo' ? async (ctx) => { if (ctx.key.endsWith(`:${stage}`)) mutate(ctx); } : undefined,
        onSignature: stage === 'signature' ? mutate : undefined,
        onSignatureRead: stage === 'signature-read' ? mutate : undefined,
      });
      await assert.rejects(h.run(), /mudaram/);
      unchanged(h);
      assert.equal(h.state.current[h.taskId].flowMontagem, undefined);
      assert.equal(h.calls.history.length, 0);
      assert.equal(h.context.recoveredBatchIdsRef.current.has(h.taskId), true, 'failed operation never claims recovered record ownership');
      if (mutation === 'generation') assert.equal(h.state.current[h.taskId].phase, 'rendering', 'newer run is never reset to done');
      assert.ok(h.calls.persisted.every((item) => item.key.includes(':part:flow-montagem:')), 'only unique staging keys can be written');
    });
  }
}
await test('signature write failure preserves the previous committed delivery', async () => {
  const h = harness({ signatureFails: true }); await assert.rejects(h.run(), /assinatura/); unchanged(h);
});
await test('a newer queued React generation cannot be overwritten at final metadata commit', async () => {
  const h = harness({ onReactCommit: ({ state }) => { state.current['task-ready'] = { ...state.current['task-ready'], genId: 'newest', phase: 'rendering' }; } });
  await assert.rejects(h.run(), /mudou antes de publicar/); unchanged(h);
  assert.equal(h.state.current[h.taskId].phase, 'rendering');
  assert.equal(h.state.current[h.taskId].flowMontagem, undefined);
});
await test('a queued generation before phase post prevents pipeline and preserves its message', async () => {
  const h = harness({ onReactStart: ({ state }) => { state.current['task-ready'] = { ...state.current['task-ready'], genId: 'newest', phase: 'rendering', message: 'new run in progress' }; } });
  await assert.rejects(h.run(), /mudou antes de iniciar/); unchanged(h);
  assert.equal(h.calls.pipeline, 0);
  assert.equal(h.state.current[h.taskId].phase, 'rendering');
  assert.equal(h.state.current[h.taskId].message, 'new run in progress');
});
await test('late progress cannot overwrite the message of another generation', async () => {
  const h = harness({ onPipeline: ({ state, cfg }) => {
    state.current['task-ready'] = { ...state.current['task-ready'], genId: 'newest', phase: 'rendering', message: 'new run in progress' };
    cfg.onProgress({ stage: 'old progress', doneCount: 1, totalCount: 2 });
  } });
  await assert.rejects(h.run(), /mudaram/); unchanged(h);
  assert.equal(h.state.current[h.taskId].message, 'new run in progress');
});
await test('optional history failure after publishing cannot revoke the new delivery', async () => {
  const h = harness({ historyThrows: true }); assert.equal(await h.run(), true);
  const latest = h.state.current[h.taskId];
  assert.ok(latest.flowMontagem);
  assert.ok(!h.calls.revoked.includes(latest.montadoZipUrl));
  assert.equal(h.stored.get(latest.flowMontagem.montadoKey), h.calls.persisted[0].blob);
});
await test('failing a subsequent Flow update preserves its previous unique-key pointer', async () => {
  const options = {};
  const h = harness(options); assert.equal(await h.run(), true);
  const previous = h.state.current[h.taskId];
  const oldPointer = previous.flowMontagem;
  const oldSaved = h.stored.get(oldPointer.montadoKey);
  const revokedCount = h.calls.revoked.length;
  options.onPersist = async ({ refs }) => { refs.current['task-ready'][0].palavraAte++; };
  await assert.rejects(h.run(), /mudaram/);
  assert.equal(h.state.current[h.taskId].flowMontagem, oldPointer);
  assert.equal(h.stored.get(oldPointer.montadoKey), oldSaved);
  assert.equal(h.state.current[h.taskId].montadoZipUrl, previous.montadoZipUrl);
  assert.ok(!h.calls.revoked.slice(revokedCount).includes(previous.montadoZipUrl));
});
await test('committed Flow pointer survives serializing/restoring the job and leaves canonical legacy ZIP intact', async () => {
  const h = harness({ camo: true }); assert.equal(await h.run(), true);
  const durable = { exports: {} };
  vm.runInNewContext(compile(readFileSync(new URL('lib/durable-records-core.ts', root), 'utf8')), durable);
  const restored = durable.exports.checkpoint(h.state.current[h.taskId]);
  assert.equal(restored.montadoZipUrl, undefined, 'real durable checkpoint strips only ephemeral URLs');
  assert.equal(h.stored.get(restored.flowMontagem.montadoKey), h.calls.persisted[0].blob);
  assert.equal(h.stored.get(restored.flowMontagem.camufladoKey), h.calls.persisted[1].blob);
  assert.equal(await h.stored.get(restored.flowMontagem.assinaturaKey).text(), restored.montagemSig);
  assert.equal(h.stored.get('batch:task-ready:montado'), oldZip);
});
await test('Flow staging groups with the task and survives per-generation purge, without changing global cache rules', async () => {
  const pruning = { exports: {} };
  vm.runInNewContext(compile(readFileSync(new URL('lib/zip-store-prune.ts', root), 'utf8')), pruning);
  const h = harness({ camo: true }); await h.run();
  for (const key of Object.values(h.state.current[h.taskId].flowMontagem).filter((k) => k.startsWith('pilot:'))) {
    assert.equal(pruning.exports.zipGroupId(key), h.taskId);
    assert.ok(/:part:flow-montagem:/.test(key));
  }
  assert.equal((page.match(/preservar: new RegExp\(`\$\{INSUMO_DO_DISPARO.source\}\|:part:flow-montagem:`\)/g) || []).length, 2, 'both existing generation purges retain committed Flow deliveries');
});
let hydrationUpdater;
function findHydration(node) {
  if (ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.statements.some((s) => ts.isIfStatement(s) && s.getText(ast).includes('JSON.stringify(cur.flowMontagem)'))) hydrationUpdater = node.getText(ast);
  ts.forEachChild(node, findHydration);
}
findHydration(ast);
assert.ok(hydrationUpdater, 'the real hydration updater checks the committed Flow pointer');
await test('late F5 hydration cannot replace the URL of a newly committed Flow output', async () => {
  const older = { genId: 'g', flowMontagem: { genId: 'g', montadoKey: 'old-stage' } };
  const newer = { genId: 'g', flowMontagem: { genId: 'g', montadoKey: 'new-stage' }, montadoZipUrl: 'blob:new' };
  const context = { exports: {}, taskId: 'task', restored: { task: older }, updates: { montadoZipUrl: 'blob:old' } };
  vm.runInNewContext(compile(`exports.run = (${hydrationUpdater});`), context);
  const prev = { task: newer };
  assert.equal(context.exports.run(prev), prev);
  context.restored.task = newer;
  assert.equal(context.exports.run(prev).task.montadoZipUrl, 'blob:old', 'same pointer can hydrate its own URL');
});
await test('legacy caller does not receive strict post options or cache rejection', async () => {
  const h = harness({ missing: ['take:gen-current:BODY 1'] });
  assert.equal(await h.run({}), true); assert.equal(h.calls.pipeline, 1); assert.equal(h.calls.postOptions[0], undefined);
});

// Verify the actual post-production wrapper rejects warnings before deleting
// orphan configuration. No real browser media operation runs in this unit test.
const posCode = compile(`${extract('fazerPosProcessar')}\nexports.run = fazerPosProcessar;`);
function postHarness(strict, result) {
  let removed = 0;
  const ctx = { exports: {}, console: { log() {}, warn() {} },
    taskIdBaseDaVersao: (id) => id, CHAVE_PADRAO: 'default',
    legendaCfgsRef: { current: {} }, zoomCfgsRef: { current: {} }, headlineRef: { current: {} },
    LEGENDA_CFG_DEFAULT: { on: false }, ZOOM_CFG_DEFAULT: { on: false }, HEADLINE_CFG_DEFAULT: { on: false },
    insertsDaMontagem: () => [{ id: 'flow' }], batchStatesRef: { current: { task: { replan: { parts: [{ label: 'BODY 1', text: 'copy' }] } } } },
    taskAnalysesRef: { current: {} }, captionTemplatesRef: { current: [] },
    insertsRef: { current: { task: [{ id: 'flow' }] } }, setInserts: () => { removed++; },
    setBatchStates: () => {}, setPosResultado: () => {},
    require(id) {
      if (id === '@/lib/pilot-pos-producao-run') return { montarPosProducao: async () => result };
      if (id === '@/lib/pilot-pos-producao') return { semOQueFoiPedido: () => 'sem insert' };
      if (id === '@/lib/idioma') return { idiomaDaCopy: () => 'pt' };
      throw new Error(`Unexpected ${id}`);
    },
  };
  vm.runInNewContext(posCode, ctx);
  return { run: () => ctx.exports.run('task', strict ? { exigirCompleta: true } : undefined)(video, { filename: 'fixture.mp4', partesSec: [5] }), removed: () => removed };
}
await test('strict actual post wrapper rejects warnings and does not delete orphan config', async () => {
  const h = postHarness(true, { blob: video, avisos: ['o insert não abriu'], insertsOrfaos: ['flow'] });
  await assert.rejects(h.run(), /não foi concluída/); assert.equal(h.removed(), 0);
});
await test('legacy actual post wrapper preserves warning and orphan cleanup behavior', async () => {
  const h = postHarness(false, { blob: video, avisos: ['o insert não abriu'], insertsOrfaos: ['flow'] });
  assert.equal(await h.run(), video); assert.ok(h.removed() > 0);
});
await test('strict actual post wrapper accepts clean compositor output', async () => {
  assert.equal(await postHarness(true, { blob: video, avisos: [] }).run(), video);
});
await test('strict post accepts informational ASR fallback, duration fit and copy correction warnings', async () => {
  assert.equal(await postHarness(true, { blob: video, avisos: [
    'não consegui ouvir a fala pra posicionar insert/headline — eles entraram pela estimativa da copy (podem ficar alguns segundos fora do lugar)',
    'insert "video" é curto demais pro trecho: desacelerou até o limite e o resto ficou no último frame',
    'a legenda saiu do que foi FALADO, sem a correção pela copy do doc — confere a grafia dos nomes próprios.',
  ] }).run(), video);
});
for (const warning of [
  'os inserts não entraram nesta montagem — o vídeo saiu com o resto (legenda, zoom) normal.',
  'o insert "video" não coube no trecho de copy marcado — ele não entrou nesta montagem.',
  'não consegui ler os arquivos dos inserts agora. O AD saiu sem eles.',
  'não consegui misturar o som dos inserts nesta montagem — o AD saiu só com o áudio do avatar.',
  'o vídeo saiu SEM ÁUDIO — confere antes de entregar',
  'a legenda não entrou nesta montagem — o vídeo saiu sem ela.',
  'a headline tinha texto mas não achou um trecho válido — ela não entrou.',
]) await test(`strict post rejects omitted output: ${warning.slice(0, 65)}`, async () => {
  await assert.rejects(postHarness(true, { blob: video, avisos: [warning] }).run(), /não foi concluída/);
});
console.log(`Flow remount handler: ${passed} real-handler unit scenarios passed; browser compositor E2E is separate.`);

}

// Execute the real decoder expressions without codec, media-file or FFmpeg
// dependencies. A Flow MP4 with B-frames exposed visible corruption when its
// compressed samples were submitted in presentation order instead of DTS.
{
  const decoderSource = readFileSync(new URL('../lib/insert-decoder.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('insert-decoder.ts', decoderSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const wanted = new Set(['amostras', 'alimentar', 'recomecarEm']);
  const snippets = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && wanted.has(node.name.getText(ast)) && node.initializer) {
      snippets.set(node.name.getText(ast), node.initializer.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual([...snippets.keys()].sort(), [...wanted].sort(), 'real decoder expressions must be discoverable');
  const transpile = (code) => ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  function runFeed(rawSamples) {
    const chunks = [];
    const context = {
      exports: {}, brutas: rawSamples, proxAmostra: 0,
      EncodedVideoChunk: class { constructor(init) { Object.assign(this, init); } },
      decoder: { state: 'configured', decode: (chunk) => chunks.push(chunk) },
    };
    vm.runInNewContext(transpile(
      `const amostras = ${snippets.get('amostras')};\n` +
      `const alimentar = ${snippets.get('alimentar')};\n` +
      'alimentar(amostras.length); exports.samples = amostras;',
    ), context);
    return { chunks, samples: context.exports.samples };
  }
  function runSeek(samples, targetUs) {
    const context = {
      amostras: samples, proxAmostra: -1, _recomecos: 0, _chamadas: 0,
      console: { warn() {} }, novoDecoder() {},
    };
    vm.runInNewContext(transpile(
      `const recomecarEm = ${snippets.get('recomecarEm')};\nrecomecarEm(${targetUs});`,
    ), context);
    return context.proxAmostra;
  }
  const sample = (id, dts, cts, sync = false) => ({
    data: Uint8Array.of(id), dts, cts, duration: 1, timescale: 1_000_000, is_sync: sync,
  });
  const chunkIds = (chunks) => chunks.map((chunk) => chunk.data[0]);
  const bResult = runFeed([
    sample(10, 0, 0, true), sample(20, 1, 3), sample(30, 2, 1), sample(40, 3, 2),
  ]);
  assert.deepEqual(chunkIds(bResult.chunks), [10, 20, 30, 40], 'B-frame chunks follow DTS, preserving reference dependencies');
  assert.deepEqual(bResult.chunks.map((chunk) => chunk.timestamp), [0, 3, 1, 2], 'DTS submission preserves CTS presentation timestamps');
  assert.deepEqual(chunkIds(runFeed([
    sample(50, 0, 0, true), sample(60, 1, 1), sample(70, 2, 2),
  ]).chunks), [50, 60, 70], 'video without B-frames retains its submission order');
  assert.equal(runSeek([
    { ctsUs: 0, chave: true }, { ctsUs: 400, chave: false },
    { ctsUs: 200, chave: true }, { ctsUs: 300, chave: false },
  ], 250), 2, 'seek finds the latest eligible sync sample despite nonmonotonic CTS');
  assert.equal(runSeek([
    { ctsUs: 0, chave: true }, { ctsUs: 200, chave: true }, { ctsUs: 100, chave: false },
  ], 50), 0, 'backward seek keeps the earlier eligible sync sample');
  console.log('Flow video decoder: 5 portable DTS/CTS regression invariants passed.');
}
