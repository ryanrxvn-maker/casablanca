/**
 * Suite de testes do matcher de Decupagem por Copy.
 *
 * Roda standalone (sem framework):
 *   npx tsc lib/decupagem-matcher.ts lib/decupagem-matcher.test.ts \
 *     --outDir .test-tmp --module commonjs --target es2020 \
 *     --moduleResolution node --skipLibCheck
 *   node .test-tmp/decupagem-matcher.test.js
 *
 * Cobre as regras criticas que o usuario exige:
 *   - expert fala a MESMA frase 10x  → sai 1 corte so
 *   - take incompleta NUNCA e' escolhida
 *   - hesitacao/filler perde pra take limpa
 *   - ordem da copy preservada, sem duplicatas
 *   - frases distintas NUNCA sao fundidas por engano
 */

import {
  matchCopyWindowed,
  dedupCutsGlobal,
  textSimilarity,
  splitIntoPhrases,
  stem,
  normalize,
  type Word,
  type Cut,
} from './decupagem-matcher';

// --------------------------------------------------------------------- //
// Mini harness
// --------------------------------------------------------------------- //

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/**
 * Constroi um transcript word-level a partir de "takes" faladas em
 * sequencia. Cada palavra ~280ms, 70ms entre palavras, 450ms de pausa
 * entre takes (simula respiracao/silencio entre tentativas).
 */
function transcript(...takes: string[]): Word[] {
  const out: Word[] = [];
  let t = 1000;
  for (const take of takes) {
    const toks = take.split(/\s+/).filter(Boolean);
    for (const tok of toks) {
      const dur = 280;
      out.push({ text: tok, start: t, end: t + dur });
      t += dur + 70;
    }
    t += 450;
  }
  return out;
}

function texts(cuts: Cut[]): string[] {
  return cuts.map((c) => normalize(c.transcriptText));
}

function isSortedByStart(cuts: Cut[]): boolean {
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i].startMs < cuts[i - 1].startMs) return false;
  }
  return true;
}

// --------------------------------------------------------------------- //
// Unit: helpers
// --------------------------------------------------------------------- //

console.log('\n[unit] helpers');

check('stem reduz conjugacao', stem('treinando') === stem('treinou'),
  `${stem('treinando')} vs ${stem('treinou')}`);
check('stem reduz plural', stem('pernas') === stem('perna'),
  `${stem('pernas')} vs ${stem('perna')}`);
check(
  'splitIntoPhrases separa por pontuacao',
  splitIntoPhrases('Frase um. Frase dois! Frase tres?').length === 3,
);
check(
  'splitIntoPhrases ignora fragmentos curtos',
  splitIntoPhrases('Ok. a. Frase real aqui.').length === 1,
  JSON.stringify(splitIntoPhrases('Ok. a. Frase real aqui.')),
);
check(
  'textSimilarity identico = 1',
  textSimilarity('isso nao e um treino', 'isso nao e um treino') === 1,
);
check(
  'textSimilarity frases distintas baixo',
  textSimilarity('o ceu e azul claro', 'comprar pao na padaria') < 0.3,
);

// --------------------------------------------------------------------- //
// S1: expert repete a MESMA frase 10x → 1 corte so
// --------------------------------------------------------------------- //

console.log('\n[S1] mesma frase falada 10x');
{
  const frase = 'isso nao e um treino qualquer';
  const copy = 'Isso não é um treino qualquer.';
  const takes = Array.from({ length: 10 }, () => frase);
  const cuts = matchCopyWindowed(copy, transcript(...takes));

  check('S1 retorna exatamente 1 corte', cuts.length === 1,
    `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check(
      'S1 corte cobre 1 take (nao concatenou repeticoes)',
      t.split(' ').length <= 9,
      `texto="${t}" (${t.split(' ').length} palavras)`,
    );
    check('S1 conteudo correto', t.includes('treino'), `texto="${t}"`);
  }
}

// --------------------------------------------------------------------- //
// S2: take incompleta NUNCA escolhida
// --------------------------------------------------------------------- //

console.log('\n[S2] take incompleta vs completa');
{
  const copy =
    'Isso não é um treino comum, é uma transformação completa de verdade.';
  // 1a tentativa: cortou no meio. 2a: frase inteira.
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'isso nao e um treino',
      'isso nao e um treino comum e uma transformacao completa de verdade',
    ),
  );

  check('S2 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check(
      'S2 escolheu a take COMPLETA (tem "transformacao")',
      t.includes('transformacao') && t.includes('completa'),
      `texto="${t}"`,
    );
  }
}

// --------------------------------------------------------------------- //
// S3: hesitacao/filler perde pra take limpa
// --------------------------------------------------------------------- //

console.log('\n[S3] take com filler vs take limpa');
{
  const copy = 'Você precisa entender isso agora mesmo.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'voce tipo precisa entender entao isso agora mesmo',
      'voce precisa entender isso agora mesmo',
    ),
  );

  check('S3 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check(
      'S3 escolheu take SEM filler (sem "tipo"/"entao")',
      !t.includes('tipo') && !t.includes('entao'),
      `texto="${t}"`,
    );
  }
}

// --------------------------------------------------------------------- //
// S4: copy multi-frase + lixo/retakes no meio, gravado em ordem
// --------------------------------------------------------------------- //

console.log('\n[S4] multi-frase com retakes e lixo intercalado');
{
  const copy =
    'A primeira frase importante aqui.\n' +
    'A segunda frase decisiva agora.\n' +
    'A terceira frase final fechando.';

  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'peraí deixa eu ver o roteiro',
      'a primeira frase aaa importante', // retake ruim P1
      'a primeira frase importante aqui', // P1 boa
      'caramba errei de novo desculpa',
      'a segunda frase decisiva agora', // P2 boa
      'a terceira frase aaa final', // retake ruim P3
      'a terceira frase final fechando', // P3 boa
    ),
  );

  check('S4 retorna 3 cortes', cuts.length === 3, `retornou ${cuts.length}`);
  check('S4 ordenado cronologicamente', isSortedByStart(cuts));
  if (cuts.length === 3) {
    const tt = texts(cuts);
    check('S4 #1 = P1', tt[0].includes('primeira') && tt[0].includes('aqui'),
      tt[0]);
    check('S4 #2 = P2', tt[1].includes('segunda') && tt[1].includes('decisiva'),
      tt[1]);
    check('S4 #3 = P3', tt[2].includes('terceira') && tt[2].includes('fechando'),
      tt[2]);
    check(
      'S4 sem duplicatas',
      new Set(tt).size === 3,
      JSON.stringify(tt),
    );
  }
}

// --------------------------------------------------------------------- //
// S5: frases distintas NUNCA fundidas
// --------------------------------------------------------------------- //

console.log('\n[S5] frases distintas nao podem ser fundidas');
{
  const copy = 'O resultado aparece em trinta dias.\n' +
    'O investimento volta em dobro rapido.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'o resultado aparece em trinta dias',
      'o investimento volta em dobro rapido',
    ),
  );
  check('S5 retorna 2 cortes', cuts.length === 2, `retornou ${cuts.length}`);
  if (cuts.length === 2) {
    const tt = texts(cuts);
    check('S5 mantem as duas frases', tt[0] !== tt[1], JSON.stringify(tt));
  }
}

// --------------------------------------------------------------------- //
// S6: dedupCutsGlobal isolado — 10 takes identicas → 1
// --------------------------------------------------------------------- //

console.log('\n[S6] dedupCutsGlobal colapsa repeticoes');
{
  const dup: Cut[] = Array.from({ length: 10 }, (_, i) => ({
    startMs: i * 5000,
    endMs: i * 5000 + 2000,
    copyPhrase: 'Compre agora mesmo sem pensar.',
    transcriptText: 'compre agora mesmo sem pensar',
    score: 0.5 + i * 0.01, // ultima e' a melhor
    recall: 0.9,
    precision: 0.9,
  }));
  const out = dedupCutsGlobal(dup);
  check('S6 colapsa 10 → 1', out.length === 1, `retornou ${out.length}`);
  check(
    'S6 manteve o de maior score',
    Math.abs(out[0]?.score - 0.59) < 1e-9,
    `score=${out[0]?.score}`,
  );
}

// --------------------------------------------------------------------- //
// S7: copy com a MESMA linha repetida 2x → ainda 1 corte
// --------------------------------------------------------------------- //

console.log('\n[S7] copy repete a propria linha → nao duplica video');
{
  const copy = 'Essa é a sua última chance.\nEssa é a sua última chance.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'essa e a sua ultima chance',
      'essa e a sua ultima chance',
      'essa e a sua ultima chance',
    ),
  );
  check('S7 nao duplica (1 corte)', cuts.length === 1,
    `retornou ${cuts.length}`);
}

// --------------------------------------------------------------------- //

console.log(
  `\n================ ${passed} passed, ${failed} failed ================\n`,
);
if (failed > 0) {
  console.log('FALHAS:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
process.exit(0);
