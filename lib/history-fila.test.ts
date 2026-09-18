/**
 * Trava o STATUS AO VIVO que o histórico mostra por disparo.
 *
 * O que isto blinda:
 *  - a barra do histórico usa a MESMA conta do card do Pilot (30/60/10 + piso
 *    do motor). Se as duas telas discordarem, uma delas está mentindo pro dono;
 *  - "gerando" é gerando: fase ativa acende a barra, terminal não;
 *  - no modo economia a contagem de partes fica zerada — o progresso do motor
 *    é o que impede a barra de ficar parada o disparo inteiro;
 *  - fase desconhecida (registro velho) não explode nem inventa "pronto".
 */
import { algumAtivo, resumoDeTakes, seloDoRegistro, statusDoDisparo, tempoCurto } from './history-fila';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

const partes = (n: number, comId: number, prontos: number) =>
  Array.from({ length: n }, (_, i) => ({
    label: `take ${i + 1}`,
    videoId: i < comId ? `v${i}` : null,
    videoStatus: i < prontos ? 'completed' : null,
  }));

console.log('\nGARANTIA — status ao vivo do disparo no histórico:');

// (A) vocabulário e tom por fase
{
  ok(statusDoDisparo({ phase: 'rendering' })?.rotulo === 'Gerando', 'rendering aparece como "Gerando"');
  ok(statusDoDisparo({ phase: 'queued' })?.rotulo === 'Na fila', 'queued aparece como "Na fila"');
  ok(statusDoDisparo({ phase: 'post' })?.rotulo === 'Montando', 'post aparece como "Montando"');
  ok(statusDoDisparo({ phase: 'done' })?.tom === 'success', 'done é sucesso');
  ok(statusDoDisparo({ phase: 'failed' })?.tom === 'error', 'failed é erro');
  ok(statusDoDisparo(null) === null, 'sem registro, sem status');
  ok(statusDoDisparo({ phase: 'coisa-nova' })?.fase === 'queued', 'fase desconhecida cai em "na fila", não em pronto');
}

// (B) quem está trabalhando
{
  for (const f of ['queued', 'dispatching', 'rendering', 'downloading', 'post']) {
    ok(statusDoDisparo({ phase: f })?.ativo === true, `"${f}" está trabalhando`);
  }
  for (const f of ['done', 'failed', 'draft']) {
    ok(statusDoDisparo({ phase: f })?.ativo === false, `"${f}" não está trabalhando`);
  }
}

// (C) a barra segue a conta do card (30% envio · 60% render · 10% cauda)
{
  const metadeEnviada = statusDoDisparo({ phase: 'dispatching', parts: partes(10, 5, 0) });
  ok(metadeEnviada?.pct === 15, 'metade enviada, nada renderizado = 15%');

  const tudoEnviadoMetadeRenderizada = statusDoDisparo({ phase: 'rendering', parts: partes(10, 10, 5) });
  ok(tudoEnviadoMetadeRenderizada?.pct === 60, 'tudo enviado e metade pronta = 60%');

  const montando = statusDoDisparo({ phase: 'post', parts: partes(10, 10, 10) });
  ok(montando?.pct === 95, 'montando com tudo pronto = 95%');

  const pronto = statusDoDisparo({ phase: 'done', parts: partes(10, 10, 10) });
  ok(pronto?.pct === 100, 'pronto = 100%');

  const comecando = statusDoDisparo({ phase: 'queued', parts: partes(10, 0, 0) });
  ok(comecando?.pct === 3, 'recém-enfileirado mostra um fio de barra, nunca zero');
}

// (D) modo economia: contagem zerada, motor manda
{
  const economia = statusDoDisparo({ phase: 'rendering', parts: partes(8, 0, 0), progressoMotor: 47 });
  ok(economia?.pct === 47, 'sem videoId nenhum, o progresso do motor segura a barra');

  const motorNaFila = statusDoDisparo({ phase: 'queued', parts: partes(8, 0, 0), progressoMotor: 88 });
  ok(motorNaFila?.pct === 3, 'motor de outro disparo não empurra a barra de quem só está na fila');

  const contagemGanha = statusDoDisparo({ phase: 'rendering', parts: partes(10, 10, 10), progressoMotor: 12 });
  ok(contagemGanha?.pct === 90, 'entre contagem e motor, vale o MAIOR');
}

// (E) take pronto sem videoStatus (batch antigo) só conta em fase terminal
{
  const velhoMontando = statusDoDisparo({
    phase: 'post',
    parts: [{ videoId: 'a' }, { videoId: 'b' }],
  });
  ok(velhoMontando?.prontos === 2, 'batch antigo em montagem conta os takes como prontos');

  const velhoRenderizando = statusDoDisparo({
    phase: 'rendering',
    parts: [{ videoId: 'a' }, { videoId: 'b' }],
  });
  ok(velhoRenderizando?.prontos === 0, 'em render, videoId sem status NÃO vira pronto');

  const negado = statusDoDisparo({
    phase: 'post',
    parts: [{ videoId: 'a', videoStatus: 'failed' }, { videoId: 'b', videoStatus: 'completed' }],
  });
  ok(negado?.prontos === 1, 'take negado nunca é contado como pronto');
}

// (F) resumo e relógio
{
  ok(resumoDeTakes(statusDoDisparo({ phase: 'rendering', parts: partes(10, 10, 4) })) === '4/10 takes', 'resumo mostra o andamento');
  ok(resumoDeTakes(statusDoDisparo({ phase: 'done', parts: partes(3, 3, 3) })) === '3 takes', 'pronto mostra só o total');
  ok(resumoDeTakes(statusDoDisparo({ phase: 'done', parts: [] })) === '', 'sem partes, sem resumo');
  ok(tempoCurto(3200) === '3s', 'segundos');
  ok(tempoCurto(137000) === '2m17s', 'minutos e segundos');
  ok(tempoCurto(3_900_000) === '1h05m', 'horas e minutos');
  ok(tempoCurto(-5) === '', 'tempo inválido não vira texto');
}

// (F2) TODA linha tem selo: sem fila, o estado vem do próprio registro
{
  ok(seloDoRegistro('done').rotulo === 'Pronto', 'entrega pronta diz Pronto');
  ok(seloDoRegistro('export').rotulo === 'Exportado', 'export diz Exportado');
  ok(seloDoRegistro('dispatch').rotulo === 'Disparado', 'disparo antigo diz Disparado');
  ok(seloDoRegistro('download').rotulo === 'Baixado', 'download diz Baixado');
  ok(!!seloDoRegistro('coisa-nova').rotulo, 'registro de tipo novo ainda ganha selo (nunca fica sem)');
}

// (G) a lista só fica lendo o estado quando há trabalho em curso
{
  ok(algumAtivo({ a: statusDoDisparo({ phase: 'done' }), b: statusDoDisparo({ phase: 'rendering' }) }), 'um ativo basta');
  ok(!algumAtivo({ a: statusDoDisparo({ phase: 'done' }), b: null }), 'tudo terminado, nada de ficar lendo');
}

console.log(`\n${passed} ok, ${failed} falhas`);
if (failed > 0) process.exit(1);
