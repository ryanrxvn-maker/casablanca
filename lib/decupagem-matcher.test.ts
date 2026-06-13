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
  extractVocabHints,
  auditResult,
  type Word,
  type Cut,
} from './decupagem-matcher';

// Constroi Word[] de uma transcricao (palavras 280ms, gap 70ms) — usado pra
// simular a transcricao do RESULTADO na auditoria.
function audioOf(text: string): Word[] {
  const out: Word[] = [];
  let t = 0;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    out.push({ text: tok, start: t, end: t + 280 });
    t += 350;
  }
  return out;
}

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

// extractVocabHints — dica de vocabulario p/ a transcricao (marcas/nomes).
{
  const copy =
    'Mounjaro, Ozempic ou qualquer canetinha. ' +
    'O lipedema não some com drenagem linfática. ' +
    'Meu nome é Matheus Galvão. Clique em saiba mais agora.';
  const hints = extractVocabHints(copy).map((h) => h.toLowerCase());
  check('vocab pega a marca Mounjaro', hints.includes('mounjaro'),
    JSON.stringify(hints));
  check('vocab pega Ozempic', hints.includes('ozempic'), JSON.stringify(hints));
  check('vocab pega o nome proprio (Matheus/Galvao)',
    hints.includes('matheus') || hints.includes('galvão'),
    JSON.stringify(hints));
  check('vocab pega termo de dominio (lipedema)', hints.includes('lipedema'),
    JSON.stringify(hints));
  check('vocab NAO inclui inicio-de-frase comum ("clique"/"meu")',
    !hints.includes('clique') && !hints.includes('meu'),
    JSON.stringify(hints));
}

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

// ===================================================================== //
// CASOS REAIS — extraidos do AD de lipedema (bruto real, 2026-06-12).
// Cada um reproduz um erro concreto que o matcher cometia.
// ===================================================================== //

// S18: take CORTADA no fim perde pra take completa (erro real #6/#9/#17).
// O expert truncou a primeira tentativa e refez inteira logo depois.
console.log('\n[S18] take cortada no fim NUNCA escolhida');
{
  const copy = 'Um dia desses, uma moça chegou aqui no consultório.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'um dia desses uma moca chegou aqui no', // truncou em "no"
      'um dia desses uma moca chegou aqui no meu consultorio', // completa
    ),
  );
  check('S18 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S18 pegou a take COMPLETA (tem "consultorio")',
      t.includes('consultorio'), `texto="${t}"`);
  }
}

// S19: a palavra-FIM da copy e' uma marca que o ASR transcreveu diferente
// (mounjaro vs monjaro) — erro real #3. Fuzzy tem que casar e incluir a marca.
console.log('\n[S19] palavra-fim com variacao de marca (fuzzy)');
{
  const copy = 'E aí começa uma rotina de treino, uma dieta, a usar mounjaro.';
  const cuts = matchCopyWindowed(
    copy,
    // tudo numa fala so (sem pausa) — o corte tem que ir ate "monjaro".
    transcript(
      'e ai comeca uma rotina de treino uma dieta a usar monjaro e um mes depois ela se olha',
    ),
  );
  check('S19 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S19 corte inclui a marca do fim ("monjaro")',
      t.includes('monjaro'), `texto="${t}"`);
    check('S19 nao vazou "um mes depois" (proxima ideia)',
      !t.includes('mes depois'), `texto="${t}"`);
  }
}

// S20: head da copy nao pode sumir — erro real #1 (perdeu "Monjaro" no inicio).
console.log('\n[S20] primeira palavra-conceito nao some');
{
  const copy =
    'Monjaro, Ozempic ou qualquer uma dessas canetinhas é veneno.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'monjaro ozempic ou qualquer uma dessas canetinhas aqui e veneno puro',
    ),
  );
  check('S20 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S20 comeca em "monjaro" (head preservado)',
      t.startsWith('monjaro'), `texto="${t}"`);
  }
}

// S21: vazamento do inicio da retomada seguinte — erro real #18/#28.
// Take incompleta ("pernas incham") + comeco do retake ("e isso explica").
// O matcher tem que pegar a take COMPLETA (termina em "roxas") e nao a curta.
console.log('\n[S21] nao vaza o comeco do proximo retake');
{
  const copy =
    'E isso explica porque você continua emagrecendo em cima, ' +
    'mas as suas pernas estão inchadas, doloridas e com manchas roxas.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'e isso explica porque voce continua emagrecendo em cima mas as suas pernas incham',
      'e isso explica porque voce continua emagrecendo na parte de cima mas as suas pernas continuam inchadas doloridas e com manchas roxas',
    ),
  );
  check('S21 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S21 pegou a take completa (tem "roxas")', t.includes('roxas'),
      `texto="${t}"`);
  }
}

// S22: corte tem que cair NO SILENCIO entre takes (sem vazar nem clipar).
// Verifica que startMs/endMs caem dentro da pausa, nao em cima da fala.
console.log('\n[S22] corte cai no silencio (boundaries limpos)');
{
  const words = transcript(
    'lixo antes que nao interessa nada',
    'a frase boa que a gente quer cortar limpa',
    'mais lixo depois que tambem nao interessa',
  );
  const cuts = matchCopyWindowed('A frase boa que a gente quer cortar limpa.', words);
  check('S22 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length === 1) {
    // take1 = words[0..5], take2 (a boa) = words[6..14], take3 = words[15..].
    const firstStart = words[6].start; // "a" (inicio da take boa)
    const lastEnd = words[14].end; // "limpa" (fim da take boa)
    // O corte cobre do inicio ao fim da take boa, com margem que cai SO no
    // silencio de 450ms entre takes — nunca dentro da fala vizinha.
    check('S22 start nao corta o inicio da fala',
      cuts[0].startMs <= firstStart && cuts[0].startMs >= firstStart - 230,
      `start=${cuts[0].startMs} firstWord=${firstStart}`);
    check('S22 end nao corta nem vaza vizinho',
      cuts[0].endMs >= lastEnd && cuts[0].endMs <= lastEnd + 230,
      `end=${cuts[0].endMs} lastWord=${lastEnd}`);
  }
}

// S23: take cortada que TERMINA numa pausa (boundary) mas sem a palavra-fim
// perde pra take completa — erro real #6. A truncada casava as palavras
// INICIAIS da copy de forma exata e ganhava por pouco.
console.log('\n[S23] take cortada (mesmo terminando em pausa) perde');
{
  const copy = 'E o resultado não muda, agora parece até que as pernas estão mais grossas.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'e o resultado nao muda agora parece ate que as pernas estao', // truncou
      'e o resultado nao muda e as pernas parecem ate que ficam muitas vezes mais grossas', // completa
    ),
  );
  check('S23 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S23 pegou a take com a palavra-fim ("grossas")',
      t.includes('grossas'), `texto="${t}"`);
  }
}

// S24: copy line longa que o expert NUNCA falou inteira numa take so. A janela
// NAO pode cruzar a pausa de retake e duplicar palavras (erro real #27).
console.log('\n[S24] nao funde duas takes (sem duplicar)');
{
  const copy =
    'Eu já ajudei centenas de mulheres a sair desse resultado em menos de um mês.';
  const cuts = matchCopyWindowed(
    copy,
    transcript(
      'eu ja ajudei centenas de mulheres aqui no meu consultorio na clinica',
      'eu ja ajudei centenas de mulheres a sair desse resultado em menos de um mes',
    ),
  );
  check('S24 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    const ocorrencias = (t.match(/ajudei/g) || []).length;
    check('S24 nao duplicou "ajudei" (nao fundiu takes)',
      ocorrencias <= 1, `"${t}" (${ocorrencias}x)`);
  }
}

// S25: restart de retake SEM pausa (o expert emenda) — a janela NAO pode
// fundir as duas tentativas. Erro real #24/#25.
console.log('\n[S25] fusao por restart sem pausa e' + ' rejeitada');
{
  const copy = 'Eu já ajudei muitas mulheres a perder peso rápido.';
  const cuts = matchCopyWindowed(
    copy,
    // UMA fala continua (sem pausa de 450ms): tentativa truncada + restart.
    transcript(
      'eu ja ajudei muitas mulheres aqui no consultorio eu ja ajudei muitas mulheres a perder peso rapido',
    ),
  );
  check('S25 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    const n = (t.match(/ajudei/g) || []).length;
    check('S25 nao fundiu (so 1 "ajudei")', n <= 1, `"${t}" (${n}x)`);
    check('S25 pegou a take boa (tem "rapido")', t.includes('rapido'), t);
  }
}

// S26: extensao de cabeca — o corte tem que comecar nos conectivos da copy
// ("E por isso que voce..."), nao no meio da fala ("faz dieta..."). #13/#20.
console.log('\n[S26] corte comeca na 1a palavra da frase (extensao de cabeca)');
{
  const copy = 'É por isso que você faz dieta, vai pra academia.';
  const cuts = matchCopyWindowed(
    copy,
    // lixo + a frase, tudo na mesma respiracao (sem pausa antes de "e por isso").
    transcript('entao a pessoa fala e por isso que voce faz dieta vai pra academia'),
  );
  check('S26 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S26 comeca em "e por isso que voce"',
      t.startsWith('e por isso que voce'), `texto="${t}"`);
    check('S26 nao puxou o lixo anterior ("fala"/"pessoa")',
      !t.includes('pessoa') && !t.includes('fala'), `texto="${t}"`);
  }
}

// S27: o ASR COLAPSOU uma retake (transcreveu 1x) mas os timestamps abracam
// as duas — sobra um BURACO de segundos no meio. Erro real #3/#12/#15/#25.
// Construtor manual pra injetar o buraco entre as palavras.
console.log('\n[S27] buraco interno (retake colapsada pelo ASR) e' + ' rejeitado');
{
  // Take com buraco de 3s no meio (onde o ASR comeu a repeticao) + take limpa.
  const words: Word[] = [];
  let t = 1000;
  const push = (toks: string, gapAfterLast: number) => {
    const arr = toks.split(/\s+/).filter(Boolean);
    arr.forEach((tok, i) => {
      words.push({ text: tok, start: t, end: t + 280 });
      t += 280 + (i === arr.length - 1 ? gapAfterLast : 70);
    });
  };
  // 1a metade da fala, BURACO de 3000ms (retake colapsada), 2a metade —
  // se a janela abracar as duas pontas, ela contem o buraco.
  push('e ai comeca uma rotina de treino', 3000);
  push('uma dieta a usar monjaro', 450);
  // take limpa logo depois (sem buraco): a copy inteira numa fala so.
  push('e ai comeca uma rotina de treino uma dieta a usar monjaro', 450);
  const cuts = matchCopyWindowed(
    'E aí começa uma rotina de treino, uma dieta, a usar mounjaro.',
    words,
  );
  check('S27 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    // O corte escolhido NAO pode conter o buraco de 3s (span coerente).
    const span = cuts[0].endMs - cuts[0].startMs;
    check('S27 corte sem buraco (span < 6s)', span < 6000,
      `span=${span}ms`);
    const t2 = normalize(cuts[0].transcriptText);
    check('S27 pegou take limpa (tem "monjaro")', t2.includes('monjaro'), t2);
  }
}

// S28: janela de baixa densidade de fala (muito silencio/colapso) e' rejeitada
// em favor de uma take densa e limpa.
console.log('\n[S28] densidade de fala baixa e' + ' rejeitada');
{
  const words: Word[] = [];
  let t = 1000;
  const push = (toks: string, gapAfterLast: number) => {
    const arr = toks.split(/\s+/).filter(Boolean);
    arr.forEach((tok, i) => {
      words.push({ text: tok, start: t, end: t + 280 });
      t += 280 + (i === arr.length - 1 ? gapAfterLast : 70);
    });
  };
  // take esticada por 2 buracos de 900ms (densidade baixa, sem um buraco unico
  // >= 1100) + take limpa.
  push('o metodo funciona', 900);
  push('em qualquer', 900);
  push('pessoa comprovadamente', 450);
  push('o metodo funciona em qualquer pessoa comprovadamente', 450);
  const cuts = matchCopyWindowed(
    'O método funciona em qualquer pessoa comprovadamente.',
    words,
  );
  check('S28 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const span = cuts[0].endMs - cuts[0].startMs;
    check('S28 corte denso (span < 4s)', span < 4000, `span=${span}ms`);
  }
}

// ===================================================================== //
// P1 — auditoria pos-render (auditResult)
// ===================================================================== //

const AUDIT_COPY =
  'Mounjaro é veneno pra celulite.\n' +
  'Tem mulher que acha que é gordura normal.\n' +
  'O processo é tão rápido que parece lipo.';

// S29: resultado PERFEITO (audio == copy, em ordem) → tudo ok.
console.log('\n[S29] auditoria de resultado perfeito → tudo ok');
{
  const audio = audioOf(
    'monjaro e veneno pra celulite ' +
    'tem mulher que acha que e gordura normal ' +
    'o processo e tao rapido que parece lipo',
  );
  const rep = auditResult(AUDIT_COPY, audio);
  check('S29 3 frases', rep.total === 3, `${rep.total}`);
  check('S29 todas ok', rep.okCount === 3,
    JSON.stringify(rep.phrases.map((p) => p.status)));
}

// S30: uma linha SUMIU do resultado → aquela frase = fail.
console.log('\n[S30] auditoria detecta linha ausente');
{
  const audio = audioOf(
    'monjaro e veneno pra celulite ' +
    // a 2a frase (tem mulher...) NAO esta no audio
    'o processo e tao rapido que parece lipo',
  );
  const rep = auditResult(AUDIT_COPY, audio);
  check('S30 frase ausente = fail', rep.phrases[1].status === 'fail',
    JSON.stringify(rep.phrases.map((p) => `${p.idx}:${p.status}`)));
  check('S30 as outras seguem ok', rep.phrases[0].status === 'ok' &&
    rep.phrases[2].status === 'ok',
    JSON.stringify(rep.phrases.map((p) => p.status)));
}

// S31: uma frase DUPLICADA no resultado (retake vazou) → review.
console.log('\n[S31] auditoria detecta duplicacao');
{
  const audio = audioOf(
    'monjaro e veneno pra celulite ' +
    'tem mulher que acha que e gordura normal ' +
    'tem mulher que acha que e gordura normal ' + // DUPLICOU
    'o processo e tao rapido que parece lipo',
  );
  const rep = auditResult(AUDIT_COPY, audio);
  check('S31 frase duplicada flagada', rep.phrases[1].duplicated === true,
    JSON.stringify(rep.phrases.map((p) => `${p.idx}:dup=${p.duplicated}`)));
  check('S31 status nao-ok na duplicada', rep.phrases[1].status !== 'ok',
    rep.phrases[1].status);
}

// S32: GHOST word — copy diz "Mounjaro" mas o resultado fala "Ozempic"
// (o ASR de geracao alucinou a marca). Coverage cai → review/fail.
console.log('\n[S32] auditoria pega palavra-fantasma (Mounjaro vs Ozempic)');
{
  const audio = audioOf(
    'ozempic e veneno pra celulite ' + // disse Ozempic, nao Mounjaro
    'tem mulher que acha que e gordura normal ' +
    'o processo e tao rapido que parece lipo',
  );
  const rep = auditResult(AUDIT_COPY, audio);
  check('S32 frase com fantasma nao fica ok', rep.phrases[0].status !== 'ok',
    `status=${rep.phrases[0].status} cov=${rep.phrases[0].coverage.toFixed(2)}`);
}

// S33: REPRO REAL — copy do AD lipedema + transcricao REAL do resultado.
// A maioria das frases esta correta no audio, entao a auditoria TEM que
// aprovar >= 20. (Expõe o bug do detector que marcava 27/28 como ausente.)
console.log('\n[S33] auditoria com transcricao REAL do resultado');
{
  const realCopy = [
    'Mounjaro, Ozempic ou qualquer uma dessas canetinhas é veneno pra quem tem esse tipo de celulite aqui',
    'Tem mulher que tem essas celulites e acha que é gordura normal',
    'E aí começa uma rotina de treino, uma dieta, a usar mounjaro',
    'Se você tá passando por isso, pare o treino, a dieta e o mounjaro agora',
    'Porque isso é a pior coisa que você está fazendo e eu vou te provar',
    'Um dia desses, uma moça chegou aqui no consultório',
    'A queixa era que as pernas estavam inchadas e não desinchava por nada',
    'Ela treinava pernas 6 vezes por semana, achando que ia conquistar pernas torneadas, lisas e firmes e se livrar dessa celulite',
    'Pernas cada vez mais grossas, doloridas e inflamadas',
    'Isso acontece porque lipedema não é gordura comum que você queima na academia',
    'É uma inflamação que piora, e muito, com o exercício de impacto',
    'É por isso que você faz dieta, vai para academia e suas pernas não param de inchar igual um balão',
    'Porque o lipedema NÃO é gordura comum que você elimina com qualquer dieta ou exercício pesado',
    'É uma gordura inflamada que fica presa ali',
    'Poucos médicos sabem disso, já que essa doença começou a ser mais estudada agora em 2020',
    'E isso explica porque você continua emagrecendo em cima, mas as suas pernas estão inchadas, doloridas e com manchas roxas',
    'Mesmo que você corte todos os carboidratos, faça jejum intermitente, treine seis vezes por semana, use mounjaro e ozempic',
    'a gordura vai continuar inchando sem parar e suas pernas vão ficar cada vez mais deformadas',
    'Por quê',
    'E o que você precisa é ter uma rotina de alimentação anti-inflamatória',
    'Quando você tira a inflamação do jogo, a gordura vai começar a derreter',
    'Eu vi isso acontecer milhares de vezes',
    'Clique em saiba mais, assista à aula e saia de lá com tudo o que você precisa para eliminar o lipedema nas próximas três semanas',
    'Sem gastar fortunas em drenagem linfática, sem passar fome comendo só salada e sem procedimentos invasivos caros',
    'Clique agora em saiba mais e veja você mesma',
    'lá eu também vou te revelar a combinação de especiarias que toda mulher tem na cozinha e que reduz a inflamação do lipedema em até 40% em apenas sete dias',
    'Então clica agora em saiba mais',
  ].join('.\n');

  const realResult =
    'O Ozempic ou qualquer uma dessas canetinhas aqui é veneno para quem tem esse tipo aqui ó de celulite. ' +
    'Tem mulher que tem essa celulite e acha que é gordura normal. ' +
    'E aí começa uma rotina de treino, e aí começa uma rotina de treino, uma dieta, a usar Monjaro. ' +
    'Se você tá passando por isso, pare o treino, a dieta e o Monjaro agora. ' +
    'Pior coisa que você pode estar fazendo, e eu vou te provar. ' +
    'Um dia desses, uma moça chegou aqui no meu consultório. ' +
    'Um dia desses, uma moça chegou pessoal aqui no meu consultório. ' +
    'E a queixa era que as pernas estavam mais inchadas e não desinchavam por nada. ' +
    'Ela treinava sério, e olha só, ela treinava pernas 6 vezes por semana achando que ia conquistar pernas mais torneadas, lisas e firmes, e que iria se livrar dessa celulite. ' +
    'Pernas cada vez mais grossas, doloridas, inflamadas. ' +
    'Isso acontece porque o lipedema, ela não é uma gordura normal que você queima só indo para academia, é uma inflamação. ' +
    'O lipedema é uma inflamação que piora, e muito, com exercícios de impacto. ' +
    'É por isso que você faz dieta, vai para academia e as suas pernas não param de inchar. ' +
    'É por isso que você faz dieta, vai para academia e as suas pernas não param de inchar igual um balão. ' +
    'Porque o lipedema não é gordura comum que você elimina com qualquer dieta ou exercício pesado. ' +
    'Na verdade, é uma gordura inflamada cronicamente que fica presa ali. ' +
    'Poucos médicos e nutricionistas sabem disso. Já que essa doença, poucos médicos e nutricionistas sabem disso, já que essa doença começou a ser mais estudada agora, no ano de 2020. ' +
    'E isso explica o porquê você continuar emagrecendo na parte de cima, mas as suas pernas continuarem cada vez mais inchadas, doloridas e com aquelas manchas roxas. ' +
    'Mesmo que você corte todos os carboidratos, faça jejum intermitente, treine 6 vezes por semana, use manjar ou Zen Peak, a gordura vai continuar inchando sem parar e suas pernas vão ficar vão ficar cada vez mais deformadas. ' +
    'Sabe por quê? E o que você precisa é ter uma rotina de alimentação que seja anti-inflamatória. ' +
    'Quando você tira a inflamação do jogo, a gordura vai começar a derreter. ' +
    'Eu vi isso acontecer milhares de vezes em menos de 21 dias e já ajudei centenas de mulheres a sair desse resultado para esse, para esse, em menos de um mês. ' +
    'Clique em saiba mais, assista a aula e sai de lá com tudo o que você precisa para eliminar o lipedema já nas próximas 3 semanas. ' +
    'E olha, sem gastar fortunas em drenagem linfática, sem passar fome comendo só salada, sem gastar fortunas com drenagem linfática, sem passar fome comendo só salada e sem procedimentos invasivos caros. E sem procedimentos invasivos caros. ' +
    'Clique agora em saiba mais e veja você mesmo. ' +
    'El também vou te revelar a combinação de especiarias que toda mulher tem na própria cozinha de casa e que é capaz de reduzir a inflamação do lipedema em até 40% em apenas 7 dias. ' +
    'Então clique agora em saiba mais';

  const rep = auditResult(realCopy, audioOf(normalize(realResult)));
  console.log(
    `  [S33] laudo: ${rep.okCount} ok / ${rep.reviewCount} review / ${rep.failCount} fail de ${rep.total}`,
  );
  console.log(
    '  [S33] status por frase: ' +
      rep.phrases.map((p) => `${p.idx}:${p.status}`).join(' '),
  );
  check('S33 auditoria aprova a maioria (>=18 ok)', rep.okCount >= 18,
    `okCount=${rep.okCount}`);
  check('S33 nao marca quase tudo como falha (all-red = bug)',
    rep.failCount <= 5, `failCount=${rep.failCount}`);
  check('S33 flagou as duplicacoes reais (#3,#6,#12,#15 = review)',
    rep.phrases[2].status === 'review' && rep.phrases[5].status === 'review' &&
    rep.phrases[11].status === 'review' && rep.phrases[14].status === 'review',
    JSON.stringify([2, 5, 11, 14].map((k) => rep.phrases[k].status)));
}

// S34: restart REFORMULADO sem pausa (palavras levemente diferentes, sem
// bigrama identico, sem buraco) — FIX-1b pega pela palavra-conceito repetida.
// Modela o #12 real ("É por isso que você faz dieta... faz dieta...").
console.log('\n[S34] restart reformulado (unigrama repetido) e' + ' rejeitado');
{
  const copy = 'É por isso que você faz dieta e suas pernas não param de inchar.';
  const cuts = matchCopyWindowed(
    copy,
    // 1a tentativa + restart reformulado, TUDO sem pausa (mesma respiracao):
    // "dieta", "pernas", "inchar" aparecem 2x — a copy so pede 1x.
    transcript(
      'e por isso que voce faz dieta e as suas pernas vivem inchando e por isso que voce faz dieta e suas pernas nao param de inchar',
    ),
  );
  check('S34 retorna 1 corte', cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    const nDieta = (t.match(/dieta/g) || []).length;
    check('S34 nao duplicou (1 "dieta" so)', nDieta <= 1, `"${t}" (${nDieta}x)`);
  }
}

// S35: copy que LEGITIMAMENTE repete uma palavra-conceito (ex: "saiba mais...
// saiba mais") NAO pode ser punida pelo FIX-1b.
console.log('\n[S35] copy que repete palavra de proposito nao e' + ' punida');
{
  const copy = 'Clique em saiba mais, sim, clique em saiba mais agora.';
  const cuts = matchCopyWindowed(
    copy,
    transcript('clique em saiba mais sim clique em saiba mais agora'),
  );
  // FIX-1b NAO pode rejeitar/zerar a frase so porque a copy repete "saiba"
  // (a repeticao e' esperada pela copy → permitida).
  check('S35 acha o corte (FIX-1b nao pune repeticao legitima)',
    cuts.length === 1, `retornou ${cuts.length}`);
  if (cuts.length >= 1) {
    const t = normalize(cuts[0].transcriptText);
    check('S35 corte valido com o conteudo da copy',
      t.includes('saiba') && t.includes('clique'), t);
  }
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
