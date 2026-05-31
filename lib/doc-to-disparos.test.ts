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
import { matchAvatar, parseAvatars } from './copy-parser';

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
  // role nas partes (input dos slots de avatar/voz no preview)
  assert(!!hook1 && (hook1.role || '').toLowerCase() === 'doutor', 'HOOK 1 carrega role "Doutor"');
  assert(!!hook2 && (hook2.role || '').toLowerCase() === 'mulher', 'HOOK 2 carrega role "Mulher"');
  // slots distintos por role = 2 (Doutor, Mulher)
  const roleKeys = Array.from(new Set(d1.parts.map((p) => (p.role || '').toLowerCase())));
  assert(roleKeys.length === 2, `AD139 tem 2 slots de avatar por role (got ${roleKeys.length})`);
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

/* ----------------- matchAvatar por ID (talking-photo @numero) ----------------- */
console.log('\nmatchAvatar por ID (avatar referenciado pelo id cru):');
const libWithId = [
  { id: '749477393444762056', name: 'Foto Avatar', groupName: 'Fotos', voiceName: '@vozqualquer' },
  { id: 'abc123', name: 'Outro', groupName: 'X', voiceName: '@outro' },
];
const mId = matchAvatar('@749477393444762056', libWithId);
assert(!!mId && mId.id === '749477393444762056', 'match exato por id (@749477393444762056)');
const mIdPrefix = matchAvatar('Avatar 749477393444762056.mp4', libWithId);
assert(!!mIdPrefix && mIdPrefix.id === '749477393444762056', 'match por id mesmo com prefixo "Avatar "');
const mIdNone = matchAvatar('@000000000000', libWithId);
assert(mIdNone === null || mIdNone.id !== '749477393444762056', 'id diferente NAO casa');

/* ----------------- convenção "AD01 - PV" (sufixo após traço) ----------------- */
console.log('\nconvenção AD01 - PV (sufixo após " - " + siblings AD01G1-PV):');
const DOC_PV = `
Instruções gerais para edição:
Cada anúncio abaixo deve ser feito duas versões.

AD01 - PV
Link do avatar: surgerv-2.mp4 - clonar voz
Instruções para edição: Edição mais UGC com poucos inserts.
https://www.tiktok.com/@viralmusichitsofficial/video/123
https://drive.google.com/drive/folders/abc

AD01G1-PV
Se teu amigão fica mole quando ela tá de boca, o viagra não vai resolver o seu problema…

AD01G2-PV
A diabetes, a pressão alta, não causam disfunção. Causa fuga venosa, por isso nada do que você toma resolve.

BODY
Existem 4 tipos de disfunção erétil. O seu médico diz que é um e as pílulas tratam outra. E tudo que você tentou foi feito para um problema que você não tem. O viagra é feito exatamente pra forçar o sangue entrar, mas se é só isso não resolve. Presta atenção nos próximos segundos que eu vou te explicar o caminho certo pra resolver isso de vez.

AD02 - PV
Link do avatar: surgerv-2.mp4 - clonar voz

AD02G1-PV
Outro gancho qualquer aqui pra testar o segundo anúncio do documento.

BODY
Corpo do segundo anúncio com bastante texto pra garantir que o split por tempo gere pelo menos um take de body sem cortar frase no meio do caminho.
`;
const CAND_PV: AvatarCandidate[] = [
  { id: 'av_surgerv', name: 'Surgerv', groupName: 'Surgerv', voiceName: '@surgerv-2', voiceId: 'v_surgerv' },
  { id: 'av_x', name: 'Outro', groupName: 'Outro', voiceName: '@naotem9', voiceId: 'v_x' },
];

const pvName = buildDisparosFromNomenclatures(DOC_PV, ['AD01 - PV'], CAND_PV);
console.log('  diagnostic =', pvName.diagnostic, '| parts =', pvName.disparos[0]?.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
assert(pvName.disparos.length === 1, 'AD01 - PV → 1 disparo');
if (pvName.disparos[0]) {
  const d = pvName.disparos[0];
  assert(d.fromDarkoBriefing, 'AD01 - PV parseado pelo DARKO (não genérico)');
  const hooks = d.parts.filter((p) => /^HOOK/.test(p.label));
  assert(hooks.length === 2, `AD01 tem 2 hooks (got ${hooks.length})`);
  assert(d.parts.some((p) => /^BODY/.test(p.label)), 'AD01 tem body');
  assert(d.parts.every((p) => p.avatarId === 'av_surgerv'), 'avatar surgerv-2 casado em todas as partes');
  const h1 = d.parts.find((p) => p.label === 'HOOK 1');
  assert(!!h1 && /viagra/i.test(h1.text), 'HOOK 1 = texto do AD01G1');
  assert(!!h1 && !/\.mp4|Link do avatar/i.test(h1.text), 'HOOK 1 sem avatar/link vazado');
}

console.log('\nAD01 - PV via auto-descoberta (toggle pegar todos):');
const pvAuto = buildDisparosFromDoc(DOC_PV, CAND_PV);
console.log('  detectedAdIds =', pvAuto.detectedAdIds);
assert(pvAuto.disparos.length === 2, `auto acha 2 ADs (got ${pvAuto.disparos.length})`);
assert(pvAuto.detectedAdIds.includes('AD01PV') && pvAuto.detectedAdIds.includes('AD02PV'), 'bases AD01PV + AD02PV');

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

/* ----------------- SLOTS de avatar/voz (replica a lógica do page) ----------------- */
// Replica buildSlotsForDisparo + a aplicação dos slots no enqueue (page.tsx),
// pra provar que trocar avatar/voz por speaker propaga certo pras partes.
type Slot = {
  role: string;
  roleLabel: string;
  avatarId: string | null;
  avatarName: string | null;
  defaultVoiceId: string | null;
  voiceOverride: { id: string; name: string } | null;
};
function buildSlots(d: { parts: Array<{ role: string | null; avatarId: string | null; avatarName: string | null; voiceId: string | null }> }): Slot[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const p of d.parts) {
    const key = (p.role || '').toLowerCase();
    if (!seen.has(key)) { seen.add(key); order.push(key); }
  }
  return order.map((key, idx) => {
    const part = d.parts.find((p) => (p.role || '').toLowerCase() === key)!;
    return {
      role: key,
      roleLabel: part.role || (order.length === 1 ? 'Avatar' : `Avatar ${idx + 1}`),
      avatarId: part.avatarId,
      avatarName: part.avatarName,
      defaultVoiceId: part.voiceId,
      voiceOverride: null,
    };
  });
}
function applySlots(
  d: { parts: Array<{ label: string; role: string | null; avatarId: string | null; avatarName: string | null; voiceId: string | null }> },
  slots: Slot[],
) {
  const byRole = new Map(slots.map((s) => [s.role, s]));
  return d.parts.map((p) => {
    const slot = byRole.get((p.role || '').toLowerCase()) || slots[0];
    return {
      label: p.label,
      avatarId: slot?.avatarId ?? p.avatarId,
      avatarName: slot?.avatarName ?? p.avatarName,
      voiceId: slot?.voiceOverride?.id ?? slot?.defaultVoiceId ?? p.voiceId,
    };
  });
}

console.log('\nslots de avatar/voz (troca por speaker propaga pras partes):');
{
  const dd = buildDisparosFromDoc(DOC, CANDIDATES).disparos.find((x) => x.baseAdId.toUpperCase().includes('AD139'))!;
  const slots = buildSlots(dd);
  assert(slots.length === 2, `2 slots (Doutor, Mulher) (got ${slots.length})`);
  assert(slots[0].avatarId === 'av_renato', 'slot Doutor inicia com Renato');
  assert(slots[1].avatarId === 'av_marcella', 'slot Mulher inicia com Marcella');

  // Troca o avatar do Doutor pra "av_outro" + voz custom
  slots[0] = { ...slots[0], avatarId: 'av_outro', avatarName: 'Outro Avatar', defaultVoiceId: 'voice_outro', voiceOverride: { id: 'voice_custom', name: 'Voz Custom' } };
  // Só troca a voz da Mulher (mantém avatar)
  slots[1] = { ...slots[1], voiceOverride: { id: 'voice_mulher_custom', name: 'Voz Mulher Custom' } };

  const finalParts = applySlots(dd, slots);
  const h1 = finalParts.find((p) => p.label === 'HOOK 1')!; // Doutor
  const h2 = finalParts.find((p) => p.label === 'HOOK 2')!; // Mulher
  const body = finalParts.filter((p) => /^BODY/.test(p.label));
  assert(h1.avatarId === 'av_outro' && h1.voiceId === 'voice_custom', 'HOOK 1 (Doutor) pegou avatar+voz trocados');
  assert(body.every((b) => b.avatarId === 'av_outro' && b.voiceId === 'voice_custom'), 'BODY (Doutor) também trocou junto');
  assert(h2.avatarId === 'av_marcella' && h2.voiceId === 'voice_mulher_custom', 'HOOK 2 (Mulher) manteve avatar e trocou só a voz');
}

/* ----------------- regressao: metadados nao viram avatar ----------------- */
// Bug reportado pelo user (screenshot AD30GL/PRPB06): linha
//   "Música de fundo: 📎 Scary Piano.mp4"
// virava avatar "Música de fundo" / "@Scary Piano" no card de análise.
// Causa: NON_AVATAR_PREFIXES nao cobria "Música de fundo" (nem outros
// metadados de producao tipo Cenário/Edição/Tipo de Legenda/Trilha).
console.log('\nregressao: metadados de producao nao viram avatar:');
{
  const docMeta = [
    'AD30GL - PRPB06',
    'Avatar e Vozes:',
    'Doutor: @vivasaudavel1.mp4',
    'Cenário:',
    'Manter a mesma voz dos avatares.',
    'Edição: Cinemáticas somente nas partes mencionadas no texto.',
    'Referência: 📎 VivaSaudavel.mp4',
    'Música de fundo: 📎 Scary Piano.mp4',
    'Referência:',
    'Tipo de Legenda: Sem legenda.',
    'Observações:',
    'Trilha: 📎 EpicCinematic.mp4',
    'Áudio referência: 📎 VoiceSample.mp4',
  ].join('\n');
  const av = parseAvatars(docMeta);
  console.log('  avatars =', av.map((a) => `${a.role}/${a.username}`));
  const usernames = av.map((a) => a.username.toLowerCase());
  const roles = av.map((a) => a.role.toLowerCase());
  assert(!usernames.some((u) => u.includes('scary')), 'Música de fundo NAO virou avatar (Scary Piano)');
  assert(!roles.some((r) => r.startsWith('música')), 'role "Música ..." rejeitado');
  assert(!roles.some((r) => r.startsWith('cenário')), 'role "Cenário" rejeitado');
  assert(!roles.some((r) => r.startsWith('edição')), 'role "Edição" rejeitado');
  assert(!roles.some((r) => r.startsWith('tipo de legenda')), 'role "Tipo de Legenda" rejeitado');
  assert(!roles.some((r) => r.startsWith('trilha')), 'role "Trilha" rejeitado');
  assert(!roles.some((r) => r.startsWith('áudio')), 'role "Áudio referência" rejeitado');
  assert(!roles.some((r) => r.startsWith('observa')), 'role "Observações" rejeitado');
  // Doutor real precisa CONTINUAR sendo detectado
  assert(roles.includes('doutor'), 'Doutor (avatar real) preservado');
}

/* ----------------- regressao: ClickUp attachment chip format ----------------- */
// User reportou (29/05/2026): docs reais do ClickUp tem o link como CHIP
// (atachment), nao como @username puro. Formatos comuns:
//   "Doutor: 📎 Viva Saudável_1330239768979913 (32 ativos).mp4"
//   "Doutor: 📎 Dicas Saude_1454126032545043 (17 dias - lateral)..."
// Antes do fix, reFullLine nao casava (parens dentro do filename) -> 0 avatares.
console.log('\nregressao: ClickUp attachment chip (📎) format:');
{
  const docChip = [
    'AD30GL - PRPB06',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Doutor: 📎 Viva Saudável_1330239768979913 (32 ativos).mp4',
  ].join('\n');
  const av = parseAvatars(docChip);
  console.log('  avatars =', av.map((a) => `${a.role}/${a.username}`));
  assert(av.length === 1, `1 avatar detectado (got ${av.length})`);
  assert(av[0]?.role.toLowerCase() === 'doutor', 'role = Doutor');
  assert(/viva\s*saud[áa]vel/i.test(av[0]?.username || ''), `username inclui "Viva Saudável" (got ${av[0]?.username})`);
  // Filename NAO deve carregar "(32 ativos)" nem ".mp4"
  assert(!/\(/.test(av[0]?.username || ''), 'username sem parens trailing');
  assert(!/\.mp4/i.test(av[0]?.username || ''), 'username sem .mp4');
}
{
  const docTrunc = [
    'AD34GL - PRPB06',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Doutor: 📎 Dicas Saude_1454126032545043 (17 dias ativos - escala lateral)...',
  ].join('\n');
  const av = parseAvatars(docTrunc);
  console.log('  avatars =', av.map((a) => `${a.role}/${a.username}`));
  assert(av.length === 1, `1 avatar detectado (chip truncado por ...) (got ${av.length})`);
  assert(av[0]?.role.toLowerCase() === 'doutor', 'role = Doutor');
  assert(/dicas\s*saude/i.test(av[0]?.username || ''), `username inclui "Dicas Saude" (got ${av[0]?.username})`);
  assert(!/\.{2,}/.test(av[0]?.username || ''), 'username sem "..." trailing');
  assert(!/\(/.test(av[0]?.username || ''), 'username sem parens trailing');
}
// Sanity: gatilho 📎 NAO deve criar avatar fantasma quando role e metadado
{
  const docBg = [
    'AD30GL - PRPB06',
    'Música de fundo: 📎 Scary Piano.mp4',
    'Cenário: 📎 sala-medica.mp4',
  ].join('\n');
  const av = parseAvatars(docBg);
  console.log('  bg-only avatars =', av.length);
  assert(av.length === 0, 'metadados com 📎 continuam bloqueados');
}

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
