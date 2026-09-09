// Executa as funções de PRODUÇÃO em VM, substituindo somente browser/rede.
// Nenhum POST real, crédito, projeto ou conta é usado por estes testes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function declarations(file, names) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found.set(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return [...found.values()].join('\n');
}

const source = declarations('extension/heygen-content.js', [
  'runEconomyJobApi', 'ecoExigirJobAtivo', 'ecoEsperarTakeApi', 'ecoPublicarCena', 'ecoAguardarEtapa', 'ecoRenderCenaResiliente',
  'ecoDraftEscreverCena', 'ecoIdsDaCena', 'ecoFaixaDaCena', 'ecoPctDaEspera',
  'ecoProgresso', 'ecoZerarProgresso',
]);
const clean = value => JSON.parse(JSON.stringify(value));
function harness(overrides = {}) {
  const calls = [], progress = [];
  let result;
  const wrapper = { text_draft: {
    visual: { layout: ['scene'], elements: {
      scene: { content: { elements: ['avatar'] } },
      avatar: { type: 'avatar', content: { engine: 'avatar_iv' } },
    } },
    script: { timeline: ['speech'], elements: { speech: { attributes: {} } } },
  }, metadata: {} };
  const ctx = vm.createContext({
    chrome: { runtime: { sendMessage: msg => calls.push(['checkpoint', clean(msg.cena)]) } },
    console: { log() {}, warn() {}, error() {} }, Date, Math, JSON,
    currentJob: null, ecoCancelado: false, ecoPctAtual: 0,
    podeAssumirJob: () => true, marcarBatimento() {},
    ecoLog() {}, ecoWarn() {},
    reportProgress: (_id, msg, pct) => progress.push({ msg, pct }),
    reportResult: (_id, raw) => { result = JSON.parse(raw.slice(9)); },
    reportError: (_id, erro) => { result = { cenas: [], erro, fatal: true }; },
    ecoContaAtual: async () => 'account', ecoBancadaGuardada: async () => 'bench',
    ecoBancadaServe: async () => true, ecoGuardarBancada: async () => {},
    ecoDraftLer: async () => ({ wrapper: clean(wrapper), title: 'Test' }),
    ecoQueimarFranquiaApi: async () => ({ queimadas: 0, restantes: 0, leu: true }),
    ecoFranquiaDePreview: async () => ({ restantes: 0 }),
    ecoAjustesDeVoz: () => ({}), ecoVozDaCena: () => 'voice',
    ecoGerarTts: async ({ texto }) => {
      calls.push(['tts', texto]);
      return { duracao: 2, url: 'https://test/audio.mp3', palavras: [], resumo: 'ok' };
    },
    ecoAplicarTtsNaCena() {},
    ecoRenderCenaApi: async ({ wrapper: draft }) => {
      const text = draft.text_draft.script.elements.speech.text;
      calls.push(['render', text]);
      assert.equal(draft.text_draft.visual.elements.avatar.content.engine, 'avatar_iii');
      return { ok: true, data: { video_url: `https://test/${text}.mp4` } };
    },
    ecoResumoDaResposta: () => 'ok', ecoUrlDaResposta: d => d?.video_url ?? null,
    sleep: async () => {},
  });
  vm.runInContext(source, ctx);
  Object.assign(ctx, typeof overrides === 'function' ? overrides(ctx, calls) : overrides);
  const payload = { avatarId: 'look', voiceId: 'voice', jobLabel: 'AD',
    cenas: Array.from({ length: 15 }, (_, i) => ({ idx: i * 2, texto: `take${i}`, label: `Take ${i}` })) };
  return { ctx, calls, progress, payload,
    async run() { await ctx.runEconomyJobApi('job', payload); return clean(result); } };
}

test('15 cenas: índices esparsos, URLs distintas, Avatar III e progresso monotônico', async () => {
  const h = harness(); const r = await h.run();
  assert.equal(r.cenas.length, 15);
  assert.deepEqual(r.cenas.map(c => c.idx), h.payload.cenas.map(c => c.idx));
  assert.equal(new Set(r.cenas.map(c => c.videoUrl)).size, 15);
  assert.equal(h.ctx.currentJob, null);
  assert.ok(h.progress.length > 30);
  assert.ok(h.progress.every((p, i) => !i || p.pct >= h.progress[i - 1].pct));
});

for (const kind of ['502', 'TTS', 'timeout']) {
  test(`${kind} na cena 3 preserva as prontas e tenta as outras 12`, async () => {
    const h = harness((ctx, calls) => {
      const render = ctx.ecoRenderCenaApi, tts = ctx.ecoGerarTts;
      return {
        ecoGerarTts: async args => kind === 'TTS' && args.texto === 'take2'
          ? { erro: 'TTS indisponível' } : tts(args),
        ecoRenderCenaApi: async args => {
          if (args.wrapper.text_draft.script.elements.speech.text !== 'take2') return render(args);
          calls.push(['render', 'take2']);
          return kind === '502' ? { ok: false, http: 502, msg: 'Bad Gateway' }
            : kind === 'timeout' ? { ok: true, data: { job_id: 'slow' } } : render(args);
        },
        ecoEsperarTakeApi: async () => null,
      };
    });
    const r = await h.run();
    assert.equal(r.cenas.filter(c => c.videoUrl).length, 14);
    assert.equal(r.cenas.find(c => c.idx === 4)?.error?.length > 0, true);
    assert.equal(r.cenas.at(-1).idx, 28);
    assert.equal(r.fatal, false);
    assert.match(r.erro, /1/);
    assert.ok(!h.progress.at(-1).msg.includes('15 cena(s) renderizada(s)'));
  });
}

test('marca d’água continua fatal e nunca entra no resultado', async () => {
  const h = harness(ctx => {
    const render = ctx.ecoRenderCenaApi;
    return { ecoRenderCenaApi: async args => args.wrapper.text_draft.script.elements.speech.text === 'take2'
      ? { ok: true, data: { video_url: 'https://test/take-marked-abc.mp4' } } : render(args) };
  });
  const r = await h.run();
  assert.equal(r.cenas.length, 2); assert.ok(r.erro); assert.equal(r.fatal, true);
});

for (const preempt of [false, true]) {
  test(`${preempt ? 'preempção' : 'cancelamento'} durante TTS impede novo POST`, async () => {
    const h = harness(ctx => {
      const tts = ctx.ecoGerarTts;
      return { ecoGerarTts: async args => {
        const r = await tts(args);
        if (args.texto === 'take2') {
          if (preempt) ctx.currentJob = 'new-job'; else ctx.ecoCancelado = true;
        }
        return r;
      } };
    });
    const r = await h.run();
    assert.equal(h.calls.filter(c => c[0] === 'render').length, 2);
    assert.equal(r.cenas.length, 2);
    assert.equal(h.ctx.currentJob, preempt ? 'new-job' : null);
  });
}

test('disparo antigo não libera slot novo nem aceita resposta tardia de render', async () => {
  const h = harness(ctx => ({ ecoRenderCenaApi: async () => {
    ctx.currentJob = 'new-job'; return { ok: true, data: { video_url: 'https://test/late.mp4' } };
  } }));
  const r = await h.run();
  assert.equal(h.ctx.currentJob, 'new-job'); assert.equal(r.cenas.length, 0);
});

test('cancelar durante sleep não dispara mais um poll', async () => {
  let polls = 0;
  const h = harness(ctx => ({ sleep: async () => { ctx.ecoCancelado = true; },
    ecoApiJson: async () => { polls++; return { ok: true, data: { video_url: 'https://test/late.mp4' } }; } }));
  h.ctx.currentJob = 'job';
  await assert.rejects(h.ctx.ecoEsperarTakeApi('bench', 10000, null, 'render'));
  assert.equal(polls, 0);
});

test('15 cenas: progresso emitido preserva frações durante render de 2 minutos', () => {
  const h = harness();
  const { inicio, largura } = h.ctx.ecoFaixaDaCena(0, 15);
  for (let ms = 4000; ms <= 120000; ms += 4000) {
    h.ctx.ecoProgresso('job', 'esperando', h.ctx.ecoPctDaEspera(inicio, largura, ms));
  }
  assert.ok(h.progress.every((p, i) => !i || p.pct > h.progress[i - 1].pct));
});

test('modo economia prepara o TTS seguinte durante o poll sem paralelizar renders', async () => {
  const tts = [], renders = [];
  let primeiraEspera = true;
  const h = harness({
    ecoGerarTts: async ({ texto }) => {
      tts.push(texto);
      return { duracao: 2, url: `https://test/${texto}.mp3`, palavras: [], resumo: 'ok' };
    },
    ecoRenderCenaApi: async ({ wrapper: draft }) => {
      const texto = draft.text_draft.script.elements.speech.text;
      renders.push(texto);
      return primeiraEspera
        ? { ok: true, data: { job_id: 'primeiro-render' } }
        : { ok: true, data: { video_url: `https://test/${texto}.mp4` } };
    },
    ecoEsperarTakeApi: async () => {
      // O segundo TTS ja nasceu, mas o segundo render ainda nao: esta e a
      // sobreposicao segura que encurta o caminho critico.
      assert.deepEqual(tts, ['take0', 'take1']);
      assert.deepEqual(renders, ['take0']);
      primeiraEspera = false;
      return 'https://test/take0.mp4';
    },
  });
  h.payload.cenas = h.payload.cenas.slice(0, 2).map((c, i) => ({ ...c, idx: i }));
  const r = await h.run();
  assert.equal(r.cenas.length, 2);
  assert.deepEqual(renders, ['take0', 'take1']);
});

function loadTs(file) {
  const ctx = vm.createContext({ exports: {}, console });
  vm.runInContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, ctx);
  return ctx.exports;
}
const economia = loadTs('lib/pilot-economia.ts');
const pageText = readFileSync('app/tools/clickup-pilot/page.tsx', 'utf8');
const pageAst = ts.createSourceFile('page.tsx', pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dispatchSource;
function findDispatch(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(pageAst) === 'dispararPeloStudio') {
    dispatchSource = `var dispatch = ${n.initializer.getText(pageAst)};`;
  }
  ts.forEachChild(n, findDispatch);
}
findDispatch(pageAst);
assert.ok(dispatchSource);
dispatchSource = ts.transpileModule(dispatchSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function pageHarness(gerar, shared = {}) {
  let states = { task: {} };
  const recorded = [];
  const ctx = vm.createContext({
    ...economia, console: { log() {}, warn() {} }, setTimeout, clearTimeout,
    minhasIdx: [0, 1, 2], taskId: 'task', adNameClean: 'AD', genId: 'gen', statusEconomia: {},
    plan: { parts: [0, 1, 2].map(i => ({ label: `take${i}`, text: `fala${i}`, avatarId: `look${i}`, voiceId: 'voz' })) },
    findAvatarOptionById: () => null,
    ecoFilaRef: shared.fila ?? { current: Promise.resolve() },
    ecoStatusRef: { current: {} }, batchCancelRef: shared.cancel ?? { current: {} },
    sleepUnthrottled: shared.sleep ?? (async () => {}),
    ...(shared.navigator ? { navigator: shared.navigator } : {}),
    setBatchStates: fn => { states = fn(states); },
    gerarPelaEconomia: gerar,
    registrarResultado: r => recorded.push(r),
  });
  vm.runInContext(dispatchSource, ctx);
  return { ctx, recorded, run: () => ctx.dispatch() };
}

test('página continua outros avatares após erro local e publica URLs para dedup', async () => {
  const seen = [];
  const h = pageHarness(async p => {
    seen.push(p.avatarId);
    return p.avatarId === 'look0'
      ? { cenas: [{ idx: 0, error: '502' }], erro: '1 falha', fatal: false }
      : { cenas: p.cenas.map(c => ({ idx: c.idx, videoUrl: `https://test/${c.idx}.mp4` })) };
  });
  const r = await h.run();
  assert.deepEqual(seen, ['look0', 'look1', 'look2']);
  assert.equal(r.filter(c => c.videoId).length, 2);
  assert.equal(h.ctx.ecoStatusRef.current['eco:gen:2'].videoUrl, 'https://test/2.mp4');
});

for (const kind of ['fatal', 'legacy', 'transport']) {
  test(`página para e libera fila em erro ${kind}`, async () => {
    let calls = 0;
    const h = pageHarness(async () => {
      calls++;
      if (kind === 'transport') throw new Error('ACK ausente');
      return { cenas: [], erro: 'parar', ...(kind === 'fatal' ? { fatal: true } : {}) };
    });
    await h.run();
    assert.equal(calls, 1);
    await h.ctx.ecoFilaRef.current;
  });
}

test('duas tasks serializam o Studio e cancelada na fila não dispara', async () => {
  let release, start;
  const running = new Promise(r => { start = r; });
  const barrier = new Promise(r => { release = r; });
  const shared = { fila: { current: Promise.resolve() } };
  const a = pageHarness(async p => {
    start(); await barrier;
    return { cenas: p.cenas.map(c => ({ idx: c.idx, videoUrl: 'https://test/a.mp4' })) };
  }, shared);
  let callsB = 0;
  const cancel = { current: {} };
  const b = pageHarness(async () => { callsB++; return { cenas: [] }; }, { ...shared, cancel });
  const pa = a.run(); await running;
  const pb = b.run(); await Promise.resolve();
  assert.equal(callsB, 0);
  cancel.current.task = true;
  release(); await Promise.all([pa, pb]);
  assert.equal(callsB, 0); await shared.fila.current;
});

test('bancada ocupada espera e repete o MESMO AD em vez de falhar e promover o proximo', async () => {
  let calls = 0, waits = 0;
  const h = pageHarness(async p => {
    calls++;
    if (calls === 1) return { cenas: [], erro: 'Outra geração em andamento — aguarde finalizar.', fatal: true };
    return { cenas: p.cenas.map(c => ({ idx: c.idx, videoUrl: `https://test/${c.idx}.mp4` })) };
  }, { sleep: async () => { waits++; } });
  const r = await h.run();
  // Três avatares = três projetos; o primeiro recebe BUSY e repete.
  assert.equal(calls, 4);
  assert.equal(waits, 1);
  assert.equal(r.filter(x => x.videoId).length, 3);
  assert.equal(r.every(x => x.error === null), true);
});

test('lock do navegador protege a bancada entre abas durante o projeto inteiro', async () => {
  const locks = [];
  const navigator = { locks: { request: async (name, options, fn) => {
    locks.push([name, options.mode]);
    return fn();
  } } };
  const h = pageHarness(async p => ({
    cenas: p.cenas.map(c => ({ idx: c.idx, videoUrl: `https://test/${c.idx}.mp4` })),
  }), { navigator });
  await h.run();
  assert.deepEqual(locks, [['autoedit:heygen-economia:studio', 'exclusive']]);
});

test('ponte transmite erro parcial sem perder o sinal fatal:false', async () => {
  const listeners = [], sent = [];
  const ctx = vm.createContext({ exports: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { addEventListener: (_event, fn) => listeners.push(fn), postMessage: msg => sent.push(msg) } });
  vm.runInContext(ts.transpileModule(readFileSync('lib/heygen-extension-bridge.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, ctx);
  const promise = ctx.exports.gerarPelaEconomia({ cenas: [{ idx: 1, texto: 'test' }], avatarId: 'look' });
  const requestId = sent[0].requestId;
  for (const fn of listeners) fn({ data: { source: 'darkolab-ext', requestId, type: 'HG_RESULT',
    videoUrl: 'ECONOMIA:' + JSON.stringify({ cenas: [{ idx: 1, error: '502' }], erro: '1 falha', fatal: false }) } });
  const r = await promise;
  assert.equal(r.fatal, false); assert.equal(r.cenas[0].error, '502');
});

for (const ending of ['error', 'timeout', 'result', 'malformed']) {
  test(`ponte preserva checkpoints em ${ending} e ignora outro disparo/índice`, async () => {
    const listeners = [], sent = [];
    const ctx = vm.createContext({ exports: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
      window: { addEventListener: (_event, fn) => listeners.push(fn), postMessage: msg => sent.push(msg) } });
    vm.runInContext(ts.transpileModule(readFileSync('lib/heygen-extension-bridge.ts', 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, ctx);
    const promise = ctx.exports.gerarPelaEconomia({ cenas: [{ idx: 2, texto: 'test' }], avatarId: 'look' }, undefined,
      { ackMs: 1000, tetoJobMs: 20 });
    const requestId = sent[0].requestId;
    const emit = data => listeners.forEach(fn => fn({ data: { source: 'darkolab-ext', requestId, ...data } }));
    emit({ type: 'HG_ECONOMY_ACK' });
    emit({ type: 'HG_ECONOMY_SCENE', cena: { idx: 2, videoUrl: 'https://test/good.mp4' } });
    emit({ type: 'HG_ECONOMY_SCENE', cena: { idx: 9, videoUrl: 'https://test/wrong-index.mp4' } });
    emit({ requestId: 'other', type: 'HG_ECONOMY_SCENE', cena: { idx: 2, videoUrl: 'https://test/wrong-job.mp4' } });
    if (ending === 'error') emit({ type: 'HG_ERROR', error: 'Cancelado pelo usuario.' });
    if (ending === 'result') emit({ type: 'HG_RESULT', videoUrl: 'ECONOMIA:{"cenas":[],"erro":"interrompido","fatal":true}' });
    if (ending === 'malformed') emit({ type: 'HG_RESULT', videoUrl: 'ECONOMIA:{' });
    const r = await promise;
    assert.deepEqual(clean(r.cenas), [{ idx: 2, videoUrl: 'https://test/good.mp4' }]);
    assert.equal(r.fatal, true); assert.ok(r.erro);
    if (ending === 'timeout') assert.ok(sent.some(m => m.type === 'HG_CANCEL'));
  });
}

test('card mantém frações na largura e ignora progresso antigo quando em fila', () => {
  const text = readFileSync('components/BatchJobCard3D.tsx', 'utf8');
  const start = text.indexOf('  const dispatchPct =');
  const end = text.indexOf('\n\n', text.indexOf('  const barPct =', start));
  assert.ok(start > 0 && end > start);
  const code = text.slice(start, end) + '\nbarPct;';
  assert.equal(vm.runInNewContext(code, { partsTotal: 15, partsDispatched: 0, partsRendered: 0, phase: 'rendering', progressoMotor: 8.123 }), 8.123);
  assert.equal(vm.runInNewContext(code, { partsTotal: 15, partsDispatched: 0, partsRendered: 0, phase: 'queued', progressoMotor: 88 }), 3);
});

test('pós-processo cancela timers vencidos e expõe progresso real por take', () => {
  const pipeline = readFileSync('lib/clickup-pilot-pipeline.ts', 'utf8');
  assert.match(pipeline, /Promise\.race\(\[p, timeout\]\)\.finally/);
  assert.match(pipeline, /clearTimeout\(timer\)/);
  assert.match(pipeline, /detail: `take \$\{i \+ 1\}\/\$\{blobs\.length\}/);
  assert.match(pipeline, /durSec \* 4_000 \+ 60_000/);

  const card = readFileSync('components/BatchJobCard3D.tsx', 'utf8');
  assert.match(card, /\/regulando\/i\.test\(message \|\| ''\)/);
  assert.match(card, /'REGULANDO VOZ'/);

  const page = readFileSync('app/tools/clickup-pilot/page.tsx', 'utf8');
  assert.match(page, /minEconomia = '4\.40\.0'/);
  assert.match(page, /p\.detail \? ` · \$\{p\.detail\}`/);
  // Retomar economia nunca pode apagar o unico cache dos ids sinteticos nem
  // mandar `eco:*` ao porteiro da API. Se o cache sumiu, recupera apenas as
  // cenas faltantes pelo mesmo Studio sem credito.
  assert.match(page, /legadoEconomiaComIdSintetico/);
  assert.match(page, /preservando o cache legado/);
  assert.match(page, /economiaNoResume[\s\S]*Recuperando \$\{candidateIdxs\.length\} take\(s\) faltante\(s\) pelo Studio/);
  assert.match(page, /planejarEconomia\(partesEco, \{ indicesDoPlano: redispatchIdxs \}\)/);
  assert.doesNotMatch(page, /Modo economia ligado: \$\{jobsToRedispatch\.length\} take\(s\) não foram re-disparados/);
  assert.match(page, /state\.parts\[cena\.idx\] = \{/);
  assert.match(page, /idDaCena\(cena, genId\)[\s\S]*state\.parts\[cena\.idx\]\?\.videoId[\s\S]*idSinteticoDaCena\(cena\.idx, genId\)/);
  assert.match(page, /Causa: \$\{String\(erros\[0\]\)/);
  assert.match(page, /const economySceneFailure = !!b\.economia/);
  assert.match(page, /if \(economySceneFailure\) continue/);

  const extension = readFileSync('extension/heygen-content.js', 'utf8');
  assert.match(extension, /falha sistemica do HeyGen/);
});

function backgroundHarness() {
  const source = readFileSync('extension/background.js', 'utf8');
  const ast = ts.createSourceFile('background.js', source, ts.ScriptTarget.Latest, true);
  let listener;
  function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === 'chrome.runtime.onMessage.addListener') listener = n.arguments[0].getText(ast);
    ts.forEachChild(n, visit);
  }
  visit(ast); assert.ok(listener);
  const reports = [], sends = [], timers = new Map();
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, activeJobs: new Map(), ecoMedirMarcaDagua: false,
    setTimeout: (fn, ms) => { const id = timers.size + 1; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    reportToPage: (...args) => reports.push(args),
    findOrCreateHeyGenTab: async () => ({ id: 7, url: 'https://app.heygen.com/avatar' }),
    chrome: { tabs: { sendMessage: async (...args) => sends.push(args),
      get: async () => ({ url: 'https://app.heygen.com/avatar' }) } },
  });
  vm.runInContext('var listener = ' + listener + ';\n' + declarations('extension/background.js', ['handleStudioGenerate']), ctx);
  return { ctx, reports, sends, timers,
    emit: msg => ctx.listener(msg, { tab: { id: 7 } }, () => {}) };
}

test('background aguarda confirmação de cancelamento antes de liberar a fila', async () => {
  const h = backgroundHarness();
  h.ctx.activeJobs.set('job', { tabId: 7, bridgeTabId: 4, economiaApi: true, dispatched: true });
  h.emit({ type: 'HG_CANCEL', requestId: 'job' });
  h.emit({ type: 'HG_CANCEL', requestId: 'job' });
  assert.equal(h.reports.length, 0);
  assert.equal(h.ctx.activeJobs.size, 1); assert.equal(h.timers.size, 1);
  h.emit({ type: 'HG_TAB_ECONOMY_SCENE', requestId: 'job', cena: { idx: 2, videoUrl: 'https://test/a.mp4' } });
  assert.equal(h.reports.at(-1)[2], 'HG_ECONOMY_SCENE');
  h.emit({ type: 'HG_TAB_RESULT', requestId: 'job', videoUrl: 'ECONOMIA:{"cenas":[]}' });
  assert.equal(h.ctx.activeJobs.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.reports.at(-1)[2], 'HG_RESULT');
});

test('background mantém cancelamento antigo e tem teto quando economia não responde', () => {
  const h = backgroundHarness();
  h.ctx.activeJobs.set('normal', { tabId: 7, bridgeTabId: 4 });
  h.emit({ type: 'HG_CANCEL', requestId: 'normal' });
  assert.equal(h.ctx.activeJobs.size, 0); assert.equal(h.reports.at(-1)[2], 'HG_ERROR');
  h.ctx.activeJobs.set('eco', { tabId: 7, bridgeTabId: 4, economiaApi: true, dispatched: true });
  h.emit({ type: 'HG_CANCEL', requestId: 'eco' });
  const timer = [...h.timers.values()][0]; assert.equal(timer.ms, 90000); timer.fn();
  assert.equal(h.ctx.activeJobs.size, 0); assert.match(h.reports.at(-1)[3].error, /90s/);
});

test('cancelar enquanto abre a aba impede geração tardia', async () => {
  const h = backgroundHarness(); let release;
  h.ctx.findOrCreateHeyGenTab = () => new Promise(r => { release = r; });
  const job = h.ctx.handleStudioGenerate('job', { avatarId: 'look' }, 4, 'HG_RUN_ECONOMY_API');
  h.emit({ type: 'HG_CANCEL', requestId: 'job' });
  release({ id: 7, url: 'https://app.heygen.com/avatar' }); await job;
  assert.equal(h.sends.length, 0); assert.equal(h.ctx.activeJobs.size, 0);
});

test('preempção durante preparo impede a queima e preserva o slot novo', async () => {
  let burns = 0;
  const h = harness(ctx => ({
    ecoDraftLer: async () => { ctx.currentJob = 'new-job'; return { wrapper: {} }; },
    ecoQueimarFranquiaApi: async () => { burns++; return {}; },
  }));
  const r = await h.run();
  assert.equal(burns, 0); assert.equal(h.ctx.currentJob, 'new-job'); assert.ok(r.erro);
});

test('falhas transitórias de poll também emitem progresso e erro permanente não gira', async () => {
  let polls = 0, ticks = 0;
  const h = harness({ ecoApiJson: async () => ++polls < 3 ? { ok: false, http: 502 }
    : { ok: true, data: { video_url: 'https://test/ready.mp4' } } });
  h.ctx.currentJob = 'job';
  const url = await h.ctx.ecoEsperarTakeApi('bench', 10000, () => ticks++, 'render');
  assert.equal(url, 'https://test/ready.mp4'); assert.equal(ticks, 3);
  polls = 0; h.ctx.ecoApiJson = async () => { polls++; return { ok: false, http: 403 }; };
  await assert.rejects(h.ctx.ecoEsperarTakeApi('bench', 10000, null, 'render'));
  assert.equal(polls, 1);
});

test('finalizers dos quatro caminhos não limpam slot, buffer ou debugger de outro job', async () => {
  const source = readFileSync('extension/heygen-content.js', 'utf8');
  const ast = ts.createSourceFile('content.js', source, ts.ScriptTarget.Latest, true);
  const functions = new Map();
  function visit(n) {
    if (ts.isFunctionDeclaration(n) && n.name && ['runJob', 'runStudioJob', 'runEconomyJob', 'runEconomyJobApi'].includes(n.name.text)) functions.set(n.name.text, n);
    ts.forEachChild(n, visit);
  }
  visit(ast); assert.equal(functions.size, 4);
  for (const [name, n] of functions) {
    const blocks = n.body.statements.filter(ts.isTryStatement).filter(t => t.finallyBlock);
    assert.ok(blocks.length, name);
    let detached = false;
    const ctx = vm.createContext({ currentJob: 'new', requestId: 'old', interceptedVideoIds: [1, 2], marcaBuffer: 0,
      cdpDetachBg: async () => { detached = true; } });
    await vm.runInContext('(async () => ' + blocks.at(-1).finallyBlock.getText(ast) + ')()', ctx);
    assert.equal(ctx.currentJob, 'new', name);
    assert.equal(ctx.interceptedVideoIds.length, 2, name); assert.equal(detached, false, name);
  }
});

test('ponte mantém resultado antigo que só tem videoId', async () => {
  const listeners = [], sent = [];
  const ctx = vm.createContext({ exports: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { addEventListener: (_event, fn) => listeners.push(fn), postMessage: msg => sent.push(msg) } });
  vm.runInContext(ts.transpileModule(readFileSync('lib/heygen-extension-bridge.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, ctx);
  const pending = ctx.exports.gerarPelaEconomia({ cenas: [{ idx: 0, texto: 'test' }], avatarId: 'look' });
  listeners.forEach(fn => fn({ data: { source: 'darkolab-ext', requestId: sent[0].requestId, type: 'HG_RESULT',
    videoUrl: 'ECONOMIA:{"cenas":[{"idx":0,"videoId":"legacy-id"}]}' } }));
  assert.equal((await pending).cenas[0].videoId, 'legacy-id');
});

test('ponte publica a cena pronta imediatamente e nao duplica a previa no resultado final', async () => {
  const listeners = [], sent = [], prontas = [];
  const ctx = vm.createContext({ exports: {}, console, setTimeout, clearTimeout, setInterval, clearInterval,
    window: { addEventListener: (_event, fn) => listeners.push(fn), postMessage: msg => sent.push(msg) } });
  vm.runInContext(ts.transpileModule(readFileSync('lib/heygen-extension-bridge.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, ctx);
  const pending = ctx.exports.gerarPelaEconomia(
    { cenas: [{ idx: 0, texto: 'test' }], avatarId: 'look' },
    undefined,
    { onScene: cena => prontas.push(clean(cena)) },
  );
  const requestId = sent[0].requestId;
  const emit = data => listeners.forEach(fn => fn({ data: { source: 'darkolab-ext', requestId, ...data } }));
  const cena = { idx: 0, videoUrl: 'https://test/live.mp4' };
  emit({ type: 'HG_ECONOMY_SCENE', cena });
  assert.deepEqual(prontas, [cena]);
  emit({ type: 'HG_RESULT', videoUrl: `ECONOMIA:${JSON.stringify({ cenas: [cena] })}` });
  assert.deepEqual(clean((await pending).cenas), [cena]);
  assert.deepEqual(prontas, [cena]);
});

test('TTS lento recebe pulsos sem invadir etapa seguinte nem atrasar conclusão', async () => {
  let tick, finish, now = 0;
  const h = harness({ sleep: () => new Promise(r => { tick = r; }), Date: { now: () => now } });
  h.ctx.currentJob = 'job';
  const pending = h.ctx.ecoAguardarEtapa('job', () => new Promise(r => { finish = r; }), 'TTS', 10, 20);
  for (let i = 0; i < 3; i++) { now += 4000; tick(); await new Promise(setImmediate); }
  assert.equal(h.progress.length, 3);
  assert.ok(h.progress.every((p, i) => p.pct > 10 && p.pct < 20 && (!i || p.pct > h.progress[i - 1].pct)));
  finish('audio pronto'); assert.equal(await pending, 'audio pronto');
  tick(); await new Promise(setImmediate); assert.equal(h.progress.length, 3);
});

for (const http of [0, 502, 403]) {
  test(`render HTTP ${http}: retentativa limitada e reutiliza exatamente a fala e o draft`, async () => {
    let calls = 0, firstArgs;
    const h = harness({ ecoRenderCenaApi: async args => {
      calls++;
      if (calls === 1) { firstArgs = args; return { ok: false, http }; }
      assert.equal(args, firstArgs);
      return { ok: true, data: { video_url: 'https://test/recovered.mp4' } };
    } });
    h.ctx.currentJob = 'job';
    const r = await h.ctx.ecoRenderCenaResiliente('job', { wrapper: {}, videoId: 'bench' });
    assert.equal(calls, http === 403 ? 1 : 2);
    assert.equal(r.ok, http !== 403);
  });
}

test('cancelamento no intervalo da retentativa impede outro POST', async () => {
  let calls = 0;
  const h = harness(ctx => ({ ecoRenderCenaApi: async () => { calls++; return { ok: false, http: 502 }; },
    sleep: async () => { ctx.ecoCancelado = true; } }));
  h.ctx.currentJob = 'job';
  await assert.rejects(h.ctx.ecoRenderCenaResiliente('job', {}));
  assert.equal(calls, 1);
});
