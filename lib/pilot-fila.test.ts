/**
 * "NA FILA" com os takes rendendo — o card mentia e travava o Retomar.
 *
 * Caso real (20.09.2026, AD01 - CREATOR): disparo em pé, clique sem querer no
 * ▶ Play, card volta pra "NA FILA" com 1m48s... 2m35s no relógio, Retomar
 * desabilitado, NENHUMA outra task na frente. Quando o run chegou no download,
 * o card se corrigiu sozinho ("BAIXANDO") e seguiu pra montagem.
 */
import {
  disparoJaEmAndamento,
  cardMenteNaFila,
  ocupaVaga,
  faseEstaAtiva,
} from './pilot-fila';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; console.error(`  FAIL ${msg}`); }
}

console.log('FILA DO PILOT — quem já está de pé não volta pra fila:');

// ── O BUG, em uma linha ────────────────────────────────────────────────────
ok(
  disparoJaEmAndamento({ fase: 'rendering', wrapperVivo: true }) === true,
  'clique no Play com o disparo RENDERIZANDO: no-op (era aqui que virava "na fila")',
);
ok(
  disparoJaEmAndamento({ fase: 'dispatching' }) === true,
  'enviando também é disparo de pé — mesmo sem o wrapper conhecido',
);
ok(
  disparoJaEmAndamento({ fase: 'queued' }) === true,
  'quem já espera vaga não é re-enfileirado (não zera takes nem relógio)',
);
ok(
  disparoJaEmAndamento({ fase: 'queued', wrapperVivo: false }) === true,
  'e isso vale mesmo quando o porteiro ainda não apareceu no ref',
);

// ── O que CONTINUA podendo disparar ────────────────────────────────────────
ok(
  disparoJaEmAndamento({ fase: 'failed' }) === false,
  'task que falhou dispara de novo — o Play segue vivo',
);
ok(
  disparoJaEmAndamento({ fase: 'done' }) === false,
  'task pronta pode ser disparada de novo (re-disparo é escolha do user)',
);
ok(
  disparoJaEmAndamento({ fase: undefined }) === false,
  'task que nunca rodou dispara normal',
);
ok(
  disparoJaEmAndamento({ fase: 'waiting-heygen' }) === false,
  'esperando o HeyGen NÃO é wrapper de pé — o watcher dela resolve sozinho',
);
ok(
  disparoJaEmAndamento({ fase: 'recoverable' }) === false,
  'card recuperável segue disparável',
);

// ── A mentira, e só ela ────────────────────────────────────────────────────
ok(
  cardMenteNaFila({ fase: 'queued', comVagaNaMao: true }) === true,
  '"na fila" com a vaga NA MÃO é mentira — o watchdog conserta',
);
ok(
  cardMenteNaFila({ fase: 'queued', comVagaNaMao: false }) === false,
  'esperar vaga de verdade NÃO é mentira (é o único "na fila" honesto)',
);
ok(
  cardMenteNaFila({ fase: 'rendering', comVagaNaMao: true }) === false,
  'rodando com vaga na mão é o estado normal — watchdog não encosta',
);
ok(
  cardMenteNaFila({ fase: 'done', comVagaNaMao: false }) === false,
  'card pronto nunca entra na cura',
);

// ── Contagem de vagas: a mentira não pode liberar um 3º disparo ────────────
ok(
  ocupaVaga({ fase: 'queued', comVagaNaMao: true }) === true,
  'task que mentia "na fila" CONTINUA ocupando a vaga que tem na mão',
);
ok(
  ocupaVaga({ fase: 'queued', comVagaNaMao: false }) === false,
  'quem só espera vaga não ocupa nenhuma',
);
ok(
  ocupaVaga({ fase: 'post', comVagaNaMao: false }) === true,
  'montando ocupa vaga mesmo sem o ref (sobrevive a reload/remount)',
);
ok(
  ocupaVaga({ fase: 'post', comVagaNaMao: true, kind: 'troca' }) === false,
  'TROCA DE ÁUDIO roda fora do HeyGen — nunca ocupa vaga',
);
ok(
  ocupaVaga({ fase: 'done', comVagaNaMao: false }) === false,
  'task pronta libera a vaga',
);

// ── Base ───────────────────────────────────────────────────────────────────
ok(faseEstaAtiva('downloading') === true, 'baixando é fase ativa');
ok(faseEstaAtiva('queued') === false, '"na fila" não é fase ativa');
ok(faseEstaAtiva(null) === false, 'sem fase = não ativa');

console.log(`\n${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
