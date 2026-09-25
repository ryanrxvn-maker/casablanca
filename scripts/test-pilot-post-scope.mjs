// Executa código de produção; só mídia/ffmpeg/React são substituídos.
// Nada é baixado, renderizado ou enviado a serviços externos.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const clean = value => JSON.parse(JSON.stringify(value));
const silent = { log() {}, warn() {}, error() {} };
const render = () => new Blob([new Uint8Array(120_000)], { type: 'video/mp4' });
function loadTs(file, mocks = {}, globals = {}, source = readFileSync(file, 'utf8')) {
  const exports = {};
  const context = vm.createContext({ exports, Blob, Uint8Array, DataView, console: silent,
    setTimeout, clearTimeout, ...globals,
    require(name) {
      assert.ok(name in mocks, `Dependência não mockada: ${name}`);
      return mocks[name];
    },
  });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { exports, context };
}
const scopes = loadTs('lib/pilot-post-scope.ts').exports;
const inserts = loadTs('lib/pilot-inserts.ts').exports;
const copy = [
  { label: 'HOOK 1', text: 'joelho com dor' },
  { label: 'HOOK 2', text: 'caminhar sem dor' },
  { label: 'BODY 1', text: 'receita de mel' },
  { label: 'BODY 2', text: 'rotina mais leve' },
];
const stocks = copy.map((parte, index) => ({
  id: `stock-${index}`, ancora: parte.label, palavraDe: 0, palavraAte: 2,
  source: 'stockframe', layout: { tipo: 'cheia' },
  stockFrame: { videoId: `v-${index}`, smart: true, coverage: 100, title: parte.text },
}));

test('cada vídeo recebe só seu hook, body em ordem real e 100% íntegro', () => {
  for (const hook of ['HOOK 1', 'HOOK 2']) {
    const labels = [hook, 'BODY 2', 'BODY 1'];
    const scope = scopes.escopoDaPosProducao(copy, stocks, labels);
    assert.deepEqual(clean(scope.partes).map(p => p.label), labels);
    assert.deepEqual(clean(scope.inserts).map(i => i.ancora).sort(), [...labels].sort());
    assert.equal(inserts.planoSmartStockFrameCompleto(scope.inserts, scope.partes), true);
  }
  assert.equal(stocks.length, 4, 'não modifica a coleção da task');
});

test('órfãos verdadeiros e body ausente não somem para fazer 100% passar', () => {
  const orfao = { ...stocks[0], id: 'orphan', ancora: 'HOOK 99' };
  const scope = scopes.escopoDaPosProducao(copy, [...stocks, orfao], ['HOOK 1', 'BODY 1']);
  assert.ok(scope.inserts.some(i => i.id === 'orphan'));
  assert.ok(scope.inserts.some(i => i.ancora === 'BODY 2'));
  assert.equal(inserts.planoSmartStockFrameCompleto(scope.inserts, scope.partes), false);
  assert.deepEqual(clean(scopes.escopoDaPosProducao(copy, stocks, ['HOOK 99']).labelsDesconhecidas), ['HOOK 99']);
});

test('caller legado sem labels mantém todas partes/inserts; labels duplicadas não passam', () => {
  assert.deepEqual(clean(scopes.escopoDaPosProducao(copy, stocks)), { partes: copy, inserts: stocks, labelsDesconhecidas: [] });
  const scope = scopes.escopoDaPosProducao(copy, stocks, ['HOOK 1', 'HOOK 1', 'BODY 1', 'BODY 2']);
  assert.equal(inserts.planoSmartStockFrameCompleto(scope.inserts, scope.partes), false);
});

test('copy da variante: replan própria → análise própria → replan mãe → análise mãe', () => {
  for (let winner = 0; winner < 4; winner++) {
    const sources = Array.from({ length: 4 }, (_, i) => i < winner ? [] : [{ label: 'BODY 1', text: `fonte ${i}` }]);
    assert.equal(scopes.copyDaPosProducao(sources)[0].text, `fonte ${winner}`);
  }
});

function pageHarness({ taskCopy = copy, parentCopy, activeStocks = stocks, avisos = [], orfaos = [], exigirCompleta = false } = {}) {
  const source = readFileSync('app/tools/clickup-pilot/page.tsx', 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let functionSource;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'fazerPosProcessar') functionSource = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(functionSource);
  const rendered = [];
  const ref = value => ({ current: value });
  const { context } = loadTs('page.tsx', {
    '@/lib/pilot-pos-producao-run': { montarPosProducao: async (_blob, info, cfg) => {
      rendered.push({ info, cfg }); return { blob: render(), avisos, insertsOrfaos: orfaos };
    } },
    '@/lib/pilot-pos-producao': { semOQueFoiPedido: () => '' },
    '@/lib/idioma': { idiomaDaCopy: () => 'pt' },
  }, {
    ...scopes, planoSmartStockFrameCompleto: inserts.planoSmartStockFrameCompleto,
    taskIdBaseDaVersao: () => 'mother',
    legendaCfgsRef: ref({}), zoomCfgsRef: ref({}), headlineRef: ref({}), captionTemplatesRef: ref([]),
    CHAVE_PADRAO: 'default', LEGENDA_CFG_DEFAULT: { on: false }, ZOOM_CFG_DEFAULT: { on: false }, HEADLINE_CFG_DEFAULT: { on: false },
    insertsDaMontagem: () => activeStocks,
    batchStatesRef: ref({ task: { replan: { parts: taskCopy } }, mother: { replan: { parts: parentCopy } } }),
    taskAnalysesRef: ref({}),
    setBatchStates() {}, setPosResultado() {},
  }, functionSource);
  return { rendered, run: context.fazerPosProcessar('task', { exigirCompleta }) };
}

for (const hook of ['HOOK 1', 'HOOK 2']) {
  test(`callback real: ${hook} não recebe take nem copy do hook alternativo`, async () => {
    const h = pageHarness();
    await h.run(render(), { filename: `${hook}.mp4`, partesSec: [3, 3, 3], partLabels: [hook, 'BODY 1', 'BODY 2'] });
    assert.equal(h.rendered.length, 1);
    const { cfg } = h.rendered[0];
    assert.deepEqual(clean(cfg.partes).map(p => p.label), [hook, 'BODY 1', 'BODY 2']);
    assert.deepEqual(clean(cfg.inserts).map(p => p.ancora), [hook, 'BODY 1', 'BODY 2']);
  });
}

test('callback real: variante sem copy própria herda replan da mãe', async () => {
  const inherited = pageHarness({ taskCopy: [], parentCopy: copy });
  await inherited.run(render(), { filename: 'V2.mp4', partesSec: null, partLabels: ['HOOK 2', 'BODY 1', 'BODY 2'] });
  assert.equal(inherited.rendered[0].cfg.partes[0].text, copy[1].text);
});

test('callback real: intent full100 sobrevive se só havia stocks de outro hook', async () => {
  const h = pageHarness({ activeStocks: [stocks[1]] });
  await assert.rejects(h.run(render(), { filename: 'G1.mp4', partesSec: null, partLabels: ['HOOK 1', 'BODY 1', 'BODY 2'] }), { name: 'IncompleteStockFrameCoverageError' });
  assert.equal(h.rendered.length, 0);
});

test('callback real: órfão desconhecido é fatal antes do render', async () => {
  const h = pageHarness({ activeStocks: [...stocks, { ...stocks[0], id: 'orfao', ancora: 'HOOK 99' }] });
  await assert.rejects(h.run(render(), { filename: 'G1.mp4', partesSec: null, partLabels: ['HOOK 1', 'BODY 1', 'BODY 2'] }), { name: 'IncompleteStockFrameCoverageError' });
  assert.equal(h.rendered.length, 0);
});

test('callback real: mídia ausente depois do render mantém erro obrigatório no cache', async () => {
  const h = pageHarness({ orfaos: ['stock-0'], exigirCompleta: true });
  await assert.rejects(h.run(render(), { filename: 'G1.mp4', partesSec: null, partLabels: ['HOOK 1', 'BODY 1', 'BODY 2'] }), { name: 'IncompleteStockFrameCoverageError' });
});

function pipeline() {
  const ffmpeg = { concatVideosFast: async () => render(), cancelFFmpeg() {}, normalizeForConcat: async blob => blob };
  return loadTs('lib/clickup-pilot-pipeline.ts', {
    './audio-engine': {}, './speech-detect': {}, './ffmpeg-worker': ffmpeg, './camuflagem': {},
    './video-duracao': { duracaoDeVideo: async () => 3 },
    './pilot-formato': loadTs('lib/pilot-formato.ts').exports,
  }).exports.runPostPipeline;
}
const input = { baseAdId: 'AD99GL', parts: copy.map(p => ({ label: p.label, blob: render(), expected: true })),
  decupagem: false, nivelarVoz: false, camuflagem: false };
function coverageError() { const error = new Error('cobertura incompleta'); error.name = 'IncompleteStockFrameCoverageError'; return error; }

test('pipeline real propaga labels dos blobs e protege lista original de mutação', async () => {
  const labels = [];
  const result = await pipeline()({ ...input, posProcessar: async (_blob, info) => {
    labels.push([...info.partLabels]); info.partLabels.push('MUTATION'); return render();
  } });
  assert.deepEqual(labels.map(clean), [['HOOK 1', 'BODY 1', 'BODY 2'], ['HOOK 2', 'BODY 1', 'BODY 2']]);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(item => !item._partLabels.includes('MUTATION')));
});

for (const retry of [false, true]) {
  test(`pipeline real nunca engole full100 no ${retry ? 'segundo' : 'primeiro'} catch`, async () => {
    let calls = 0;
    const seen = [];
    await assert.rejects(pipeline()({ ...input, posProcessar: async (_blob, info) => {
      seen.push([...info.partLabels]); calls++;
      if (retry && calls === 1) { info.partLabels.push('MUTATION'); throw new Error('ffmpeg terminated'); }
      throw coverageError();
    } }), { name: 'IncompleteStockFrameCoverageError' });
    assert.equal(calls, retry ? 2 : 1);
    assert.ok(seen.every(labels => !labels.includes('MUTATION')));
  });
}

test('pós-produção opcional continua fallback; não regride comportamento sem full100', async () => {
  const result = await pipeline()({ ...input, posProcessar: async () => { throw new Error('legenda indisponível'); } });
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every(item => item.rawAssembled.size > 0 && item.errors?.posproducao));
});
