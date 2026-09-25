// GARANTIA do FORMATO (9:16 × 16:9) nas funções de PRODUÇÃO do Pilot.
//
// Roda o runner do HeyGen (lib/heygen-job-runner.ts) e o pipeline de montagem
// (lib/clickup-pilot-pipeline.ts) de verdade, trocando SÓ as bordas externas:
// o submit do HeyGen (processJob) e o ffmpeg-wasm. Nenhuma chamada real, nenhum
// crédito. O que se confere é o que ESTARIA indo pro HeyGen e pro ffmpeg.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const OUT = join('.test-tmp', 'esm', 'formato');
mkdirSync(OUT, { recursive: true });

/** Bundla `entry` trocando os módulos de `stubs` (nome → código). */
async function bundle(entry, name, stubs) {
  const outfile = resolve(OUT, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
    plugins: [{
      name: 'stubs',
      setup(b) {
        for (const [mod, code] of Object.entries(stubs)) {
          const filter = new RegExp(`^\\./${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
          b.onResolve({ filter }, () => ({ path: mod, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
        }
      },
    }],
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

// ─── RUNNER ────────────────────────────────────────────────────────────────
function opts(extra = {}) {
  return {
    parallel: 3, mode: 'copy', avatarId: 'av', motor: 'III', adNameSafe: 'AD01',
    isCancelled: () => false, onProgress: () => {}, onResult: () => {}, ...extra,
  };
}
const jobs = [
  { label: 'HOOK', copy: 'oi', avatarId: 'a1', voiceId: 'v1' },
  { label: 'BODY 1', copy: 'tudo bem', avatarId: 'a1', voiceId: 'v1', motionPrompt: 'acena' },
  { label: 'BODY 2', audio: new File([new Uint8Array(10)], 'x.mp3'), avatarId: 'a2', voiceId: 'v2', voiceMirroring: true },
];

// O stub anota cada submit num array global — é o payload que iria pro HeyGen.
async function rodar(extra) {
  const vistos = [];
  const bundled = await bundle('lib/heygen-job-runner.ts', `runner-${Math.random().toString(36).slice(2)}`, {
    'heygen-api-direct': `
      export async function processJob(input) { globalThis.__formatoVistos.push(input); return { videoId: 'vid_' + globalThis.__formatoVistos.length }; }
      export function isQuotaError() { return false; }
    `,
  });
  globalThis.__formatoVistos = vistos;
  const res = await bundled.runHeyGenJobs(jobs, opts(extra));
  return { vistos, res };
}

test('runner: sem formato → portrait em TODOS os takes (o de sempre)', async () => {
  const { vistos, res } = await rodar({});
  assert.equal(vistos.length, 3);
  for (const v of vistos) assert.equal(v.orientation, 'portrait');
  assert.equal(res.filter((r) => r.videoId).length, 3);
});

test('runner: portrait explícito → portrait', async () => {
  const { vistos } = await rodar({ orientation: 'portrait' });
  for (const v of vistos) assert.equal(v.orientation, 'portrait');
});

test('runner: landscape → landscape em texto, gesto (IV) e áudio/espelho', async () => {
  const { vistos, res } = await rodar({ orientation: 'landscape' });
  assert.equal(vistos.length, 3);
  for (const v of vistos) assert.equal(v.orientation, 'landscape');
  // o resto do job segue intacto
  const porTitulo = Object.fromEntries(vistos.map((v) => [v.title, v]));
  assert.equal(porTitulo['AD01_HOOK'].text, 'oi');
  assert.equal(porTitulo['AD01_HOOK'].engine, 'iii');
  assert.equal(porTitulo['AD01_BODY 1'].engine, 'iv', 'gesto continua subindo pro IV');
  assert.equal(porTitulo['AD01_BODY 1'].motionPrompt, 'acena');
  assert.ok(porTitulo['AD01_BODY 2'].file, 'take de áudio continua em modo áudio');
  assert.equal(porTitulo['AD01_BODY 2'].voiceMirroring, true);
  assert.equal(res.filter((r) => r.videoId).length, 3);
});

test('runner: valor estranho em orientation cai em portrait', async () => {
  const { vistos } = await rodar({ orientation: 'square' });
  for (const v of vistos) assert.equal(v.orientation, 'portrait');
});

test('runner: modo imagem manda aspectRatio do formato', async () => {
  const bundled = await bundle('lib/heygen-job-runner.ts', 'runner-img', {
    'heygen-api-direct': `
      export async function processJob() { throw new Error('nao deveria chamar processJob no modo imagem'); }
      export function isQuotaError() { return false; }
    `,
  });
  const enviados = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('data:')) return fetchOriginal(url);
    enviados.push(init.body.get('aspectRatio'));
    return new Response(JSON.stringify({ videoId: 'img_' + enviados.length }), { status: 200 });
  };
  try {
    const img = [{ label: 'CENA', copy: 'fala', voiceId: 'v1', imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQ' }];
    await bundled.runHeyGenJobs(img, opts({}));
    await bundled.runHeyGenJobs(img, opts({ orientation: 'landscape' }));
    await bundled.runHeyGenJobs(img, opts({ orientation: 'portrait' }));
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(enviados, ['9:16', '16:9', '9:16']);
});

// ─── PIPELINE DE MONTAGEM ──────────────────────────────────────────────────
// O caminho feliz é o concat RÁPIDO (cópia, sem re-encode): ele não mexe no
// enquadramento, então takes 16:9 do HeyGen já saem 16:9. O formato importa nos
// caminhos de socorro — normalizar parte a parte, concat monolítico e o re-sync
// — que antes forçavam 1080x1920. `falhas` força cada um deles.
async function montar(formato, falhas = {}) {
  const bundled = await bundle('lib/clickup-pilot-pipeline.ts', `pipe-${Math.random().toString(36).slice(2)}`, {
    'ffmpeg-worker': `
      const st = () => globalThis.__formatoFF;
      export async function normalizeForConcat(b, o) {
        st().log.push(['norm', o && o.formato]);
        // a 1a parte falha nas duas tentativas do retry → fica sem normalizar
        if (st().falhas.norm && st().log.filter((c) => c[0] === 'norm').length <= 2) throw new Error('norm falhou');
        return b;
      }
      export async function concatAvatarParts(bs, o) { st().log.push(['mono', o && o.formato]); return new Blob([new Uint8Array(4096)], { type: 'video/mp4' }); }
      export async function concatVideosFast(bs) {
        st().log.push(['fast']);
        if (st().falhas.fast && st().log.filter((c) => c[0] === 'fast').length <= st().falhas.fast) throw new Error('fast falhou');
        return new Blob([new Uint8Array(4096)], { type: 'video/mp4' });
      }
      export async function cutVideoSegments(b) { return b; }
      export async function muxAudioIntoVideo(b) { return b; }
      export async function extractAudio(b) { return b; }
      export async function prepareVoiceForDecupagem(b) { return b; }
      export function cancelFFmpeg() {}
    `,
  });
  globalThis.__formatoFF = { log: [], falhas };
  const mk = () => new Blob([new Uint8Array(2048)], { type: 'video/mp4' });
  const input = {
    baseAdId: 'AD01GL',
    parts: [
      { label: 'HOOK 1', blob: mk(), expected: true },
      { label: 'BODY 1', blob: mk(), expected: true },
      { label: 'BODY 2', blob: mk(), expected: true },
    ],
    decupagem: false,
    nivelarVoz: false,
    camuflagem: false,
  };
  if (formato !== undefined) input.formato = formato;
  const r = await bundled.runPostPipeline(input);
  return { ff: globalThis.__formatoFF.log, r };
}
const comFormato = (ff) => ff.filter((c) => c[0] === 'norm' || c[0] === 'mono');

test('montagem: caminho rápido (cópia) segue igual — não re-enquadra nada', async () => {
  for (const f of [undefined, '9:16', '16:9']) {
    const { ff, r } = await montar(f);
    assert.deepEqual(ff, [['fast']], `formato ${f}: só o concat rápido`);
    assert.equal(r.items.length, 1);
    assert.ok(!r.items[0].errors?.assemble);
  }
});

test('montagem (socorro: normaliza parte a parte): sem formato → 9:16, o de sempre', async () => {
  const { ff } = await montar(undefined, { fast: 1 });
  assert.equal(comFormato(ff).length, 3, JSON.stringify(ff));
  for (const n of comFormato(ff)) assert.equal(n[1], '9:16');
});

test('montagem (socorro: normaliza parte a parte): 16:9 → 16:9', async () => {
  const { ff, r } = await montar('16:9', { fast: 1 });
  assert.equal(comFormato(ff).length, 3, JSON.stringify(ff));
  for (const n of comFormato(ff)) assert.equal(n[1], '16:9');
  assert.ok(!r.items[0].errors?.assemble);
});

test('montagem (socorro: concat monolítico): 16:9 → 16:9', async () => {
  // fast falha, 1 normalização falha → vai direto pro monolítico
  const { ff, r } = await montar('16:9', { fast: 1, norm: true });
  assert.ok(ff.some((c) => c[0] === 'mono'), JSON.stringify(ff));
  for (const n of comFormato(ff)) assert.equal(n[1], '16:9');
  assert.ok(!r.items[0].errors?.assemble);
});

test('montagem (socorro: fast pós-normalização falha → monolítico): 9:16 → 9:16', async () => {
  const { ff } = await montar('9:16', { fast: 2 });
  assert.ok(ff.some((c) => c[0] === 'mono'), JSON.stringify(ff));
  for (const n of comFormato(ff)) assert.equal(n[1], '9:16');
});

test('montagem: lixo no formato → 9:16', async () => {
  const { ff } = await montar('4:3', { fast: 1 });
  for (const n of comFormato(ff)) assert.equal(n[1], '9:16');
});

// ─── CADEIA REAL ATÉ O CORPO HTTP ──────────────────────────────────────────
// Sem stub nenhum no código do app: runner → processJob → createVideoWithText
// → jsonCall → heygenApiFetch. Só a EXTENSÃO é simulada (o `postMessage` que
// ela responde), e ela repassa o body como veio — então o `bodyText` capturado
// aqui é exatamente o que chegaria no /v2/avatar/shortcut/submit do HeyGen.
async function cadeiaReal(orientation) {
  const bundled = await bundle('lib/heygen-job-runner.ts', `runner-real-${Math.random().toString(36).slice(2)}`, {});
  const capturados = [];
  const listeners = new Set();
  const winAntes = globalThis.window;
  globalThis.window = {
    addEventListener: (_t, h) => listeners.add(h),
    removeEventListener: (_t, h) => listeners.delete(h),
    postMessage: (msg) => {
      if (msg?.type !== 'HG_API_FETCH') return;
      capturados.push(msg.req);
      const body = msg.req.bodyText ? JSON.parse(msg.req.bodyText) : null;
      const resp = msg.req.url.endsWith('/v2/avatar/shortcut/submit')
        ? { code: 100, data: { video_id: `vid_${capturados.length}`, avatar_id: body?.avatar_id } }
        : { code: 100, data: {} };
      queueMicrotask(() => {
        for (const h of [...listeners]) {
          h({ data: { source: 'darkolab-ext', type: 'HG_API_RESULT', requestId: msg.requestId, status: 200, ok: true, body: resp } });
        }
      });
    },
  };
  try {
    const textJobs = [
      { label: 'HOOK', copy: 'oi', avatarId: 'a1', voiceId: 'v1', motor: 'III' },
      { label: 'BODY', copy: 'tudo', avatarId: 'a2', voiceId: 'v2', motionPrompt: 'acena' },
    ];
    const res = await bundled.runHeyGenJobs(textJobs, opts(orientation ? { orientation } : {}));
    const submits = capturados
      .filter((r) => r.url.endsWith('/v2/avatar/shortcut/submit'))
      .map((r) => JSON.parse(r.bodyText));
    return { res, submits };
  } finally {
    globalThis.window = winAntes;
  }
}

test('cadeia real: sem formato → video_orientation "portrait" no submit (o de sempre)', async () => {
  const { res, submits } = await cadeiaReal(undefined);
  assert.equal(res.filter((r) => r.videoId).length, 2, JSON.stringify(res));
  assert.equal(submits.length, 2);
  for (const b of submits) assert.equal(b.video_orientation, 'portrait');
});

test('cadeia real: 16:9 → video_orientation "landscape" no submit, resto intacto', async () => {
  const { res, submits } = await cadeiaReal('landscape');
  assert.equal(res.filter((r) => r.videoId).length, 2, JSON.stringify(res));
  assert.equal(submits.length, 2);
  for (const b of submits) {
    assert.equal(b.video_orientation, 'landscape');
    assert.equal(b.audio_data.audio_type, 'tts_pending');
    assert.equal(b.fit, 'cover');
  }
  const hook = submits.find((b) => b.video_title === 'AD01_HOOK');
  const body = submits.find((b) => b.video_title === 'AD01_BODY');
  assert.equal(hook.audio_data.text, 'oi');
  assert.equal(hook.avatar_id, 'a1');
  assert.equal(body.avatar_id, 'a2');
  assert.equal(body.avatar_settings.motion_prompt, 'acena', 'gesto continua indo pro Avatar IV');
});
