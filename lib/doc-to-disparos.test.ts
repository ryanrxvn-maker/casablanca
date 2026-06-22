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
import { matchAvatar, parseAvatars, parseVABriefing, parseDarkoBriefing, extractAvatarFileTokens, type DocLink } from './copy-parser';

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

/* ----------------- regressao: multi-avatar por CHIP no body (AD40G1VN) ----------------- */
// Bug reportado (12/06/2026, screenshot AD40G1VN - VRWA02): doc com
//   "Link do avatar: a.mp4 + b.mp4 + c.mp4 + <numerico>.mp4" no topo
// e o body separando as falas por CHIP do filename do avatar (linha
// "monetzamoraa3.mp4" sozinha antes de cada bloco) — em vez de labels
// "Mulher:"/"Doutor:". Antes do fix: 0 hooks (GANCHO comido pelo sanitizer)
// + body inteiro indo pra 1 avatar (chip nao virava boundary de speaker).
console.log('\nregressao: multi-avatar por chip no body (AD40G1VN):');
{
  const DOC_CHIP_BODY = [
    'AD40G1VN - VRWA02',
    'Link do avatar: monetzamoraa3.mp4 + nanychan_uwu.mp4 + gihribeiroo20.mp4 + 7494773934441762056.mp4',
    'Instruções para edição: Edição mais UGC com poucos inserts usando imagens em duplo sentido.',
    'https://drive.google.com/drive/folders/abc',
    '',
    'GANCHO',
    'Este é o segredo sujo para satisfazer quatro namoradas aos 67 anos. Ah… E você não vai nem cansar.',
    '',
    'BODY',
    'monetzamoraa3.mp4',
    'Preste muita atenção, porque vamos ensinar apenas uma vez.',
    'Toda mulher sabe que quanto mais grosso e maior, mais a gente sente prazer.',
    'Porque o mangote vai atingir todos os nossos pontos de prazer…',
    '',
    'nanychan_uwu.mp4',
    'Nós vamos mostrar como fazer esse truque com 3 ingredientes naturais, que quando misturados são 11 vezes mais fortes do que qualquer tadala e azulzinho.',
    'O homem que faz esse truque vai virar o rambo, preparado para atirar quando precisar.',
    '',
    'gihribeiroo20.mp4',
    'Quem apresentou essa receita pra gente foi nossa vizinha lá do condomínio.',
    'Uma noite a gente escutou ela gemendo horrores e a gente tinha que saber qual era o segredo do marido dela.',
    '',
    '7494773934441762056.mp4',
    'Só não faz igual ao nosso namorado.',
    'Ele exagerou na dose e além de me arrombar toda, ficou com o amigão duro a noite inteira.',
  ].join('\n');
  const CAND_CHIP: AvatarCandidate[] = [
    { id: 'av_monet', name: 'Monet Zamora', groupName: 'Monet', voiceName: '@monetzamoraa3', voiceId: 'v_monet' },
    { id: 'av_nany', name: 'Nany Chan', groupName: 'Nany', voiceName: '@nanychan_uwu', voiceId: 'v_nany' },
    { id: 'av_gih', name: 'Gih Ribeiro', groupName: 'Gih', voiceName: '@gihribeiroo20', voiceId: 'v_gih' },
    { id: '7494773934441762056', name: 'Foto TP', groupName: 'Fotos', voiceName: '@tpvoice', voiceId: 'v_tp' },
  ];
  const r = buildDisparosFromNomenclatures(DOC_CHIP_BODY, ['AD40VN - VRWA02'], CAND_CHIP);
  console.log('  diagnostic =', r.diagnostic);
  assert(r.disparos.length === 1, `AD40 → 1 disparo (got ${r.disparos.length})`);
  const d = r.disparos[0];
  if (d) {
    console.log('  AD40 parts:', d.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
    assert(d.fromDarkoBriefing, 'AD40 parseado pelo DARKO');
    // Bug 2: GANCHO recuperado (sanitizer nao comeu mais a fala).
    const hooks = d.parts.filter((p) => /^HOOK/.test(p.label));
    assert(hooks.length === 1, `AD40 tem 1 hook (got ${hooks.length})`);
    const hook1 = hooks[0];
    assert(!!hook1 && /segredo sujo/i.test(hook1.text), 'HOOK 1 = texto real do GANCHO ("segredo sujo")');
    assert(!!hook1 && !/Link do avatar|\.mp4/i.test(hook1.text), 'HOOK 1 sem metadados/link vazado');
    // Bug 1: cada bloco do body vai pro avatar do seu chip — nao tudo no 1o.
    const body = d.parts.filter((p) => /^BODY/.test(p.label));
    assert(body.length >= 4, `AD40 tem >=4 partes de body (got ${body.length})`);
    const findPart = (kw: RegExp) => d.parts.find((p) => kw.test(p.text));
    const pMonet = findPart(/mangote|grosso e maior/i);
    const pNany = findPart(/ingredientes naturais|rambo/i);
    const pGih = findPart(/vizinha|condomínio/i);
    const pTp = findPart(/Só não faz igual|amigão duro/i);
    assert(!!pMonet && pMonet.avatarId === 'av_monet', 'bloco 1 → monetzamoraa3 (Monet)');
    assert(!!pNany && pNany.avatarId === 'av_nany', 'bloco 2 → nanychan_uwu (Nany)');
    assert(!!pGih && pGih.avatarId === 'av_gih', 'bloco 3 → gihribeiroo20 (Gih)');
    assert(!!pTp && pTp.avatarId === '7494773934441762056', 'bloco 4 → talking-photo numerico');
    // Nenhum chip vazou pra fala (avatar nao recita o filename).
    assert(d.parts.every((p) => !/\.(mp4|mov)\b/i.test(p.text)), 'nenhum filename de chip vazou no texto');
    // Todas as 4 identidades distintas aparecem (nao colapsou no 1o avatar).
    const ids = new Set(body.map((p) => p.avatarId));
    assert(ids.size === 4, `body usa os 4 avatares distintos (got ${ids.size})`);
    assert(body.every((p) => !!p.avatarId), 'nenhuma parte de body sem avatar (fallback)');
  }
}

/* ----------------- regressao: convencao INVERTIDA (copy sob a base, metadata sob G1) ----------------- */
// Bug reportado (13/06/2026, AD14GL - VRWA02 - AVA05): doc com DUAS headings —
//   "AD14G1GL - VRWA02 - AVA05"  → so metadados (INSTRUÇÕES, avatar, refs)
//   "AD14GL - VRWA02 - AVA05"    → a copy real (hook + Body)
// findGSiblings so via a G1 (metadata) -> "0 hooks + 0 body splits" com 1
// avatar detectado. A copy estava sob a heading BASE (sem G), que o parser de
// G-siblings nunca olhava.
console.log('\nregressao: convencao invertida (copy sob a base AD, metadata sob G1):');
{
  const DOC_INV = [
    'AD14G1GL - VRWA02 - AVA05',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Muher: 📎 aaliiceeofc__.mp4',
    'Manter a mesma voz dos avatares, a não ser que seja um avatar gringo.',
    'Edição: Edição dopaminérgica;',
    'Referência:',
    'Atenção na Voz: Gerar o áudio no Eleven Labs (elevenlabs.io). Selecionar o sotaque Brasileiro.',
    'Referência de um áudio natural: 📎 Áudio ElevenLabs AD107GL.mp3',
    'Música de fundo: Música animada e batida forte.',
    'Referência:',
    'https://www.tiktok.com/@viralmusichitsofficial/video/123',
    'Tipo de Legenda:',
    'Observações:',
    '',
    'AD14GL - VRWA02 - AVA05',
    'Eu dormi com mais de mil homens e sempre usei esse Viagra de Pobre neles pro amigão ficar duro o tempo que eu quisesse.',
    '',
    'Body',
    'Isso vai me complicar, mas eu vou contar.',
    'Tem o truque caseiro que deixa qualquer ferramenta firme como pedra, e funciona pra qualquer homem de qualquer idade sem depender de remédio caro nem receita de médico nenhum.',
    'Presta atenção nos próximos segundos porque eu vou te ensinar o passo a passo completo agora.',
  ].join('\n');
  const CAND_INV: AvatarCandidate[] = [
    { id: 'av_alice', name: 'Alice OFC', groupName: 'Alice', voiceName: '@aaliiceeofc__', voiceId: 'v_alice' },
    { id: 'av_y', name: 'Outro', groupName: 'Outro', voiceName: '@naotem9', voiceId: 'v_y' },
  ];
  const r = buildDisparosFromNomenclatures(DOC_INV, ['AD14GL - VRWA02 - AVA05'], CAND_INV);
  console.log('  diagnostic =', r.diagnostic);
  assert(r.disparos.length === 1, `AD14GL → 1 disparo (got ${r.disparos.length})`);
  const d = r.disparos[0];
  if (d) {
    console.log('  AD14GL parts:', d.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
    assert(d.fromDarkoBriefing, 'AD14GL parseado pelo DARKO');
    const hooks = d.parts.filter((p) => /^HOOK/.test(p.label));
    const body = d.parts.filter((p) => /^BODY/.test(p.label));
    // Bug: antes era 0 hooks + 0 body. Agora a copy da base e recuperada.
    assert(hooks.length === 1, `AD14GL tem 1 hook (got ${hooks.length})`);
    assert(!!hooks[0] && /dormi com mais de mil/i.test(hooks[0].text), 'HOOK = texto real da base ("dormi com mais de mil")');
    assert(!!hooks[0] && !/INSTRU|Eleven Labs|Referência|\.mp3/i.test(hooks[0].text), 'HOOK sem metadados vazados');
    assert(body.length >= 1, `AD14GL tem body (got ${body.length})`);
    assert(d.parts.some((p) => /truque caseiro/i.test(p.text)), 'body contem a fala real ("truque caseiro")');
    // 1 unico avatar (Muher/aaliiceeofc__) fala tudo.
    assert(d.parts.every((p) => p.avatarId === 'av_alice'), 'todas as partes → aaliiceeofc__ (1 avatar)');
    assert(d.parts.every((p) => !/INSTRU|Música de fundo|Tipo de Legenda/i.test(p.text)), 'nenhum metadado vazou na fala');
  }
}

/* ----------------- regressao: VARIANTES do mesmo AD no mesmo doc (F2/P1/AVA05) ----------------- */
// Bug reportado (13/06/2026, AD14GL F2 vs P1): doc com VARIAS variantes do
// mesmo AD ("- F2", "- P1", "- AVA05"), cada uma com metadata + copy proprias.
// Todas casam baseAdId "AD14GL" -> findAdSection FUNDIA tudo numa secao e
// poçava avatares/copy de variantes diferentes: F2 e P1 mostravam OS MESMOS
// 2 avatares (aaliiceeofc__ + monetzamoraa) e a MESMA copy. Cada heading de
// copy usa miolo de nicho diferente ("AD14GL - VFPB04 - F2") mas carrega o
// token de variante. Isolar por token (F2/P1) conserta.
console.log('\nregressao: variantes do mesmo AD no mesmo doc (F2/P1):');
{
  const DOC_VAR = [
    'AD14GL - VRWA02 - AVA05 (Variação de Avatar)',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Mulher: aaliiceeofc__.mp4',
    'Manter a mesma voz dos avatares.',
    '',
    'AD14GL - VFPB04 - AVA05',
    'Gancho do AVA05 com a pessoa que usou viagra de pobre.',
    'Body',
    'Corpo do AVA05 com bastante texto pra gerar pelo menos um take de body sem cortar frase no meio do caminho aqui.',
    '',
    'AD14GL - VRWA02 - F2 (Variação de Formato)',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Mulher: monetzamoraa.mp4',
    'Cenário: aaliiceeofc__.mp4 [p]',
    'Manter a mesma voz dos avatares, a não ser que seja um avatar gringo.',
    'Edição: Edição dopaminérgica;',
    'Música de fundo: Música animada e batida forte.',
    '',
    'AD14GL - VFPB04 - F2',
    'Eu dormi com mais de mil homens e sempre usei esse Viagra de Pobre neles pro amigão ficar duro.',
    'Body',
    'Tem um truque caseiro que deixa qualquer ferramenta firme como pedra e funciona pra qualquer homem sem remédio caro nenhum, presta atenção agora.',
    '',
    'AD14GL - VRWA02 - P1 (Mudança de Perspectiva)',
    'INSTRUÇÕES PARA EDIÇÃO:',
    'Avatar e Vozes:',
    'Homem:',
    'Manter a mesma voz dos avatares, a não ser que seja um avatar gringo.',
    'Edição: Edição dopaminérgica;',
    '',
    'AD14GL - VFPB04 - P1',
    'Eu dormi com mais de mil mulheres e sempre usei esse Viagra de Pobre nelas pro amigão ficar duro.',
    'Body',
    'Corpo do P1 com bastante texto pra gerar pelo menos um take de body sem cortar frase no meio do caminho aqui agora.',
    '',
    'AD15GL - VRWA02 - F1',
    'Outro AD totalmente diferente que serve so de boundary pro merge nao vazar.',
    'Body',
    'Corpo do AD15 que nao deve aparecer em nenhuma variante do AD14.',
  ].join('\n');
  const CAND_VAR: AvatarCandidate[] = [
    { id: 'av_monet', name: 'Monet Zamora', groupName: 'Monet', voiceName: '@monetzamoraa', voiceId: 'v_monet' },
    { id: 'av_alice', name: 'Alice OFC', groupName: 'Alice', voiceName: '@aaliiceeofc__', voiceId: 'v_alice' },
  ];
  // --- F2: 1 avatar (Mulher/monetzamoraa). Cenário NAO e avatar. Copy = homens.
  const rF2 = buildDisparosFromNomenclatures(DOC_VAR, ['AD14GL - VRWA02 - F2'], CAND_VAR);
  const dF2 = rF2.disparos[0];
  assert(!!dF2, 'F2 → 1 disparo');
  if (dF2) {
    console.log('  F2 parts:', dF2.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
    const ids = new Set(dF2.parts.map((p) => p.avatarId).filter(Boolean));
    assert(ids.size === 1 && ids.has('av_monet'), `F2 usa SO monetzamoraa (got ${[...ids].join(',')||'nenhum'})`);
    assert(!dF2.parts.some((p) => p.avatarId === 'av_alice'), 'F2 NAO inclui aaliiceeofc__ (Cenário/outra variante)');
    assert(dF2.parts.some((p) => /mil homens/i.test(p.text)), 'F2 copy = a propria (homens)');
    assert(!dF2.parts.some((p) => /mil mulheres|AVA05|AD15/i.test(p.text)), 'F2 sem copy vazada de P1/AVA05/AD15');
  }
  // --- P1: avatar "Homem:" sem arquivo -> 0 avatares casados. Copy = mulheres.
  const rP1 = buildDisparosFromNomenclatures(DOC_VAR, ['AD14GL - VRWA02 - P1'], CAND_VAR);
  const dP1 = rP1.disparos[0];
  assert(!!dP1, 'P1 → 1 disparo');
  if (dP1) {
    console.log('  P1 parts:', dP1.parts.map((p) => `${p.label}→${p.avatarName ?? 'NULL'}`));
    assert(dP1.parts.every((p) => !p.avatarId), 'P1 SEM avatar casado (Homem sem arquivo) — nao poça 2 avatares');
    assert(dP1.parts.some((p) => /mil mulheres/i.test(p.text)), 'P1 copy = a propria (mulheres)');
    assert(!dP1.parts.some((p) => /mil homens/i.test(p.text)), 'P1 sem copy vazada do F2 (homens)');
  }
}

/* ----------------- parseVABriefing: VA multi-avatar por AVA ----------------- */
// Regressao do bug 2026-06-16 (doc real AD02G1VN-PRPB07): cada AVA tem 2
// avatares ("Avatar: x.mp4 + @y.mp4") = Doutor(Gancho) + Homem(Body). O parser
// pegava so 1 avatar, capturava "GANCHO" como username e nao detectava o AD
// (filename "AD02G1VN - PRPB07.mp4" tem espaco).
console.log('\nparseVABriefing (VA multi-avatar):');
const VA_DOC = [
  'Instruções gerais para edição:',
  'Cada anúncio abaixo deve ser feito com edição',
  'Ambas as versões devem ter entre 20 e 100mb.',
  '',
  'AD02G1VN - PRPB07 - Variação de avatar  - Silas',
  'Link do ad: AD02G1VN - PRPB07.mp4',
  'Instruções para edição: Usar uma edição nova, mas mantém o mesmo hook visual.',
  '',
  'AD02G1VN-PRPB07-AVA01',
  'Avatar: radyrahbanmd2.mp4 + @robertofranciscopaulo72.mp4',
  'AD02G1VN-PRPB07-AVA02',
  'Avatar: drromaoyouseff4.mp4 + @kiko.urso1.mp4',
  '',
  'GANCHO',
  'Doutor:',
  'Coloque o quiabo entre as suas pernas antes de dormir e veja sua próstata desinchar nas próximas 48 horas.',
  '',
  'BODY',
  'Homem:',
  'Pode parecer um absurdo, mas foi um pote de baba de quiabo que salvou minha masculinidade.',
].join('\n');

// extractAvatarFileTokens: pega ambos, ignora separador "+"
const toks = extractAvatarFileTokens('Avatar: radyrahbanmd2.mp4 + @robertofranciscopaulo72.mp4');
assert(toks.length === 2 && toks[0] === 'radyrahbanmd2' && toks[1] === 'robertofranciscopaulo72', 'extractAvatarFileTokens pega 2 avatares (sep "+")');
assert(extractAvatarFileTokens('GANCHO').length === 0, 'extractAvatarFileTokens ignora "GANCHO" (sem .mp4)');

const va = parseVABriefing(VA_DOC, 'VA - AD02G1VN - PRPB07 - AVA01 e 02 - Silas', [], [1, 2]);
assert(!!va, 'parseVABriefing → resolve');
if (va) {
  assert(va.avatares.length === 2, `2 AVAs detectados (got ${va.avatares.length})`);
  const ava01 = va.avatares.find((a) => a.avaCode === 'AVA01');
  const ava02 = va.avatares.find((a) => a.avaCode === 'AVA02');
  assert(!!ava01 && ava01.username === 'radyrahbanmd2', 'AVA01 principal = radyrahbanmd2');
  assert(!!ava01 && !!ava01.roles && ava01.roles.length === 2, 'AVA01 tem 2 papeis (diarizacao)');
  assert(!!ava01 && ava01.roles?.[1]?.username === 'robertofranciscopaulo72', 'AVA01 papel 2 = robertofranciscopaulo72');
  assert(!!ava02 && ava02.username === 'drromaoyouseff4', 'AVA02 principal = drromaoyouseff4');
  assert(!!ava02 && ava02.roles?.[1]?.username === 'kiko.urso1', 'AVA02 papel 2 = kiko.urso1');
  assert(!va.avatares.some((a) => /gancho/i.test(a.username)), 'NENHUM avatar com username "GANCHO"');
  assert(va.linkAdFilename === 'AD02G1VN - PRPB07.mp4', `AD detectado com espacos (got ${va.linkAdFilename})`);
  assert(/quiabo entre as suas pernas/i.test(va.hookText), 'hook (Gancho) capturado');
  assert(/baba de quiabo/i.test(va.bodyText), 'body capturado');
}

// 1 avatar por AVA = comportamento classico (roles ausente)
const VA_SINGLE = [
  'AD09G1VN - PRPB07 - Variação de avatar - Silas',
  'Link do ad: AD09G1VN-PRPB07.mp4',
  'AD09G1VN-PRPB07-AVA01',
  'Avatar: @lara.mp4',
  'GANCHO',
  'Doutor:',
  'Texto do hook aqui.',
].join('\n');
const vaSingle = parseVABriefing(VA_SINGLE, 'VA - AD09G1VN - PRPB07', [], []);
assert(!!vaSingle && vaSingle.avatares.length === 1, '1 AVA single-avatar');
assert(!!vaSingle && vaSingle.avatares[0].username === 'lara', 'single: username = lara');
assert(!!vaSingle && !vaSingle.avatares[0].roles, 'single: roles AUSENTE (classico)');

/* ----------------- avatar por SMART-CHIP de YouTube (AD03GL) ----------------- *
 * Doc real: "Doutora: 🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS" e um
 * hyperlink do YouTube. No texto exportado so sobra o TITULO (o .mp4/@ nunca
 * aparece) — o parser antigo nao achava avatar nenhum ("NENHUM AVATAR
 * IDENTIFICADO"). Agora o titulo casa o link capturado → avatar + thumb. */
console.log('\nyoutube smart-chip avatar:');
const YT_LINKS: DocLink[] = [
  { text: 'O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', fileId: null },
];
// (a) smart-chip: emoji sobreviveu no texto + titulo casa o link
const ytAvatars = parseAvatars('Avatar e Vozes:\nDoutora: 🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS', YT_LINKS);
assert(ytAvatars.length === 1, `smart-chip YT → 1 avatar (got ${ytAvatars.length})`);
assert(ytAvatars[0]?.role === 'Doutora', `role = Doutora (got ${ytAvatars[0]?.role})`);
assert(ytAvatars[0]?.youtubeUrl === 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtubeUrl resolvido do link');
assert(ytAvatars[0]?.thumbUrl === 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'thumbUrl = hqdefault do video');
assert(ytAvatars[0]?.username === 'dQw4w9WgXcQ', 'username = video ID (convencao VA)');

// (b) sem o emoji no texto (img-chip → titulo puro) ainda casa o link
const ytNoEmoji = parseAvatars('Doutora: O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS', YT_LINKS);
assert(ytNoEmoji.length === 1 && !!ytNoEmoji[0]?.youtubeUrl?.includes('dQw4w9WgXcQ'), 'titulo puro (sem emoji) casa o link YT');

// (c) URL crua de YouTube no proprio texto (sem precisar de links)
const ytRaw = parseAvatars('Doutor: https://youtu.be/abc123XYZ_-', []);
assert(ytRaw.length === 1 && !!ytRaw[0]?.youtubeUrl?.includes('abc123XYZ_-'), 'URL crua youtu.be vira avatar sem links');

// (d) formato 2-linhas: "Doutora:" + titulo do chip na linha seguinte
const ytTwoLine = parseAvatars('Doutora:\n🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS', YT_LINKS);
assert(ytTwoLine.length === 1 && ytTwoLine[0]?.role === 'Doutora' && !!ytTwoLine[0]?.youtubeUrl, '2-linhas (role + titulo) casa');

// (e) REGRESSAO: AD01-style chip .mp4 de Drive continua igual (sem youtubeUrl)
const mp4Chip = parseAvatars('Mulher: 🎥 mygermangrandma.mp4', []);
assert(mp4Chip.length === 1 && mp4Chip[0]?.username === 'mygermangrandma', 'regressao: chip .mp4 → username limpo');
assert(!mp4Chip[0]?.youtubeUrl, 'regressao: chip .mp4 NAO tem youtubeUrl');

// (f) NEGATIVO: narrativa "Doutor: voce sabia..." NUNCA vira avatar YT
const narrative = parseAvatars('Doutor: você sabia que 9 em cada 10 homens ignoram isso?', YT_LINKS);
assert(narrative.length === 0, 'narrativa comum NAO vira avatar (sem match de link)');

// (g) NEGATIVO: "Referência:" com link de YouTube e bloqueado (metadata)
const refLine = parseAvatars('Referência: 🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS', YT_LINKS);
assert(refLine.length === 0, 'linha "Referência:" NAO vira avatar (NON_AVATAR_PREFIXES)');

// (g2) NEGATIVO CRÍTICO: narrativa longa que CONTÉM um título de link curto
// NÃO pode virar avatar (cobertura baixa). Ex link "memória recuperada" + fala
// "Doutor: Mais de 5 mil brasileiros já tiveram a memória recuperada e hoje...".
const SHORT_LINK: DocLink[] = [{ text: 'memória recuperada', url: 'https://youtu.be/zzz999AAA__', fileId: null }];
const fp = parseAvatars('Doutor: Mais de 5 mil brasileiros já tiveram a memória recuperada e hoje vivem uma vida normal.', SHORT_LINK);
assert(fp.length === 0, 'narrativa que contém título de link curto NÃO vira avatar (guard de cobertura)');

// (g3) NEGATIVO crítico (review): narrativa de ALTA cobertura que contém o
// título quase inteiro NÃO pode virar avatar. Sem o gate de sinal-de-mídia, a
// frase "Homem: <título> muda tudo..." (cobertura > 0.6) virava avatar fantasma.
const phantomHigh = parseAvatars('Homem: O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS muda tudo na sua vida hoje', YT_LINKS);
assert(phantomHigh.length === 0, 'narrativa de alta cobertura contendo o título NÃO vira avatar (gate de sinal de mídia)');

// (g4) END-TO-END: doc com o chip LEGÍTIMO + uma fala que repete o título
// deve achar SÓ 1 avatar (a Doutora do chip), nunca um "Homem" fantasma.
const PHANTOM_DOC = [
  'AD09GL - RIPCFPB',
  'Avatar e Vozes:',
  'Doutora: 🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS',
  '',
  'AD09G1GL-RIPCFPB',
  'Homem:',
  'O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS muda tudo na sua vida, presta atenção.',
  '',
  'Body',
  'Doutora:',
  'E hoje eu vou te mostrar como reverter isso de forma natural em poucos dias sem remédio.',
].join('\n');
const phantomE2E = parseDarkoBriefing(PHANTOM_DOC, 'AD09GL', null, YT_LINKS);
assert(!!phantomE2E && phantomE2E.avatars.length === 1, `doc com fala repetindo título → 1 avatar (got ${phantomE2E?.avatars.length})`);
assert(!!phantomE2E && /doutora/i.test(phantomE2E.avatars[0]?.role || ''), 'o único avatar é a Doutora (chip), não um Homem fantasma');

// (h) END-TO-END: parseDarkoBriefing com doc AD03-like + links
const AD03_DOC = [
  'AD03GL - RIPCFPB',
  'INSTRUÇÕES PARA EDIÇÃO:',
  'Avatar e Vozes:',
  'Doutora: 🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS',
  'Manter a mesma voz dos avatares, a não ser que seja um avatar gringo.',
  '',
  'AD03G1GL-RIPCFPB',
  'Doutora:',
  'Você sabia que o estresse destrói os hormônios femininos silenciosamente?',
  '',
  'Body',
  'Doutora:',
  'E hoje eu vou te mostrar exatamente como reverter isso de forma natural em poucos dias, sem remédio caro e sem terapia hormonal complicada, presta atenção.',
].join('\n');
const ad03 = parseDarkoBriefing(AD03_DOC, 'AD03GL', null, YT_LINKS);
assert(!!ad03, 'parseDarkoBriefing AD03 → resolve');
assert(!!ad03 && ad03.avatars.length === 1, `AD03 → 1 avatar identificado (got ${ad03?.avatars.length})`);
assert(!!ad03 && ad03.avatars[0]?.role === 'Doutora' && !!ad03.avatars[0]?.youtubeUrl, 'AD03 avatar = Doutora com youtubeUrl');
assert(!!ad03 && ad03.hooks.length >= 1, 'AD03 hook capturado');
assert(!!ad03 && !!ad03.body, 'AD03 body capturado');

/* ----------------- avatar de DEPOIMENTO (inline no corpo) ----------------- *
 * Doc real (AD memória): no fim da copy vem "Depoimento com avatar: 📎
 * 7508150707225251077.mp4" + o texto do depoimento. Antes NAO era identificado
 * por 2 motivos: (1) "depoimento" estava no blocklist de roles, (2) a linha
 * fica no CORPO, nao na seção "Avatar:" base. Agora é identificado e o texto
 * do depoimento é roteado pra esse avatar. */
console.log('\ndepoimento avatar (inline no corpo):');
// (a) parseAvatars reconhece a linha de depoimento com talking-photo numérico
const depoAv = parseAvatars('Depoimento com avatar: 📎 7508150707225251077.mp4', []);
assert(depoAv.length === 1, `depoimento → 1 avatar (got ${depoAv.length})`);
assert(depoAv[0]?.username === '7508150707225251077', `depoimento username = talking-photo id (got ${depoAv[0]?.username})`);
assert(/depoimento/i.test(depoAv[0]?.role || ''), `role contém "depoimento" (got ${depoAv[0]?.role})`);

// (a2) com emoji de vídeo 🎥 (não só 📎) — username tem que sair LIMPO, sem o
// emoji grudado (senão "@🎥 7508..." e a thumb/match quebram).
const depoEmoji = parseAvatars('Depoimento com avatar: 🎥 7508150707225251077.mp4', []);
assert(depoEmoji.length === 1 && depoEmoji[0]?.username === '7508150707225251077', `depoimento 🎥 → username limpo (got ${depoEmoji[0]?.username})`);

// (a3) CRÍTICO (doc REAL RIPCFPB): export do Google Docs COMEU o ":" do rótulo
// antes do smart-chip → a linha chega SEM dois-pontos:
//   "Depoimento com avatar 7508150707225251077.mp4"
// Tem que virar avatar mesmo assim (rótulo com palavra de locutor + .mp4).
const depoNoColon = parseAvatars('Depoimento com avatar 7508150707225251077.mp4', []);
assert(depoNoColon.length === 1 && depoNoColon[0]?.username === '7508150707225251077', `depoimento SEM ":" → detectado (got ${JSON.stringify(depoNoColon)})`);
assert(/depoimento/i.test(depoNoColon[0]?.role || ''), 'depoimento sem ":" → role contém "depoimento"');
const depoNoColonEmoji = parseAvatars('Depoimento com avatar 🎥 7508150707225251077.mp4', []);
assert(depoNoColonEmoji.length === 1 && depoNoColonEmoji[0]?.username === '7508150707225251077', 'depoimento sem ":" + 🎥 → detectado, username limpo');
// NEGATIVO: narrativa terminando em .mp4 SEM palavra de locutor NÃO vira avatar
const fpNoColon = parseAvatars('Então clique e assista o vídeo aula completo gratis.mp4', []);
assert(fpNoColon.length === 0, 'narrativa terminando em .mp4 (sem keyword de locutor) NÃO vira avatar');
// NEGATIVO: "Música de fundo X.mp4" (asset, não locutor) NÃO vira avatar
const fpMusica = parseAvatars('Música de fundo Scary Piano.mp4', []);
assert(fpMusica.length === 0, '"Música de fundo ...mp4" sem ":" NÃO vira avatar');

// (b) NEGATIVO: "Depoimento:" seguido só de texto NÃO vira avatar
const depoText = parseAvatars('Depoimento:\nMinha mãe melhorou muito com esse ritual incrível.', []);
assert(depoText.length === 0, 'depoimento só com texto NÃO vira avatar');

// (c) END-TO-END: depoimento declarado DENTRO do corpo (depois do Body)
const DEPO_DOC = [
  'AD10GL - MEPB',
  'Avatar e Vozes:',
  'Doutor: @drtakashi.mp4',
  '',
  'AD10G1GL-MEPB',
  'Doutor:',
  'Esse ritual faz tudo se conectar e voltar a funcionar.',
  '',
  'Body',
  'Doutor:',
  'Mais de 5 mil brasileiros já tiveram a memória recuperada e hoje vivem uma vida normal como se nada tivesse acontecido.',
  '',
  'Depoimento com avatar: 📎 7508150707225251077.mp4',
  'Minha mãe com 65 anos estava nos estágios iniciais do Alzheimer. Ela já tomava donepezila e galantamina, mas não adiantava nada. Foi então que eu descobri um ritual que melhorou muito a memória dela.',
].join('\n');
const depo = parseDarkoBriefing(DEPO_DOC, 'AD10GL', null, []);
assert(!!depo, 'parseDarkoBriefing depoimento → resolve');
assert(!!depo && depo.avatars.length === 2, `2 avatares: Doutor + Depoimento (got ${depo?.avatars.length})`);
assert(!!depo && depo.avatars.some((a) => a.username === '7508150707225251077'), 'avatar do depoimento (talking-photo) identificado');
assert(!!depo && depo.avatars.some((a) => /depoimento/i.test(a.role)), 'role "Depoimento ..." presente');
// O segmento do depoimento pode rotear por ROLE ("Depoimento ...") OU por
// USERNAME (talking-photo id) — o username é até mais preciso (casa o slot
// exato). Aceita os dois (pickRoleForText no app casa username→slot).
assert(!!depo && depo.bodySegments.some((s) => /depoimento/i.test(s.role || '') || s.username === '7508150707225251077'), 'segmento do depoimento roteado pro avatar do depoimento (role OU username)');
assert(!!depo && /minha mãe com 65/i.test(depo.body || ''), 'texto do depoimento entrou no corpo (não foi descartado)');
assert(!!depo && !/7508150707225251077/.test(depo.body || ''), 'linha do chip .mp4 NÃO vaza pra fala');

// (c2) END-TO-END RIPCFPB COMPLETO: avatar base por link YouTube, labels de
// locutor no corpo repetindo o título do YT, depoimento SEM ":" no corpo.
// Garante: (1) 2 avatares, (2) testemunho roteado pro depoimento, (3) título
// do YouTube NÃO vaza pra fala, (4) corpo da copy preservado.
const RIP_LINKS: DocLink[] = [
  { text: 'O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS', url: 'https://www.youtube.com/watch?v=AbCdEfGhIjk', fileId: null },
  { text: '7508150707225251077.mp4', fileId: 'DEPOFILEID', url: null },
];
const RIP_DOC = [
  'AD03GL - RIPCFPB',
  'INSTRUÇÕES PARA EDIÇÃO:',
  'Avatar e Vozes:',
  'Doutora: 🎥 O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS',
  'Referência:',
  'AD53G2VN-ME.mp4',
  '',
  'Body',
  'Doutora: O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS',
  'Mais de 5 mil brasileiros já tiveram a memória recuperada e hoje vivem uma vida normal.',
  '',
  'Depoimento com avatar 7508150707225251077.mp4',
  'Minha mãe com 65 anos estava nos estágios iniciais do Alzheimer e melhorou muito com o ritual.',
  '',
  'Doutora: O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS',
  'Se você está sofrendo com esquecimentos leves, esse ritual vai ajudar.',
  '',
  'AD04GL - RIPCFPB',
  'Avatar e Vozes:',
  'Homem: peterattiamd.mp4',
].join('\n');
const rip = parseDarkoBriefing(RIP_DOC, 'AD03GL', null, RIP_LINKS);
assert(!!rip && rip.avatars.length === 2, `RIPCFPB → 2 avatares (Doutora YT + Depoimento) (got ${rip?.avatars.length})`);
assert(!!rip && rip.avatars.some((a) => !!a.youtubeUrl), 'RIPCFPB → Doutora com youtubeUrl');
assert(!!rip && rip.avatars.some((a) => a.username === '7508150707225251077'), 'RIPCFPB → depoimento (sem ":") identificado');
assert(!!rip && rip.bodySegments.some((s) => s.username === '7508150707225251077' && /minha mãe com 65/i.test(s.text)), 'RIPCFPB → testemunho roteado pro avatar do depoimento');
assert(!!rip && !/IMPACTO DO ESTRESSE/i.test(rip.body || ''), 'RIPCFPB → título do YouTube NÃO vaza pra fala');
assert(!!rip && /mais de 5 mil/i.test(rip.body || '') && /minha mãe/i.test(rip.body || ''), 'RIPCFPB → corpo da copy preservado');

// (d) REGRESSÃO CRÍTICA (RIPCFPB): a Referência "AD53G2VN-ME.mp4" PARECE um
// título de AD (AD53G2VN-ME) e cortava a seção do AD no meio — o depoimento no
// corpo (depois da Referência) sumia. Filename .mp4 NÃO é heading de AD.
const REF_AD_DOC = [
  'AD03GL - RIPCFPB',
  'INSTRUÇÕES PARA EDIÇÃO:',
  'Avatar e Vozes:',
  'Doutora: @drtakashi.mp4',
  'Edição: dopaminérgica;',
  'Referência:',
  'AD53G2VN-ME.mp4',
  '',
  'Body',
  'Doutora:',
  'Mais de 5 mil brasileiros já tiveram a memória recuperada e hoje vivem uma vida normal.',
  '',
  'Depoimento com avatar: 7508150707225251077.mp4',
  'Minha mãe com 65 anos estava nos estágios iniciais do Alzheimer e melhorou muito com o ritual.',
  '',
  'AD04GL - RIPCFPB',
  'Avatar e Vozes:',
  'Homem: peterattiamd.mp4',
].join('\n');
const refAd = parseDarkoBriefing(REF_AD_DOC, 'AD03GL', null, []);
assert(!!refAd && refAd.avatars.some((a) => a.username === '7508150707225251077'), 'Referência tipo-AD ".mp4" NÃO trunca a seção — depoimento no corpo é detectado');
assert(!!refAd && refAd.avatars.length === 2, `2 avatares (Doutora + Depoimento) apesar da Referência tipo-AD (got ${refAd?.avatars.length})`);
assert(!!refAd && /minha mãe com 65/i.test(refAd.body || ''), 'corpo (com testemunho) não foi cortado pela Referência tipo-AD');

/* ============ MATRIZ DE ROBUSTEZ — invariantes do parser de docs ============
 * Prova 2 regras INVIOLÁVEIS em N formatações (com/sem ":", com/sem 🎥):
 *   (1) NO-LEAK    — NUNCA vaza referência (título YT / filename / nomenclatura
 *                    AD / URL) na fala do avatar.
 *   (2) NO-MISSING — NUNCA falta copy real na fala.
 * + o avatar do depoimento é SEMPRE identificado. */
console.log('\nmatriz de robustez (no-leak / no-missing em N formatações):');
const M_YT = 'O IMPACTO DO ESTRESSE NOS HORMÔNIOS FEMININOS';
const M_LINKS: DocLink[] = [
  { text: M_YT, url: 'https://www.youtube.com/watch?v=AbCdEfGhIjk', fileId: null },
  { text: '7508150707225251077.mp4', fileId: 'DEPOID', url: null },
];
const speechOf = (b: ReturnType<typeof parseDarkoBriefing>): string =>
  !b ? '' : [b.hooks.map((h) => h.text).join('\n'), b.body || ''].join('\n');
const FORBIDDEN = ['IMPACTO DO ESTRESSE', '7508150707225251077', 'AD53G2VN', 'peterattiamd', 'https?:\\/\\/'];
const mainVariants = [`Doutora: 🎥 ${M_YT}`, `Doutora: ${M_YT}`];
const depoVariants = [
  'Depoimento com avatar: 📎 7508150707225251077.mp4',
  'Depoimento com avatar: 7508150707225251077.mp4',
  'Depoimento com avatar 7508150707225251077.mp4',       // SEM ":" (o bug)
  'Depoimento com avatar 🎥 7508150707225251077.mp4',    // SEM ":" + 🎥
];
let matrixFails = 0;
let matrixRuns = 0;
for (const mainL of mainVariants) {
  for (const depoL of depoVariants) {
    matrixRuns++;
    const doc = [
      'AD03GL - RIPCFPB', 'INSTRUÇÕES PARA EDIÇÃO:', 'Avatar e Vozes:', mainL,
      'Referência:', 'AD53G2VN-ME.mp4', '',
      'AD03G1GL-RIPCFPB', mainL, 'Gancho', 'GANCHOFRASE você sabia que o estresse destrói sua memória', '',
      'Body', mainL, 'CORPOUM mais de cinco mil brasileiros recuperaram a memória', '',
      depoL, 'DEPOFRASE minha mãe melhorou muito com o ritual natural', '',
      mainL, 'CORPODOIS se você sofre disso esse ritual vai te ajudar', '',
      'AD04GL - RIPCFPB', 'Avatar e Vozes:', 'Homem: peterattiamd.mp4',
    ].join('\n');
    const b = parseDarkoBriefing(doc, 'AD03GL', null, M_LINKS);
    const sp = speechOf(b);
    const okAvatar = !!b && b.avatars.some((a) => a.username === '7508150707225251077');
    const missing = ['GANCHOFRASE', 'CORPOUM', 'DEPOFRASE', 'CORPODOIS'].filter((p) => !sp.includes(p));
    const leak = FORBIDDEN.find((f) => new RegExp(f, 'i').test(sp));
    if (!okAvatar || missing.length || leak) {
      matrixFails++;
      console.log(`  FAIL [${mainL.slice(0, 14)}.. | ${depoL.slice(0, 26)}..] avatar=${okAvatar} missing=[${missing}] leak=${leak || '-'}`);
    }
  }
}
assert(matrixFails === 0, `matriz robustez: ${matrixRuns - matrixFails}/${matrixRuns} combinações OK (avatar + copy completa + zero vazamento)`);

/* ===== ISOLAMENTO ENTRE ADs — avatar de um AD NUNCA vaza pra outro ===== *
 * Bug real (2026-06-22): docs copy-paste deixam no CORPO de um AD um label de
 * avatar de OUTRO AD (ex "Mulher: mygermangrandma.mp4" sobrou no corpo do AD02).
 * Com a seção incluindo o corpo, o avatar principal vazava entre ADs. O avatar
 * PRINCIPAL tem que vir SÓ da declaração ("Avatar e Vozes:"); o corpo só
 * contribui o DEPOIMENTO. */
console.log('\nisolamento entre ADs (avatar não vaza):');
const ISO_LINKS: DocLink[] = [{ text: '7508150707225251077.mp4', fileId: 'DEPOID', url: null }];
const ISO_DOC = [
  'AD01GL - RIPCFPB', 'Avatar e Vozes:', 'Mulher: mygermangrandma.mp4', '',
  'AD01G1GL-RIPCFPB', 'Mulher:', 'Gancho AD01.', 'Body', 'Mulher: mygermangrandma.mp4', 'Corpo do AD01.', '',
  'AD02GL - RIPCFPB', 'Avatar e Vozes:', 'Doutor: vivianlamounier.mp4', '',
  'AD02G1GL-RIPCFPB', 'Doutor:', 'Gancho AD02.', 'Body',
  'Mulher: mygermangrandma.mp4',  // ← LEFTOVER de copy-paste do AD01
  'Corpo do AD02.', '',
  'Depoimento com avatar 7508150707225251077.mp4', 'Testemunho do AD02.', '',
  'AD04GL - RIPCFPB', 'Avatar e Vozes:', 'Homem: peterattiamd.mp4', '',
  'AD04G1GL-RIPCFPB', 'Homem:', 'Gancho AD04.', 'Body',
  'Mulher: mygermangrandma.mp4',  // ← LEFTOVER no AD04 também
  'Corpo do AD04.',
].join('\n');
const ad01 = parseDarkoBriefing(ISO_DOC, 'AD01GL', null, ISO_LINKS);
const ad02 = parseDarkoBriefing(ISO_DOC, 'AD02GL', null, ISO_LINKS);
const ad04 = parseDarkoBriefing(ISO_DOC, 'AD04GL', null, ISO_LINKS);
const u = (b: ReturnType<typeof parseDarkoBriefing>) => (b?.avatars || []).map((a) => a.username);
assert(JSON.stringify(u(ad01)) === JSON.stringify(['mygermangrandma']), `AD01 só mygermangrandma (got ${JSON.stringify(u(ad01))})`);
assert(!u(ad02).includes('mygermangrandma'), `AD02 NÃO pega avatar do AD01 (got ${JSON.stringify(u(ad02))})`);
assert(u(ad02).includes('vivianlamounier'), 'AD02 mantém seu próprio avatar (vivianlamounier)');
assert(u(ad02).includes('7508150707225251077'), 'AD02 mantém o depoimento inline');
assert(!u(ad04).includes('mygermangrandma'), `AD04 NÃO pega avatar do AD01 (got ${JSON.stringify(u(ad04))})`);
assert(u(ad04).includes('peterattiamd'), 'AD04 mantém seu próprio avatar (peterattiamd)');

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
