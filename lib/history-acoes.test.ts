/**
 * Trava as invariantes das AÇÕES do histórico (baixar · remontar · debug).
 *
 * O que isto blinda:
 *  - o botão de download do disparo entrega O MONTADO, nunca os takes nem o
 *    resgate do HeyGen (pedido explícito do Silas);
 *  - o registro sabe de que disparo fala, inclusive o do Hey Auto, cujo taskId
 *    TEM ':' dentro — cortar no primeiro ':' devolveria um id quebrado;
 *  - remontar/debug só aparecem pra quem realmente sabe executar;
 *  - intenção guardada VENCE: um pedido velho não pode reiniciar disparo.
 */
import {
  aceitaAcaoDeFila,
  agruparPorVersao,
  consolidarCiclosDeDisparo,
  faseAtiva,
  filtrarPorOrigemEData,
  origemDoEvento,
  podeVirarCard,
  rotuloVersaoDoTaskId,
  chainDeDownload,
  intencaoValida,
  prefixosDoDisparo,
  rotaDaTask,
  taskIdDoEvento,
  temFilaDeDisparo,
  tituloVisivelDoHistorico,
  VALIDADE_INTENCAO_MS,
} from './history-acoes';
import { buildChains, type FileRef, type HistoryEvent } from './history-tools';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

const ev = (p: Partial<HistoryEvent> & { id: string }): HistoryEvent => ({
  t: 1_700_000_000_000,
  tool: 'clickup-pilot',
  title: 'AD02 entregue',
  kind: 'done',
  ...p,
});

console.log('\nGARANTIA — ações do histórico (download/remontar/debug):');

// (A) de que disparo o registro fala
{
  const comRef = ev({
    id: 'x1',
    ref: [{ via: 'zip', key: 'batch:86aj6:montado', name: 'AD02.mp4', label: 'Montado', taskId: '86aj6' }],
  });
  ok(taskIdDoEvento(comRef) === '86aj6', 'taskId sai da referência do arquivo');

  const disparo = ev({ id: 'dispatch:86aj6nfue:1700000000000', ref: undefined, kind: 'dispatch' });
  ok(taskIdDoEvento(disparo) === '86aj6nfue', 'taskId sai do id do registro de disparo');

  const heyAuto = ev({ id: 'dispatch:heygenauto:heygen:1699:ab12:1700000000000', kind: 'dispatch' });
  ok(
    taskIdDoEvento(heyAuto) === 'heygenauto:heygen:1699:ab12',
    'taskId do Hey Auto (com ":" dentro) sai inteiro',
  );

  ok(taskIdDoEvento(ev({ id: 'abc123' })) === null, 'registro comum não inventa disparo');
  ok(
    taskIdDoEvento(ev({ id: 'dispatch:só-isso' })) === null,
    'id de disparo sem carimbo de tempo não vira taskId',
  );
}

// (B) quem sabe executar remontar/debug
{
  ok(temFilaDeDisparo('clickup-pilot'), 'Pilot tem fila');
  ok(temFilaDeDisparo('heygen-auto'), 'Hey Auto tem fila');
  ok(!temFilaDeDisparo('compressor'), 'Compressor não tem fila de disparo');
  ok(rotaDaTask('86aj6') === '/tools/clickup-pilot', 'task comum é do Pilot');
  ok(
    rotaDaTask('heygenauto:heygen:1:2') === '/tools/heygen-auto',
    'task com prefixo heygenauto é do Hey Auto',
  );
  ok(aceitaAcaoDeFila('86aj6'), 'Pilot aceita remontar/debug por taskId');
  ok(
    !aceitaAcaoDeFila('heygenauto:heygen:1:2'),
    'Hey Auto NÃO oferece remontar de disparo velho (card é só o da rodada atual)',
  );
}

// (C) o download do disparo é o MONTADO
{
  const refs: FileRef[] = [
    { via: 'zip', key: 'batch:t:takes', name: 'AD02_takes.zip', label: 'Takes', taskId: 't' },
    { via: 'zip', key: 'batch:t:montado', name: 'AD02.mp4', label: 'Montado', taskId: 't' },
    { via: 'heygen', parts: [{ label: 'take 1', videoId: 'v1' }], name: 'AD02_heygen.zip', label: 'Resgatar takes do HeyGen', taskId: 't' },
  ];
  const e = ev({ id: 'x2', ref: refs });
  const alvo = chainDeDownload(e, buildChains(refs));
  ok(alvo?.name === 'AD02.mp4', 'escolhe o montado mesmo com takes na frente');

  const soTakes: FileRef[] = [
    { via: 'zip', key: 'batch:t:takes', name: 'AD02_takes.zip', label: 'Takes', taskId: 't' },
    { via: 'heygen', parts: [{ label: 't', videoId: 'v' }], name: 'h.zip', label: 'Resgatar takes do HeyGen', taskId: 't' },
  ];
  ok(
    chainDeDownload(ev({ id: 'x3', ref: soTakes }), buildChains(soTakes)) === null,
    'sem montado o botão não oferece takes nem resgate — não é isso que ele promete',
  );

  const camo: FileRef[] = [
    { via: 'zip', key: 'batch:t:camo', name: 'AD02_camuflado.zip', label: 'Camuflado', taskId: 't' },
  ];
  ok(
    chainDeDownload(ev({ id: 'x4', ref: camo }), buildChains(camo))?.name === 'AD02_camuflado.zip',
    'entrega camuflada também é entrega',
  );

  const comum: FileRef[] = [{ via: 'vault', key: 'hv:1', name: 'audio_normalizado.wav' }];
  const eComum = ev({ id: 'x5', tool: 'normalizador', ref: comum });
  ok(
    chainDeDownload(eComum, buildChains(comum))?.name === 'audio_normalizado.wav',
    'ferramenta comum baixa o arquivo do evento',
  );
  ok(chainDeDownload(eComum, []) === null, 'sem arquivo nenhum, sem botão');
}

// (D) o que a remoção limpa
{
  const p = prefixosDoDisparo('86aj6');
  ok(p.includes('batch:86aj6:'), 'remove o pacote do disparo');
  ok(p.includes('pilot:86aj6:'), 'remove as partes guardadas do disparo');
  ok(
    p.every((x) => x.includes('86aj6')),
    'todo prefixo é ANCORADO na task — remoção nunca varre disparo de outro',
  );
}

// (D2) o que conta como disparo TRABALHANDO
{
  for (const f of ['queued', 'dispatching', 'rendering', 'downloading', 'post']) {
    ok(faseAtiva(f), `fase "${f}" é trabalho em curso (trava remontar)`);
  }
  for (const f of ['done', 'failed', 'draft']) {
    ok(!faseAtiva(f), `fase "${f}" NÃO trava os botões`);
  }
  ok(!faseAtiva(undefined), 'registro sem fase não trava nada');
}

// (D3) registro que o Pilot nunca mostra como card
{
  ok(podeVirarCard('86aj6nfue'), 'task normal vira card');
  ok(podeVirarCard('pilot_creator_abc_1'), 'task do Creator vira card');
  ok(!podeVirarCard('archive:9eeb9de2c160a3e0741900ca4975c24e'), 'arquivo morto NÃO vira card');
  ok(!podeVirarCard('pilot-draft:team:A'), 'rascunho NÃO vira card');
  ok(!podeVirarCard('heygenauto:heygen:1:2'), 'fila do Hey Auto NÃO vira card do Pilot');
  ok(!podeVirarCard(null), 'sem task, sem card');
}

// (D4) versões do mesmo AD viram uma linha só
{
  const entrega = (id: string, taskId: string, titulo: string): HistoryEvent =>
    ev({ id, title: titulo, ref: [{ via: 'zip', key: `batch:${taskId}:montado`, name: `${titulo}.mp4`, label: 'Montado', taskId }] });
  const lista = [
    entrega('a', '86ad-v3', 'AD05 entregue'),
    entrega('b', '86ad-v2', 'AD05 entregue'),
    entrega('c', '86ad', 'AD05 entregue'),
    entrega('d', '86out', 'AD09 entregue'),
  ];
  const grupos = agruparPorVersao(lista);
  ok(grupos.length === 2, 'três versões do mesmo AD viram um grupo (e o outro AD fica só)');
  ok(grupos[0].eventos.length === 3, 'o grupo reúne as três versões');
  ok(grupos[0].eventos[0].id === 'a', 'a mais nova continua na frente');

  const disparoEEntrega = [
    ev({ id: 'x', kind: 'dispatch', ref: [{ via: 'zip', key: 'k', name: 'n', taskId: '86ad' }] }),
    entrega('y', '86ad', 'AD05 entregue'),
  ];
  ok(
    agruparPorVersao(disparoEEntrega).length === 2,
    'disparo e entrega da MESMA task não se fundem: são momentos diferentes',
  );

  // O MESMO disparo gravado duas vezes (aconteceu de verdade, 13s de
  // diferença): uma linha só, sem seletor de versão gêmea.
  const repetido = [
    ev({ id: 'dispatch:86ad:2', kind: 'dispatch', t: 1_700_000_100_000 }),
    ev({ id: 'dispatch:86ad:1', kind: 'dispatch', t: 1_700_000_000_000 }),
  ];
  const gRepetido = agruparPorVersao(repetido);
  ok(gRepetido.length === 1, 'disparo repetido continua sendo uma linha só');
  ok(gRepetido[0].eventos.length === 1, 'a repetição não vira opção do seletor');
  ok(gRepetido[0].eventos[0].id === 'dispatch:86ad:2', 'fica a mais nova');

  const semTask = [ev({ id: 'z1', tool: 'compressor' }), ev({ id: 'z2', tool: 'compressor' })];
  ok(agruparPorVersao(semTask).length === 2, 'ferramenta comum não agrupa nada');

  ok(rotuloVersaoDoTaskId('86ad-v3') === 'v3', 'rótulo da versão 3');
  ok(rotuloVersaoDoTaskId('86ad-yt') === 'v2', 'a versão YouTube é a 2');
  ok(rotuloVersaoDoTaskId('86ad') === 'v1', 'a mãe é a v1');
  ok(rotuloVersaoDoTaskId(null) === '', 'sem task, sem rótulo');

  // Variação de hook mora DENTRO do pacote da mesma task. Referências extras
  // nunca inventam versão: versão real só existe no taskId do Pilot.
  const hooksNaMesmaTask = entrega('hooks', '86hooks', 'AD08 entregue');
  hooksNaMesmaTask.ref?.push({
    via: 'zip',
    key: 'batch:86hooks:hooks',
    name: 'AD08_HOOKS.zip',
    label: 'Variações de hook',
    taskId: '86hooks',
  });
  const grupoHooks = agruparPorVersao([hooksNaMesmaTask]);
  ok(
    grupoHooks.length === 1 && grupoHooks[0].eventos.length === 1,
    'variações de hook não viram versões do AD',
  );
}

// (D4b) nomenclatura visível: estado não duplica o selo PRONTO
{
  ok(tituloVisivelDoHistorico('AD42 entregue') === 'AD42', 'remove o estado "entregue" do nome');
  ok(tituloVisivelDoHistorico('AD42 (VA) entregue') === 'AD42 (VA)', 'preserva a marca VA');
  ok(
    tituloVisivelDoHistorico('AD07 entregue (camuflado)') === 'AD07 (camuflado)',
    'preserva o tipo camuflado',
  );
  ok(
    tituloVisivelDoHistorico('Arquivo entregue ao cliente') === 'Arquivo entregue ao cliente',
    'não apaga palavra que faz parte de uma frase real',
  );
  ok(
    tituloVisivelDoHistorico('AD124VN - PRPB07 entregue') === 'AD124VN - PRPB07',
    'preserva a nomenclatura completa e exata da task',
  );
}

// (D4c) disparo + entrega pronta são uma execução, não duas tasks
{
  const taskId = '86ad124';
  const pronto = ev({
    id: 'ready-124',
    t: 1_700_000_500_000,
    title: 'AD124VN entregue',
    kind: 'done',
    meta: '10 takes · 75.5MB',
    ref: [{ via: 'zip', key: `batch:${taskId}:montado`, name: 'AD124VN.zip', taskId }],
  });
  const disparo = ev({
    id: `dispatch:${taskId}:1700000000000`,
    t: 1_700_000_000_000,
    title: 'AD124VN - PRPB07',
    kind: 'dispatch',
    channels: [{ label: 'META', color: '#22d3ee' }],
  });
  const umaLinha = consolidarCiclosDeDisparo([pronto, disparo]);
  ok(umaLinha.length === 1, 'uma execução pronta não aparece duas vezes');
  ok(umaLinha[0].id === 'ready-124', 'preserva o registro que contém o arquivo pronto');
  ok(umaLinha[0].title === 'AD124VN - PRPB07', 'recupera do disparo o nome completo da task');
  ok(umaLinha[0].channels?.[0]?.label === 'META', 'preserva o canal gravado no disparo');

  const redisparoNovo = ev({
    id: `dispatch:${taskId}:1700000600000`,
    t: 1_700_000_600_000,
    title: 'AD124VN - PRPB07',
    kind: 'dispatch',
  });
  const duasExecucoes = consolidarCiclosDeDisparo([redisparoNovo, pronto, disparo]);
  ok(duasExecucoes.length === 2, 'um redisparo realmente novo continua separado');
  ok(duasExecucoes[0].id === redisparoNovo.id, 'o redisparo atual fica na frente');
}

// (D5) origem do disparo e filtro por data
{
  const comTask = (id: string, taskId: string, t?: number): HistoryEvent =>
    ev({ id, t: t ?? 1_700_000_000_000, ref: [{ via: 'zip', key: 'k', name: 'n', taskId }] });

  ok(origemDoEvento(comTask('o1', '86abc')) === 'clickup', 'task do ClickUp');
  ok(origemDoEvento(comTask('o2', 'pilot_creator_abc_1')) === 'creator', 'task do Creator');
  ok(origemDoEvento(comTask('o3', 'pilot_docs_abc_1')) === 'docs', 'task de um Doc');
  ok(origemDoEvento(ev({ id: 'o4', tool: 'compressor' })) === null, 'ferramenta comum não tem origem');
  ok(
    origemDoEvento(comTask('o5', 'archive:xyz')) === null,
    'registro arquivado não entra em filtro de origem',
  );

  const lista = [
    comTask('a', '86abc'),
    comTask('b', 'pilot_creator_x_1'),
    comTask('c', 'pilot_docs_y_1'),
    ev({ id: 'd', tool: 'compressor' }),
  ];
  ok(filtrarPorOrigemEData(lista, { origem: 'creator' }).length === 1, 'filtra pela origem pedida');
  ok(filtrarPorOrigemEData(lista, { origem: null }).length === 4, 'sem origem escolhida, passa tudo');

  const DIA = 86_400_000;
  const agora = new Date(2026, 8, 19, 15, 0, 0).getTime();
  const porData = [
    comTask('hoje', '86a', agora - 3600_000),
    comTask('ontem', '86b', agora - DIA),
    comTask('semana', '86c', agora - 5 * DIA),
    comTask('velho', '86d', agora - 30 * DIA),
  ];
  ok(filtrarPorOrigemEData(porData, { dias: 0, agora }).map((e) => e.id).join() === 'hoje', 'só hoje');
  ok(filtrarPorOrigemEData(porData, { dias: 1, agora }).map((e) => e.id).join() === 'ontem', 'só ontem');
  ok(
    filtrarPorOrigemEData(porData, { dias: 7, agora }).map((e) => e.id).join() === 'hoje,ontem,semana',
    'últimos 7 dias pega hoje, ontem e a semana',
  );
  ok(filtrarPorOrigemEData(porData, {}).length === 4, 'sem filtro, nada some');
}

// (E) intenção entre páginas vence
{
  const agora = 1_700_000_000_000;
  ok(intencaoValida({ acao: 'debug', taskId: 't', t: agora }, agora), 'intenção recém-criada vale');
  ok(
    intencaoValida({ acao: 'debug', taskId: 't', t: agora - VALIDADE_INTENCAO_MS + 1000 }, agora),
    'dentro da janela ainda vale',
  );
  ok(
    !intencaoValida({ acao: 'debug', taskId: 't', t: agora - VALIDADE_INTENCAO_MS - 1 }, agora),
    'intenção velha NÃO reinicia disparo',
  );
  ok(!intencaoValida(null, agora), 'sem intenção, nada acontece');
  ok(
    !intencaoValida({ acao: 'retomar', taskId: '', t: agora }, agora),
    'intenção sem task é descartada',
  );
}

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed > 0) process.exit(1);
