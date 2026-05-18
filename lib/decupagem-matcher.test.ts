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

// ===================================================================== //
// CENARIOS HORRIVEIS — robustez extrema
// ===================================================================== //

// S8: gagueira / repeticao de silaba no meio das palavras
console.log('\n[S8] gagueira e palavras quebradas');
{
  const copy = 'Isso não é um treino qualquer.';
  const cuts = matchCopyWindowed(
    copy,
    transcript('is is isso nao nao e um trei treino qualquer'),
  );
  check('S8 acha o corte mesmo com gagueira', cuts.length === 1,
    `retornou ${cuts.length}`);
  if (cuts.length === 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S8 conteudo correto', t.includes('treino') && t.includes('qualquer'),
      t);
  }
}

// S9: a MELHOR take esta no MEIO (nao a ultima) — tiebreak nao pode
// deixar a ultima (pior) ganhar
console.log('\n[S9] melhor take no meio, ultima e pior');
{
  const copy = 'Você precisa agir imediatamente sem hesitar nenhum segundo.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'voce tipo precisa agir entao imediatamente sem hesitar', // 1a ruim
      'voce precisa agir imediatamente sem hesitar nenhum segundo', // 2a otima
      'voce precisa tipo agir imediatamente sabe sem hesitar nenhum', // 3a ruim
    ),
  );
  check('S9 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length === 1) {
    const t = normalize(cuts[0].transcriptText);
    check(
      'S9 escolheu a take limpa do MEIO (sem filler, tem "segundo")',
      !t.includes('tipo') && !t.includes('sabe') && t.includes('segundo'),
      t,
    );
  }
}

// S10: duas linhas DISTINTAS da copy mas quase identicas (so muda 1
// palavra-chave). NENHUMA pode ser fundida/perdida.
console.log('\n[S10] linhas distintas quase identicas nao podem fundir');
{
  const copy =
    'Com isso você vai ganhar dinheiro rápido.\n' +
    'Com isso você vai ganhar dinheiro fácil.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'com isso voce vai ganhar dinheiro rapido',
      'com isso voce vai ganhar dinheiro facil',
    ),
  );
  check('S10 mantem AS DUAS linhas (2 cortes)', cuts.length === 2,
    `retornou ${cuts.length}`);
  if (cuts.length === 2) {
    const tt = texts(cuts);
    const temRapido = tt.some((t) => t.includes('rapido'));
    const temFacil = tt.some((t) => t.includes('facil'));
    check('S10 tem a linha "rapido" E a "facil"', temRapido && temFacil,
      JSON.stringify(tt));
  }
}

// S11: muito lixo / falsos comecos espalhados antes da take boa
console.log('\n[S11] enxurrada de falsos comecos');
{
  const copy = 'O método funciona em qualquer pessoa comprovadamente.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'o metodo',
      'o metodo funciona em',
      'o metodo funciona em qualquer',
      'peraí',
      'o metodo funciona em qualquer pessoa',
      'o metodo funciona em qualquer pessoa comprovadamente',
    ),
  );
  check('S11 1 corte e' + ' completo', cuts.length === 1,
    `retornou ${cuts.length}`);
  if (cuts.length === 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S11 pegou a take inteira (tem "comprovadamente")',
      t.includes('comprovadamente') && t.includes('pessoa'), t);
  }
}

// S12: transcript so com lixo, nada casa → [] sem crashar
console.log('\n[S12] nada casa → vazio sem crashar');
{
  let crashed = false;
  let cuts: Cut[] = [];
  try {
    cuts = matchCopyWindowed(
      'Frase totalmente ausente do video aqui agora.',
      transcript('bom dia pessoal tudo certo por ai com voces hoje'),
    );
  } catch {
    crashed = true;
  }
  check('S12 nao crashou', !crashed);
  check('S12 retornou poucos/zero cortes ruins', cuts.length <= 1,
    `retornou ${cuts.length}`);
}

// S13: copy vazia / so pontuacao / espaco → [] sem crashar
console.log('\n[S13] copy degenerada');
{
  let crashed = false;
  let r1: Cut[] = [], r2: Cut[] = [], r3: Cut[] = [];
  try {
    r1 = matchCopyWindowed('', transcript('qualquer coisa aqui falada'));
    r2 = matchCopyWindowed('   \n  ', transcript('qualquer coisa aqui'));
    r3 = matchCopyWindowed('... !!! ?', transcript('qualquer coisa aqui'));
  } catch {
    crashed = true;
  }
  check('S13 nao crashou', !crashed);
  check('S13 copy vazia → []', r1.length === 0 && r2.length === 0 &&
    r3.length === 0,
    `${r1.length}/${r2.length}/${r3.length}`);
}

// S14: transcript de 1 palavra / vazio → [] sem crashar
console.log('\n[S14] transcript minusculo');
{
  let crashed = false;
  let r1: Cut[] = [], r2: Cut[] = [];
  try {
    r1 = matchCopyWindowed('Uma frase normal aqui.', []);
    r2 = matchCopyWindowed('Uma frase normal aqui.', transcript('oi'));
  } catch {
    crashed = true;
  }
  check('S14 nao crashou', !crashed);
  check('S14 transcript vazio/1-palavra → []',
    r1.length === 0 && r2.length === 0, `${r1.length}/${r2.length}`);
}

// S15: 30 repeticoes da mesma linha repetida 2x na copy → 1 corte
console.log('\n[S15] 30 takes da mesma frase');
{
  const copy = 'Essa oferta acaba à meia-noite de hoje.\n' +
    'Essa oferta acaba à meia-noite de hoje.';
  const takes = Array.from(
    { length: 30 },
    () => 'essa oferta acaba a meia noite de hoje',
  );
  const cuts = matchCopyWindowed(copy, transcript(...takes));
  check('S15 30 takes → 1 corte', cuts.length === 1,
    `retornou ${cuts.length}`);
}

// S16: copy 6 frases, retakes ruins de TODAS espalhados, gravado em
// ordem com muito ruido — stress real de VSL
console.log('\n[S16] VSL longa com retakes de todas as frases');
{
  const copy =
    'O problema é que ninguém te contou a verdade.\n' +
    'Na realidade existe um caminho muito mais simples.\n' +
    'Eu descobri isso depois de anos de tentativa.\n' +
    'E agora eu vou compartilhar tudo com você.\n' +
    'Basta seguir os três passos que eu vou mostrar.\n' +
    'Clique no botão abaixo antes que acabe o tempo.';

  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'deixa eu respirar aqui um segundo',
      'o problema e que ninguem aaa te contou', // retake ruim 1
      'o problema e que ninguem te contou a verdade', // boa 1
      'na realidade existe um tipo caminho mais', // retake ruim 2
      'na realidade existe um caminho muito mais simples', // boa 2
      'eu descobri isso depois de anos de tentativa', // boa 3
      'errei desculpa de novo',
      'e agora eu vou sabe compartilhar tudo', // retake ruim 4
      'e agora eu vou compartilhar tudo com voce', // boa 4
      'basta seguir os tres passos que eu vou mostrar', // boa 5
      'clique no botao',
      'clique no botao abaixo antes que acabe o tempo', // boa 6
    ),
  );

  check('S16 retorna 6 cortes', cuts.length === 6, `retornou ${cuts.length}`);
  check('S16 cronologico', isSortedByStart(cuts));
  if (cuts.length === 6) {
    const tt = texts(cuts);
    check('S16 #1', tt[0].includes('verdade'), tt[0]);
    check('S16 #2', tt[1].includes('simples'), tt[1]);
    check('S16 #3', tt[2].includes('tentativa'), tt[2]);
    check('S16 #4', tt[3].includes('voce') && tt[3].includes('compartilhar'),
      tt[3]);
    check('S16 #5', tt[4].includes('passos'), tt[4]);
    check('S16 #6', tt[5].includes('botao') && tt[5].includes('tempo'),
      tt[5]);
    check('S16 sem filler nos cortes finais',
      !tt.some((t) => t.includes(' aaa ') || t.includes('tipo') ||
        t.includes('sabe')),
      JSON.stringify(tt));
    check('S16 sem duplicatas', new Set(tt).size === 6, JSON.stringify(tt));
  }
}

// S17: ordem invertida (copy A→B, expert falou B→A) — nao crasha, nao
// duplica. Comportamento aceitavel: prioriza cronologia.
console.log('\n[S17] copy fora da ordem falada');
{
  let crashed = false;
  let cuts: Cut[] = [];
  try {
    cuts = matchCopyWindowed(
      'A frase que vem primeiro na copy.\n' +
        'A frase que vem depois na copy.',
      transcript(
        'a frase que vem depois na copy',
        'a frase que vem primeiro na copy',
      ),
    );
  } catch {
    crashed = true;
  }
  check('S17 nao crashou', !crashed);
  check('S17 cronologico e sem duplicata', isSortedByStart(cuts) &&
    new Set(texts(cuts)).size === cuts.length,
    JSON.stringify(texts(cuts)));
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
