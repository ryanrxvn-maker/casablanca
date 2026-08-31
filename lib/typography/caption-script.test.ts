/**
 * Testes do ROTEIRO DE LEGENDA (hook × body com letterings diferentes).
 *
 * O caso de referência é o lote WL PL de 17.08: hook em Vermelho Sangue
 * 120%/altura 50% e body em Keynote 100%/altura 70%, com a fronteira definida
 * pela CONTAGEM DE PALAVRAS do hook — e a armadilha do travessão solto, que
 * inflava a conta em 1 e travava um bloco a mais.
 */
import type { Block, TWord } from './engine';
import { emptyIdentity } from './blocks-edit';
import {
  applyCaptionScript,
  countScriptWords,
  defaultSegments,
  newSegmentId,
  relabelSegments,
  resolveCaptionScript,
  segmentsToTemplate,
  templateToSegments,
  TEMPLATE_1,
  TEMPLATE_2,
  TEMPLATE_3,
  TEMPLATE_4,
  BUILTIN_TEMPLATES,
  type CaptionSegment,
} from './caption-script';
import { groupWords } from './group';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

const FRASE =
  'Para prostata inchada nao existe nada melhor do que isso aqui ' +
  'A maioria das pessoas usa o azeite do jeito completamente errado todo dia';
const TOKENS = FRASE.split(' ');

function wordsFrom(tokens: string[]): TWord[] {
  return tokens.map((t, i) => ({ text: t, start: i * 300, end: i * 300 + 280 }));
}

const WORDS = wordsFrom(TOKENS);

function seg(over: Partial<CaptionSegment>): CaptionSegment {
  return {
    id: newSegmentId(),
    kind: 'body',
    label: 'Body',
    text: '',
    words: null,
    style: {},
    ...over,
  };
}

console.log('\n── contagem de palavras da copy ──');
{
  ok(countScriptWords('Para prostata inchada') === 3, '3 palavras contam 3');
  ok(
    countScriptWords('Para prostata — inchada') === 3,
    'travessão solto NÃO conta (a armadilha que empurrava a fronteira um bloco)',
  );
  ok(countScriptWords('  ...  “”  ') === 0, 'só pontuação = zero palavras');
  ok(countScriptWords('R$10 é 1 palavra') === 4, 'número com símbolo conta como palavra');
  ok(countScriptWords('') === 0, 'texto vazio = zero');
}

console.log('\n── resolver o roteiro contra os blocos ──');
{
  const blocks = groupWords(WORDS, 'equilibrado');
  const total = blocks.reduce((s, b) => s + b.words.length, 0);
  ok(total === TOKENS.length, `os ${TOKENS.length} tokens viraram ${blocks.length} blocos`);

  // hook = fronteira EXATA numa virada de bloco
  const nHook = blocks[0].words.length + blocks[1].words.length;
  const hookText = TOKENS.slice(0, nHook).join(' ');
  const r = resolveCaptionScript(blocks, [
    seg({ kind: 'hook', label: 'Hook', text: hookText }),
    seg({ kind: 'body', label: 'Body' }),
  ]);
  ok(r.segments[0].exact, 'fronteira que cai na virada de bloco é EXATA');
  ok(r.segments[0].to === 1 && r.segments[0].from === 0, 'o hook pegou os 2 primeiros blocos');
  ok(r.segments[0].got === nHook, `o hook fechou nas ${nHook} palavras pedidas`);
  ok(r.segments[1].from === 2, 'o body começa no bloco seguinte');
  ok(r.segments[1].to === blocks.length - 1, 'o body vazio leva TODO o resto');
  ok(r.leftover === 0, 'nada fica de fora');
  ok(r.segments[0].cut === null, 'fronteira exata não sugere corte');
  ok(
    r.segments[0].endMs === blocks[1].end && r.segments[1].startMs === blocks[2].start,
    'as janelas de tempo batem com os blocos escolhidos',
  );
}

{
  // hook que termina no MEIO de um bloco → sugere corte na palavra exata
  const blocks = groupWords(WORDS, 'equilibrado');
  const nHook = blocks[0].words.length + 1; // 1 palavra dentro do 2º bloco
  const r = resolveCaptionScript(blocks, [
    seg({ kind: 'hook', label: 'Hook', text: TOKENS.slice(0, nHook).join(' ') }),
    seg({ kind: 'body', label: 'Body' }),
  ]);
  ok(!r.segments[0].exact, 'fronteira no meio do bloco NÃO se declara exata (não mente)');
  ok(
    r.segments[0].cut?.blockId === blocks[1].id && r.segments[0].cut?.wordIndex === 1,
    'e sugere partir o 2º bloco antes da palavra 1',
  );
}

{
  // aplicar COM corte: a fronteira fica exata e o estilo cai certinho
  const blocks = groupWords(WORDS, 'equilibrado');
  const nHook = blocks[0].words.length + 1;
  const segs: CaptionSegment[] = [
    seg({
      kind: 'hook',
      label: 'Hook',
      text: TOKENS.slice(0, nHook).join(' '),
      style: { presetId: 'vermelho-sangue', fontScale: 1.2, posY: 0.5 },
    }),
    seg({ kind: 'body', label: 'Body', style: { presetId: 'keynote', fontScale: 1, posY: 0.7 } }),
  ];
  const r = applyCaptionScript(blocks, segs, emptyIdentity(), { splitAtBoundary: true });
  ok(r.splits === 1, 'partiu exatamente 1 bloco pra fechar a fronteira');
  ok(r.resolved.segments[0].exact, 'depois do corte a fronteira do hook é exata');
  ok(
    r.resolved.segments[0].got === nHook,
    `o hook ficou com as ${nHook} palavras da copy, nem uma a mais`,
  );

  const idsHook = new Set(r.resolved.segments[0].blockIds);
  const idsBody = new Set(r.resolved.segments[1].blockIds);
  ok(
    [...idsHook].every((id) => r.blockStyles[id]?.presetId === 'vermelho-sangue'),
    'todo bloco do hook ficou com o modelo do hook',
  );
  ok(
    [...idsBody].every((id) => r.blockStyles[id]?.presetId === 'keynote'),
    'todo bloco do body ficou com o modelo do body',
  );
  ok(
    [...idsHook].every((id) => r.blockStyles[id]?.posY === 0.5) &&
      [...idsBody].every((id) => r.blockStyles[id]?.posY === 0.7),
    'altura do hook e do body são diferentes, como o roteiro pede',
  );
  ok(
    [...idsHook, ...idsBody].every((id) => r.locked.includes(id)),
    'os blocos aplicados ficam TRAVADOS (um "aplicar a todas" não desfaz o roteiro)',
  );
  ok(
    [...idsHook].every((id) => !idsBody.has(id)),
    'nenhum bloco pertence ao hook e ao body ao mesmo tempo',
  );
  ok(
    r.resolved.segments[0].blockIds.length + r.resolved.segments[1].blockIds.length ===
      r.blocks.length,
    'hook + body cobrem todos os blocos, sem buraco',
  );
  const texto = r.blocks.flatMap((b) => b.words.map((w) => w.text)).join(' ');
  ok(texto === FRASE, 'o corte não perdeu nem duplicou nenhuma palavra');
}

{
  // aplicar SEM corte: encaixa no bloco mais próximo e diz que não foi exato
  const blocks = groupWords(WORDS, 'equilibrado');
  const nHook = blocks[0].words.length + 1;
  const r = applyCaptionScript(
    blocks,
    [
      seg({ kind: 'hook', label: 'Hook', text: TOKENS.slice(0, nHook).join(' '), style: { fontScale: 1.2 } }),
      seg({ kind: 'body', label: 'Body', style: { fontScale: 1 } }),
    ],
    emptyIdentity(),
    { splitAtBoundary: false },
  );
  ok(r.splits === 0, 'sem corte, nenhum bloco é partido');
  ok(r.blocks.length === blocks.length, 'e a lista de blocos fica do mesmo tamanho');
  ok(!r.resolved.segments[0].exact, 'e o relatório avisa que a fronteira não ficou exata');
}

console.log('\n── body dividido em partes ──');
{
  const blocks = groupWords(WORDS, 'rapido');
  const n0 = blocks[0].words.length;
  const n1 = blocks[1].words.length;
  const segs: CaptionSegment[] = relabelSegments([
    seg({ kind: 'hook', text: TOKENS.slice(0, n0).join(' '), style: { presetId: 'vermelho-sangue' } }),
    seg({ kind: 'body', text: TOKENS.slice(n0, n0 + n1).join(' '), style: { presetId: 'keynote' } }),
    seg({ kind: 'body', style: { presetId: 'faixa-suave' } }),
  ]);
  ok(
    segs.map((s) => s.label).join('|') === 'Hook|Body 1|Body 2',
    'os rótulos viram Hook / Body 1 / Body 2 sozinhos',
  );
  const r = applyCaptionScript(blocks, segs, emptyIdentity());
  const [h, b1, b2] = r.resolved.segments;
  ok(h.blockIds.length === 1 && b1.blockIds.length === 1, 'hook e body 1 pegaram 1 bloco cada');
  ok(b2.blockIds.length === blocks.length - 2, 'o body 2 levou todo o resto');
  ok(
    r.blockStyles[h.blockIds[0]]?.presetId === 'vermelho-sangue' &&
      r.blockStyles[b1.blockIds[0]]?.presetId === 'keynote' &&
      r.blockStyles[b2.blockIds[0]]?.presetId === 'faixa-suave',
    'cada parte do body ficou com a SUA legenda',
  );
}

console.log('\n── contagem manual e casos de borda ──');
{
  const blocks = groupWords(WORDS, 'equilibrado');
  const r = resolveCaptionScript(blocks, [
    seg({ kind: 'hook', text: 'texto que nao importa', words: blocks[0].words.length }),
    seg({ kind: 'body' }),
  ]);
  ok(r.segments[0].demand === blocks[0].words.length, 'a contagem manual vence o texto colado');
  ok(r.segments[0].exact && r.segments[0].to === 0, 'e fecha exatamente no 1º bloco');
}
{
  const blocks = groupWords(WORDS, 'equilibrado');
  const r = resolveCaptionScript(blocks, [
    seg({ kind: 'hook', words: 9999 }),
    seg({ kind: 'body', style: { fontScale: 2 } }),
  ]);
  ok(r.segments[0].to === blocks.length - 1, 'pedir mais palavras do que existe leva tudo');
  ok(r.segments[1].blockIds.length === 0, 'e o trecho seguinte fica vazio (sem estourar)');
  const ap = applyCaptionScript(blocks, [seg({ kind: 'hook', words: 9999 })], emptyIdentity());
  ok(ap.blocks.length === blocks.length, 'aplicar nesse caso não parte bloco nenhum');
}
{
  // hook ainda VAZIO nao pode engolir o video inteiro
  const blocks = groupWords(WORDS, 'equilibrado');
  const r = resolveCaptionScript(blocks, [
    seg({ kind: 'hook' }),
    seg({ kind: 'body' }),
  ]);
  ok(r.segments[0].blockIds.length === 0, 'hook sem copy nao leva bloco nenhum');
  ok(
    r.segments[1].blockIds.length === blocks.length,
    'e o body (ultimo, vazio) leva o video inteiro',
  );
  const ap = applyCaptionScript(
    blocks,
    [seg({ kind: 'hook', style: { fontScale: 9 } }), seg({ kind: 'body', style: { fontScale: 1 } })],
    emptyIdentity(),
  );
  ok(
    Object.values(ap.blockStyles).every((st) => st.fontScale === 1),
    'aplicar com hook vazio nao carimba o estilo do hook em lugar nenhum',
  );
}
{
  const vazio: Block[] = [];
  const r = resolveCaptionScript(vazio, defaultSegments());
  ok(r.segments.every((s) => s.blockIds.length === 0), 'sem blocos, o roteiro resolve vazio sem quebrar');
  const ap = applyCaptionScript(vazio, defaultSegments(), emptyIdentity());
  ok(ap.styled === 0 && ap.blocks.length === 0, 'e aplicar num vídeo sem legenda não faz nada');
}
{
  // roteiro aplicado NÃO apaga o cadeado/estilo que o user já tinha em outro bloco
  const blocks = groupWords(WORDS, 'equilibrado');
  const outro = blocks[blocks.length - 1];
  const ident = {
    locked: [outro.id],
    blockStyles: { [outro.id]: { italic: true } },
    wordStyles: { [outro.id]: { 0: { bold: true } } },
    highlights: { [outro.id]: [0] },
  };
  const r = applyCaptionScript(
    blocks,
    [seg({ kind: 'hook', words: blocks[0].words.length, style: { fontScale: 1.2 } }), seg({ kind: 'body' })],
    ident,
  );
  ok(r.blockStyles[outro.id]?.italic === true, 'o override manual anterior não é apagado');
  ok(r.wordStyles[outro.id]?.[0]?.bold === true, 'o estilo por palavra anterior sobrevive');
  ok(r.highlights[outro.id]?.[0] === 0, 'o destaque anterior sobrevive');
}

console.log('\n── templates ──');
{
  ok(TEMPLATE_1.segments[0].style.presetId === 'vermelho-sangue', 'Template 1: hook Vermelho Sangue');
  ok(TEMPLATE_1.segments[0].style.fontScale === 1.2, 'Template 1: hook 120%');
  ok(TEMPLATE_1.segments[0].style.posY === 0.5, 'Template 1: hook na altura 50%');
  ok(TEMPLATE_1.segments[1].style.presetId === 'keynote', 'Template 1: body Keynote');
  ok(TEMPLATE_1.segments[1].style.posY === 0.7, 'Template 1: body na altura 70%');
  ok(TEMPLATE_2.segments[0].style.presetId === 'extensao-script', 'Template 2: hook Extensão Script');
  ok(TEMPLATE_2.segments[1].style.presetId === 'faixa-suave', 'Template 2: body Faixa Suave');
  ok(TEMPLATE_3.segments[0].style.presetId === 'contraste', 'Template 3: hook Contraste');
  ok(TEMPLATE_3.segments[1].style.presetId === 'marca-texto', 'Template 3: body Marca-Texto');
  ok(TEMPLATE_4.segments[0].style.presetId === 'caixa-vermelha-ouro', 'Template 4: hook Caixa Vermelha Ouro');
  ok(TEMPLATE_4.segments[1].style.presetId === 'tarja-preta', 'Template 4: body Tarja Preta');
  ok(BUILTIN_TEMPLATES.length === 4, 'os 4 templates de fábrica estão na lista');

  // a regra que vale pra TODOS: hook centralizado e maior, body mais embaixo
  // e menor — se um template novo quebrar isso, o lote sai torto
  for (const t of BUILTIN_TEMPLATES) {
    const hook = t.segments.find((s) => s.kind === 'hook');
    const body = t.segments.find((s) => s.kind === 'body');
    ok(!!hook && !!body, `${t.name}: tem hook e body`);
    if (!hook || !body) continue;
    const h = hook.style;
    const bd = body.style;
    ok(h.posY === 0.5 && h.posX === 0.5, `${t.name}: hook centralizado`);
    ok(h.fontScale === 1.2, `${t.name}: hook a 120%`);
    ok(bd.posY === 0.7, `${t.name}: body mais embaixo`);
    ok(bd.fontScale === 1, `${t.name}: body a 100%`);
    ok(
      (h.fontScale ?? 0) > (bd.fontScale ?? 0) && (bd.posY ?? 0) > (h.posY ?? 0),
      `${t.name}: hook maior e acima do body`,
    );
  }

  // cada template tem de trazer um par PRÓPRIO — repetir lettering entre
  // templates faz o chip virar enfeite
  const usados = new Set<string>();
  for (const t of BUILTIN_TEMPLATES) {
    for (const s of t.segments) {
      const pid = s.style.presetId ?? '(sem preset)';
      ok(!usados.has(pid), `${t.name}: ${pid} não repete em outro template`);
      usados.add(pid);
    }
  }

  const atual = relabelSegments([
    seg({ kind: 'hook', text: 'meu hook colado' }),
    seg({ kind: 'body', text: 'meu body colado' }),
    seg({ kind: 'body', text: 'terceira parte' }),
  ]);
  const trocado = templateToSegments(TEMPLATE_2, atual);
  ok(
    trocado.map((s) => s.text).join('|') === 'meu hook colado|meu body colado|terceira parte',
    'trocar de template NÃO apaga a copy já colada',
  );
  ok(trocado.length === 3, 'o trecho extra do user sobrevive à troca de template');
  ok(
    trocado[2].style.presetId === 'faixa-suave',
    'o trecho extra herda o estilo do último trecho do template',
  );

  const salvo = segmentsToTemplate(trocado, 'Meu template', 'x1');
  ok(salvo.segments.length === 3 && !('text' in salvo.segments[0]), 'salvar como template guarda só os estilos');
  ok(salvo.name === 'Meu template' && salvo.id === 'x1', 'nome e id do template salvo');
}

console.log(falhas === 0 ? '\n✅ caption-script: tudo passou' : `\n❌ caption-script: ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
