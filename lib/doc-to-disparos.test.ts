/**
 * Teste isolado do doc-to-disparos. Compila com tsc (ver package.json) e roda
 * em node. Cobre: descoberta multi-AD, parser DARKO G[N]=Hook[N], match de
 * avatar por role/voz, e fila com 2 ADs.
 *
 *   npx tsc lib/copy-parser.ts lib/heygen-extension-bridge.ts lib/doc-to-disparos.ts lib/doc-to-disparos.test.ts \
 *     --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck
 *   node .test-tmp/doc-to-disparos.test.js
 */

import {
  buildDisparosFromDoc,
  buildDisparosFromNomenclatures,
  extractAdIds,
  discoverBaseAdIds,
  toBaseAdId,
  type AvatarCandidate,
} from './doc-to-disparos';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ok  ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL ${msg}`);
  }
}

/* ----------------- toBaseAdId ----------------- */
console.log('toBaseAdId:');
assert(toBaseAdId('AD139G1GL') === 'AD139GL', 'remove G1 infix → AD139GL');
assert(toBaseAdId('AD139GL') === 'AD139GL', 'base sem G mantem');
assert(toBaseAdId('AD23G2VN') === 'AD23VN', 'AD23G2VN → AD23VN');
assert(toBaseAdId('ad23vn') === 'AD23VN', 'uppercase');

/* ----------------- doc sintetico (2 ADs) ----------------- */
const DOC = `
Briefing semana — DARKO LAB

AD139GL - VFPB04
Avatar:
Doutor: @renatomartins1.mp4
Mulher: @marcella.malvar2.mp4

Instruções para edição:
Coloca legenda amarela e zoom no rosto.

AD139G1GL-VFPB04
Doutor:
Você sabia que 9 em cada 10 homens ignoram esse sintoma simples?

AD139G2GL-VFPB04
Mulher:
Meu marido mudou completamente depois que descobriu isso.

Body
Doutor:
Existe um detalhe que a maioria dos médicos não te conta sobre a próstata. E hoje eu vou te explicar exatamente o que fazer pra resolver de uma vez por todas, sem remédio caro e sem cirurgia. Presta muita atenção nos próximos segundos porque isso pode mudar a sua vida inteira a partir de agora.

AD200GL - PRPB01
Avatar:
Homem: @joaopedro5.mp4

AD200G1GL-PRPB01
Homem:
Para tudo o que você está fazendo e escuta isso com atenção total agora.

Body
Homem:
Esse é o segredo que separa quem tem energia o dia inteiro de quem vive cansado. Eu testei por trinta dias e o resultado foi absurdo, então deixa eu te mostrar o passo a passo completo pra você aplicar ainda hoje sem complicação nenhuma.
`;

const CANDIDATES: AvatarCandidate[] = [
  { id: 'av_renato', name: 'Renato Martins', groupName: 'Renato', voiceName: '@renatomartins1', voiceId: 'voice_renato' },
  { id: 'av_marcella', name: 'Marcella Malvar', groupName: 'Marcella', voiceName: '@marcella.malvar2', voiceId: 'voice_marcella' },
  { id: 'av_joao', name: 'Joao Pedro', groupName: 'Joao', voiceName: '@joaopedro5', voiceId: 'voice_joao' },
  { id: 'av_outro', name: 'Outro Avatar', groupName: 'Outro', voiceName: '@naousar9', voiceId: 'voice_outro' },
];

console.log('\ndiscoverBaseAdIds:');
const bases = discoverBaseAdIds(DOC);
console.log('  bases =', bases);
assert(bases.includes('AD139GL'), 'descobriu AD139GL');
assert(bases.includes('AD200GL'), 'descobriu AD200GL');
assert(!bases.includes('AD139G1GL'), 'NAO duplica sibling AD139G1GL');

console.log('\nbuildDisparosFromDoc (fila multi-AD):');
const res = buildDisparosFromDoc(DOC, CANDIDATES);
console.log('  diagnostic =', res.diagnostic);
assert(res.disparos.length === 2, `2 disparos na fila (got ${res.disparos.length})`);

const d1 = res.disparos.find((d) => d.baseAdId.toUpperCase().includes('AD139'));
const d2 = res.disparos.find((d) => d.baseAdId.toUpperCase().includes('AD200'));
assert(!!d1, 'disparo AD139 existe');
assert(!!d2, 'disparo AD200 existe');

if (d1) {
  console.log('  AD139 parts:', d1.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
  assert(d1.fromDarkoBriefing, 'AD139 veio do parser DARKO');
  const hooks = d1.parts.filter((p) => /^HOOK/.test(p.label));
  assert(hooks.length === 2, `AD139 tem 2 hooks (got ${hooks.length})`);
  const hook1 = d1.parts.find((p) => p.label === 'HOOK 1');
  assert(!!hook1 && hook1.avatarId === 'av_renato', 'HOOK 1 (Doutor) → Renato');
  const hook2 = d1.parts.find((p) => p.label === 'HOOK 2');
  assert(!!hook2 && hook2.avatarId === 'av_marcella', 'HOOK 2 (Mulher) → Marcella');
  const body = d1.parts.filter((p) => /^BODY/.test(p.label));
  assert(body.length >= 1, `AD139 tem body (got ${body.length})`);
  assert(body.every((b) => b.avatarId === 'av_renato'), 'BODY (Doutor) → Renato');
  // Texto sanitizado: nao deve conter o filename nem o label "Doutor:"
  assert(!!hook1 && !/@renatomartins1|\.mp4/i.test(hook1.text), 'HOOK 1 sem filename vazado');
  assert(!!hook1 && !/^Doutor:/i.test(hook1.text.trim()), 'HOOK 1 sem label Doutor vazado');
}

if (d2) {
  console.log('  AD200 parts:', d2.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
  assert(d2.parts.every((p) => p.avatarId === 'av_joao'), 'AD200 todas as partes → Joao');
  assert(d2.unmatchedAvatars.length === 0, 'AD200 sem avatares nao-casados');
}

/* ----------------- single AD (modo handoff) ----------------- */
console.log('\nonlyBaseAdId (single):');
const single = buildDisparosFromDoc(DOC, CANDIDATES, { onlyBaseAdId: 'AD139GL' });
assert(single.disparos.length === 1, 'restringe a 1 disparo');
assert(!!single.disparos[0] && single.disparos[0].baseAdId.toUpperCase().includes('AD139'), 'disparo certo');

/* ----------------- extractAdIds (igual runParser do clickup-pilot) ----------------- */
console.log('\nextractAdIds:');
const e1 = extractAdIds('AD139GL - VFPB04');
assert(e1.baseAdId === 'AD139GL', 'base de "AD139GL - VFPB04" → AD139GL');
assert(e1.fullAdId === 'AD139GL - VFPB04', 'full preservado');
const e2 = extractAdIds('AD200GL - PRPB01 - extra');
assert(e2.baseAdId === 'AD200GL', 'base de "AD200GL - PRPB01 - extra" → AD200GL');

/* ----------------- buildDisparosFromNomenclatures (campos digitados) ----------------- */
console.log('\nbuildDisparosFromNomenclatures (campos do user):');
const byName = buildDisparosFromNomenclatures(DOC, ['AD139GL - VFPB04', 'AD200GL - PRPB01'], CANDIDATES);
console.log('  diagnostic =', byName.diagnostic);
assert(byName.disparos.length === 2, `2 disparos pelas nomenclaturas (got ${byName.disparos.length})`);
assert(byName.notFound.length === 0, 'nenhuma nomenclatura perdida');
assert(byName.disparos[0].baseAdId === 'AD139GL - VFPB04', 'preserva a nomenclatura digitada como nome');
const h1 = byName.disparos[0].parts.find((p) => p.label === 'HOOK 1');
assert(!!h1 && h1.avatarId === 'av_renato', 'match de avatar igual o auto (HOOK 1 → Renato)');

console.log('\nnomenclatura inexistente:');
const miss = buildDisparosFromNomenclatures(DOC, ['AD999XX - NOPE', 'AD139GL'], CANDIDATES);
assert(miss.disparos.length === 1, 'acha só o que existe');
assert(miss.notFound.includes('AD999XX - NOPE'), 'reporta o não-encontrado');

/* ----------------- copy crua sem nomenclatura AD ----------------- */
console.log('\ncopy crua (sem heading AD):');
const RAW = `HOOK 1:
Você sente cansaço o tempo todo mesmo dormindo bem?

BODY:
Existe uma explicação simples pra isso e hoje eu vou te mostrar o passo a passo completo pra recuperar sua energia já a partir de amanhã sem remédio nenhum.`;
const rawRes = buildDisparosFromDoc(RAW, CANDIDATES);
console.log('  diagnostic =', rawRes.diagnostic, '| parts =', rawRes.disparos[0]?.parts.map((p) => p.label));
assert(rawRes.disparos.length === 1, 'copy crua → 1 disparo');
assert(!!rawRes.disparos[0] && rawRes.disparos[0].parts.length >= 2, 'copy crua → HOOK + BODY parseados');

/* ----------------- doc vazio ----------------- */
console.log('\nedge cases:');
const empty = buildDisparosFromDoc('', CANDIDATES);
assert(empty.disparos.length === 0, 'doc vazio → 0 disparos');

console.log('');
if (failures > 0) {
  console.error(`✗ ${failures} assert(s) falharam`);
  process.exit(1);
} else {
  console.log('✓ todos os asserts passaram');
}
