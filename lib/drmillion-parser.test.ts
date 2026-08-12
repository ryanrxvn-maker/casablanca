/**
 * Testes do parser DR MILLION — em cima do texto REAL do doc
 * (grupo AD07: três hooks + um Body compartilhado, tudo PT/PL).
 */
import {
  parseDrMillionBriefing,
  extrairBlocos,
  isDrMillionFormat,
  idiomasDisponiveis,
  limparLinhaFalada,
  adGroupOf,
} from './drmillion-parser';

const DOC = [
  'AD07GL - COD WL PL',
  'BRIEFING PARA O COPY: Criativo antigo que escalou no EUA.',
  'INSTRUÇÕES PARA EDIÇÃO:',
  'AD07G1GL - COD WL PL',
  'PT',
  '',
  'Eu aprendi a receita da gelatina na hora certa e foi a melhor coisa da minha vida.',
  'PL',
  'Nauczyłam się przepisu na galaretkę w samą porę i to była najlepsza rzecz w moim życiu.[t]',
  'AD07G2GL - COD WL PL',
  'PT',
  '',
  'Todo mundo fala do truque da gelatina para a gordura abdominal.[u]',
  'PL',
  'Wszyscy mówią o sposobie z żelatyną na tłuszcz brzuszny.',
  'AD07G3GL - COD WL PL',
  'PT',
  'Essa receita matinal de gelatina para idosos me fez passar de 89 quilos para 66 quilos.',
  'É natural, fácil, não tem efeitos colaterais.',
  'PL',
  'Dzięki temu porannemu przepisowi schudłam z 89 kilogramów do 66 kilogramów.',
  'Jest to naturalny, łatwy sposób.[v]',
  'Body',
  'PT',
  '',
  '2 Quando vi a balança cair de 104 para 86, eu senti que tinha que compartilhar isso.',
  '',
  '3 Meninas, prestem atenção.',
  '',
  '1 Clique em “Saiba mais agora” e copie a receita correta.',
  'PL',
  '2 Kiedy zobaczyłam, jak waga spadła ze 104 do 86, poczułam, że muszę się tym podzielić.',
  '3 Dziewczyny, uważajcie.',
  '2 Kliknij „Dowiedz się więcej” i przygotuj się.',
  'AD08GL - COD WL PL',
  'PT',
  'Outro AD, outro grupo — não pode vazar pro AD07.',
  'PL',
  'Inny AD, inna grupa.',
  'Body',
  'PT',
  '9 Corpo do AD08, não do AD07.',
  'PL',
  '9 Ciało AD08, a nie AD07.',
].join('\n');

let fails = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL ${label}\n  esperado: ${e}\n  veio:     ${a}`); fails++; }
  else console.log(`ok   ${label}`);
}
function ok(cond: boolean, label: string) { eq(!!cond, true, label); }

// ── grupo ──
eq(adGroupOf('AD07G1GL'), 'AD07', 'grupo do AD07G1GL');
eq(adGroupOf('AD01G3GL'), 'AD01', 'grupo do AD01G3GL');
eq(adGroupOf('lixo'), null, 'sem AD id = null');

// ── limpeza da linha falada ──
eq(limparLinhaFalada('2 Quando vi a balança cair'), 'Quando vi a balança cair', 'tira número de cena');
eq(limparLinhaFalada('...da minha vida.[t]'), '...da minha vida.', 'tira marcador de comentário');
eq(limparLinhaFalada('1 Clique em “Saiba mais agora”'), 'Clique em “Saiba mais agora”', 'número + aspas tipográficas');
eq(limparLinhaFalada('Perdi 104 quilos em 3 meses'), 'Perdi 104 quilos em 3 meses', 'NÃO mexe em número no meio da frase');
eq(limparLinhaFalada('104 quilos foi o meu pico'), '104 quilos foi o meu pico', 'número de 3 dígitos no início é fala, não cena');

// ── detecção ──
ok(isDrMillionFormat(DOC, 'AD07G1GL'), 'detecta formato DR MILLION');
ok(!isDrMillionFormat('Hook 1\nBody\ntexto normal do B2C', 'AD07G1GL'), 'doc do B2C NÃO é DR MILLION');
eq(idiomasDisponiveis(DOC, 'AD07G1GL'), { pt: true, pl: true }, 'AD07G1GL tem os dois idiomas');

// ── hook certo pra cada task (o problema do "primeiro parecido") ──
const g1 = extrairBlocos(DOC, 'AD07G1GL')!;
const g2 = extrairBlocos(DOC, 'AD07G2GL')!;
const g3 = extrairBlocos(DOC, 'AD07G3GL')!;
ok(g1.hook.pt[0].startsWith('Eu aprendi a receita'), 'AD07G1GL pega o hook 1');
ok(g2.hook.pt[0].startsWith('Todo mundo fala'), 'AD07G2GL pega o hook 2');
ok(g3.hook.pt[0].startsWith('Essa receita matinal'), 'AD07G3GL pega o hook 3');
eq(g3.hook.pt.length, 2, 'hook de 2 linhas vem inteiro');

// ── body compartilhado: os TRÊS hooks recebem o MESMO corpo ──
eq(g1.body.pl, g2.body.pl, 'hook 1 e 2 compartilham o body');
eq(g2.body.pl, g3.body.pl, 'hook 2 e 3 compartilham o body');
ok(g1.body.pt[0].startsWith('Quando vi a balança'), 'body do grupo AD07 (sem número de cena)');
ok(!g1.body.pt.join(' ').includes('AD08'), 'body do AD07 não vaza pro AD08');

// ── isolamento entre grupos ──
const g8 = extrairBlocos(DOC, 'AD08GL')!;
ok(g8.body.pt[0].includes('AD08'), 'AD08 pega o body DELE');
ok(!g8.body.pt.join(' ').includes('Quando vi a balança'), 'AD08 não pega o body do AD07');

// ── idioma ──
const pl = parseDrMillionBriefing(DOC, 'AD07G1GL', 'pl')!;
const pt = parseDrMillionBriefing(DOC, 'AD07G1GL', 'pt')!;
ok(pl.hooks[0].text.includes('Nauczyłam'), 'PL: hook em polonês');
ok(!pl.hooks[0].text.includes('Eu aprendi'), 'PL: sem português junto');
ok(pl.body!.includes('Kiedy zobaczyłam'), 'PL: body em polonês');
ok(!pl.body!.includes('Quando vi'), 'PL: body sem português junto');
ok(pt.hooks[0].text.includes('Eu aprendi'), 'PT: hook em português');
ok(!pt.body!.includes('Kiedy'), 'PT: body sem polonês junto');

// ── nada de marcador/numeração indo pro HeyGen ──
const falado = pl.hooks[0].text + '\n' + pl.body;
ok(!/^\s*(PT|PL)\s*$/m.test(falado), 'não sobra marcador PT/PL no texto falado');
ok(!/\[[a-z]{1,3}\]/.test(falado), 'não sobra marcador de comentário');
ok(!/^\s*[1-9]\s+\p{Lu}/mu.test(falado), 'não sobra número de cena no início das linhas');

// ── formato de saída compatível com o pipeline ──
eq(pl.baseAdId, 'AD07G1GL', 'baseAdId preservado');
eq(pl.avatars, [], 'sem avatar no doc (botão manual resolve)');
eq(pl.bodySegments.length, 1, 'body vira 1 segmento (o split por tempo é do pipeline)');
eq(pl.hooks.length, 1, 'cada task tem 1 hook');

// ── AD inexistente ──
eq(parseDrMillionBriefing(DOC, 'AD99XX', 'pl'), null, 'AD que não existe devolve null');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
