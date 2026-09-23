// Executa o módulo de produção completo em VM; somente mídia/rede são mocks.
// Nenhuma geração HeyGen, download StockFrame ou crédito real é utilizado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const file = 'lib/va-pipeline.ts';
const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const withoutImports = ts.factory.updateSourceFile(ast, ast.statements.filter(node => !ts.isImportDeclaration(node)));
const compiled = ts.transpileModule(ts.createPrinter().printFile(withoutImports), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ studio = false, smartMode = false, hasFace = true, posProcessar, failAvatar = null, avatarCount = 1 } = {}) {
  const original = new Blob([new Uint8Array(80_000)], { type: 'video/mp4' });
  const edited = new Blob([new Uint8Array(90_000)], { type: 'video/mp4' });
  const progress = [], postCalls = [], warnings = [];
  const samples = new Float32Array(80);
  const context = vm.createContext({
    exports: {}, Blob, Uint8Array, Float32Array, ArrayBuffer, DataView,
    console: { log() {}, warn: (...args) => warnings.push(args), error() {} },
    // Todas as operações mockadas resolvem imediatamente. O watchdog nunca
    // precisa disparar e não deve manter o processo Node aberto por minutos.
    setTimeout() { return 1; }, clearTimeout() {},
    decodeAudioRobust: async () => ({ duration: 8, sampleRate: 10, length: 80, numberOfChannels: 1, getChannelData: () => samples }),
    detectSilences: () => [],
    detectFacePresence: async ({ segments }) => segments.map((segment, segmentIdx) => ({ ...segment, segmentIdx, hasAvatar: hasFace, reason: 'detected' })),
    isolateVoiceNeural: async () => ({ ok: true, vocalsBlob: original, elapsedMs: 1 }),
    isolateVoice: async () => original,
    extractAudio: async () => original,
    concatVideosFast: async () => original,
    concatAvatarParts: async () => original,
    overlaySegmentsOnVideo: async () => original,
    cutVideoSegments: async () => original,
    cancelFFmpeg() {},
    runFfmpegExclusive: async callback => callback(),
  });
  vm.runInContext(compiled, context, { filename: file });
  const dispatch = async ({ avaCode, label }) => {
    if (avaCode === failAvatar || label?.startsWith(`${failAvatar}_`)) throw new Error('generation failed');
    return original;
  };
  const input = {
    baseAdId: 'AD-TEST', adVideoBytes: original, smartMode,
    avatares: Array.from({ length: avatarCount }, (_, i) => ({ avaCode: `AVA0${i + 1}`, avatarId: `avatar-${i}`, avatarName: `Avatar ${i}` })),
    onProgress: value => progress.push(value),
    dispatchAudioTake: dispatch,
    ...(studio ? { dispatchAvatarStudio: dispatch } : {}),
    ...(posProcessar ? { posProcessar: async (blob, info) => {
      postCalls.push({ blob, info });
      return posProcessar({ blob, info, edited, call: postCalls.length });
    } } : {}),
  };
  return { run: () => context.exports.runVAPipeline(input), original, edited, progress, postCalls, warnings };
}

for (const hasFace of [true, false]) {
  const mode = hasFace ? 'Smart Mode com face' : 'Smart Mode sem face';
  test(`${mode}: full100 inválido não cai em fallback nem entrega original`, async () => {
    const error = Object.assign(new Error('StockFrame full100 incompleto'), { name: 'IncompleteStockFrameCoverageError' });
    const h = harness({ smartMode: true, hasFace, posProcessar: async () => { throw error; } });
    await assert.rejects(h.run(), actual => actual === error);
    assert.equal(h.postCalls.length, 1);
    assert.equal(h.progress.some(p => p.stage === 'done'), false);
    assert.equal(h.warnings.length, 0);
  });

  test(`${mode}: pós-produção válida chega ao resultado`, async () => {
    const h = harness({ smartMode: true, hasFace, posProcessar: async ({ edited }) => edited });
    const result = await h.run();
    assert.equal(result.items[0].blob, h.edited);
    assert.equal(result.items[0].filename, 'AD-TEST-AVA01-smart.mp4');
    assert.equal(h.progress.at(-1).stage, 'done');
  });

  test(`${mode}: sem pós-produção preserva saída original`, async () => {
    const h = harness({ smartMode: true, hasFace });
    const result = await h.run();
    assert.equal(result.items[0].blob, h.original);
    assert.equal(result.audioSegmentCount, hasFace ? 1 : 0);
  });
}

for (const studio of [false, true]) {
  const mode = studio ? 'Studio' : 'montagem local';

  test(`${mode}: full100 incompleto rejeita pipeline e nunca informa done`, async () => {
    const error = Object.assign(new Error('StockFrame 100% possui lacuna'), { name: 'IncompleteStockFrameCoverageError' });
    const h = harness({ studio, posProcessar: async () => { throw error; } });
    await assert.rejects(h.run(), actual => actual === error);
    assert.equal(h.postCalls.length, 1);
    assert.equal(h.progress.some(p => p.stage === 'done'), false);
    assert.equal(h.warnings.length, 0);
  });

  test(`${mode}: cobertura incompleta no segundo avatar impede entrega parcial`, async () => {
    const error = Object.assign(new Error('Segundo avatar com lacuna'), { name: 'IncompleteStockFrameCoverageError' });
    const h = harness({ studio, avatarCount: 2, posProcessar: async ({ edited, call }) => {
      if (call === 2) throw error;
      return edited;
    } });
    await assert.rejects(h.run(), actual => actual === error);
    assert.equal(h.postCalls.length, 2);
    assert.equal(h.progress.some(p => p.stage === 'done'), false);
  });

  test(`${mode}: pós-produção válida substitui os vídeos de todos os avatares`, async () => {
    const h = harness({ studio, avatarCount: 2, posProcessar: async ({ edited }) => edited });
    const result = await h.run();
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every(item => item.blob === h.edited));
    assert.deepEqual(h.postCalls.map(call => call.info.filename), ['AD-TEST-AVA01.mp4', 'AD-TEST-AVA02.mp4']);
    assert.ok(h.postCalls.every(call => call.info.partesSec === null));
    assert.equal(h.progress.at(-1).stage, 'done');
  });

  test(`${mode}: erro legado de legenda/zoom preserva original`, async () => {
    const h = harness({ studio, posProcessar: async () => { throw new Error('optional caption failed'); } });
    const result = await h.run();
    assert.equal(result.items[0].blob, h.original);
    assert.equal(h.warnings.length, 1);
    assert.equal(h.progress.at(-1).stage, 'done');
  });

  test(`${mode}: retorno nulo ou inválido preserva fallback legado`, async () => {
    for (const invalid of [null, new Blob(), new Blob([new Uint8Array(50_000)])]) {
      const h = harness({ studio, posProcessar: async () => invalid });
      const result = await h.run();
      assert.equal(result.items[0].blob, h.original);
    }
  });

  test(`${mode}: sem callback mantém comportamento e saída existentes`, async () => {
    const h = harness({ studio });
    const result = await h.run();
    assert.equal(result.items[0].blob, h.original);
    assert.equal(result.audioSegmentCount, 1);
    assert.equal(h.progress.at(-1).stage, 'done');
  });

  test(`${mode}: não pós-processa avatar cuja geração falhou`, async () => {
    const h = harness({ studio, avatarCount: 2, failAvatar: 'AVA01', posProcessar: async ({ edited }) => edited });
    const result = await h.run();
    assert.equal(result.items[0].blob, null);
    assert.match(result.items[0].error, /generation failed/);
    assert.equal(result.items[1].blob, h.edited);
    assert.equal(h.postCalls.length, 1);
    assert.equal(h.postCalls[0].info.filename, 'AD-TEST-AVA02.mp4');
  });
}
