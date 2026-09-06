/**
 * Teste de GARANTIA com o conteúdo REAL do doc "ADS - PV" (AD01), colado pelo
 * user. Roda as MESMAS funções de produção (buildDisparosFromNomenclatures +
 * buildDisparosFromDoc + matchAvatar) e valida que:
 *   - HOOK 1 = texto exato do AD01G1-PV
 *   - HOOK 2 = texto exato do AD01G2-PV
 *   - BODY  = texto do body (sem vazar hook/avatar/links/instruções)
 *   - avatar surgerv-2 casa (voice_name)
 *
 *   npx tsc lib/copy-parser.ts lib/heygen-extension-bridge.ts lib/doc-to-disparos.ts lib/doc-to-disparos.real.test.ts \
 *     --outDir .test-tmp --module commonjs --target es2020 --moduleResolution node --skipLibCheck --lib es2020,dom
 *   node .test-tmp/doc-to-disparos.real.test.js
 */
import { buildDisparosFromNomenclatures, buildDisparosFromDoc, type AvatarCandidate } from './doc-to-disparos';
import { matchAvatar, parseDarkoBriefing, extractVariantToken } from './copy-parser';

let fails = 0;
function ok(cond: boolean, msg: string) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) fails++;
}

const HOOK1 =
  'Se teu amigão fica mole quando ela tá de boca, o viagra não vai resolver o seu problema…';
const HOOK2 =
  'A diabetes, a pressão alta, não causam disfunção. Causa fuga venosa, por isso nada do que você toma resolve.';

// Conteúdo REAL do doc (AD01), reproduzido fielmente do que o user colou.
const DOC = `Instruções gerais para edição:
Cada anúncio abaixo deve ser feito duas versões, uma com edição e uma sem edição.
Ambas as versões devem ter entre 20 e 100mb.
A versão com edição, segue o normal, com as indicações, trilha sonora e hook visual.
A versão sem edição deve ter camuflagem de áudio.
Segue o link da pasta dos criativos: Criativos

AD01 - PV
Link do avatar: surgerv-2.mp4 - clonar voz
Instruções para edição: Edição mais UGC com poucos inserts usando imagens mais em duplo sentido, sem usar nada pornográfico ou imagens de mulheres seminuas. Ref de Trilhas para colocar no AD:
https://www.tiktok.com/@viralmusichitsofficial/video/7466809975847898373?lang=pt-BR&q=trilha%20sonora%20animada&t=1773424389430
https://www.tiktok.com/@viralmusichitsofficial/video/7475078548638682374?lang=pt-BR&q=trilha%20sonora%20animada&t=1773424389430
https://drive.google.com/drive/folders/1ITGdcq5HbJ-3p3IWC23sNoFJKerKrP4X

AD01G1-PV
${HOOK1}

AD01G2-PV
${HOOK2}

BODY
Existem 4 tipos de disfunção erétil… O seu médico diz que é um e as pílulas tratam outra.

E tudo que você tentou foi feito para um problema que você não tem…

Alguns acham que tá chegando pouco sangue, acham que com o envelhecimento o corpo perde a força e o sangue não desce com a mesma força.

O viagra é feito exatamente para isso, ele força o sangue entrar.

Mas é só isso, não resolve o problema, depois que amolece, já era.

Tem uns que acreditam que precisam tomar testosterona… Olha, testosterona alta pode te deixar com vontade de comer uma parede, mas não vai fazer você ficar com o amigão duro igual pedra.

Porque o que faz a ferramenta da maioria dos homens amolecer é o sangue dando fuga.

Por isso, às vezes, você até consegue ficar ereto, mas quando coloca a camisinha, amolece…

Ou quando mesmo no ato, metendo, tu broxa.

Isso acontece, porque o sangue que endureceu tua ferramenta, escapou…

Essa é a fuga venosa, o sangue não consegue ficar mais no teu amigão aí.

É exatamente isso que o max vigor faz. Você responde um quiz rápido.

Clica abaixo e começa hoje.

AD02 - PV
Link do avatar: surgerv-2.mp4 - clonar voz

AD02G1-PV
Gancho do segundo anúncio só pra delimitar o fim do AD01.`;

const CANDS: AvatarCandidate[] = [
  // Espelha o que apareceu no seu print: surgerv-2 → "Dr Careful Listener"
  { id: 'look_dcl', name: 'Dr Careful Listener', groupName: 'Dr Careful Listener', voiceName: '@surgerv-2', voiceId: 'v_dcl' },
  { id: 'look_outro', name: 'Outro', groupName: 'Outro', voiceName: '@naotem', voiceId: 'v_o' },
];

console.log('GARANTIA — doc real AD01 (por nomenclatura "AD01 - PV"):');
const res = buildDisparosFromNomenclatures(DOC, ['AD01 - PV'], CANDS);
ok(res.disparos.length === 1, 'achou 1 disparo pro AD01 - PV');
const d = res.disparos[0];
if (d) {
  ok(d.fromDarkoBriefing, 'parseado pelo DARKO (não genérico)');

  const hooks = d.parts.filter((p) => /^HOOK/i.test(p.label));
  ok(hooks.length === 2, `2 hooks (got ${hooks.length})`);

  const h1 = hooks.find((p) => p.label === 'HOOK 1');
  const h2 = hooks.find((p) => p.label === 'HOOK 2');
  ok(!!h1 && h1.text.trim() === HOOK1, 'HOOK 1 = texto EXATO do AD01G1-PV');
  ok(!!h2 && h2.text.trim() === HOOK2, 'HOOK 2 = texto EXATO do AD01G2-PV');

  const bodyParts = d.parts.filter((p) => /^BODY/i.test(p.label));
  const bodyText = bodyParts.map((p) => p.text).join('\n');
  ok(bodyParts.length >= 1, `body presente (${bodyParts.length} take(s))`);
  ok(/Existem 4 tipos de disfunção erétil/.test(bodyText), 'body começa com "Existem 4 tipos..."');
  ok(/Clica abaixo e começa hoje/.test(bodyText), 'body termina com "Clica abaixo e começa hoje"');

  // O body NÃO pode vazar hook / avatar / links / instruções:
  ok(!bodyText.includes(HOOK1), 'body NÃO contém o texto do HOOK 1');
  ok(!/surgerv-2|\.mp4|Link do avatar/i.test(bodyText), 'body sem "Link do avatar"/filename');
  ok(!/tiktok\.com|drive\.google\.com|https?:\/\//i.test(bodyText), 'body sem URLs (tiktok/drive)');
  ok(!/Instruções para edição/i.test(bodyText), 'body sem "Instruções para edição"');
  ok(!/Ambas as versões|camuflagem de áudio/i.test(bodyText), 'body sem instruções gerais');

  // Avatar casado
  const matched = d.parts.every((p) => p.avatarId === 'look_dcl');
  ok(matched, 'avatar surgerv-2 → Dr Careful Listener em TODAS as partes');
  ok(d.parts.every((p) => p.voiceId === 'v_dcl'), 'voiceId do avatar propagado');
}

console.log('\nGARANTIA — match de avatar por voice_name e por id:');
const mv = matchAvatar('surgerv-2', CANDS);
ok(!!mv && mv.id === 'look_dcl', 'matchAvatar("surgerv-2") → look_dcl (voice_name)');
const mid = matchAvatar('@749477393444762056', [
  { id: '749477393444762056', name: 'Foto', groupName: 'F', voiceName: '@x' },
]);
ok(!!mid && mid.id === '749477393444762056', 'matchAvatar por id cru (talking-photo)');

console.log('\nGARANTIA — auto-descoberta (toggle pegar todos) acha AD01 + AD02:');
const auto = buildDisparosFromDoc(DOC, CANDS);
ok(auto.detectedAdIds.includes('AD01PV') && auto.detectedAdIds.includes('AD02PV'), `bases = ${auto.detectedAdIds.join(', ')}`);

// ───────────────────────────────────────────────────────────────────────────
// GARANTIA — AD24G1VN - VRWA02 (2 locutores Doutor/Mulher alternando).
// REGRESSAO real: nomenclatura com infixo de sibling COLADO no numero
// ("AD24G1VN") fazia extractAdIds devolver base "AD24G" (pegava o "G" do
// "G1" como sufixo). Base errada → findGSiblings("AD24G") nao casava o
// heading "AD24G1VN" → parser DARKO devolvia 0 hooks/body → CAIA no parser
// legado, que NAO segmenta por speaker → body inteiro num bloco roteado pro
// 1o role do texto (a "Mulher"). Resultado em prod: video INTEIRO com a
// mulher falando. Fix: tirar o infixo G<N> antes de extrair o sufixo.
// ───────────────────────────────────────────────────────────────────────────
// Formato REAL do doc (AD24 à 31): "Link do avatar:" como header vazio +
// 2 linhas "Role: filename.mp4". CRITICAL: o avatar do Doutor tem ID 100%
// NUMERICO (talking-photo do HeyGen) — parseAvatars barrava all-digit e
// DROPAVA o Doutor, sobrando so a Mulher. Por isso o video saia todo dela.
const DOC_AD24 = `AD24VN - VRWA02
Link do avatar:
Doutor: 7558713641210531102.mp4 - Clonar voz
Mulher: gihribeiroo20.mp4 - clonar voz

Instruções para edição:
O criativo vai rodar só pra youtube, faz a edição básica.
	AD24G1VN - VRWA02
Doutor
Tenha cuidado quando for fazer o viagra de pobre, ele pode aumentar demais o seu pinto.
BODY
Mulher
É óbvio que sempre vamos preferir os maiores e mais grossos.
Doutor
Por isso que a receita do viagra de pobre que passei pro meus pacientes está fazendo sucesso.
Mulher
Doutor, já tinha muito tempo que eu não sabia como era ter um orgasmo.
Doutor
As pessoas acreditam que a receita se faz de qualquer jeito. Clique aqui abaixo.`;

const CANDS24: AvatarCandidate[] = [
  // Doutor = talking-photo (ID numerico casado pelo id cru). Mulher por voice_name.
  { id: '7558713641210531102', name: 'Photo Avatar Doutor', groupName: 'g', voiceName: '@doutorvoz', voiceId: 'v_doc' },
  { id: 'look_mul', name: 'Gih Mulher', groupName: 'g', voiceName: '@gihribeiroo20', voiceId: 'v_mul' },
];

console.log('\nGARANTIA — AD24G1VN - VRWA02 (Doutor/Mulher NAO podem colapsar num só):');
const r24 = buildDisparosFromNomenclatures(DOC_AD24, ['AD24G1VN - VRWA02'], CANDS24);
ok(r24.disparos.length === 1, 'achou 1 disparo pro AD24G1VN - VRWA02');
const d24 = r24.disparos[0];
if (d24) {
  ok(d24.fromDarkoBriefing, 'parseado pelo DARKO (NAO caiu no legado)');
  const body24 = d24.parts.filter((p) => /^BODY/i.test(p.label));
  ok(body24.length >= 4, `body segmentado por speaker (got ${body24.length} takes, esperado >=4)`);
  // Nenhum take pode ter o label de speaker vazado como LINHA SOLTA. (Cuidado:
  // "Doutor, já tinha muito tempo..." é fala legitima — vocativo, NAO label.)
  ok(body24.every((p) => !/^[ \t]*(Doutor|Mulher)[ \t]*$/im.test(p.text)), 'nenhum take vaza label "Doutor"/"Mulher" como linha solta');
  // O avatar do Doutor (talking-photo numerico) NAO pode ser dropado.
  ok(d24.parts.some((p) => p.role?.toLowerCase() === 'doutor'), 'existe take com role Doutor (avatar numerico nao foi dropado)');
  // Tem que ter os DOIS avatares no body — nao pode ser tudo a mulher.
  const usaDoutor = body24.some((p) => p.avatarId === '7558713641210531102');
  const usaMulher = body24.some((p) => p.avatarId === 'look_mul');
  ok(usaDoutor && usaMulher, `body usa OS DOIS avatares (Doutor=${usaDoutor}, Mulher=${usaMulher}) — NAO so a mulher`);
  // 1o segmento do body é da Mulher, o seguinte do Doutor (alternancia real).
  ok(body24[0]?.avatarId === 'look_mul', '1o take do body = Mulher');
  ok(body24.some((p, i) => i > 0 && p.avatarId === '7558713641210531102'), 'algum take seguinte = Doutor (talking-photo)');
}

// ---------------------------------------------------------------------------
// GARANTIA — briefing "ADVN - RIPTVWA" (18.07.26). Conteúdo REAL do doc.
// Duas armadilhas que zeravam a identificação no ClickUp Pilot:
//   1. o marcador "[T]" colado no código ("AD17G1VN[T]-RIPTVWA") fazia a linha
//      NAO ser reconhecida como heading de AD;
//   2. a linha logo abaixo é o AD de ORIGEM da copy ("AD65VN[T] - VFPB02") —
//      tratada como heading, ela cortava a seção na 1a linha (sem copy).
// Resultado: "Parser nao achou hooks nem body pra AD17VN no doc".
// ---------------------------------------------------------------------------
const DOC_RIPTVWA = `ADVN - RIPTVWA
AD17 à 23

AD17G1VN[T]-RIPTVWA

AD65VN[T] - VFPB02

Link do avatar:

Doutor: @drromaoyouseff5.mp4

Homem: kiko.urso.mp4

Instruções para edição: Exportar uma versão com camuflagem e uma sem camuflagem. O AD é só lipsync, não vai ter edição.

GANCHO

Doutor

Mas será mesmo que passar vick no meio das pernas realmente faz seu amigão ficar um monstro de grande?

BODY

Doutor

Eu vou te mostrar como esse truque funciona na prática.

Homem

Duvidei no início. Mesmo assim fiz o truque como foi ensinado.

AD18G1VN[T]-RIPTVWA

AD01VN[T] - VFPB02

Link do avatar:

Doutor: @drromaoyouseff5.mp4

Instruções para edição: Só lipsync.

GANCHO

Doutor

Esse é o gancho do AD18 e ele NAO pode vazar pro AD17.

BODY

Doutor

Corpo do AD18.`;

console.log('\nGARANTIA — ADVN - RIPTVWA (heading com "[T]" + linha de AD de referência):');
const b17 = parseDarkoBriefing(DOC_RIPTVWA, 'AD17VN', null, []);
ok(!!b17, 'achou a seção do AD17VN (heading "AD17G1VN[T]-RIPTVWA")');
if (b17) {
  ok(b17.hooks.length === 1, `1 hook (got ${b17.hooks.length})`);
  ok(/passar vick no meio das pernas/i.test(b17.hooks[0]?.text || ''), 'HOOK 1 = texto do gancho do AD17');
  ok(!!b17.body && /funciona na prática/i.test(b17.body), 'BODY do AD17 presente');
  ok(!/AD18/i.test(b17.body || '') && !/gancho do AD18/i.test(b17.body || ''), 'copy do AD18 NAO vazou pro AD17');
  ok(b17.avatars.some((a) => /drromaoyouseff5/i.test(a.username)), 'avatar Doutor identificado');
  ok(b17.avatars.some((a) => /kiko\.urso/i.test(a.username)), 'avatar Homem identificado');
  // A linha de referência ("AD65VN[T] - VFPB02") é metadado — nunca fala.
  ok(!/AD65/i.test(b17.body || '') && !/AD65/i.test(b17.hooks[0]?.text || ''), 'linha de referência AD65 nao virou fala');
}
const b18 = parseDarkoBriefing(DOC_RIPTVWA, 'AD18VN', null, []);
ok(!!b18 && /gancho do AD18/i.test(b18.hooks[0]?.text || ''), 'AD18VN tambem identificado, com o proprio gancho');
// O AD de REFERENCIA nao pode virar uma seção própria roubando a copy do AD17.
const b65 = parseDarkoBriefing(DOC_RIPTVWA, 'AD65VN', null, []);
ok(!b65 || (b65.hooks.length === 0 && !b65.body), 'AD65VN (referência) nao abre seção com a copy do AD17');

// ---------------------------------------------------------------------------
// GARANTIA — task "AD80GL-RIPTVWA-V2" (06.09.26). A SEGUNDA VERSAO de um
// criativo traz "-V2" no NOME DA TASK; o doc nao sabe disso (la o AD e
// "AD80G1GL - RIPTVWA"). O "V2" casa a forma de token de variante (1-3 letras
// + 1-3 digitos), virava FILTRO de heading, nenhum heading tinha "V2" e a
// task morria em "Parser nao achou hooks nem body pra AD80GL no doc" — com a
// copy inteira no doc. Filtro que nao deixa nada de pe e' filtro errado.
// ---------------------------------------------------------------------------
// Estrutura EXATA do doc (hook colado no heading, "Body" numa linha, ficha
// entre separadores) — só as falas foram encurtadas.
const DOC_V2 = `AD79 a 82
AD79GL - RIPTVWA
BRIEFING: AD14G1GL-RIPTVWA c/ troca de avatar para Doutor.
_______________________________________________________________________
INSTRUÇÕES PARA EDIÇÃO:
Avatar e Vozes:
Meta Ads
Doutor: @drromaoyouseff5.mp4
Youtube Ads / Kwai Ads
Doutor: @drromaoyouseff5.mp4

AD79G1GL - RIPTVWA
Gancho do AD79, que NAO pode vazar pro AD80.
Body
Corpo do AD79, que tambem nao pode vazar.

AD80GL - RIPTVWA
BRIEFING: AD14G1GL-RIPTVWA c/ troca de avatar para Doutor.
_______________________________________________________________________
INSTRUÇÕES PARA EDIÇÃO:
Avatar e Vozes:
Meta Ads
Doutor: 7651210164560973076.mp4
Youtube Ads / Kwai Ads
Doutor: surgery-2.mp4
Manter a mesma voz dos avatares, a não ser que seja um avatar gringo.
_______________________________________________________________________
Observações:

AD80G1GL - RIPTVWA
Se voce usar o vick e seu amigao nao ficar igual uma bengala.
Body
Ja apareceu pra voce o truque do vick que ta viralizando.
Entao pega papel e caneta que eu vou ensinar uma vez so.

AD81GL - RIPTVWA
BRIEFING: Pegar AD32G1VN-RIPTVWA e reescrever.
_______________________________________________________________________
Avatar e Vozes:
Meta Ads
Doutor: @drromaoyouseff5.mp4`;

console.log('\nGARANTIA — task com sufixo de VERSAO ("AD80GL-RIPTVWA-V2"):');
const v2 = extractVariantToken('AD80GL-RIPTVWA-V2');
ok(v2 === 'V2', `"-V2" e lido como token de variante (got ${String(v2)})`);
const b80 = parseDarkoBriefing(DOC_V2, 'AD80GL', v2, []);
ok(!!b80, 'achou a seção do AD80GL mesmo com a variante "V2" ausente do doc');
if (b80) {
  ok(b80.hooks.length === 1, `1 hook (got ${b80.hooks.length})`);
  ok(/bengala/i.test(b80.hooks[0]?.text || ''), 'HOOK = o gancho do AD80');
  ok(!!b80.body && /viralizando/i.test(b80.body), 'BODY do AD80 presente');
  ok(!/AD79/i.test(b80.body || '') && !/vazar pro AD80/i.test(b80.body || ''), 'copy do AD79 NAO vazou');
  ok(b80.avatars.some((a) => /7651210164560973076/.test(a.username)), 'avatar META identificado');
  ok(b80.avatars.some((a) => /surgery-2/i.test(a.username)), 'avatar YouTube identificado');
}
// O fallback NAO pode afrouxar o filtro quando a variante EXISTE no doc: ali
// ele continua discriminando (era o motivo de o filtro existir).
const DOC_VAR = `AD14GL - VRWA02 - F2

Avatar e Vozes:

Mulher: @mulher.mp4

HOOK

Gancho da variante F2.

BODY

Corpo da F2.

AD14GL - VRWA02 - P1

Avatar e Vozes:

Homem: @homem.mp4

HOOK

Gancho da variante P1.

BODY

Corpo da P1.`;
const bF2 = parseDarkoBriefing(DOC_VAR, 'AD14GL', 'F2', []);
ok(!!bF2 && /variante F2/i.test(bF2.hooks[0]?.text || ''), 'variante EXISTENTE (F2) continua isolada');
ok(!!bF2 && !/variante P1/i.test(bF2.body || ''), 'copy da P1 nao vazou pra F2');

console.log('');
if (fails > 0) {
  console.error(`✗ ${fails} assert(s) FALHARAM`);
  process.exit(1);
} else {
  console.log('✓ GARANTIA: todos os asserts passaram com o conteúdo REAL');
}
