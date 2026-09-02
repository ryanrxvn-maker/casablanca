/**
 * Trava as invariantes das DUAS VERSÕES POR AD (META × YouTube).
 * Ver lib/versao-canal.ts.
 *
 * O que isto blinda: (a) ligar a função não pode mudar UMA VÍRGULA do caminho
 * de hoje — o META continua com o mesmo nome de arquivo e a mesma chave de
 * IndexedDB; (b) a versão YouTube não pode sobrescrever a do META; (c) a
 * decisão "gera de novo" tem que ser conservadora, porque cada `true` a mais é
 * um disparo do HeyGen pago à toa.
 */
import {
  CANAIS,
  rotuloCanal,
  sufixoCanal,
  nomeComCanal,
  chaveEntregaCanal,
  avatarDoCanal,
  precisaGerarDeNovo,
  papeisQueMudam,
  planejarDuasVersoes,
  taskIdDoCanal,
  canalDoTaskId,
  taskIdBase,
  type PapelCanal,
} from './versao-canal';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

console.log('\nGARANTIA — duas versões por AD (META × YouTube):');

// (1) O META é o caminho de HOJE, byte a byte.
{
  ok(nomeComCanal('AD06G1GL.mp4', 'meta') === 'AD06G1GL.mp4', 'META mantém o nome do arquivo intacto');
  ok(sufixoCanal('meta') === '', 'META não ganha sufixo');
  ok(
    chaveEntregaCanal('batch:868xyz:montado', 'meta') === 'batch:868xyz:montado',
    'META mantém a chave de entrega intacta',
  );
  ok(
    chaveEntregaCanal('batch:868xyz:takes', 'meta') === 'batch:868xyz:takes',
    'META mantém a chave de takes intacta',
  );
  ok(
    chaveEntregaCanal('batch:868xyz:camo', 'meta') === 'batch:868xyz:camo',
    'META mantém a chave de camuflado intacta',
  );
}

// (2) O YouTube NUNCA colide com o META — nem nome, nem chave.
{
  ok(nomeComCanal('AD06G1GL.mp4', 'youtube') === 'AD06G1GL_V2.mp4', 'a 2ª versão sufixa _V2 antes da extensão');
  ok(
    nomeComCanal('AD06G1GL.mp4', 'youtube') !== nomeComCanal('AD06G1GL.mp4', 'meta'),
    'nome do YouTube difere do nome do META',
  );
  for (const k of ['batch:868xyz:montado', 'batch:868xyz:takes', 'batch:868xyz:camo']) {
    ok(
      chaveEntregaCanal(k, 'youtube') !== chaveEntregaCanal(k, 'meta'),
      `chave do YouTube difere do META em ${k}`,
    );
  }
  ok(
    chaveEntregaCanal('batch:868xyz:montado', 'youtube') === 'batch:868xyz:yt:montado',
    'chave do YouTube tem o formato batch:<id>:yt:<kind>',
  );
  // a chave do YouTube tem que continuar dentro do prefixo purgável da task
  ok(
    chaveEntregaCanal('batch:868xyz:montado', 'youtube').startsWith('batch:868xyz:'),
    'chave do YouTube fica sob o prefixo da task (a faxina do zip-store a alcança)',
  );
}

// (3) Nome sem extensão e nome com ponto no meio não quebram.
{
  ok(nomeComCanal('AD06G1GL', 'youtube') === 'AD06G1GL_V2', 'nome sem extensão recebe o sufixo no fim');
  ok(
    nomeComCanal('AD06.G1.GL.mp4', 'youtube') === 'AD06.G1.GL_V2.mp4',
    'sufixo entra antes da ÚLTIMA extensão',
  );
  ok(nomeComCanal('.gitignore', 'youtube') === '.gitignore_V2', 'nome que começa com ponto não vira extensão');
}

// (4) precisaGerarDeNovo é conservadora — cada true a mais é crédito gasto.
{
  const igual: PapelCanal[] = [{ avatarId: 'a1', youtube: { avatarId: 'a1' } }];
  const semYoutube: PapelCanal[] = [{ avatarId: 'a1' }];
  const youtubeNulo: PapelCanal[] = [{ avatarId: 'a1', youtube: null }];
  const youtubeVazio: PapelCanal[] = [{ avatarId: 'a1', youtube: { avatarId: '' } }];
  const difere: PapelCanal[] = [{ avatarId: 'a1', youtube: { avatarId: 'a2' } }];
  const umDifere: PapelCanal[] = [
    { avatarId: 'a1', youtube: { avatarId: 'a1' } },
    { avatarId: 'b1', youtube: { avatarId: 'b2' } },
  ];

  ok(!precisaGerarDeNovo(igual), 'mesmo avatar nos dois canais NÃO gera de novo');
  ok(!precisaGerarDeNovo(semYoutube), 'sem escolha de YouTube NÃO gera de novo');
  ok(!precisaGerarDeNovo(youtubeNulo), 'youtube null NÃO gera de novo');
  ok(!precisaGerarDeNovo(youtubeVazio), 'youtube com avatarId vazio NÃO gera de novo');
  ok(!precisaGerarDeNovo([]), 'sem papéis NÃO gera de novo');
  ok(precisaGerarDeNovo(difere), 'avatar diferente GERA de novo');
  ok(precisaGerarDeNovo(umDifere), 'basta UM papel diferente pra gerar de novo');
  ok(papeisQueMudam(umDifere).length === 1 && papeisQueMudam(umDifere)[0] === 1, 'papeisQueMudam aponta o índice certo');
  ok(papeisQueMudam(igual).length === 0, 'papeisQueMudam vazio quando nada muda');
}

// (5) avatarDoCanal nunca devolve avatar vazio.
{
  const papel: PapelCanal = {
    avatarId: 'a1', avatarName: 'Ana', avatarThumb: 't1', avatarVoiceId: 'v1',
    youtube: { avatarId: 'a2' },
  };
  ok(avatarDoCanal(papel, 'meta').avatarId === 'a1', 'META usa o avatar do papel');
  ok(avatarDoCanal(papel, 'youtube').avatarId === 'a2', 'YouTube usa a escolha própria');
  ok(avatarDoCanal(papel, 'youtube').avatarVoiceId === 'v1', 'YouTube herda a voz do papel quando não escolheu outra');
  ok(avatarDoCanal(papel, 'youtube').avatarName === 'Ana', 'YouTube herda o nome quando não veio outro');

  const semEscolha: PapelCanal = { avatarId: 'a1', avatarVoiceId: 'v1' };
  ok(avatarDoCanal(semEscolha, 'youtube').avatarId === 'a1', 'YouTube sem escolha cai no avatar do META');
  ok(avatarDoCanal(semEscolha, 'youtube').avatarVoiceId === 'v1', 'YouTube sem escolha cai na voz do META');

  const vozPropria: PapelCanal = { avatarId: 'a1', avatarVoiceId: 'v1', youtube: { avatarId: 'a2', avatarVoiceId: 'v2' } };
  ok(avatarDoCanal(vozPropria, 'youtube').avatarVoiceId === 'v2', 'YouTube usa a própria voz quando escolhida');
}

// (6) planejarDuasVersoes: desligado se comporta como hoje.
{
  const difere: PapelCanal[] = [{ avatarId: 'a1', youtube: { avatarId: 'a2' } }];
  const desligado = planejarDuasVersoes(false, difere);
  ok(!desligado.ativo && !desligado.gerarDeNovo, 'desligado nunca gera segunda versão, mesmo com avatar diferente');

  const ligadoIgual = planejarDuasVersoes(true, [{ avatarId: 'a1', youtube: { avatarId: 'a1' } }]);
  ok(ligadoIgual.ativo && !ligadoIgual.gerarDeNovo, 'ligado com avatar igual: duas versões, UMA geração');
  ok(/reaproveita/i.test(ligadoIgual.motivo), 'motivo diz que reaproveita');

  const ligadoDifere = planejarDuasVersoes(true, difere);
  ok(ligadoDifere.ativo && ligadoDifere.gerarDeNovo, 'ligado com avatar diferente: gera de novo');
  ok(/1 papel\b/.test(ligadoDifere.motivo), 'motivo conta quantos papéis mudam');
}

// (7) Task irmã: o id do YouTube não pode cair sob o prefixo purgável do META.
{
  const TASK = '868abc123';
  const yt = taskIdDoCanal(TASK, 'youtube');
  ok(taskIdDoCanal(TASK, 'meta') === TASK, 'META mantém o taskId original');
  ok(yt !== TASK, 'YouTube tem taskId próprio');
  ok(canalDoTaskId(TASK) === 'meta' && canalDoTaskId(yt) === 'youtube', 'canalDoTaskId reconhece os dois');
  ok(taskIdBase(yt) === TASK && taskIdBase(TASK) === TASK, 'taskIdBase volta pra task mãe');

  // A ARMADILHA: o disparo do zero faz deletePrefix(`pilot:<taskId>:`). Se o id
  // da irmã ficasse sob esse prefixo, re-disparar o META apagaria o YouTube.
  const purgeMeta = `pilot:${TASK}:`;
  const purgeYt = `pilot:${yt}:`;
  ok(!`pilot:${yt}:g:xyz:part:HOOK 1`.startsWith(purgeMeta), 'purge do META NÃO alcança os takes do YouTube');
  ok(!`pilot:${TASK}:g:xyz:part:HOOK 1`.startsWith(purgeYt), 'purge do YouTube NÃO alcança os takes do META');
  ok(`pilot:${yt}:g:xyz:part:HOOK 1`.startsWith(purgeYt), 'purge do YouTube alcança os próprios takes');

  // Mesma armadilha nas chaves de entrega.
  ok(!`batch:${yt}:montado`.startsWith(`batch:${TASK}:`), 'entrega do YouTube fora do prefixo do META');

  // A gaveta de entrega do canal e a task irmã são caminhos INDEPENDENTES —
  // usar os dois juntos não pode colidir.
  ok(
    chaveEntregaCanal(`batch:${yt}:montado`, 'meta') !== chaveEntregaCanal(`batch:${TASK}:montado`, 'youtube'),
    'task irmã e sufixo de chave não geram a mesma chave',
  );
}

// (8) Sanidade da lista de canais e dos rótulos.
{
  ok(CANAIS.length === 2 && CANAIS[0] === 'meta', 'META vem primeiro (o YouTube pode reaproveitar o resultado dele)');
  // 02.09: o canal virou detalhe interno. Na tela e no arquivo é Versão 1 e 2.
  ok(rotuloCanal('meta') === 'Versão 1' && rotuloCanal('youtube') === 'Versão 2',
    'o rótulo da UI é Versão N — META/YouTube não aparecem pro usuário');
}

// (9) MODO IMAGEM (30.08): no DR MILLION o AD nao tem avatar de biblioteca — a
// pessoa E a foto. Entao "+ versoes" tem que trocar o FRAME, e a mesma regra de
// custo vale: frame vazio no canal = reaproveita o decupado do META.
{
  const semFrameProprio: PapelCanal[] = [
    { avatarId: null, imageKey: 'pilot:t1:img:0', youtube: null },
  ];
  ok(!precisaGerarDeNovo(semFrameProprio), 'modo imagem sem frame no YouTube NAO gera de novo');
  ok(
    avatarDoCanal(semFrameProprio[0], 'youtube').imageKey === 'pilot:t1:img:0',
    'sem frame proprio, o YouTube usa o MESMO frame do META',
  );

  const comFrameProprio: PapelCanal[] = [
    {
      avatarId: null,
      avatarVoiceId: 'voz-do-papel',
      imageKey: 'pilot:t1:img:0',
      imageName: 'meta.png',
      youtube: {
        avatarId: null,
        imageKey: 'pilot:t1:v2:img:0',
        imageDataUrl: 'data:image/png;base64,YT',
        imageName: 'yt.png',
      },
    },
  ];
  ok(precisaGerarDeNovo(comFrameProprio), 'frame proprio no YouTube EXIGE segundo disparo');
  ok(papeisQueMudam(comFrameProprio).length === 1, 'o relatorio de custo enxerga o papel que muda de frame');
  const escYt = avatarDoCanal(comFrameProprio[0], 'youtube');
  ok(escYt.imageKey === 'pilot:t1:v2:img:0', 'o YouTube sai com o frame DELE');
  ok(escYt.imageDataUrl === 'data:image/png;base64,YT', 'e com os bytes do frame dele');
  // A voz e o nome continuam do papel: e a MESMA pessoa em outra foto.
  ok(escYt.avatarVoiceId === 'voz-do-papel', 'a voz do papel sobrevive a troca de frame');
  ok(avatarDoCanal(comFrameProprio[0], 'meta').imageKey === 'pilot:t1:img:0', 'o META nao muda de frame');

  // MESMO frame nos dois canais = nao gera de novo (a armadilha do custo).
  const mesmoFrame: PapelCanal[] = [
    { avatarId: null, imageKey: 'pilot:t1:img:0', youtube: { avatarId: null, imageKey: 'pilot:t1:img:0' } },
  ];
  ok(!precisaGerarDeNovo(mesmoFrame), 'frame IGUAL nos dois canais nao gasta geracao');

  // O plano em portugues tem que dizer a verdade nos dois casos.
  ok(planejarDuasVersoes(true, comFrameProprio).gerarDeNovo, 'o plano acusa a geracao nova no modo imagem');
  ok(!planejarDuasVersoes(true, mesmoFrame).gerarDeNovo, 'o plano diz reaproveita quando o frame e igual');

  // E o caminho ANTIGO (avatar de biblioteca) nao pode ter mudado.
  const soAvatar: PapelCanal[] = [{ avatarId: 'av1', youtube: { avatarId: 'av2' } }];
  ok(precisaGerarDeNovo(soAvatar), 'avatar diferente no YouTube continua gerando de novo');
  ok(avatarDoCanal(soAvatar[0], 'youtube').avatarId === 'av2', 'e continua trocando o avatar');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} versao-canal: ${passed} ok, ${failed} fail\n`);
if (failed > 0) process.exit(1);
