/**
 * AUTO CORTES — testes da MÁQUINA DE ESTADOS (`pipeline-core.ts`).
 *
 * Tudo com dependências injetadas: nenhum IndexedDB, nenhum ffmpeg, nenhum
 * DOM. O que está travado aqui é o comportamento que não pode regredir:
 *
 *  1. ordem das fases num run completo (upload e link);
 *  2. retomada de CADA fase (baixando com OPFS, transcrevendo, analisando,
 *     renderizando) sem refazer o que já estava pronto;
 *  3. falha de UM corte não bloqueia o lote (retry 1× e segue);
 *  4. cancelamento libera as pistas e não deixa corte preso "renderizando";
 *  5. `attachFile` recusa arquivo com assinatura diferente;
 *  6. `rerenderAll` NÃO re-transcreve nem re-analisa;
 *  7. ZIP com os nomes combinados (`01 - <título>.mp4` + `.srt` + textos.txt).
 */

import assert from 'node:assert';

import {
  createPipelineCore,
  emptyProject,
  effectiveBounds,
  safeFileName,
  type PipelineDeps,
  type RenderJob,
  type RenderLane,
  type ThumbJob,
  type ZipEntryLite,
} from './pipeline-core';
import type { Clip, ClipPlan, Project, RenderStatus, Transcript } from './types';

// ───────────────────────────────────────────────────────────────────────────
// Ferramenta de teste
// ───────────────────────────────────────────────────────────────────────────

let passou = 0;
const falhas: string[] = [];

function test(nome: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou++;
      console.log(`  ok  ${nome}`);
    })
    .catch((e) => {
      falhas.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`);
      console.log(`  XX  ${nome}`);
      console.log(`      ${e instanceof Error ? e.stack : e}`);
    });
}

/** Cast por causa da tipagem do TS 5.9 (Uint8Array<ArrayBufferLike> × BlobPart) —
 *  em runtime é o mesmo buffer. Mesma gambiarra documentada em opfs.ts. */
function bytes(n: number): BlobPart {
  return new Uint8Array(n) as unknown as BlobPart;
}

function fakeBlob(n = 4096, type = 'video/mp4'): Blob {
  return new Blob([bytes(n)], { type });
}

function fakeFile(name = 'podcast.mp4', size = 5000, lastModified = 1700000000000): File {
  return new File([bytes(size)], name, { type: 'video/mp4', lastModified });
}

function abortError(): Error {
  const e = new Error('abortado');
  e.name = 'AbortError';
  return e;
}

function esperar(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - inicio > ms) return reject(new Error('condição não aconteceu a tempo'));
      const t = setTimeout(tick, 2);
      if (typeof (t as unknown as { unref?: () => void }).unref === 'function') {
        (t as unknown as { unref: () => void }).unref();
      }
    };
    tick();
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Dublês
// ───────────────────────────────────────────────────────────────────────────

function planoFake(n: number): ClipPlan {
  return {
    candidateId: `w0c${n}`,
    title: `Corte número ${n}`,
    headline: `HEADLINE ${n}`,
    hook: 'gancho',
    description: 'descrição do post',
    hashtags: ['um', 'dois', 'tres', 'quatro', 'cinco'],
    score: 90 - n,
    scoreBreakdown: { hook: 80, value: 80, emotion: 80, completeness: 80, shareability: 80 },
    why: 'funciona sozinho',
    extendStartSentences: 0,
    extendEndSentences: 0,
  };
}

function clipeFake(n: number, status: RenderStatus = 'pendente'): Clip {
  const id = `c${String(n).padStart(2, '0')}`;
  return {
    id,
    rank: n,
    plan: planoFake(n),
    startMs: n * 60_000,
    endMs: n * 60_000 + 45_000,
    captionBlocks: [{ id: 'b1', words: [{ text: 'oi', start: 0, end: 400 }], start: 0, end: 45_000 }],
    cropPlan: null,
    renderStatus: status,
    renderProgress: status === 'pronto' ? 1 : 0,
    renderError: null,
    blobKey: status === 'pronto' ? `ac:p1:clip:${id}` : null,
    thumbKey: status === 'pronto' ? `ac:p1:thumb:${id}` : null,
    outputBytes: status === 'pronto' ? 4096 : null,
    renderMode: status === 'pronto' ? 'decode' : null,
    edited: null,
  };
}

function transcriptFake(): Transcript {
  return {
    words: [
      { text: 'oi', start: 0, end: 400 },
      { text: 'gente', start: 420, end: 900 },
    ],
    sentences: [{ id: 'S0001', startMs: 0, endMs: 900, text: 'oi gente', wordFrom: 0, wordTo: 1 }],
    language: 'pt',
    provider: 'mock',
    hash: 'hash-1',
  };
}

type Espiao = {
  deps: PipelineDeps;
  fases: string[];
  chamadas: {
    transcribe: number;
    analyze: number;
    ingestLink: number;
    ingestUpload: number;
    fromOpfs: number;
    prune: number;
    begin: number;
    lane: number;
    end: number;
    thumb: number;
    history: number;
  };
  rodou: string[];
  salvos: Project[];
  blobs: Map<string, Blob>;
  projetos: Map<string, Project>;
  zip: ZipEntryLite[] | null;
  /** liga/desliga comportamentos do motor de render */
  motor: {
    travar: boolean;
    falharEm: Set<string>;
    /** clipes que já foram atendidos por `run` (com repetição) */
    laneAbertas: number;
  };
  quantosCortes: number;
};

function criarEspiao(over: Partial<PipelineDeps> = {}): Espiao {
  const chamadas: Espiao['chamadas'] = {
    transcribe: 0,
    analyze: 0,
    ingestLink: 0,
    ingestUpload: 0,
    fromOpfs: 0,
    prune: 0,
    begin: 0,
    lane: 0,
    end: 0,
    thumb: 0,
    history: 0,
  };
  const rodou: string[] = [];
  const salvos: Project[] = [];
  const blobs = new Map<string, Blob>();
  const projetos = new Map<string, Project>();
  const motor = { travar: false, falharEm: new Set<string>(), laneAbertas: 0 };
  const espiao: Espiao = {
    deps: null as unknown as PipelineDeps,
    fases: [],
    chamadas,
    rodou,
    salvos,
    blobs,
    projetos,
    zip: null,
    motor,
    quantosCortes: 3,
  };

  const deps: PipelineDeps = {
    store: {
      async saveProject(p) {
        salvos.push(p);
        projetos.set(p.id, p);
      },
      async loadProject(id) {
        return projetos.get(id) ?? null;
      },
      async saveBlob(key, blob) {
        blobs.set(key, blob);
      },
      async loadBlob(key) {
        return blobs.get(key) ?? null;
      },
      async deleteBlob(key) {
        blobs.delete(key);
      },
      async prune() {
        chamadas.prune++;
        return null;
      },
    },
    keys: {
      clip: (p, c) => `ac:${p}:clip:${c}`,
      thumb: (p, c) => `ac:${p}:thumb:${c}`,
    },
    ingest: {
      async link(url, o) {
        chamadas.ingestLink++;
        o.onProgress?.({ ratio: 0.5, label: 'Baixando 1 MB' });
        const file = fakeFile('baixado.mp4', 9000);
        return {
          file,
          source: {
            kind: 'youtube',
            url,
            name: 'baixado.mp4',
            sizeBytes: file.size,
            signature: `baixado.mp4:${file.size}:/auto-cortes/p1/source.mp4`,
            opfsPath: '/auto-cortes/p1/source.mp4',
            durationSec: 1800,
            width: null,
            height: 1080,
          },
        };
      },
      async upload(file) {
        chamadas.ingestUpload++;
        return {
          kind: 'upload',
          url: null,
          name: file.name,
          sizeBytes: file.size,
          signature: `${file.name}:${file.size}:${file.lastModified}`,
          opfsPath: null,
          durationSec: 1800,
          width: null,
          height: 1080,
        };
      },
      signature: (f) => `${f.name}:${f.size}:${f.lastModified}`,
      async fromOpfs() {
        chamadas.fromOpfs++;
        return fakeFile('baixado.mp4', 9000);
      },
    },
    async transcribe(_file, o) {
      chamadas.transcribe++;
      o.onProgress?.({ stage: 'audio', done: 1, total: 2 });
      o.onProgress?.({ stage: 'audio', done: 2, total: 2 });
      o.onProgress?.({ stage: 'asr', done: 1, total: 2 });
      o.onProgress?.({ stage: 'asr', done: 2, total: 2 });
      return transcriptFake();
    },
    async analyze(_input, o) {
      chamadas.analyze++;
      o.onProgress?.({ stage: 'map', done: 1, total: 2, candidatesSoFar: 3 });
      o.onProgress?.({ stage: 'reduce' });
      return {
        candidates: [],
        clips: Array.from({ length: espiao.quantosCortes }, (_v, i) => ({
          plan: planoFake(i + 1),
          startMs: (i + 1) * 60_000,
          endMs: (i + 1) * 60_000 + 45_000,
        })),
        warnings: [],
      };
    },
    engine: {
      async begin() {
        chamadas.begin++;
      },
      async lane(): Promise<RenderLane> {
        chamadas.lane++;
        motor.laneAbertas++;
        return {
          async cut(startSec) {
            return { blob: fakeBlob(8192), firstPts: Math.max(0, startSec) };
          },
          async audio() {
            return fakeBlob(512, 'audio/mp4');
          },
          async close() {
            motor.laneAbertas--;
          },
        };
      },
      async probeSize() {
        return { width: 1920, height: 1080 };
      },
      async thumb(_j: ThumbJob) {
        chamadas.thumb++;
        return fakeBlob(64, 'image/jpeg');
      },
      async run(job: RenderJob) {
        rodou.push(job.clipId);
        job.onStage('renderizando', 0.5);
        if (motor.travar) {
          await new Promise<void>((_resolve, reject) => {
            if (job.signal.aborted) return reject(abortError());
            job.signal.addEventListener('abort', () => reject(abortError()));
          });
        }
        if (motor.falharEm.has(job.clipId)) throw new Error('o encoder morreu');
        return { blob: fakeBlob(20_000), thumb: fakeBlob(64, 'image/jpeg'), cropPlan: { layout: 'none' }, mode: 'decode' };
      },
      async end() {
        chamadas.end++;
      },
    },
    captions: (_w, startMs, endMs) => [
      { id: 'b1', words: [{ text: 'oi', start: 0, end: 400 }], start: 0, end: Math.max(1, endMs - startMs) },
    ],
    srt: (blocks) => (blocks.length > 0 ? '1\n00:00:00,000 --> 00:00:00,400\noi\n' : ''),
    async zip(entries) {
      espiao.zip = entries;
      return fakeBlob(1000, 'application/zip');
    },
    logHistory() {
      chamadas.history++;
    },
    sleep: (ms) =>
      new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        if (typeof (t as unknown as { unref?: () => void }).unref === 'function') {
          (t as unknown as { unref: () => void }).unref();
        }
      }),
    now: () => Date.now(),
    objectUrl: { create: () => 'blob:mock', revoke: () => undefined },
    friendly: (e, fallback) => (e instanceof Error && e.message ? e.message : fallback),
    isCancel: (e) => e instanceof Error && (e.name === 'AbortError' || /cancelad|abortad/i.test(e.message)),
    makeError: (m) => new Error(m),
    ...over,
  };

  espiao.deps = deps;
  return espiao;
}

function comFases(pipe: ReturnType<typeof createPipelineCore>, espiao: Espiao): void {
  pipe.subscribe((p) => {
    if (espiao.fases[espiao.fases.length - 1] !== p.phase) espiao.fases.push(p.phase);
  });
}

function projetoBase(over: Partial<Project> = {}): Project {
  return { ...emptyProject('p1', 1_700_000_000_000), ...over };
}

// ───────────────────────────────────────────────────────────────────────────
// Testes
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nauto-cortes / pipeline (máquina de estados)\n');

  await test('run completo por UPLOAD passa por todas as fases, na ordem', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    comFases(pipe, esp);

    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });

    assert.deepStrictEqual(esp.fases, ['fonte', 'audio', 'transcrevendo', 'analisando', 'renderizando', 'pronto']);
    assert.strictEqual(esp.chamadas.ingestUpload, 1, 'o upload foi ingerido uma vez');
    assert.strictEqual(esp.chamadas.ingestLink, 0, 'upload não baixa nada');
    assert.strictEqual(esp.chamadas.transcribe, 1);
    assert.strictEqual(esp.chamadas.analyze, 1);
    assert.strictEqual(esp.rodou.length, 3, 'renderizou os 3 cortes');
    assert.strictEqual(esp.chamadas.history, 1, 'histórico registrado ao entrar em pronto');

    const st = pipe.getState();
    assert.strictEqual(st.phase, 'pronto');
    assert.ok(st.clips.every((c) => c.renderStatus === 'pronto'), 'todos os cortes prontos');
    assert.ok(st.clips.every((c) => c.blobKey && c.thumbKey), 'todos com MP4 e miniatura no store');
    assert.strictEqual(esp.blobs.size, 6, '3 MP4 + 3 miniaturas');
    pipe.destroy();
  });

  await test('persiste cedo: projeto salvo em toda transição e o último salvo é o final', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });
    assert.ok(esp.salvos.length >= 6, `salvou em toda transição (foram ${esp.salvos.length})`);
    assert.strictEqual(esp.salvos[esp.salvos.length - 1].phase, 'pronto');
    assert.strictEqual(esp.chamadas.prune, 1, 'faxina do store roda ao iniciar');
    pipe.destroy();
  });

  await test('run por LINK passa por "baixando" e guarda o caminho do OPFS', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    comFases(pipe, esp);
    await pipe.start({
      settings: projetoBase().settings,
      source: { kind: 'link', url: 'https://youtube.com/watch?v=abc12345678' },
    });
    assert.deepStrictEqual(esp.fases, [
      'fonte',
      'baixando',
      'audio',
      'transcrevendo',
      'analisando',
      'renderizando',
      'pronto',
    ]);
    assert.strictEqual(esp.chamadas.ingestLink, 1);
    assert.strictEqual(pipe.getState().source.opfsPath, '/auto-cortes/p1/source.mp4');
    pipe.destroy();
  });

  await test('retomada de "baixando" com OPFS reabre do disco (não baixa de novo)', async () => {
    const esp = criarEspiao();
    const inicial = projetoBase({
      phase: 'baixando',
      source: {
        kind: 'youtube',
        url: 'https://youtu.be/abc',
        name: 'baixado.mp4',
        sizeBytes: 9000,
        signature: 'baixado.mp4:9000:/auto-cortes/p1/source.mp4',
        opfsPath: '/auto-cortes/p1/source.mp4',
        durationSec: 1800,
        width: null,
        height: 1080,
      },
    });
    const pipe = createPipelineCore({ projectId: 'p1', initial: inicial, deps: esp.deps });
    await pipe.resume();
    assert.strictEqual(esp.chamadas.fromOpfs, 1, 'leu do OPFS');
    assert.strictEqual(esp.chamadas.ingestLink, 0, 'não re-baixou');
    assert.strictEqual(pipe.getState().phase, 'pronto');
    pipe.destroy();
  });

  await test('retomada de "transcrevendo" re-roda a transcrição do zero (chunks não persistem)', async () => {
    const esp = criarEspiao();
    const inicial = projetoBase({
      phase: 'transcrevendo',
      source: { ...projetoBase().source, name: 'podcast.mp4', sizeBytes: 5000, signature: 'x', durationSec: 1800 },
    });
    const pipe = createPipelineCore({ projectId: 'p1', initial: inicial, getFile: () => fakeFile(), deps: esp.deps });
    comFases(pipe, esp);
    await pipe.resume();
    assert.strictEqual(esp.chamadas.transcribe, 1, 're-transcreveu');
    assert.strictEqual(esp.chamadas.analyze, 1);
    assert.strictEqual(pipe.getState().phase, 'pronto');
    pipe.destroy();
  });

  await test('retomada de "analisando" com transcrição salva NÃO re-transcreve', async () => {
    const esp = criarEspiao();
    const inicial = projetoBase({
      phase: 'analisando',
      transcript: transcriptFake(),
      source: { ...projetoBase().source, name: 'podcast.mp4', sizeBytes: 5000, signature: 'x', durationSec: 1800 },
    });
    const pipe = createPipelineCore({ projectId: 'p1', initial: inicial, getFile: () => fakeFile(), deps: esp.deps });
    comFases(pipe, esp);
    await pipe.resume();
    assert.strictEqual(esp.chamadas.transcribe, 0, 'transcrição foi reaproveitada');
    assert.strictEqual(esp.chamadas.analyze, 1);
    assert.deepStrictEqual(esp.fases, ['analisando', 'renderizando', 'pronto']);
    pipe.destroy();
  });

  await test('retomada de "renderizando" só refaz o que faltava', async () => {
    const esp = criarEspiao();
    const inicial = projetoBase({
      phase: 'renderizando',
      transcript: transcriptFake(),
      clips: [clipeFake(1, 'pronto'), clipeFake(2, 'pronto'), clipeFake(3, 'erro')],
      source: { ...projetoBase().source, name: 'podcast.mp4', sizeBytes: 5000, signature: 'x', durationSec: 1800 },
    });
    const pipe = createPipelineCore({ projectId: 'p1', initial: inicial, getFile: () => fakeFile(), deps: esp.deps });
    await pipe.resume();
    assert.strictEqual(esp.chamadas.transcribe, 0);
    assert.strictEqual(esp.chamadas.analyze, 0, 'não re-analisou');
    assert.deepStrictEqual(esp.rodou, ['c03'], 'só o corte que faltava');
    assert.strictEqual(pipe.getState().phase, 'pronto');
    pipe.destroy();
  });

  await test('falha de UM corte não derruba o lote (retry 1× e o resto entrega)', async () => {
    const esp = criarEspiao();
    esp.motor.falharEm.add('c02');
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });

    const st = pipe.getState();
    assert.strictEqual(st.phase, 'pronto', 'o lote fecha mesmo com um corte quebrado');
    const c02 = st.clips.find((c) => c.id === 'c02');
    assert.strictEqual(c02?.renderStatus, 'erro');
    assert.ok(c02?.renderError, 'o card do corte mostra o motivo');
    assert.strictEqual(st.clips.filter((c) => c.renderStatus === 'pronto').length, 2);
    assert.strictEqual(esp.rodou.filter((id) => id === 'c02').length, 2, 'tentou 2× o corte quebrado');
    assert.ok(
      st.warnings.some((w) => /não renderizaram/i.test(w.message)),
      'o aviso do corte quebrado ficou registrado',
    );
    pipe.destroy();
  });

  await test('cancelamento libera as pistas: nenhum corte fica preso e dá pra retomar', async () => {
    const esp = criarEspiao();
    esp.motor.travar = true;
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    const rodando = pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });

    await esperar(() => esp.rodou.length >= 1);
    pipe.cancel();
    await rodando;

    const st = pipe.getState();
    assert.strictEqual(st.phase, 'renderizando', 'a fase fica onde estava (retomável)');
    const presos = st.clips.filter((c) => c.renderStatus !== 'pendente' && c.renderStatus !== 'pronto');
    assert.deepStrictEqual(presos, [], 'nenhum corte ficou preso em cortando/renderizando');
    assert.strictEqual(esp.motor.laneAbertas, 0, 'todas as pistas do pool foram devolvidas');
    assert.strictEqual(esp.chamadas.end, 1, 'o lote foi fechado no motor');

    // e agora retoma de verdade
    esp.motor.travar = false;
    await pipe.resume();
    assert.strictEqual(pipe.getState().phase, 'pronto');
    assert.strictEqual(esp.chamadas.transcribe, 1, 'retomar não re-transcreveu');
    pipe.destroy();
  });

  await test('attachFile recusa arquivo diferente e aceita o mesmo', async () => {
    const esp = criarEspiao();
    const arquivo = fakeFile('podcast.mp4', 5000, 1700000000000);
    const inicial = projetoBase({
      phase: 'transcrevendo',
      source: {
        kind: 'upload',
        url: null,
        name: 'podcast.mp4',
        sizeBytes: 5000,
        signature: 'podcast.mp4:5000:1700000000000',
        opfsPath: null,
        durationSec: 1800,
        width: null,
        height: 1080,
      },
    });
    const pipe = createPipelineCore({ projectId: 'p1', initial: inicial, deps: esp.deps });

    assert.strictEqual(pipe.needsFile(), true, 'upload sem File em memória pede o arquivo');

    const outro = pipe.attachFile(fakeFile('outro.mp4', 4321, 1600000000000));
    assert.strictEqual(outro.ok, false);
    assert.ok(!outro.ok && /mesmo arquivo/i.test(outro.reason), 'a recusa explica o que fazer');
    assert.strictEqual(pipe.needsFile(), true, 'continua pedindo o arquivo');

    const certo = pipe.attachFile(arquivo);
    assert.strictEqual(certo.ok, true);
    assert.strictEqual(pipe.needsFile(), false);
    pipe.destroy();
  });

  await test('resume() sem o arquivo do upload lança orientação (não trava calado)', async () => {
    const esp = criarEspiao();
    const inicial = projetoBase({
      phase: 'transcrevendo',
      source: {
        kind: 'upload',
        url: null,
        name: 'podcast.mp4',
        sizeBytes: 5000,
        signature: 'podcast.mp4:5000:1700000000000',
        opfsPath: null,
        durationSec: 1800,
        width: null,
        height: 1080,
      },
    });
    const pipe = createPipelineCore({ projectId: 'p1', initial: inicial, deps: esp.deps });
    let erro: unknown = null;
    try {
      await pipe.resume();
    } catch (e) {
      erro = e;
    }
    assert.ok(erro instanceof Error, 'lançou');
    assert.ok(/MESMO vídeo/i.test((erro as Error).message), 'orienta re-selecionar o mesmo vídeo');
    assert.strictEqual(esp.chamadas.transcribe, 0);
    pipe.destroy();
  });

  await test('rerenderAll troca a legenda sem re-transcrever nem re-analisar', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });
    const rodadaUm = esp.rodou.length;

    await pipe.rerenderAll({ captionPresetId: 'titulo-ouro', headlinePresetId: null });

    assert.strictEqual(esp.chamadas.transcribe, 1, 'transcrição intacta');
    assert.strictEqual(esp.chamadas.analyze, 1, 'análise intacta');
    assert.strictEqual(esp.rodou.length, rodadaUm + 3, 'os 3 cortes renderizaram de novo');
    const st = pipe.getState();
    assert.strictEqual(st.settings.captionPresetId, 'titulo-ouro');
    assert.strictEqual(st.settings.headlinePresetId, null);
    assert.strictEqual(st.phase, 'pronto');
    pipe.destroy();
  });

  await test('rerenderClip refaz só um corte', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });
    esp.rodou.length = 0;
    await pipe.rerenderClip('c02');
    assert.deepStrictEqual(esp.rodou, ['c02']);
    assert.strictEqual(pipe.getState().phase, 'pronto');
    pipe.destroy();
  });

  await test('reanalyze mantém a transcrição e limpa os cortes velhos', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });
    esp.quantosCortes = 2;
    await pipe.reanalyze({ length: 'lt30' });
    assert.strictEqual(esp.chamadas.transcribe, 1, 'não re-transcreveu');
    assert.strictEqual(esp.chamadas.analyze, 2, 'analisou de novo');
    const st = pipe.getState();
    assert.strictEqual(st.clips.length, 2);
    assert.strictEqual(st.settings.length, 'lt30');
    assert.strictEqual(esp.blobs.size, 4, 'os blobs dos cortes velhos saíram do store');
    pipe.destroy();
  });

  await test('updateClip guarda a edição, recalcula a legenda e NÃO renderiza', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });
    const antes = esp.rodou.length;

    pipe.updateClip('c01', { title: 'Título novo', endMs: 100_000 });
    const c01 = pipe.getState().clips.find((c) => c.id === 'c01');
    assert.strictEqual(c01?.edited?.title, 'Título novo');
    assert.strictEqual(effectiveBounds(c01 as Clip).endMs, 100_000, 'as bordas editadas mandam');
    assert.strictEqual(c01?.captionBlocks[0].end, 100_000 - 60_000, 'a legenda foi recalculada pra nova borda');
    assert.strictEqual(esp.rodou.length, antes, 'editar não dispara render');
    assert.strictEqual(c01?.renderStatus, 'pronto', 'o corte já pronto continua disponível');
    pipe.destroy();
  });

  await test('buildZip monta os nomes combinados e o textos.txt', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });

    const progresso: number[] = [];
    const zip = await pipe.buildZip((r) => progresso.push(r));
    assert.ok(zip.size > 0);
    const nomes = (esp.zip ?? []).map((e) => e.name);
    assert.deepStrictEqual(nomes, [
      '01 - Corte número 1.mp4',
      '01 - Corte número 1.srt',
      '02 - Corte número 2.mp4',
      '02 - Corte número 2.srt',
      '03 - Corte número 3.mp4',
      '03 - Corte número 3.srt',
      'textos.txt',
    ]);
    assert.strictEqual(progresso[progresso.length - 1], 1, 'o progresso fecha em 1');
    pipe.destroy();
  });

  await test('buildZip sem corte pronto explica o que fazer', async () => {
    const esp = criarEspiao();
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps: esp.deps });
    let erro: unknown = null;
    try {
      await pipe.buildZip();
    } catch (e) {
      erro = e;
    }
    assert.ok(erro instanceof Error && /corte pronto/i.test(erro.message));
    pipe.destroy();
  });

  await test('erro no meio vira fase "erro" com errorPhase e o Retomar volta de lá', async () => {
    const esp = criarEspiao();
    let quebrar = true;
    const deps: PipelineDeps = {
      ...esp.deps,
      async analyze(input, o) {
        if (quebrar) throw new Error('A IA de texto recusou a chave.');
        return esp.deps.analyze(input, o);
      },
    };
    const pipe = createPipelineCore({ projectId: 'p1', initial: projetoBase(), deps });
    await pipe.start({ settings: projetoBase().settings, source: { kind: 'upload', file: fakeFile() } });

    let st = pipe.getState();
    assert.strictEqual(st.phase, 'erro');
    assert.strictEqual(st.errorPhase, 'analisando', 'guardou de onde retomar');
    assert.ok(st.lastError && /chave/i.test(st.lastError));
    assert.ok(st.transcript, 'a transcrição não se perdeu');

    quebrar = false;
    await pipe.resume();
    st = pipe.getState();
    assert.strictEqual(st.phase, 'pronto');
    assert.strictEqual(st.errorPhase, undefined, 'o marcador de erro sumiu');
    assert.strictEqual(esp.chamadas.transcribe, 1, 'retomou da análise, sem re-transcrever');
    pipe.destroy();
  });

  await test('resume() relê o projeto do store quando o pipeline nasceu em branco (F5)', async () => {
    const esp = criarEspiao();
    esp.projetos.set(
      'p1',
      projetoBase({
        phase: 'analisando',
        transcript: transcriptFake(),
        source: { ...projetoBase().source, name: 'podcast.mp4', sizeBytes: 5000, signature: 'x', durationSec: 1800 },
      }),
    );
    const pipe = createPipelineCore({ projectId: 'p1', getFile: () => fakeFile(), deps: esp.deps });
    await pipe.resume();
    assert.strictEqual(esp.chamadas.transcribe, 0, 'reaproveitou a transcrição que estava no IDB');
    assert.strictEqual(pipe.getState().phase, 'pronto');
    pipe.destroy();
  });

  await test('safeFileName sane nomes de arquivo pro ZIP', () => {
    assert.strictEqual(safeFileName('Como ganhar 10x: o método'), 'Como ganhar 10x o método');
    assert.strictEqual(safeFileName('a/b\\c*d?e"f<g>h|i'), 'a b c d e f g h i');
    assert.strictEqual(safeFileName('   '), 'corte');
    assert.strictEqual(safeFileName('acaba com ponto.'), 'acaba com ponto');
  });

  console.log(`\n${passou} passaram, ${falhas.length} falharam\n`);
  if (falhas.length > 0) {
    for (const f of falhas) console.log(` - ${f}`);
    process.exit(1);
  }
}

void main();
