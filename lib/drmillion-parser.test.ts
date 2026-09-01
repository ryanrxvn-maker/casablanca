/**
 * Testes do parser DR MILLION — em cima do texto REAL do doc
 * (grupo AD07: três hooks + um Body compartilhado, tudo PT/PL).
 */
import {
  parseDrMillionBriefing,
  extrairBlocos,
  isDrMillionFormat,
  idiomasDisponiveis,
  conferirCoberturaDaCopy,
  limparLinhaFalada,
  adGroupOf,
  marcadorDeDisparo,
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
eq(idiomasDisponiveis(DOC, 'AD07G1GL'), { pt: true, pl: true, hun: false },
   'AD07G1GL tem PT e PL — e nao acende a bandeira hungara');

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

// ── MARCADOR DE IDIOMA GRUDADO NO FIM DA LINHA (regressão do WL PL) ──
// O doc real escreve "...você comprou. PL" em vez de deixar o PL sozinho na
// linha. Sem tratar isso o parser nunca troca de idioma: o polonês inteiro cai
// no balde do português, o balde `pl` fica vazio e o fallback devolve AS DUAS
// línguas — metade do disparo sairia em português, caro e inútil.
{
  const DOC_GRUDADO = [
    'AD90GL - COD WL PL',
    'PT',
    'Essa gelatina mudou tudo pra mim.',
    'PL',
    'Ta galaretka wszystko u mnie zmieniła.',
    'Body',
    'PT',
    'Eu perdi trinta quilos com essa receita.',
    'Clique no botao abaixo e me conte. PL',
    'Moje koleżanki śmiały się ze mnie.',
    // marcador colado no COMEÇO da linha — a forma mais comum no doc real
    'PT Minhas amigas riram de mim quando contei sobre a receita.',
    'PL Ja sama straciłam trzydzieści kilogramów.',
  ].join('\n');
  const so_pl = parseDrMillionBriefing(DOC_GRUDADO, 'AD90GL', 'pl');
  const texto = (so_pl?.hooks || []).map((h) => h.text).join(' ') + ' ' + (so_pl?.body || '');
  ok(/koleżanki/.test(texto), 'polonês entrou');
  ok(!/gelatina mudou tudo/.test(texto), 'português NÃO vaza pro disparo em PL');
  ok(!/Clique no botao abaixo/.test(texto), 'a linha que carrega o marcador no FIM fica no PT');
  ok(!/Minhas amigas riram/.test(texto), 'marcador no COMEÇO: português não vaza pro PL');
  ok(/straciłam trzydzieści/.test(texto), 'marcador no COMEÇO: a fala depois dele entra no PL');
  const so_pt = parseDrMillionBriefing(DOC_GRUDADO, 'AD90GL', 'pt');
  const tpt = (so_pt?.hooks || []).map((h) => h.text).join(' ') + ' ' + (so_pt?.body || '');
  ok(/Clique no botao abaixo/.test(tpt), 'a fala antes do marcador continua sendo PT');
  ok(!/koleżanki/.test(tpt), 'polonês não vaza pro PT');
}

// ---------------------------------------------------------------------------
// Forma REAL do doc WL PL (16.08). Cada caso aqui custou um disparo errado.
{
  const DOC_WLPL = [
    'AD41 a 42',                              // capa de bloco: nao e um AD
    'Instrucoes gerais para edicao:',
    'AD41GL - COD WL PL',                     // secao de BRIEFING (sem fala)
    'BRIEFING PARA O COPY: Copy do AD15G1GL mudando o avatar.',
    'Avatar e Vozes:',
    'Mulher UGC: AD minerado no organico 1',
    'AD41G1GL - COD WL PL',                   // o hook de verdade
    'PT',
    '',
    'Ela me disse que eu nao ia caber na porta.',
    'PL',
    '',
    'Powiedziala mi, ze nie zmieszcze sie w drzwiach.',
    'Body',
    'PT',
    'Minhas amigas riram de mim.',
    'PL',
    'Marek Skoczylas:',                       // rotulo de quem fala, nao e fala
    'Moje kolezanki smialy sie ze mnie.',
    'P',                                      // resto de marcador quebrado
    'Marek Skoczylas + Anita Werner',         // rotulo de dupla, sem dois-pontos
    'Kliknij przycisk teraz.',
    'AD42 a 52',                              // capa do proximo lote
    'Instrucoes gerais para edicao:',
    'Os criativos sao para META, YOUTUBE, TIKTOK E KWAI.',
    'FAZER CAMUFLAGEM DE AUDIOS SOMENTE NAS VERSOES DO YOUTUBE E KWAI',
    'LINK DA PASTA DOS ARQUIVOS PARA OS CRIATIVOS:',
    'CRIATIVOS',
  ].join('\n');

  // A task no ClickUp se chama "AD41 - GL - COD WL PL" -> o Pilot extrai "AD41",
  // que no doc NAO existe como heading. Sem o fallback por grupo o parser
  // devolvia null, o Pilot caia no parser comum e o avatar falava PT+PL.
  ok(isDrMillionFormat(DOC_WLPL, 'AD41'), 'id do grupo ("AD41") acha o hook AD41G1GL');
  const bWl = parseDrMillionBriefing(DOC_WLPL, 'AD41', 'pl')!;
  const falado = [bWl.hooks.map((h) => h.text).join(' '), bWl.body || ''].join(' ');
  ok(/Powiedziala mi/.test(falado), 'hook PL entrou pelo id do grupo');
  ok(!/BRIEFING PARA O COPY/.test(falado), 'secao de briefing nao vira fala');
  ok(!/Avatar e Vozes/.test(falado), 'rotulo de briefing nao vira fala');
  ok(!/Ela me disse/.test(falado), 'hook PT nao vaza');
  ok(!/Minhas amigas/.test(falado), 'body PT nao vaza');
  ok(/Moje kolezanki/.test(falado), 'body PL entrou');
  ok(!/Marek Skoczylas/.test(falado), 'rotulo de quem fala nao vira fala');
  ok(!/(^|\s)P(\s|$)/.test(falado), 'resto de marcador ("P") nao vira fala');
  ok(!/Instrucoes gerais/.test(falado), 'capa do proximo lote fecha o body');
  ok(!/CRIATIVOS/.test(falado), 'capa de entrega nao vaza pro fim do body');
}

// ---------------------------------------------------------------------------
// Rede de seguranca: a copy do idioma saiu INTEIRA nos takes?
{
  const DOC_C = [
    'AD70G1GL - COD WL PL',
    'PT',
    'Gancho em portugues.',
    'PL',
    'Hak po polsku.',
    'Body',
    'PT',
    'Corpo em portugues.',
    'PL',
    'Pierwsze zdanie ciala.',
    'Drugie zdanie ciala.',
    'Trzecie zdanie ciala.',
  ].join('\n');

  const b = parseDrMillionBriefing(DOC_C, 'AD70G1GL', 'pl')!;
  const takes = [b.hooks[0].text, ...b.bodySegments.map((s) => s.text)];
  eq(conferirCoberturaDaCopy(DOC_C, 'AD70G1GL', 'pl', takes).faltando.length, 0,
     'copy inteira nos takes = nada faltando');

  // take some -> a linha dele tem que ser apontada
  const semUm = conferirCoberturaDaCopy(DOC_C, 'AD70G1GL', 'pl', [b.hooks[0].text]);
  ok(semUm.faltando.some((l) => /Drugie zdanie/.test(l)), 'fala perdida e apontada pelo texto');
  eq(semUm.faltando.length, 3, 'aponta as 3 linhas do corpo que ficaram de fora');

  // o split por duracao pode PARTIR uma linha entre dois takes — isso e legitimo
  const partido = conferirCoberturaDaCopy(DOC_C, 'AD70G1GL', 'pl', [
    'Hak po polsku.',
    'Pierwsze zdanie ciala. Drugie',
    'zdanie ciala. Trzecie zdanie ciala.',
  ]);
  eq(partido.faltando.length, 0, 'linha partida entre dois takes nao conta como perda');

  // e o idioma cobrado e o ESCOLHIDO
  eq(conferirCoberturaDaCopy(DOC_C, 'AD70G1GL', 'pt', takes).faltando.length, 2,
     'em PT, cobra a copy portuguesa (que nao esta nos takes de PL)');
}

// ─────────────────────────────────────────────────────────────────────────────
// DIALETO TABELA — os marcadores vêm em linhas CONSECUTIVAS
//
// Medido em 01.09 nos docs WL2 e ED BAK HUN: o Docs renderiza a tabela de duas
// colunas como cabeçalho + células, então o texto sai
//
//     PT            <- cabeçalho da coluna 1
//     PL            <- cabeçalho da coluna 2
//     <fala pt>     <- célula 1
//     <fala pl>     <- célula 2
//
// e não PT/<fala>/PL/<fala>. Sem tratar, o parser troca de idioma duas vezes
// seguidas e as DUAS línguas caem no balde do SEGUNDO idioma — a mesma copy
// bilíngue dos 319 takes de 16/08, com outra cara.
// ─────────────────────────────────────────────────────────────────────────────
{
  const DOC_TAB = [
    'AD01GL - WL2',
    'BRIEFING PARA O COPY: Copy do AD15G1GL - COD WL PL adaptada para a WL2.',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Mulher: WL-VTPAD-POL34H1.mp4',
    'Tipo de Legenda: Sem legenda.',
    'Observações:',
    'Hook - AD1',
    'PT',
    'PL',
    'Ela me disse que em alguns dias eu não ia caber na porta de entrada.',
    'Powiedziała mi, że za kilka dni nie zmieszczę się w drzwiach wejściowych.',
    'Body - AD1',
    'PT',
    'PL',
    'Meu marido riu de mim quando contei sobre essa receita.',
    'Mój mąż śmiał się ze mnie, kiedy opowiedziałam mu o tym przepisie.',
  ].join('\n');

  const t = extrairBlocos(DOC_TAB, 'AD01')!;
  ok(!!t, 'dialeto tabela: acha os blocos');
  eq(t.hook.pt, ['Ela me disse que em alguns dias eu não ia caber na porta de entrada.'],
     'tabela: o hook PT fica SÓ com a linha portuguesa');
  eq(t.hook.pl, ['Powiedziała mi, że za kilka dni nie zmieszczę się w drzwiach wejściowych.'],
     'tabela: o hook PL fica SÓ com a linha polonesa');
  eq(t.body.pt, ['Meu marido riu de mim quando contei sobre essa receita.'],
     'tabela: o body PT não leva a linha polonesa junto');
  eq(t.body.pl, ['Mój mąż śmiał się ze mnie, kiedy opowiedziałam mu o tym przepisie.'],
     'tabela: o body PL fica só com a polonesa');
  ok(!t.body.pl.join(' ').includes('Meu marido'),
     'tabela: NENHUMA linha portuguesa vazou pro balde de disparo');
}

// ── idioma HUN (3 letras) — o lote ED BAK HUN ────────────────────────────────
// "HU" não casa "HUN": sem a forma de três letras o marcador virava RÓTULO DE
// FALANTE e o húngaro inteiro ia parar no balde do português.
{
  const DOC_HUN = [
    'AD01GL - ED BAK HUN',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes: @emelinaweiland 1.mp4',
    'Observações:',
    'AD01G1GL - ED BAK HUN',
    'PT',
    'HUN',
    'Senhores, fiquem longe desse segredo dos atores.',
    'Uraim, tartsátok magatokat távol a pornószínészek titkától.',
    'Body',
    'PT',
    'HUN',
    'Mulheres, preciso avisá-las.',
    'Hölgyek, figyelmeztetnem kell benneteket.',
  ].join('\n');

  const h = extrairBlocos(DOC_HUN, 'AD01')!;
  ok(!!h, 'HUN: acha os blocos');
  eq(h.hook.pt, ['Senhores, fiquem longe desse segredo dos atores.'],
     'HUN: português fica no balde PT');
  eq(h.hook.pl, ['Uraim, tartsátok magatokat távol a pornószínészek titkától.'],
     'HUN: o húngaro entra no balde de DISPARO (pl), que é o nome do campo no contrato');
  eq(h.body.pl, ['Hölgyek, figyelmeztetnem kell benneteket.'],
     'HUN: body no balde de disparo');
  ok(!h.hook.pl.join(' ').includes('Senhores'), 'HUN: português NÃO vazou pro disparo');
  ok(!h.hook.pt.join(' ').includes('Uraim'), 'HUN: húngaro NÃO vazou pro guia');

  // a UI precisa saber QUAL bandeira acender: pl e hun dividem o balde, entao
  // quem decide e o MARCADOR que o doc usa, nao o conteudo do balde.
  eq(idiomasDisponiveis(DOC_HUN, 'AD01'), { pt: true, pl: false, hun: true },
     'HUN: acende a bandeira hungara e NAO a polonesa');
  eq(marcadorDeDisparo(DOC_HUN, 'AD01'), 'hun', 'HUN: marcador detectado');
  eq(marcadorDeDisparo(DOC, 'AD07G1GL'), 'pl', 'PL: marcador continua polones');

  // e o disparo em hun tem que trazer o hungaro, nao o portugues
  const phun = parseDrMillionBriefing(DOC_HUN, 'AD01', 'hun')!;
  ok(/Uraim/.test(phun.hooks[0].text), 'lang=hun traz o hungaro');
  ok(!/Senhores/.test(phun.hooks[0].text), 'lang=hun nao traz o portugues');
}

console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(fails ? 1 : 0);
