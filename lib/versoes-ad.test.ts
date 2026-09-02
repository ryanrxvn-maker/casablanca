/**
 * Testes das VERSÕES do AD (1..10) — identidade, custo e o MAPEAMENTO
 * automático do doc (o caso que o Silas descreveu: mesmo avatar nos dois
 * blocos = uma versão só; avatar diferente = duas).
 */
import {
  MAX_VERSOES,
  sufixoVersao,
  nomeComVersao,
  taskIdDaVersao,
  versaoDoTaskId,
  taskIdBaseDaVersao,
  chaveEntregaVersao,
  avatarDaVersao,
  versaoGeraDeNovo,
  blocosDeVersaoDoDoc,
  mapearVersoesDoDoc,
  rotuloDaVersao,
  type VersaoAd,
} from './versoes-ad';

let falhas = 0;
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ✓ ' + msg);
  else { falhas++; console.error('  ✗ FALHOU: ' + msg); }
}

const V = (n: number, nome: string, porPapel: VersaoAd['porPapel'] = {}): VersaoAd => ({ n, nome, porPapel });

console.log('— INVARIANTE 1: a versão 1 é o caminho de hoje, intocado —');
{
  ok(sufixoVersao(V(1, 'META')) === '', 'versão 1 não tem sufixo de arquivo');
  ok(nomeComVersao('AD06G1GL.mp4', V(1, 'META')) === 'AD06G1GL.mp4', 'nome do arquivo intacto');
  ok(taskIdDaVersao('868k', V(1, 'META')) === '868k', 'taskId intacto');
  ok(chaveEntregaVersao('batch:868k:montado', V(1, 'META')) === 'batch:868k:montado', 'chave do IDB intacta');
  ok(versaoDoTaskId('868k') === 1, 'task sem sufixo é a versão 1');
}

console.log('— nomenclatura: NUNCA YouTube/META, sempre Versão N (02.09) —');
{
  // Silas: *"o fato de pedir versão YouTube e META no docs significa que META
  // seria versão 1 e YouTube a versão 2, mas NUNCA colocar na nomenclatura"*.
  // O canal é decisão da entrega; amarrar o arquivo a ele fazia a versão 2
  // herdar um caminho de código separado — de onde vinham as falhas.
  ok(sufixoVersao(V(2, 'YouTube')) === '_V2', 'o arquivo da versão 2 é _V2, não _YOUTUBE');
  ok(nomeComVersao('AD06G1GL.mp4', V(2, 'YouTube / Kwai')) === 'AD06G1GL_V2.mp4', 'nem "YouTube / Kwai" vaza pro nome');
  ok(nomeComVersao('AD06G1GL.mp4', V(2, 'META')) === 'AD06G1GL_V2.mp4', 'META também não vaza');
  ok(taskIdDaVersao('868k', V(2, 'YouTube')) === '868k-v2', 'a task irmã é -v2');
  ok(chaveEntregaVersao('batch:868k:montado', V(2, 'YouTube')) === 'batch:868k:v2:montado', 'a chave é :v2');
  ok(versaoDoTaskId('868k-v2') === 2, '-v2 é a versão 2');
  ok(taskIdBaseDaVersao('868k-v2') === '868k', 'volta pra task mãe');
}

console.log('— mas o id LEGADO -yt continua sendo lido (AD já disparado) —');
{
  // Trocar a nomenclatura não pode órfãozar o que já está no localStorage e no
  // IndexedDB: quem disparou ontem tem irmãs com id `-yt` gravadas.
  ok(versaoDoTaskId('868k-yt') === 2, 'id velho -yt ainda é a versão 2');
  ok(taskIdBaseDaVersao('868k-yt') === '868k', 'e ainda colapsa no card da mãe');
}

console.log('— versões 3..10 —');
{
  ok(sufixoVersao(V(3, 'Avatar 3')) === '_V3', 'sufixo _V3');
  ok(nomeComVersao('AD06G1GL.mp4', V(7, 'Sete')) === 'AD06G1GL_V7.mp4', 'arquivo da versão 7');
  ok(taskIdDaVersao('868k', V(4, 'Quatro')) === '868k-v4', 'task irmã -v4');
  ok(versaoDoTaskId('868k-v4') === 4 && taskIdBaseDaVersao('868k-v4') === '868k', 'ida e volta da versão 4');
  ok(chaveEntregaVersao('batch:868k:montado', V(5, 'Cinco')) === 'batch:868k:v5:montado', 'chave da versão 5');
  ok(versaoDoTaskId('868k-v99') === 1, 'sufixo fora de 2..10 não é versão (não sequestra id alheio)');
  ok(MAX_VERSOES === 10, 'teto de 10 versões');
}

console.log('— INVARIANTE 2: versão N nunca colide com a 1 —');
{
  const nomes = new Set<string>();
  const ids = new Set<string>();
  const chaves = new Set<string>();
  for (let n = 1; n <= MAX_VERSOES; n++) {
    const v = V(n, n === 2 ? 'YouTube' : `Versão ${n}`);
    nomes.add(nomeComVersao('AD06G1GL.mp4', v));
    ids.add(taskIdDaVersao('868k', v));
    chaves.add(chaveEntregaVersao('batch:868k:montado', v));
  }
  ok(nomes.size === MAX_VERSOES, 'todos os nomes de arquivo distintos');
  ok(ids.size === MAX_VERSOES, 'todos os taskIds distintos');
  ok(chaves.size === MAX_VERSOES, 'todas as chaves distintas');
}

console.log('— custo: versão sem avatar próprio NÃO gera de novo —');
{
  const papeis = [{ role: 'Doutor', avatarId: 'av1' }, { role: 'Mulher', avatarId: 'av2' }];
  ok(versaoGeraDeNovo(papeis, V(2, 'YouTube')) === false, 'versão vazia herda a 1 (custo zero)');
  ok(versaoGeraDeNovo(papeis, V(2, 'YouTube', { doutor: { avatarId: 'av1' } })) === false, 'mesmo avatar = não gera');
  ok(versaoGeraDeNovo(papeis, V(2, 'YouTube', { doutor: { avatarId: 'av9' } })) === true, 'avatar diferente = gera');
  ok(versaoGeraDeNovo(papeis, V(1, 'META')) === true, 'a versão 1 sempre gera (é o disparo)');
}

console.log('— avatarDaVersao cai na versão 1 quando a versão não escolheu —');
{
  const base = { avatarId: 'av1', avatarName: 'Doutor A', avatarVoiceId: 'vz1' };
  const semEscolha = avatarDaVersao(base, V(2, 'YouTube'), 'Doutor');
  ok(semEscolha.avatarId === 'av1' && semEscolha.avatarVoiceId === 'vz1', 'herda avatar e voz da versão 1');
  const comEscolha = avatarDaVersao(base, V(2, 'YouTube', { doutor: { avatarId: 'av9', avatarName: 'Doutor B' } }), 'Doutor');
  ok(comEscolha.avatarId === 'av9' && comEscolha.avatarName === 'Doutor B', 'usa o avatar da versão');
  ok(comEscolha.avatarVoiceId === 'vz1', 'voz não escolhida continua a da versão 1');
  ok(avatarDaVersao(base, null, 'Doutor').avatarId === 'av1', 'sem versão = versão 1');
}

console.log('— MODO IMAGEM: a versão troca o FRAME, não o avatar —');
{
  const papeis = [{ role: 'Doutor', avatarId: null, imageKey: 'pilot:t:img:0' }];
  ok(versaoGeraDeNovo(papeis, V(2, 'YouTube')) === false, 'versão sem frame próprio herda a 1 (custo zero)');
  ok(versaoGeraDeNovo(papeis, V(2, 'YouTube', { doutor: { imageKey: 'pilot:t:img:0' } })) === false, 'mesmo frame = não gera');
  ok(versaoGeraDeNovo(papeis, V(3, 'Avatar 3', { doutor: { imageKey: 'pilot:t:v3:img:0' } })) === true, 'frame diferente = gera de novo');
}
{
  const base = { avatarId: null, imageKey: 'img-1', imageDataUrl: 'data:1', imageName: 'cena1.jpg', avatarVoiceId: 'vz1' };
  const herdou = avatarDaVersao(base, V(2, 'YouTube'), 'Doutor');
  ok(herdou.imageKey === 'img-1', 'sem escolha, a versão usa o frame da 1');
  const trocou = avatarDaVersao(base, V(2, 'YouTube', { doutor: { imageKey: 'img-2', imageDataUrl: 'data:2', imageName: 'cena2.jpg' } }), 'Doutor');
  ok(trocou.imageKey === 'img-2' && trocou.imageName === 'cena2.jpg', 'usa o frame da versão');
  ok(trocou.avatarVoiceId === 'vz1', 'voz não escolhida continua a da versão 1');
  ok(!trocou.avatarId, 'modo imagem não inventa avatarId');
}

/* ═══════════ MAPEAMENTO AUTOMÁTICO (o caso do Silas) ═══════════ */

const DOC_IGUAL = [
  'Avatar e Vozes:',
  'Meta Ads:',
  'Doutor: drrobertokalil 1.mp4',
  'Youtube Ads / Kwai Ads:',
  'Doutor: drrobertokalil 1.mp4',
].join('\n');

const DOC_DIFERENTE = [
  'Avatar e Vozes:',
  'Meta Ads:',
  'Doutor: drrobertokalil 1.mp4',
  'Youtube Ads / Kwai Ads:',
  'Doutor: joshuagonzalezmd.mp4',
].join('\n');

const DOC_AVATAR_N = [
  'Avatar 1:',
  'Doutor: drrobertokalil 1.mp4',
  'Avatar 2:',
  'Doutor: joshuagonzalezmd.mp4',
  'Avatar 3:',
  'Doutor: tiagorochaog.mp4',
].join('\n');

console.log('— MESMO avatar nos dois blocos → UMA versão —');
{
  const m = mapearVersoesDoDoc(DOC_IGUAL);
  ok(m.total === 1, `1 versão (veio ${m.total})`);
  ok(/MESMO avatar/i.test(m.motivo), 'o motivo explica que o avatar é o mesmo');
}

console.log('— avatar DIFERENTE entre Meta e YouTube → DUAS versões —');
{
  const m = mapearVersoesDoDoc(DOC_DIFERENTE);
  ok(m.total === 2, `2 versões (veio ${m.total})`);
  ok(m.versoes[0].nome === 'Versão 1', `1ª = Versão 1 (veio ${m.versoes[0].nome})`);
  ok(m.versoes[1].nome === 'Versão 2', `2ª = Versão 2 (veio ${m.versoes[1].nome})`);
  // o rótulo do doc sobrevive como PROCEDÊNCIA, só não vira nome
  ok(/meta/i.test(m.versoes[0].rotuloDoDoc || ''), 'o rótulo META do doc fica guardado');
  ok(/you\s*tube/i.test(m.versoes[1].rotuloDoDoc || ''), 'e o do YouTube também');
  ok(m.versoes[1].papeis[0].username === 'joshuagonzalezmd', 'papel da 2ª leva o avatar dela');
}

console.log('— "Avatar 1/2/3:" também vira versão (mesma regra) —');
{
  const m = mapearVersoesDoDoc(DOC_AVATAR_N);
  ok(m.total === 3, `3 versões (veio ${m.total})`);
  ok(m.versoes.map((v) => v.nome).join(',') === 'Versão 1,Versão 2,Versão 3', 'a numeração vem da ORDEM do doc, não do rótulo');
}
{
  const doc = ['Avatar 1:', 'Doutor: mesmo.mp4', 'Avatar 2:', 'Doutor: mesmo.mp4'].join('\n');
  ok(mapearVersoesDoDoc(doc).total === 1, '"Avatar 1/2" com o mesmo arquivo = 1 versão');
}

console.log('— doc SEM rótulo de versão (o caso normal) → 1 versão —');
{
  const doc = ['Avatar e Vozes:', 'Doutor: drrobertokalil 1.mp4', 'Mulher: maria.mp4'].join('\n');
  const m = mapearVersoesDoDoc(doc);
  ok(m.total === 1 && m.versoes.length === 0, 'nenhum bloco → uma versão, sem sugestão');
  ok(blocosDeVersaoDoDoc(doc).length === 0, 'não inventa bloco onde não tem rótulo');
}

console.log('— multi-papel: só um papel diferente já separa as versões —');
{
  const doc = [
    'Meta Ads:',
    'Doutor: a.mp4',
    'Mulher: b.mp4',
    'Youtube Ads:',
    'Doutor: a.mp4',
    'Mulher: c.mp4',
  ].join('\n');
  const m = mapearVersoesDoDoc(doc);
  ok(m.total === 2, 'Mulher diferente → 2 versões');
  ok(m.versoes[1].papeis.length === 2, 'a versão 2 leva os dois papéis dela');
}

console.log('— teto de 10 versões —');
{
  const linhas: string[] = [];
  for (let i = 1; i <= 14; i++) { linhas.push(`Avatar ${i}:`, `Doutor: pessoa${i}.mp4`); }
  const m = mapearVersoesDoDoc(linhas.join('\n'));
  ok(m.total === MAX_VERSOES, `corta em ${MAX_VERSOES} (veio ${m.total})`);
}

console.log('— normalização: @ , .mp4 e acento não separam versões à toa —');
{
  const doc = ['Meta Ads:', 'Doutor: @drrobertokalil 1.mp4', 'Youtube Ads:', 'Doutor: drrobertokalil 1'].join('\n');
  ok(mapearVersoesDoDoc(doc).total === 1, '@ e extensão não contam como avatar diferente');
}

console.log('— rótulo da versão pra lista —');
{
  ok(rotuloDaVersao('AD02GL - PRPB12', V(2, 'YouTube'), 'drrobertokalil') === 'AD02GL - PRPB12 · YouTube · @drrobertokalil', 'nome padrão = task · versão · @avatar');
  ok(rotuloDaVersao('AD02GL', V(1, 'META')) === 'AD02GL · META', 'sem avatar mostra só task e versão');
}

console.log('— entrada suja não explode —');
{
  ok(mapearVersoesDoDoc('').total === 1, 'string vazia');
  ok(blocosDeVersaoDoDoc('Meta Ads:').length === 0, 'rótulo sem papel nenhum é ignorado');
}

if (falhas > 0) {
  console.error(`\n${falhas} teste(s) FALHARAM`);
  process.exit(1);
}
// — VERSAO COM AVATAR em base de MODO IMAGEM (30.08) —
// A versao pode trocar o FRAME por um AVATAR DA BIBLIOTECA. Ai e' OUTRA
// pessoa: a voz clonada da foto da versao 1 NAO pode vazar pra ela.
{
  const baseImg = {
    avatarId: null,
    avatarVoiceId: 'voz-clonada-da-foto',
    voiceOverride: { id: 'voz-clonada-da-foto', name: 'Foto v1' },
    imageKey: 'pilot:t:img:0',
    imageDataUrl: 'data:image/png;base64,V1',
    imageName: 'v1.png',
  };
  const verAvatar = {
    n: 3,
    nome: 'Versão 3',
    porPapel: { doutor: { avatarId: 'av-bib', avatarName: 'Dr Bib', avatarVoiceId: 'voz-do-avatar' } },
  };
  const esc = avatarDaVersao(baseImg, verAvatar, 'Doutor');
  ok(esc.avatarId === 'av-bib', 'a versao troca o frame por avatar da biblioteca');
  ok(esc.imageKey === null && esc.imageDataUrl === null, 'o frame da base NAO viaja junto com o avatar');
  ok(esc.voiceOverride === null, 'a voz clonada da FOTO nao vaza pro avatar (e outra pessoa)');
  ok(esc.avatarVoiceId === 'voz-do-avatar', 'a voz e a do proprio avatar');

  // com voz escolhida NA VERSAO, ela vence
  const verComVoz = {
    n: 3,
    nome: 'Versão 3',
    porPapel: { doutor: { avatarId: 'av-bib', voiceOverride: { id: 'voz-x', name: 'X' } } },
  };
  ok(avatarDaVersao(baseImg, verComVoz, 'Doutor').voiceOverride?.id === 'voz-x', 'voz escolhida pra versao vence');

  // base NORMAL (avatar): comportamento antigo intacto — herda a voz da base
  const baseAv = { avatarId: 'av1', voiceOverride: { id: 'voz-base', name: 'B' } };
  ok(avatarDaVersao(baseAv, verAvatar, 'Doutor').voiceOverride?.id === 'voz-base', 'base por avatar continua herdando a voz (mesma pessoa nos 2 canais)');

  // e gera de novo: avatar proprio em base de imagem = segunda geracao
  ok(versaoGeraDeNovo([{ role: 'Doutor', avatarId: null, imageKey: 'pilot:t:img:0' }], verAvatar), 'avatar proprio na base de imagem gera de novo');
}

console.log('\nversoes-ad: todos os testes passaram ✓');
