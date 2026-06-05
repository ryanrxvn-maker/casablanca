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
import { matchAvatar } from './copy-parser';

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

console.log('');
if (fails > 0) {
  console.error(`✗ ${fails} assert(s) FALHARAM`);
  process.exit(1);
} else {
  console.log('✓ GARANTIA: todos os asserts passaram com o conteúdo REAL');
}
