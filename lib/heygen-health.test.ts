/**
 * Trava as invariantes que impedem o disparo de QUEIMAR COTA À TOA.
 * Ver [[heygen-health]] / lib/heygen-health.ts.
 *
 * O bug que isto blinda (AD70GL, 14/08/2026): o HeyGen degradou e passou a levar
 * ~2h por parte. O poll tinha teto FIXO de 15min, cansou de esperar, marcou os
 * takes como 'falha' e a auto-cura re-disparou TODOS — enquanto os renders
 * originais seguiam vivos no servidor. Cada parte lenta comeu dois pedaços da
 * cota diária, a cota morreu e o disparo saiu incompleto.
 *
 * Duas regras seguram isso, e as duas estão aqui:
 *   1. computePatienceBudget — o teto de espera é FUNÇÃO DA EVIDÊNCIA, não uma
 *      constante. Batch inteiro parado = plataforma lenta (espera mais);
 *      retardatário isolado com irmãos prontos = zumbi (desiste rápido).
 *   2. decideRedispatch — só gasta cota com PROVA de que não há render vivo.
 */
import { computePatienceBudget, decideRedispatch } from './heygen-health';

let passed = 0;
let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ok   ${label}`); }
  else { failed++; console.error(`  FAIL ${label}`); }
}

const MIN = 60_000;
const BASE = 15 * MIN;      // teto por vídeo em plataforma saudável
const CAP = 4 * 60 * MIN;   // teto duro (4h)

console.log('\nGARANTIA — HeyGen lento nunca vira falso negativo nem re-disparo à toa:');

/* ── 1. PACIÊNCIA ADAPTATIVA ────────────────────────────────────────────── */

// (1.1) O CASO DO USER: 9 takes disparados, NENHUM completou, todos parados.
//       Isso é a plataforma, não os vídeos — o teto TEM que esticar muito além
//       dos 15min que causaram o re-disparo em massa.
{
  const budget = computePatienceBudget({
    baseBudgetMs: BASE, hardCapMs: CAP,
    total: 9, completedCount: 0, waitingCount: 9, peerMaxMs: 0,
    healthMultiplier: 10, // saúde 'degraded'
  });
  ok(budget >= 150 * MIN, `batch inteiro parado + saúde degradada → espera ${Math.round(budget / MIN)}min (>=150)`);
  ok(budget > BASE, 'teto NUNCA fica no valor de plataforma saudável quando o dia está ruim');
}

// (1.2) Mesmo SEM histórico de saúde (multiplicador 1, primeira vez do dia),
//       2+ vídeos parados já esticam o teto: batch parado é evidência sozinho.
{
  const budget = computePatienceBudget({
    baseBudgetMs: BASE, hardCapMs: CAP,
    total: 9, completedCount: 0, waitingCount: 9, peerMaxMs: 0,
    healthMultiplier: 1,
  });
  ok(budget === 4 * BASE, 'sem histórico, batch parado ainda estica 4x (evidência local basta)');
}

// (1.3) ZUMBI DE VERDADE: 8 de 9 completaram em ~4min e 1 ficou pra trás.
//       Aqui o problema É o vídeo — o teto tem que ficar curto pra destravar a
//       fila, senão 1 render morto prende o batch por horas.
{
  const budget = computePatienceBudget({
    baseBudgetMs: BASE, hardCapMs: CAP,
    total: 9, completedCount: 8, waitingCount: 1, peerMaxMs: 4 * MIN,
    healthMultiplier: 1,
  });
  ok(budget === BASE, 'maioria pronta + retardatário isolado → teto curto (zumbi de verdade)');
}

// (1.4) Maioria pronta MAS demorando muito (irmão mais lento levou 40min): o
//       retardatário ganha teto proporcional, não o fixo de 15min.
{
  const budget = computePatienceBudget({
    baseBudgetMs: BASE, hardCapMs: CAP,
    total: 5, completedCount: 4, waitingCount: 1, peerMaxMs: 40 * MIN,
    healthMultiplier: 1,
  });
  ok(budget === 120 * MIN, 'irmãos lentos (40min) → retardatário ganha 3x isso, não os 15min fixos');
}

// (1.5) O teto duro sempre vence — nada espera pra sempre.
{
  const budget = computePatienceBudget({
    baseBudgetMs: BASE, hardCapMs: CAP,
    total: 9, completedCount: 0, waitingCount: 9, peerMaxMs: 0,
    healthMultiplier: 1000,
  });
  ok(budget === CAP, 'teto duro respeitado mesmo com saúde catastrófica (não espera infinito)');
}

// (1.6) Render solitário (re-gerar 1 parte) em plataforma saudável mantém o
//       comportamento de sempre — nenhuma regressão de tempo de espera.
{
  const budget = computePatienceBudget({
    baseBudgetMs: BASE, hardCapMs: CAP,
    total: 1, completedCount: 0, waitingCount: 1, peerMaxMs: 0,
    healthMultiplier: 1,
  });
  ok(budget === BASE, 'render único em plataforma saudável mantém o teto normal (sem regressão)');
}

/* ── 2. PORTEIRO DO RE-DISPARO ──────────────────────────────────────────── */

// (2.1) A REGRA DE OURO: pendente NUNCA re-dispara. Era exatamente isso que
//       duplicava os vídeos e matava a cota diária.
ok(
  decideRedispatch({ hasVideoId: true, status: 'pending' }) === 'wait',
  'render PENDENTE no HeyGen nunca re-dispara (espera)',
);

// (2.2) 'stalled' é o nosso "cansei de esperar" — vale a MESMA proteção do
//       pendente, porque o render pode estar vivo do lado do servidor.
ok(
  decideRedispatch({ hasVideoId: true, status: 'stalled' }) === 'wait',
  'take marcado stalled (nossa desistência) também não re-dispara',
);

// (2.3) Falha REAL do HeyGen (moderação negou a copy agressiva) — é justamente
//       pra isso que o re-disparo existe.
ok(
  decideRedispatch({ hasVideoId: true, status: 'failed' }) === 'redispatch',
  'falha REAL reportada pelo HeyGen libera o re-disparo (moderação negou)',
);

// (2.4) Nunca disparou (cota estourou antes do submit) → pode disparar.
ok(
  decideRedispatch({ hasVideoId: false }) === 'redispatch',
  'parte que nunca chegou a disparar libera o disparo',
);

// (2.5) Ficou pronto enquanto a gente desistia → resgata, cota zero.
ok(
  decideRedispatch({ hasVideoId: true, status: 'completed', hasVideoUrl: true }) === 'rescue',
  'render que ficou pronto é resgatado, não re-gerado',
);

// (2.6) Sumiu do histórico mas existe cópia pronta com o mesmo título → resgata
//       em vez de gastar. Sem isso, todo 'unknown' viraria cota queimada.
ok(
  decideRedispatch({ hasVideoId: true, status: 'unknown', foundByTitle: true }) === 'rescue',
  'sumiu da listagem mas achou pronto por título → resgata',
);

// (2.7) Sumiu de vez, sem cópia pronta: aí sim é render perdido.
ok(
  decideRedispatch({ hasVideoId: true, status: 'unknown', foundByTitle: false }) === 'redispatch',
  'sumiu do histórico e não apareceu pronto → render perdido, re-dispara',
);

// (2.8) 'completed' SEM url é estado inconsistente do HeyGen: não é resgatável,
//       mas também não pode travar a entrega pra sempre.
ok(
  decideRedispatch({ hasVideoId: true, status: 'completed', hasVideoUrl: false }) === 'redispatch',
  'completed sem video_url (estado inconsistente) segue re-disparável',
);

// (2.9) INVARIANTE GERAL: nenhum estado que admita render vivo pode produzir
//       'redispatch'. É a trava que impede a regressão do bug inteiro.
{
  const vivos: Array<'pending' | 'stalled'> = ['pending', 'stalled'];
  ok(
    vivos.every((s) => decideRedispatch({ hasVideoId: true, status: s }) !== 'redispatch'),
    'INVARIANTE: nenhum estado com render possivelmente vivo gasta cota',
  );
}

console.log(`\n${passed} passaram, ${failed} falharam.`);
if (failed > 0) process.exit(1);
