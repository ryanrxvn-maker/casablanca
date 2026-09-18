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
  faseAtiva,
  chainDeDownload,
  intencaoValida,
  prefixosDoDisparo,
  rotaDaTask,
  taskIdDoEvento,
  temFilaDeDisparo,
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
