import {
  MOTOR_ECONOMIA,
  ehIdSintetico,
  idDaCena,
  idSinteticoDaCena,
  statusDasCenas,
  motivoLegivel,
  planejarEconomia,
  podeEconomia,
  recusaDaParte,
  resultadosParaRunner,
  resumoDoPlano,
  totalDeCenas,
  travasDoModoEconomia,
  type ParteDoPlano,
} from './pilot-economia';

let oks = 0;
let fails = 0;
function ok(cond: unknown, msg: string) {
  if (cond) {
    oks++;
    console.log(`  ok   ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL ${msg}`);
  }
}
function eq<T>(a: T, b: T, msg: string) {
  const igual = JSON.stringify(a) === JSON.stringify(b);
  if (igual) {
    oks++;
    console.log(`  ok   ${msg}`);
  } else {
    fails++;
    console.log(`  FAIL ${msg} (veio ${JSON.stringify(a)})`);
  }
}

const take = (o: Partial<ParteDoPlano> & { label: string }): ParteDoPlano => ({
  text: 'fala',
  avatarId: 'av1',
  groupId: 'g1',
  ...o,
});

console.log('pilot-economia:');

/* ─── 1. agrupamento por avatar, ordem preservada ─── */
{
  const partes = [
    take({ label: 'HOOK 1', text: 'gancho', avatarId: 'av1' }),
    take({ label: 'BODY 1', text: 'corpo um', avatarId: 'av1' }),
    take({ label: 'BODY 2', text: 'corpo dois', avatarId: 'av2', groupId: 'g2' }),
    take({ label: 'BODY 3', text: 'corpo tres', avatarId: 'av1' }),
  ];
  const p = planejarEconomia(partes);
  eq(p.projetos.length, 2, 'dois avatares viram dois projetos do Studio');
  eq(p.projetos[0].avatarId, 'av1', 'o projeto do primeiro avatar vem primeiro');
  eq(p.projetos[0].cenas.map((c) => c.label), ['HOOK 1', 'BODY 1', 'BODY 3'], 'as cenas do avatar 1 mantêm a ordem do plano');
  eq(p.projetos[0].cenas.map((c) => c.idx), [0, 1, 3], 'cada cena guarda o índice do plano original');
  eq(p.projetos[1].cenas.map((c) => c.label), ['BODY 2'], 'o avatar 2 leva só a cena dele');
  eq(p.projetos[1].groupId, 'g2', 'o groupId do avatar 2 é o dele, não o do primeiro');
  eq(totalDeCenas(p), 4, 'quatro cenas no total');
  eq(p.recusas.length, 0, 'nada recusado');
}

/* ─── 2. gesto é REMOVIDO (subiria pro Avatar IV, que cobra) ─── */
{
  const partes = [
    take({ label: 'HOOK 1', motionPrompt: 'mexe a gelatina 2x' }),
    take({ label: 'BODY 1' }),
  ];
  const p = planejarEconomia(partes);
  eq(p.avisos.length, 1, 'gesto vira aviso');
  eq(p.avisos[0].aviso, 'gesto-removido', 'o aviso diz que o gesto saiu');
  ok(p.avisos[0].detalhe.includes('Avatar IV'), 'o aviso explica que o gesto subiria pro Avatar IV');
  const cena = p.projetos[0].cenas[0] as unknown as Record<string, unknown>;
  ok(!('motionPrompt' in cena), 'a cena enviada NÃO carrega o gesto');
  eq(p.projetos[0].cenas.length, 2, 'a cena com gesto continua sendo enviada, só sem o gesto');
}

/* ─── 3. motor pago é rebaixado ─── */
{
  const p = planejarEconomia([take({ label: 'BODY 1', engine: 'IV' }), take({ label: 'BODY 2', engine: 'v' })]);
  eq(p.avisos.map((a) => a.aviso), ['motor-rebaixado', 'motor-rebaixado'], 'IV e V viram aviso de rebaixamento');
  ok(p.avisos[0].detalhe.includes('Avatar III'), 'o aviso diz que vai em Avatar III');
  eq(MOTOR_ECONOMIA, 'III', 'o motor do modo economia é o III');
}
{
  const p = planejarEconomia([take({ label: 'BODY 1', engine: 'III' })]);
  eq(p.avisos.length, 0, 'Avatar III não gera aviso nenhum');
}

/* ─── 4. o que NÃO pode ir pelo modo economia ─── */
{
  eq(recusaDaParte(take({ label: 'x', text: '   ' })), 'sem-texto', 'take sem texto é recusado');
  eq(recusaDaParte(take({ label: 'x', imageKey: 'img:1' })), 'modo-imagem', 'modo imagem é recusado');
  eq(recusaDaParte(take({ label: 'x', audioKey: 'aud:1' })), 'audio-upado', 'áudio upado é recusado');
  eq(recusaDaParte(take({ label: 'x', avatarId: null })), 'sem-avatar', 'take sem avatar é recusado');
  eq(recusaDaParte(take({ label: 'x' })), null, 'take normal passa');
  // ordem das checagens: imagem vence "sem avatar" (cena de imagem não tem avatarId de propósito)
  eq(recusaDaParte({ label: 'x', text: 'a', avatarId: null, imageKey: 'k' }), 'modo-imagem', 'cena de imagem é recusada como imagem, não como "sem avatar"');
  ok(motivoLegivel('audio-upado').includes('texto'), 'o motivo legível explica que o modo economia fala por texto');
}
{
  const p = planejarEconomia([
    take({ label: 'HOOK 1' }),
    take({ label: 'BODY 1', imageKey: 'img:1', avatarId: null }),
  ]);
  eq(p.recusas, [{ idx: 1, label: 'BODY 1', motivo: 'modo-imagem' }], 'a recusa carrega índice, label e motivo');
  eq(totalDeCenas(p), 1, 'só o take bom vira cena');
}

/* ─── 5. podeEconomia: o AD inteiro ou nada ─── */
{
  ok(podeEconomia([take({ label: 'a' }), take({ label: 'b' })]), 'AD todo por texto pode ir');
  ok(!podeEconomia([take({ label: 'a' }), take({ label: 'b', audioKey: 'k' })]), 'um take de áudio já tira o AD do modo economia');
  ok(!podeEconomia([]), 'AD sem take nenhum não pode');
}

/* ─── 6. teto de cenas por projeto ─── */
{
  const partes = Array.from({ length: 7 }, (_, i) => take({ label: `BODY ${i + 1}` }));
  const semTeto = planejarEconomia(partes);
  eq(semTeto.projetos.length, 1, 'sem teto, um projeto só');
  const comTeto = planejarEconomia(partes, { maxCenasPorProjeto: 3 });
  eq(comTeto.projetos.map((p) => p.cenas.length), [3, 3, 1], 'com teto 3, fatia em 3+3+1');
  eq(comTeto.projetos.every((p) => p.avatarId === 'av1'), true, 'as fatias mantêm o avatar');
  eq(totalDeCenas(comTeto), 7, 'nenhuma cena se perde ao fatiar');
  eq(planejarEconomia(partes, { maxCenasPorProjeto: 0 }).projetos.length, 1, 'teto 0 = sem teto');
}

/* ─── 7. adaptador pro contrato do runner ─── */
{
  const partes = [take({ label: 'HOOK 1' }), take({ label: 'BODY 1' }), take({ label: 'BODY 2' })];
  const enviados = [0, 1, 2];
  const r = resultadosParaRunner(enviados, partes, [
    { idx: 1, videoId: 'v-body1' },
    { idx: 0, videoId: 'v-hook1' },
    { idx: 2, error: 'render falhou' },
  ]);
  eq(r.map((x) => x.index), [1, 2, 3], 'o índice é 1-based na ordem ENVIADA, não na ordem que voltou');
  eq(r.map((x) => x.label), ['HOOK 1', 'BODY 1', 'BODY 2'], 'cada resultado leva o label do take certo');
  eq(r[0].videoId, 'v-hook1', 'a cena volta casada pelo idx do plano, não pela ordem de chegada');
  eq(r[2].videoId, null, 'cena com erro volta sem videoId');
  eq(r[2].error, 'render falhou', 'o erro da cena é preservado');
}
{
  const partes = [take({ label: 'HOOK 1' }), take({ label: 'BODY 1' })];
  const r = resultadosParaRunner([0, 1], partes, [{ idx: 0, videoId: 'v1' }]);
  eq(r[1].error, 'a cena não voltou do Studio', 'cena que sumiu vira erro explícito, nunca silêncio');
  ok(r[1].videoId === null, 'e sem videoId');
}
{
  const partes = [take({ label: 'HOOK 1' })];
  const r = resultadosParaRunner([0], partes, [{ idx: 0, videoId: null, videoUrl: null }]);
  eq(r[0].error, 'a cena renderizou mas o vídeo não foi capturado', 'render sem captura é erro nomeado');
}
{
  // só videoUrl (sem id): entra com ID SINTÉTICO, senão o Pilot filtra por
  // videoId e o take some sem erro nenhum.
  const r = resultadosParaRunner([0], [take({ label: 'HOOK 1' })], [{ idx: 0, videoUrl: 'https://x/cena.mp4' }]);
  eq(r[0].error, null, 'cena com URL e sem id conta como sucesso');
  eq(r[0].videoId, 'eco:0', 'e ganha um id sintético — nunca videoId null com error null');
  ok(ehIdSintetico(r[0].videoId), 'o id sintético é reconhecível');
  ok(r.every((x) => (x.videoId === null) === (x.error !== null)), 'contrato: ou tem id, ou tem erro — nunca os dois nulos');
}
{
  // o id do HeyGen, quando existe, vence o sintético
  const r = resultadosParaRunner([0], [take({ label: 'HOOK 1' })], [{ idx: 0, videoId: 'v-real', videoUrl: 'https://x/c.mp4' }]);
  eq(r[0].videoId, 'v-real', 'id real do HeyGen vence o sintético');
  ok(!ehIdSintetico(r[0].videoId), 'e não é marcado como sintético');
}
{
  // statusDasCenas: pré-preenche o mapa que o pipeline consulta pra baixar
  const st = statusDasCenas([
    { idx: 0, videoUrl: 'https://x/a.mp4' },
    { idx: 1, videoId: 'v9', videoUrl: 'https://x/b.mp4' },
    { idx: 2, error: 'falhou' },
    { idx: 3, videoId: 'v10' },
  ]);
  eq(Object.keys(st).sort(), ['eco:0', 'v9'], 'só cenas com URL entram no mapa de status');
  eq(st['eco:0'], { videoId: 'eco:0', status: 'completed', videoUrl: 'https://x/a.mp4' }, 'a cena nasce completed com a URL');
  eq(st['v9'].videoId, 'v9', 'cena com id real usa o id real como chave');
  ok(!('eco:2' in st) && !('v10' in st), 'cena com erro e cena sem URL ficam de fora');
}
{
  eq(idSinteticoDaCena(7), 'eco:7', 'o id sintético carrega o índice do plano');
  ok(!ehIdSintetico('abc123') && !ehIdSintetico(null), 'id do HeyGen e null não são sintéticos');
  eq(idDaCena({ idx: 4 }), null, 'cena sem id e sem URL não tem id');
}

/* ─── 8. índices salteados (parte do AD foi pelo modo economia) ─── */
{
  const partes = [take({ label: 'HOOK 1' }), take({ label: 'BODY 1' }), take({ label: 'BODY 2' })];
  const r = resultadosParaRunner([0, 2], partes, [{ idx: 2, videoId: 'v2' }, { idx: 0, videoId: 'v0' }]);
  eq(r.length, 2, 'só os enviados voltam');
  eq(r.map((x) => x.label), ['HOOK 1', 'BODY 2'], 'os labels seguem os índices enviados');
  eq(r[1].videoId, 'v2', 'o take 3 do plano casa com a cena de idx 2');
}

/* ─── 9. resumo e travas ─── */
{
  const p = planejarEconomia([take({ label: 'a' }), take({ label: 'b', avatarId: 'av2' })]);
  const s = resumoDoPlano(p);
  ok(s.includes('2 projetos') && s.includes('2 cenas') && s.includes('Avatar III'), `resumo diz projetos, cenas e motor (veio "${s}")`);
  eq(resumoDoPlano(planejarEconomia([])), 'nenhuma cena pode ir pelo modo economia', 'plano vazio tem resumo próprio');
  const um = resumoDoPlano(planejarEconomia([take({ label: 'a' })]));
  ok(um.includes('1 projeto no Studio') && um.includes('1 cena'), `singular sem "s" (veio "${um}")`);
}
{
  const t = travasDoModoEconomia();
  eq(t.motor, 'III', 'a trava fixa o Avatar III');
  eq(t.gestoBloqueado, true, 'gesto bloqueado');
  eq(t.motoresBloqueados, ['IV', 'V'], 'IV e V bloqueados');
  ok(t.porque.includes('cobra'), 'a trava explica o porquê em uma frase');
}

/* ─── 10. texto da cena vem aparado ─── */
{
  const p = planejarEconomia([take({ label: 'HOOK 1', text: '  fala com espaço  \n' })]);
  eq(p.projetos[0].cenas[0].texto, 'fala com espaço', 'o texto da cena vai aparado');
}

console.log(`\npilot-economia: ${oks} ok, ${fails} fail`);
if (fails) process.exit(1);
