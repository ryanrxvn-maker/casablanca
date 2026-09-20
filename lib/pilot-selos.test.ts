/**
 * O card tem que dizer DE ONDE veio o b-roll.
 *
 * Pedido do Silas (20.09): "se eu disparar uma task com stockframe ligado ou
 * flow, não deve aparecer o ícone de insert azul e sim o de stockframe ou flow,
 * o que tiver sendo usado. Se usar os 2 é os 2."
 */
import { selosDeInserts, tituloDoSeloDeInsert } from './pilot-selos';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ok   ${msg}`); }
  else { failed++; console.error(`  FAIL ${msg}`); }
}

const mao = { ancora: 'HOOK 1' };
const stock = { ancora: 'BODY 2', source: 'stockframe' };
const stock2 = { ancora: 'BODY 3', source: 'stockframe' };
const flow = { ancora: 'BODY 1', source: 'flow' };

console.log('SELOS DE INSERT — cada origem com a marca dela:');

// ── O pedido, em uma linha ─────────────────────────────────────────────────
ok(
  selosDeInserts([stock]).map((s) => s.tipo).join() === 'stockframe',
  'só StockFrame: sai o selo do StockFrame, e NÃO o insert azul',
);
ok(
  selosDeInserts([flow]).map((s) => s.tipo).join() === 'flow',
  'só Flow: sai o selo do Flow',
);
ok(
  selosDeInserts([stock, flow]).map((s) => s.tipo).join() === 'stockframe,flow',
  'usou os 2: aparecem os 2, sempre na mesma ordem',
);
ok(
  selosDeInserts([flow, stock]).map((s) => s.tipo).join() === 'stockframe,flow',
  'a ordem do selo não depende da ordem em que os inserts foram criados',
);

// ── O azul continua existindo pro que foi importado na mão ─────────────────
ok(
  selosDeInserts([mao]).map((s) => s.tipo).join() === 'insert',
  'insert subido na mão continua com o selo azul de sempre',
);
ok(
  selosDeInserts([mao, stock, flow]).map((s) => s.tipo).join() === 'insert,stockframe,flow',
  'os três juntos: mão, StockFrame e Flow, cada um com o seu',
);
ok(
  selosDeInserts([]).length === 0,
  'montagem sem insert nenhum não ganha selo de insert',
);

// ── Contagem e âncoras (é o que o hover conta) ─────────────────────────────
const soStock = selosDeInserts([stock, stock2]);
ok(soStock.length === 1 && soStock[0].quantidade === 2, 'dois takes do StockFrame viram UM selo contando 2');
ok(soStock[0].ancoras.join() === 'BODY 2,BODY 3', 'o selo sabe em que trechos o b-roll entra');
ok(
  selosDeInserts([stock, { ancora: 'BODY 2', source: 'stockframe' }])[0].ancoras.join() === 'BODY 2',
  'dois inserts no MESMO trecho não repetem a âncora',
);
ok(
  tituloDoSeloDeInsert(soStock[0]) === '2 takes do StockFrame na montagem — BODY 2, BODY 3',
  'o hover conta quantos e onde, no plural certo',
);
ok(
  tituloDoSeloDeInsert(selosDeInserts([flow])[0]) === '1 insert do Flow na montagem — BODY 1',
  'no singular não sobra "s"',
);
ok(
  tituloDoSeloDeInsert(selosDeInserts([{ source: 'flow' }])[0]) === '1 insert do Flow na montagem',
  'insert sem âncora não deixa um travessão solto no hover',
);

// ── Origem desconhecida não some do card ───────────────────────────────────
ok(
  selosDeInserts([{ ancora: 'HOOK 1', source: 'motor-novo' }]).map((s) => s.tipo).join() === 'insert',
  'origem nova que ninguém conhece ainda cai no selo genérico (some do card seria pior)',
);

console.log(`\n${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
