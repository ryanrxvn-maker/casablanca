/**
 * Trava as invariantes da ANÁLISE do AUTO CORTES (parte pura).
 *
 * O que isto blinda: o modelo só devolve IDs de frase e notas — todo o resto
 * (tempo, bordas, dedup, ordem, saneamento) é código nosso. Um erro aqui não
 * aparece como exceção: aparece como corte começando no meio de uma palavra,
 * corte de 4 minutos num preset de 30 s, ou dois cortes iguais no grid.
 *
 * Também valida os dois JSON schemas de prompts.ts com um validador mínimo —
 * schema quebrado = structured output rejeitado pela API em produção.
 */
import { strict as assert } from 'node:assert';
import {
  RANGE_TOLERANCE,
  dedupCandidates,
  finalizeClips,
  planWindows,
  previewSentence,
  refineBounds,
  resolveCandidates,
  sanitizeClipPlan,
  scoreSum,
} from './analyze';
import { MAP_SCHEMA, REDUCE_SCHEMA } from './prompts';
import { CLIP_LENGTH_RANGE_SEC } from './types';
import type { ClipPlan, MapResult, ResolvedCandidate, ScoreBreakdown, Sentence, Word } from './types';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// helpers de fixture
// ───────────────────────────────────────────────────────────────────────────

function sid(n: number): string {
  return `S${String(n).padStart(4, '0')}`;
}

/** Frases de `durSec` cada, começando em `fromSec`. */
function mkSentences(count: number, durSec: number, fromSec = 0): Sentence[] {
  return Array.from({ length: count }, (_, i) => ({
    id: sid(i + 1),
    startMs: (fromSec + i * durSec) * 1000,
    endMs: (fromSec + (i + 1) * durSec) * 1000,
    text: `frase numero ${i + 1}`,
    wordFrom: i,
    wordTo: i,
  }));
}

function mkScores(v: number): ScoreBreakdown {
  return { hook: v, value: v, emotion: v, completeness: v, shareability: v };
}

function mkCandidate(over: Partial<ResolvedCandidate> & { id: string; startMs: number; endMs: number }): ResolvedCandidate {
  return {
    startId: sid(1),
    endId: sid(2),
    hookId: sid(1),
    topic: 'tema',
    why: 'porque sim',
    kind: 'insight',
    scores: mkScores(50),
    durationSec: (over.endMs - over.startMs) / 1000,
    firstSentence: 'comeco',
    lastSentence: 'fim',
    ...over,
  };
}

/** Palavras com `gapMs` de silêncio entre elas. */
function mkWords(count: number, durMs: number, gapMs: number, fromMs = 0): Word[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `p${i}`,
    start: fromMs + i * (durMs + gapMs),
    end: fromMs + i * (durMs + gapMs) + durMs,
  }));
}

/** Nenhuma borda pode cair ESTRITAMENTE dentro de uma palavra. */
function cortaPalavra(words: Word[], t: number): boolean {
  return words.some((w) => t > w.start && t < w.end);
}

console.log('\nGARANTIA — análise do Auto Cortes (janelas, candidatos, bordas, plano):');

// ───────────────────────────────────────────────────────────────────────────
// 1. planWindows
// ───────────────────────────────────────────────────────────────────────────
{
  // 80 frases de 30 s = 40 min. Janela 720 s, overlap 90 s → passo 630 s.
  const sentences = mkSentences(80, 30);
  const windows = planWindows(sentences, { windowSec: 720, overlapSec: 90 });

  ok(windows.length === 4, `A1: 40 min com janela 12 min/overlap 90 s → 4 janelas (deu ${windows.length})`);
  ok(
    windows.every((w, i) => w.idx === i),
    'A1: idx das janelas é sequencial a partir de 0',
  );

  const first = windows[0].sentences;
  const second = windows[1].sentences;
  ok(first[0].id === sid(1), 'A1: 1ª janela começa na 1ª frase');
  ok(
    first[first.length - 1].startMs < 720_000 && second[0].startMs === 630_000,
    'A1: 2ª janela começa exatamente 1 passo (630 s) depois',
  );

  const overlap = first.filter((s) => second.some((o) => o.id === s.id));
  ok(overlap.length === 3, `A1: overlap de 90 s = 3 frases repetidas (deu ${overlap.length})`);

  const cobertas = new Set(windows.flatMap((w) => w.sentences.map((s) => s.id)));
  ok(cobertas.size === sentences.length, 'A1: toda frase aparece em pelo menos uma janela');

  const last = windows[windows.length - 1].sentences;
  ok(last[last.length - 1].id === sid(80), 'A1: última janela termina na última frase');
}

{
  // Cauda curta: a 2ª "janela" seria subconjunto da 1ª → não vira janela nova.
  const sentences = mkSentences(24, 30); // 0..720 s
  const windows = planWindows(sentences, { windowSec: 720, overlapSec: 90 });
  ok(windows.length === 1, `A2: cauda inteiramente contida na janela anterior não gera janela extra (deu ${windows.length})`);
}

{
  ok(planWindows([], { windowSec: 720, overlapSec: 90 }).length === 0, 'A3: transcrição vazia → nenhuma janela');
  const uma = planWindows(mkSentences(1, 10), { windowSec: 720, overlapSec: 90 });
  ok(uma.length === 1 && uma[0].sentences.length === 1, 'A3: uma frase só → uma janela');
}

{
  // Teto de frases por janela (a rota recusa acima de 400).
  const sentences = mkSentences(300, 1); // 300 frases em 5 min → cabem numa janela de 12 min
  const windows = planWindows(sentences, { windowSec: 720, overlapSec: 90, maxSentences: 100 });
  ok(
    windows.length === 3 && windows.every((w) => w.sentences.length <= 100),
    `A4: janela acima do teto é quebrada em pedaços de <= 100 frases (deu ${windows.length})`,
  );
  ok(
    windows.every((w, i) => w.idx === i),
    'A4: idx continua sequencial depois da quebra',
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 2. resolveCandidates
// ───────────────────────────────────────────────────────────────────────────
{
  const sentences = mkSentences(10, 10); // S0001..S0010, 10 s cada, 0..100 s
  const range = CLIP_LENGTH_RANGE_SEC['30-59'];

  const raw: MapResult = {
    candidates: [
      // válido: 0 → 40 s
      { startId: sid(1), endId: sid(4), hookId: sid(2), topic: 't1', why: 'w1', scores: mkScores(70), kind: 'insight' },
      // id inexistente
      { startId: 'S9999', endId: sid(4), hookId: sid(4), topic: 't2', why: 'w2', scores: mkScores(90), kind: 'insight' },
      // ordem invertida
      { startId: sid(5), endId: sid(2), hookId: sid(5), topic: 't3', why: 'w3', scores: mkScores(90), kind: 'insight' },
      // curto demais (20 s < 30 s − 15%)
      { startId: sid(1), endId: sid(2), hookId: sid(1), topic: 't4', why: 'w4', scores: mkScores(90), kind: 'humor' },
      // longo demais (80 s > 59 s + 15%)
      { startId: sid(1), endId: sid(8), hookId: sid(1), topic: 't5', why: 'w5', scores: mkScores(90), kind: 'historia' },
      // válido, com hookId fora do intervalo → cai pro startId; kind desconhecido → 'outro'
      { startId: sid(6), endId: sid(10), hookId: sid(1), topic: 't6', why: 'w6', scores: mkScores(60), kind: 'inventado' as never },
    ],
  };

  const out = resolveCandidates(3, raw, sentences, '30-59');
  ok(out.length === 2, `B1: só os 2 candidatos confiáveis sobrevivem (deu ${out.length})`);
  ok(out[0].id === 'w3c0' && out[1].id === 'w3c1', 'B1: id = w{janela}c{n} sequencial e sem buracos');
  ok(out[0].startMs === 0 && out[0].endMs === 40_000, 'B1: ids de frase viram tempo (S0001→S0004 = 0–40 s)');
  ok(out[0].durationSec === 40, 'B1: durationSec calculado do tempo resolvido');
  ok(out[0].hookId === sid(2), 'B1: hookId dentro do intervalo é preservado');
  ok(out[1].hookId === sid(6), 'B1: hookId fora do intervalo cai pro startId');
  ok(out[1].kind === 'outro', 'B1: kind fora da lista vira "outro"');
  ok(
    out.every((c) => c.durationSec >= range.min * (1 - RANGE_TOLERANCE) && c.durationSec <= range.max * (1 + RANGE_TOLERANCE)),
    'B1: todo sobrevivente está na faixa do preset (com 15% de tolerância)',
  );
  ok(
    out[0].firstSentence === 'frase numero 1' && out[0].lastSentence === 'frase numero 4',
    'B1: firstSentence/lastSentence vêm da 1ª/última frase',
  );
}

{
  // Preview truncado em 160 chars (o reduce recebe uma linha por candidato).
  const longa = 'a'.repeat(400);
  const p = previewSentence(longa);
  ok(p.length === 160 && p.endsWith('…'), `B2: preview de frase corta em 160 chars (deu ${p.length})`);
  ok(previewSentence('  duas   palavras  ') === 'duas palavras', 'B2: preview normaliza espaços');
}

{
  // Nota fora de 0-100 é clampada (o schema pede, mas nunca confie).
  const sentences = mkSentences(10, 10);
  const raw: MapResult = {
    candidates: [
      {
        startId: sid(1),
        endId: sid(4),
        hookId: sid(1),
        topic: 't',
        why: 'w',
        scores: { hook: 300, value: -50, emotion: 70.6, completeness: NaN as never, shareability: 100 },
        kind: 'insight',
      },
    ],
  };
  const [c] = resolveCandidates(0, raw, sentences, '30-59');
  ok(
    c.scores.hook === 100 && c.scores.value === 0 && c.scores.emotion === 71 && c.scores.completeness === 0,
    'B3: notas fora de 0-100 (ou NaN) são clampadas',
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 3. dedupCandidates
// ───────────────────────────────────────────────────────────────────────────
{
  const a = mkCandidate({ id: 'w0c0', startMs: 0, endMs: 60_000, scores: mkScores(60) }); // soma 300
  const b = mkCandidate({ id: 'w1c0', startMs: 5_000, endMs: 62_000, scores: mkScores(40) }); // soma 200
  const c = mkCandidate({ id: 'w1c1', startMs: 120_000, endMs: 180_000, scores: mkScores(50) });

  const out = dedupCandidates([b, a, c]); // ordem de entrada embaralhada de propósito
  ok(out.length === 2, `C1: dois candidatos no mesmo momento viram um (deu ${out.length})`);
  ok(out.some((x) => x.id === 'w0c0') && !out.some((x) => x.id === 'w1c0'), 'C1: fica o de MAIOR soma de notas');
  ok(out[0].startMs < out[1].startMs, 'C1: saída ordenada por tempo');
  ok(scoreSum(a.scores) === 300, 'C1: scoreSum soma as 5 dimensões');
}

{
  // 55% de sobreposição fica ABAIXO do limite (0,6) → os dois sobrevivem.
  const a = mkCandidate({ id: 'a', startMs: 0, endMs: 100_000, scores: mkScores(60) });
  const b = mkCandidate({ id: 'b', startMs: 50_000, endMs: 150_000, scores: mkScores(40) });
  const out = dedupCandidates([a, b]);
  ok(out.length === 2, 'C2: sobreposição de 50% (< 60%) mantém os dois');

  const c = mkCandidate({ id: 'c', startMs: 30_000, endMs: 130_000, scores: mkScores(40) }); // 70% de 100 s
  ok(dedupCandidates([a, c]).length === 1, 'C2: sobreposição de 70% (> 60%) derruba o mais fraco');
}

{
  ok(dedupCandidates([]).length === 0, 'C3: lista vazia não quebra o dedup');
}

// ───────────────────────────────────────────────────────────────────────────
// 4. refineBounds
// ───────────────────────────────────────────────────────────────────────────
{
  // Fixture das bordas: 4 palavras de abertura (0–1500 ms), 2 s de SILÊNCIO,
  // e um bloco denso de 60 palavras (300 ms de fala + 100 ms de gap) a partir
  // de 3500 ms. O preset 'lt30' (8–30 s) cabe no bloco sem forçar crescimento,
  // então o que o teste mede é a REGRA DE BORDA, não o ajuste de faixa.
  const abertura = mkWords(4, 300, 100, 0); // última termina em 1500
  const bloco = mkWords(60, 300, 100, 3500); // 3500 … 27400
  const words: Word[] = [...abertura, ...bloco];

  // D1: silêncio de 2 s antes da 1ª palavra → respiro fixo de 150 ms.
  const r1 = refineBounds(3500, 15_400, words, 'lt30');
  ok(r1.startMs === 3350, `D1: silêncio longo → início = palavra.start − 150 ms (deu ${r1.startMs})`);
  ok(!cortaPalavra(words, r1.startMs), 'D1: início não cai dentro de palavra');

  // D2: silêncio de 100 ms (< 250) antes da 1ª palavra → recua até o início dele.
  const r2 = refineBounds(3900, 15_400, words, 'lt30');
  ok(r2.startMs === 3800, `D2: silêncio curto → snap no início do silêncio (deu ${r2.startMs})`);
  ok(!cortaPalavra(words, r2.startMs), 'D2: o snap nunca cai dentro da palavra anterior');

  // D3: o respiro de 300 ms no fim não pode invadir a próxima palavra.
  const r3 = refineBounds(3500, 16_000, words, 'lt30');
  ok(!cortaPalavra(words, r3.endMs), 'D3: fim nunca cai no meio de palavra');
  ok(r3.endMs === 16_300, `D3: fim para no começo da próxima palavra em vez de invadi-la (deu ${r3.endMs})`);
  ok(r3.endMs >= 16_200, 'D3: fim inclui a última palavra inteira');
}

{
  // Faixa dura: 100 palavras de 300 ms com 100 ms de gap = 40 s de fala.
  const words = mkWords(100, 300, 100);
  const range = CLIP_LENGTH_RANGE_SEC.lt30;

  const longo = refineBounds(0, 40_000, words, 'lt30');
  const durLongo = (longo.endMs - longo.startMs) / 1000;
  ok(durLongo <= range.max, `D4: corte longo demais é encolhido pro máximo do preset (${durLongo}s <= ${range.max}s)`);
  ok(!cortaPalavra(words, longo.startMs) && !cortaPalavra(words, longo.endMs), 'D4: encolher não corta palavra');

  const curto = refineBounds(0, 2_000, words, 'lt30');
  const durCurto = (curto.endMs - curto.startMs) / 1000;
  ok(
    durCurto >= range.min && durCurto <= range.max,
    `D4: corte curto demais cresce até o mínimo do preset (${durCurto}s em [${range.min}, ${range.max}])`,
  );
  ok(!cortaPalavra(words, curto.startMs) && !cortaPalavra(words, curto.endMs), 'D4: crescer não corta palavra');
  ok(curto.startMs >= 0, 'D4: início nunca fica negativo');
}

{
  // Fala curta demais pro preset: entrega o que existe, sem inventar tempo.
  const words = mkWords(5, 300, 100); // 1,9 s no total
  const r = refineBounds(0, 2_000, words, '180-300');
  ok(r.endMs > r.startMs, 'D5: quando não há palavra suficiente, devolve o trecho possível (sem inverter)');
  ok(r.endMs <= words[words.length - 1].end + 300, 'D5: não inventa tempo além da última palavra');
}

{
  const r = refineBounds(1_000, 5_000, [], 'auto');
  ok(r.startMs === 1_000 && r.endMs === 5_000, 'D6: sem palavras (ASR falhou) devolve o pedido, sem quebrar');
}

// ───────────────────────────────────────────────────────────────────────────
// 5. finalizeClips + saneamento
// ───────────────────────────────────────────────────────────────────────────
{
  const sentences = mkSentences(10, 10);
  const words = mkWords(250, 300, 100); // 100 s de fala, alinhada às frases
  const candidates: ResolvedCandidate[] = [
    mkCandidate({ id: 'w0c0', startId: sid(1), endId: sid(4), startMs: 0, endMs: 40_000, scores: mkScores(50) }),
    mkCandidate({ id: 'w0c1', startId: sid(6), endId: sid(9), startMs: 50_000, endMs: 90_000, scores: mkScores(80) }),
  ];

  const clips: ClipPlan[] = [
    {
      candidateId: 'w0c0',
      title: '  Titulo   com    espaços  ',
      headline: 'Uma headline gigante que passa muito facil dos oito limites.',
      hook: 'gancho',
      description: 'descricao do post',
      hashtags: ['#Cortes', 'CORTES', 'pód-cast', 'a b c', '', 'quatro', 'cinco', 'seis'],
      score: 150,
      scoreBreakdown: mkScores(50),
      why: 'porque sim',
      extendStartSentences: 9,
      extendEndSentences: -9,
    },
    {
      candidateId: 'w0c1',
      title: 'Segundo corte',
      headline: 'Curta e direta',
      hook: 'gancho 2',
      description: 'outra descricao',
      hashtags: ['um', 'dois', 'tres', 'quatro', 'cinco'],
      score: 91,
      scoreBreakdown: mkScores(80),
      why: 'fecha bem',
      extendStartSentences: 0,
      extendEndSentences: 0,
    },
    // candidato inventado pelo modelo → some
    {
      candidateId: 'NAO_EXISTE',
      title: 'fantasma',
      headline: 'fantasma',
      hook: '-',
      description: '-',
      hashtags: ['a', 'b', 'c', 'd', 'e'],
      score: 99,
      scoreBreakdown: mkScores(99),
      why: '-',
      extendStartSentences: 0,
      extendEndSentences: 0,
    },
    // repetição do mesmo candidato → some
    {
      candidateId: 'w0c1',
      title: 'duplicado',
      headline: 'duplicado',
      hook: '-',
      description: '-',
      hashtags: ['a', 'b', 'c', 'd', 'e'],
      score: 95,
      scoreBreakdown: mkScores(95),
      why: '-',
      extendStartSentences: 0,
      extendEndSentences: 0,
    },
  ];

  const out = finalizeClips({ clips }, candidates, sentences, words, { length: 'auto' });

  ok(out.length === 2, `E1: candidato inventado e repetido são descartados (sobraram ${out.length})`);
  // score 150 → 99 assume o 1º lugar; o de 91 desce.
  const topo = out[0].plan;
  ok(topo.candidateId === 'w0c0' && out[1].plan.candidateId === 'w0c1', 'E1: ordenado por nota (maior primeiro)');
  ok(topo.score === 99, `E1: nota acima de 99 é clampada (deu ${topo.score})`);
  ok(out[1].plan.score === 91, 'E1: nota válida passa intacta');
  ok(topo.headline.split(' ').length <= 8, `E1: headline cortada em 8 palavras (deu "${topo.headline}")`);
  ok(!/[.#"]$/.test(topo.headline), 'E1: headline sem ponto final nem "#"');
  ok(topo.title === 'Titulo com espaços', `E1: título com espaços normalizados (deu "${topo.title}")`);
  ok(topo.hashtags.length === 5, 'E1: exatamente 5 hashtags');
  ok(
    topo.hashtags.every((h) => /^[a-z0-9_]+$/.test(h)) && new Set(topo.hashtags).size === 5,
    `E1: hashtags minúsculas, sem acento/símbolo e sem repetição (${topo.hashtags.join(',')})`,
  );
  ok(
    topo.extendStartSentences === 2 && topo.extendEndSentences === -2,
    'E1: extensão de bordas clampada em ±2 frases',
  );
  ok(
    out.every((c) => !cortaPalavra(words, c.startMs) && !cortaPalavra(words, c.endMs)),
    'E1: nenhuma borda final cai no meio de palavra',
  );
  ok(out.every((c) => c.endMs > c.startMs), 'E1: todo corte tem duração positiva');

  const limitado = finalizeClips({ clips }, candidates, sentences, words, { length: 'auto', count: 1 });
  ok(limitado.length === 1 && limitado[0].plan.candidateId === 'w0c0', 'E2: count limita ao topo do ranking');
}

{
  // Extensão em frases move a borda de verdade (2 frases antes = −20 s aqui).
  const sentences = mkSentences(10, 10);
  const words = mkWords(250, 300, 100);
  const cand = mkCandidate({ id: 'x', startId: sid(5), endId: sid(6), startMs: 40_000, endMs: 60_000 });
  const base = finalizeClips(
    { clips: [{ ...sanitizeClipPlan(null, 'x'), extendStartSentences: 0, extendEndSentences: 0 }] },
    [cand],
    sentences,
    words,
    { length: 'auto' },
  );
  const estendido = finalizeClips(
    { clips: [{ ...sanitizeClipPlan(null, 'x'), extendStartSentences: 2, extendEndSentences: 1 }] },
    [cand],
    sentences,
    words,
    { length: 'auto' },
  );
  ok(estendido[0].startMs < base[0].startMs, 'E3: extendStartSentences positivo começa ANTES');
  ok(estendido[0].endMs > base[0].endMs, 'E3: extendEndSentences positivo termina DEPOIS');
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Validador mínimo de JSON schema (structured output)
// ───────────────────────────────────────────────────────────────────────────

type JsonSchema = Record<string, unknown>;

/**
 * Subconjunto de JSON Schema suficiente pros dois schemas de prompts.ts:
 * type, required, properties, additionalProperties:false, enum, minimum,
 * maximum, pattern, minItems, maxItems, maxLength, items.
 */
export function validateBySchema(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const errs: string[] = [];
  const type = schema.type as string | undefined;

  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path}: esperava object`];
    }
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const required = (schema.required ?? []) as string[];
    for (const key of required) {
      if (!(key in obj)) errs.push(`${path}.${key}: campo obrigatório ausente`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) errs.push(`${path}.${key}: propriedade não permitida`);
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errs.push(...validateBySchema(obj[key], sub, `${path}.${key}`));
    }
    return errs;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path}: esperava array`];
    const min = schema.minItems as number | undefined;
    const max = schema.maxItems as number | undefined;
    if (typeof min === 'number' && value.length < min) errs.push(`${path}: minItems ${min} (tem ${value.length})`);
    if (typeof max === 'number' && value.length > max) errs.push(`${path}: maxItems ${max} (tem ${value.length})`);
    const items = schema.items as JsonSchema | undefined;
    if (items) value.forEach((v, i) => errs.push(...validateBySchema(v, items, `${path}[${i}]`)));
    return errs;
  }

  if (type === 'string') {
    if (typeof value !== 'string') return [`${path}: esperava string`];
    const maxLength = schema.maxLength as number | undefined;
    if (typeof maxLength === 'number' && value.length > maxLength) {
      errs.push(`${path}: maxLength ${maxLength} (tem ${value.length})`);
    }
    const pattern = schema.pattern as string | undefined;
    if (pattern && !new RegExp(pattern).test(value)) errs.push(`${path}: não casa com /${pattern}/`);
    const en = schema.enum as unknown[] | undefined;
    if (en && !en.includes(value)) errs.push(`${path}: valor fora do enum`);
    return errs;
  }

  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path}: esperava ${type}`];
    if (type === 'integer' && !Number.isInteger(value)) errs.push(`${path}: esperava inteiro`);
    const min = schema.minimum as number | undefined;
    const max = schema.maximum as number | undefined;
    if (typeof min === 'number' && value < min) errs.push(`${path}: minimum ${min}`);
    if (typeof max === 'number' && value > max) errs.push(`${path}: maximum ${max}`);
    return errs;
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') return [`${path}: esperava boolean`];
    return errs;
  }

  return errs;
}

const MAP_OK = {
  candidates: [
    {
      startId: 'S0001',
      endId: 'S0004',
      hookId: 'S0002',
      topic: 'como ele perdeu o primeiro cliente',
      why: 'historia com virada e licao no fim',
      scores: { hook: 82, value: 70, emotion: 65, completeness: 88, shareability: 74 },
      kind: 'historia',
    },
  ],
};

const REDUCE_OK = {
  clips: [
    {
      candidateId: 'w0c0',
      title: 'R$30 Milhoes Faturados: A Estrategia de Sucesso',
      headline: 'Perdi o cliente e faturei mais',
      hook: 'Eu perdi meu maior cliente numa terca-feira.',
      description: 'Ele conta como a perda do maior cliente virou o metodo que usa ate hoje.',
      hashtags: ['negocios', 'vendas', 'empreendedorismo', 'cortes', 'podcast'],
      score: 88,
      scoreBreakdown: { hook: 90, value: 80, emotion: 75, completeness: 85, shareability: 84 },
      why: 'Gancho com perda concreta e virada no fim; fecha em 52 s',
      extendStartSentences: 0,
      extendEndSentences: 1,
    },
  ],
};

{
  const schema = MAP_SCHEMA as unknown as JsonSchema;
  ok(validateBySchema(MAP_OK, schema).length === 0, 'F1: MAP_SCHEMA aceita uma saída válida');

  const semScores = JSON.parse(JSON.stringify(MAP_OK));
  delete semScores.candidates[0].scores;
  ok(validateBySchema(semScores, schema).length > 0, 'F1: MAP_SCHEMA recusa candidato sem "scores"');

  const idErrado = JSON.parse(JSON.stringify(MAP_OK));
  idErrado.candidates[0].startId = 'X0001';
  ok(validateBySchema(idErrado, schema).some((e) => e.includes('startId')), 'F1: MAP_SCHEMA recusa id fora do padrão S0000');

  const notaAlta = JSON.parse(JSON.stringify(MAP_OK));
  notaAlta.candidates[0].scores.hook = 120;
  ok(validateBySchema(notaAlta, schema).some((e) => e.includes('maximum')), 'F1: MAP_SCHEMA recusa nota acima de 100');

  const kindErrado = JSON.parse(JSON.stringify(MAP_OK));
  kindErrado.candidates[0].kind = 'viral';
  ok(validateBySchema(kindErrado, schema).some((e) => e.includes('enum')), 'F1: MAP_SCHEMA recusa "kind" fora do enum');

  const extra = JSON.parse(JSON.stringify(MAP_OK));
  extra.candidates[0].startSec = 12;
  ok(
    validateBySchema(extra, schema).some((e) => e.includes('não permitida')),
    'F1: MAP_SCHEMA recusa timestamp cru (propriedade extra)',
  );

  const demais = { candidates: Array.from({ length: 26 }, () => MAP_OK.candidates[0]) };
  ok(validateBySchema(demais, schema).some((e) => e.includes('maxItems')), 'F1: MAP_SCHEMA recusa mais de 25 candidatos');

  const topicoLongo = JSON.parse(JSON.stringify(MAP_OK));
  topicoLongo.candidates[0].topic = 'x'.repeat(81);
  ok(validateBySchema(topicoLongo, schema).some((e) => e.includes('maxLength')), 'F1: MAP_SCHEMA recusa topic > 80 chars');
}

{
  const schema = REDUCE_SCHEMA as unknown as JsonSchema;
  ok(validateBySchema(REDUCE_OK, schema).length === 0, 'F2: REDUCE_SCHEMA aceita uma saída válida');

  const poucasTags = JSON.parse(JSON.stringify(REDUCE_OK));
  poucasTags.clips[0].hashtags = ['a', 'b', 'c', 'd'];
  ok(validateBySchema(poucasTags, schema).some((e) => e.includes('minItems')), 'F2: REDUCE_SCHEMA exige exatamente 5 hashtags');

  const notaAlta = JSON.parse(JSON.stringify(REDUCE_OK));
  notaAlta.clips[0].score = 120;
  ok(validateBySchema(notaAlta, schema).some((e) => e.includes('maximum')), 'F2: REDUCE_SCHEMA recusa score acima de 99');

  const extensaoGrande = JSON.parse(JSON.stringify(REDUCE_OK));
  extensaoGrande.clips[0].extendStartSentences = 5;
  ok(
    validateBySchema(extensaoGrande, schema).some((e) => e.includes('maximum')),
    'F2: REDUCE_SCHEMA limita extendStartSentences a ±2',
  );

  const semTitulo = JSON.parse(JSON.stringify(REDUCE_OK));
  delete semTitulo.clips[0].title;
  ok(validateBySchema(semTitulo, schema).some((e) => e.includes('title')), 'F2: REDUCE_SCHEMA exige title');

  const extra = JSON.parse(JSON.stringify(REDUCE_OK));
  extra.clips[0].startMs = 1000;
  ok(
    validateBySchema(extra, schema).some((e) => e.includes('não permitida')),
    'F2: REDUCE_SCHEMA recusa propriedade extra (tempo cru)',
  );

  // O saneamento do código continua valendo mesmo com o schema OK.
  const saneado = sanitizeClipPlan(REDUCE_OK.clips[0] as unknown as ClipPlan);
  assert.equal(saneado.hashtags.length, 5);
  ok(saneado.score === 88 && saneado.candidateId === 'w0c0', 'F2: sanitizeClipPlan preserva o que já está correto');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} auto-cortes/analyze: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
