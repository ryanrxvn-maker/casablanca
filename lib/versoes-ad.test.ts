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

console.log('— compatibilidade: a versão 2 "YouTube" mantém o sufixo histórico —');
{
  ok(sufixoVersao(V(2, 'YouTube')) === '_YOUTUBE', 'arquivo continua _YOUTUBE');
  ok(nomeComVersao('AD06G1GL.mp4', V(2, 'YouTube / Kwai')) === 'AD06G1GL_YOUTUBE.mp4', 'YouTube/Kwai também');
  ok(taskIdDaVersao('868k', V(2, 'YouTube')) === '868k-yt', 'task irmã continua -yt');
  ok(chaveEntregaVersao('batch:868k:montado', V(2, 'YouTube')) === 'batch:868k:yt:montado', 'chave continua :yt');
  ok(versaoDoTaskId('868k-yt') === 2, '-yt é a versão 2');
  ok(taskIdBaseDaVersao('868k-yt') === '868k', 'volta pra task mãe');
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
  ok(m.versoes[0].nome === 'META', '1ª = META');
  ok(m.versoes[1].nome === 'YouTube / Kwai', `2ª = YouTube / Kwai (veio ${m.versoes[1].nome})`);
  ok(m.versoes[1].papeis[0].username === 'joshuagonzalezmd', 'papel da 2ª leva o avatar dela');
}

console.log('— "Avatar 1/2/3:" também vira versão (mesma regra) —');
{
  const m = mapearVersoesDoDoc(DOC_AVATAR_N);
  ok(m.total === 3, `3 versões (veio ${m.total})`);
  ok(m.versoes.map((v) => v.nome).join(',') === 'Avatar 1,Avatar 2,Avatar 3', 'nomes vêm do rótulo');
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
console.log('\nversoes-ad: todos os testes passaram ✓');
