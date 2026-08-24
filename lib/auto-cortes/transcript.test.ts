/**
 * Trava as invariantes do miolo PURO da transcrição do AUTO CORTES.
 * Ver lib/auto-cortes/transcript.ts e docs/auto-cortes/ARQUITETURA.md §3.2.
 *
 * O que isto blinda:
 *  - o plano de pedaços cobre o vídeo INTEIRO (nada de trecho sem transcrever)
 *    e não gera um pedacinho no fim só pra repetir o overlap;
 *  - o merge rebaseia os tempos, corta a sobreposição no meio e não deixa nem
 *    BURACO nem palavra DUPLICADA na fronteira — que é exatamente o defeito que
 *    aparece como "sumiu uma frase no minuto 9" numa transcrição em pedaços;
 *  - a frase quebra pelas 3 regras (pontuação, pausa de 700 ms, teto de 28
 *    palavras) e os ids são sequenciais E estáveis — o modelo referencia esses
 *    ids, então id instável = corte no lugar errado;
 *  - o hash é determinístico (é a chave de cache da análise).
 */
import assert from 'node:assert';
import {
  DUP_WINDOW_MS,
  SENTENCE_MAX_WORDS,
  SENTENCE_PAUSE_MS,
  buildSentences,
  mergeChunkWords,
  planAudioChunks,
  sentenceId,
  transcriptHash,
  wordsInRange,
} from './transcript';
import type { ChunkWords, Word } from './types';

let passed = 0;
let failed = 0;
function t(label: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${label}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${label}`);
    console.error(`       ${(e as Error).message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

console.log('\nGARANTIA — transcrição em pedaços (plano, merge, frases, hash):');

// ───────────────────────────── planAudioChunks ─────────────────────────────

t('plano: duração inválida/zero → nenhum pedaço', () => {
  assert.deepStrictEqual(planAudioChunks(0), []);
  assert.deepStrictEqual(planAudioChunks(-5), []);
  assert.deepStrictEqual(planAudioChunks(Number.NaN), []);
});

t('plano: vídeo menor que o pedaço → 1 pedaço cobrindo tudo', () => {
  const p = planAudioChunks(100, { chunkSec: 540, overlapSec: 3 });
  assert.deepStrictEqual(p, [{ idx: 0, startSec: 0, durSec: 100 }]);
});

t('plano: passo = chunkSec e cada pedaço estica o overlap pra frente', () => {
  const p = planAudioChunks(1200, { chunkSec: 540, overlapSec: 3 });
  assert.strictEqual(p.length, 3);
  assert.deepStrictEqual(p[0], { idx: 0, startSec: 0, durSec: 543 });
  assert.deepStrictEqual(p[1], { idx: 1, startSec: 540, durSec: 543 });
  assert.deepStrictEqual(p[2], { idx: 2, startSec: 1080, durSec: 120 });
  // cobertura contínua: o fim de um pedaço passa do começo do próximo
  for (let i = 0; i < p.length - 1; i++) {
    assert.ok(p[i].startSec + p[i].durSec > p[i + 1].startSec, `pedaço ${i} não encosta no ${i + 1}`);
  }
  // e o último termina exatamente na duração
  const last = p[p.length - 1];
  assert.strictEqual(last.startSec + last.durSec, 1200);
});

t('plano: sobra menor que o overlap não vira pedaço (já veio no anterior)', () => {
  const p = planAudioChunks(1082, { chunkSec: 540, overlapSec: 3 });
  assert.strictEqual(p.length, 2, 'o resto de 2 s já cabia no overlap do pedaço 1');
  const last = p[1];
  assert.strictEqual(last.startSec + last.durSec, 1082, 'mesmo assim cobre até o fim');
});

t('plano: idx é sequencial a partir de 0', () => {
  const p = planAudioChunks(5000, { chunkSec: 540, overlapSec: 3 });
  p.forEach((c, i) => assert.strictEqual(c.idx, i));
});

t('plano: default usa LIMITS (9 min + 3 s)', () => {
  const p = planAudioChunks(2000);
  assert.strictEqual(p[0].startSec, 0);
  assert.strictEqual(p[0].durSec, 543);
  assert.strictEqual(p[1].startSec, 540);
});

// ───────────────────────────── mergeChunkWords ─────────────────────────────

/**
 * Cenário da fronteira: pedaço 0 em [0,13), pedaço 1 em [10,15).
 * Meio do overlap = 10 s + 3 s/2 = 11 500 ms.
 *   - 'b'    (10800-11000) termina ANTES do meio → fica com o pedaço 0
 *   - 'B.'   (10850-11600) é a MESMA palavra vista pelo pedaço 1 → dedup
 *   - 'ola!' (11600-11900) termina DEPOIS do meio → fica com o pedaço 1
 */
const CH0: ChunkWords = {
  idx: 0,
  startSec: 0,
  durSec: 13,
  words: [w('a', 0, 500), w('b', 10800, 11000), w('ola!', 11600, 11900)],
};
const CH1: ChunkWords = {
  idx: 1,
  startSec: 10,
  durSec: 5,
  // tempos RELATIVOS ao início do pedaço (é assim que o ASR devolve)
  words: [w('B.', 850, 1600), w('ola', 1600, 1900), w('d', 3000, 3200)],
};

t('merge: rebase soma o início do pedaço nos tempos relativos', () => {
  const out = mergeChunkWords([CH0, CH1], 3);
  const d = out.find((x) => x.text === 'd');
  assert.ok(d, "a palavra 'd' do pedaço 1 sumiu");
  assert.strictEqual(d.start, 13000);
  assert.strictEqual(d.end, 13200);
});

t('merge: fronteira cortada no meio do overlap, sem buraco e sem duplicata', () => {
  const out = mergeChunkWords([CH0, CH1], 3);
  assert.deepStrictEqual(out.map((x) => x.text), ['a', 'b', 'ola', 'd']);
});

t('merge: a MESMA palavra vista pelos dois pedaços cai no dedup', () => {
  const out = mergeChunkWords([CH0, CH1], 3);
  assert.strictEqual(out.filter((x) => /^b/i.test(x.text)).length, 1, "'b'/'B.' entrou duas vezes");
});

t('merge: dedup ignora caixa/pontuação/acento mas respeita a janela de 300 ms', () => {
  const perto: ChunkWords[] = [
    { idx: 0, startSec: 0, durSec: 10, words: [w('É', 1000, 1100), w('e,', 1000 + DUP_WINDOW_MS - 1, 1400)] },
  ];
  assert.strictEqual(mergeChunkWords(perto, 3).length, 1, 'igual e dentro da janela → 1 só');

  const longe: ChunkWords[] = [
    { idx: 0, startSec: 0, durSec: 10, words: [w('e', 1000, 1100), w('e', 1000 + DUP_WINDOW_MS, 1400)] },
  ];
  assert.strictEqual(mergeChunkWords(longe, 3).length, 2, 'fora da janela → repetição legítima');

  const diferente: ChunkWords[] = [
    { idx: 0, startSec: 0, durSec: 10, words: [w('ele', 1000, 1100), w('dele', 1050, 1400)] },
  ];
  assert.strictEqual(mergeChunkWords(diferente, 3).length, 2, 'texto diferente nunca é dedup');
});

t('merge: pedaços fora de ordem são ordenados pelo tempo', () => {
  const out = mergeChunkWords([CH1, CH0], 3);
  assert.deepStrictEqual(out.map((x) => x.text), ['a', 'b', 'ola', 'd']);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].start);
});

t('merge: pedaço único passa inteiro (nada é cortado sem vizinho)', () => {
  const out = mergeChunkWords([CH0], 3);
  assert.deepStrictEqual(out.map((x) => x.text), ['a', 'b', 'ola!']);
});

t('merge: sem pedaços / sem palavras → vetor vazio', () => {
  assert.deepStrictEqual(mergeChunkWords([], 3), []);
  assert.deepStrictEqual(mergeChunkWords([{ idx: 0, startSec: 0, durSec: 5, words: [] }], 3), []);
});

t('merge: nenhuma palavra some entre 3 pedaços seguidos (varredura sintética)', () => {
  // fala contínua de 1 palavra por segundo, 0-30 s; pedaços de 10 s + 3 s de overlap
  const total = 30;
  const fala = Array.from({ length: total }, (_, i) => w(`p${i}`, i * 1000, i * 1000 + 400));
  const plano = planAudioChunks(total, { chunkSec: 10, overlapSec: 3 });
  const chunks: ChunkWords[] = plano.map((c) => ({
    idx: c.idx,
    startSec: c.startSec,
    durSec: c.durSec,
    words: fala
      .filter((x) => x.start >= c.startSec * 1000 && x.end <= (c.startSec + c.durSec) * 1000)
      .map((x) => w(x.text, x.start - c.startSec * 1000, x.end - c.startSec * 1000)),
  }));
  const out = mergeChunkWords(chunks, 3);
  assert.deepStrictEqual(out.map((x) => x.text), fala.map((x) => x.text));
  assert.deepStrictEqual(out.map((x) => x.start), fala.map((x) => x.start));
});

// ───────────────────────────── buildSentences ──────────────────────────────

t('frases: quebra por pontuação final', () => {
  const words = [w('Oi', 0, 200), w('mundo.', 250, 600), w('Tudo', 650, 900), w('bem?', 950, 1200)];
  const s = buildSentences(words, 'pt');
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].text, 'Oi mundo.');
  assert.strictEqual(s[1].text, 'Tudo bem?');
  assert.deepStrictEqual([s[0].wordFrom, s[0].wordTo], [0, 1]);
  assert.deepStrictEqual([s[1].wordFrom, s[1].wordTo], [2, 3]);
  assert.strictEqual(s[0].startMs, 0);
  assert.strictEqual(s[0].endMs, 600);
});

t('frases: quebra por pausa de 700 ms (mesmo sem ponto)', () => {
  const words = [
    w('um', 0, 200),
    w('dois', 250, 450),
    w('tres', 450 + SENTENCE_PAUSE_MS, 450 + SENTENCE_PAUSE_MS + 200),
  ];
  const s = buildSentences(words, 'pt');
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].text, 'um dois');
  assert.strictEqual(s[1].text, 'tres');
});

t('frases: pausa de 699 ms NÃO quebra (o limiar é 700)', () => {
  const words = [w('um', 0, 200), w('dois', 200 + SENTENCE_PAUSE_MS - 1, 1200)];
  assert.strictEqual(buildSentences(words, 'pt').length, 1);
});

t('frases: quebra pelo teto de 28 palavras', () => {
  const words = Array.from({ length: 30 }, (_, i) => w(`w${i}`, i * 100, i * 100 + 50));
  const s = buildSentences(words, 'pt');
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].wordTo - s[0].wordFrom + 1, SENTENCE_MAX_WORDS);
  assert.strictEqual(s[1].wordTo - s[1].wordFrom + 1, 30 - SENTENCE_MAX_WORDS);
});

t('frases: a última palavra sempre fecha a frase (nada fica de fora)', () => {
  const words = Array.from({ length: 5 }, (_, i) => w(`w${i}`, i * 100, i * 100 + 50));
  const s = buildSentences(words, 'pt');
  assert.strictEqual(s[s.length - 1].wordTo, words.length - 1);
});

t('frases: ids sequenciais S0001… e estáveis entre execuções', () => {
  const words = [
    w('Um.', 0, 200),
    w('Dois.', 300, 500),
    w('Tres.', 600, 800),
  ];
  const a = buildSentences(words, 'pt');
  const b = buildSentences(words, 'pt');
  assert.deepStrictEqual(a.map((x) => x.id), ['S0001', 'S0002', 'S0003']);
  assert.deepStrictEqual(a, b, 'mesma entrada tem que dar exatamente a mesma saída');
  assert.strictEqual(sentenceId(42), 'S0042');
});

t('frases: sem palavras → sem frases', () => {
  assert.deepStrictEqual(buildSentences([], 'pt'), []);
});

t('frases: texto limpa espaço antes de pontuação e espaço duplo', () => {
  const words = [w('  Oi', 0, 100), w('', 100, 120), w(',', 130, 150), w('tudo.', 200, 400)];
  const s = buildSentences(words, 'pt');
  assert.strictEqual(s[0].text, 'Oi, tudo.');
});

// ───────────────────────────── transcriptHash ──────────────────────────────

t('hash: determinístico e com 8 dígitos hex', () => {
  const words = [w('oi', 0, 100), w('mundo', 200, 400)];
  const h1 = transcriptHash(words, 'pt');
  const h2 = transcriptHash([...words.map((x) => ({ ...x }))], 'pt');
  assert.strictEqual(h1, h2);
  assert.match(h1, /^[0-9a-f]{8}$/);
});

t('hash: muda com o idioma, com o texto e com o tempo', () => {
  const words = [w('oi', 0, 100), w('mundo', 200, 400)];
  const base = transcriptHash(words, 'pt');
  assert.notStrictEqual(base, transcriptHash(words, 'en'));
  assert.notStrictEqual(base, transcriptHash([w('oi', 0, 100), w('mundos', 200, 400)], 'pt'));
  assert.notStrictEqual(base, transcriptHash([w('oi', 0, 100), w('mundo', 201, 400)], 'pt'));
});

t('hash: separadores impedem colisão por concatenação', () => {
  const a = transcriptHash([w('ab', 0, 1), w('c', 2, 3)], 'pt');
  const b = transcriptHash([w('a', 0, 1), w('bc', 2, 3)], 'pt');
  assert.notStrictEqual(a, b);
});

// ───────────────────────────── wordsInRange ────────────────────────────────

t('recorte: pega quem ENCOSTA na janela, não quem só toca a borda', () => {
  const words = [w('a', 0, 500), w('b', 600, 1000), w('c', 1000, 1400), w('d', 2000, 2400)];
  assert.deepStrictEqual(wordsInRange(words, 600, 1400).map((x) => x.text), ['b', 'c']);
  // 'a' termina exatamente em 500 → fora de [500, …)
  assert.deepStrictEqual(wordsInRange(words, 500, 700).map((x) => x.text), ['b']);
  // palavra atravessando a janela entra
  assert.deepStrictEqual(wordsInRange(words, 700, 800).map((x) => x.text), ['b']);
});

t('recorte: janela vazia/invertida → nada', () => {
  const words = [w('a', 0, 500)];
  assert.deepStrictEqual(wordsInRange(words, 100, 100), []);
  assert.deepStrictEqual(wordsInRange(words, 400, 100), []);
  assert.deepStrictEqual(wordsInRange([], 0, 1000), []);
});

console.log(`\n${failed === 0 ? '✓' : '✗'} auto-cortes/transcript: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
