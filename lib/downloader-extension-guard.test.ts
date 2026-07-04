/**
 * GARANTIA — o Downloader NUNCA mais trava em "CONECTANDO".
 *
 * O bug: popup.js/bg.js varriam as portas do motor (47923..) com fetch SEM
 * timeout, em SÉRIE. Uma porta que aceita SYN mas não responde (antivírus
 * segurando o loopback, motor zumbi) pendurava o await pra sempre → a UI
 * ficava eterna em "Conectando", sem app nem erro.
 *
 * Este teste TRAVA a blindagem contra regressão em duas frentes:
 *  (A) invariantes ESTÁTICAS no source — timeout em todo fetch, varredura
 *      paralela (Promise.any), range de portas completo, watchdog, botão de
 *      reconectar; e a assinatura do bug antigo NÃO pode reaparecer.
 *  (B) prova de COMPORTAMENTO do algoritmo — porta zumbi não atrasa nem
 *      trava, a 1ª porta viva ganha, e "todas mortas" resolve por timeout
 *      (Offline), nunca infinito.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg);
  } else {
    fail++;
    console.error('  FAIL', msg);
  }
}

const extDir = join(__dirname, '..', 'extension-downloader');
const popup = readFileSync(join(extDir, 'popup.js'), 'utf8');
const bg = readFileSync(join(extDir, 'bg.js'), 'utf8');
const content = readFileSync(join(extDir, 'content.js'), 'utf8');

console.log('\nGARANTIA — blindagem do Downloader (não regredir):');

// ── A. Invariantes estáticas nos dois lados (popup + service worker) ──
const sides: [string, string][] = [
  ['popup.js', popup],
  ['bg.js', bg],
];
for (const [name, src] of sides) {
  ok(/AbortSignal\.timeout/.test(src), `${name}: fetch de localhost com timeout (AbortSignal.timeout)`);
  ok(/new AbortController\(\)/.test(src), `${name}: fallback de timeout p/ engine sem AbortSignal.timeout`);
  ok(/Promise\.any/.test(src), `${name}: descoberta de porta é PARALELA (Promise.any)`);
  ok(src.includes('tfetch(`http://127.0.0.1:${p}/health`'), `${name}: /health via tfetch (com timeout)`);
  ok(src.includes('tfetch(`http://127.0.0.1:${p}/pair`'), `${name}: /pair via tfetch (com timeout)`);
  // A assinatura do BUG ANTIGO (loop serial, fetch cru sem timeout) não volta:
  ok(!src.includes('await fetch(`http://127.0.0.1:${p}/health`'), `${name}: sem fetch serial-sem-timeout (bug antigo)`);
  // Range de portas cobre até onde o motor pode subir (server.cjs: 47923..47930):
  for (const p of [47923, 47929, 47930, 47931]) {
    ok(src.includes(String(p)), `${name}: cobre a porta ${p}`);
  }
}

// popup: refresh blindado + reconectar + watchdog anti-limbo
ok(/hardRefresh/.test(popup), 'popup.js: botão ↻ de hard-refresh (reconectar)');
ok(/watchdog/.test(popup), 'popup.js: watchdog anti-limbo no refresh');
ok(/chrome\.runtime\.reload/.test(popup), 'popup.js: opção de recarregar a extensão (SW zumbi)');
ok(
  /darko-force-rediscover/.test(popup) && /darko-force-rediscover/.test(bg),
  'force-rediscover existe nos dois lados (hard-refresh limpa o cache do SW)',
);
// content: não afirma "iniciou" sem progresso REAL do background
ok(/gotProgress/.test(content), 'content.js: só afirma download após progresso REAL (fim do toast mentiroso)');

// ── B. Prova de comportamento do algoritmo (Promise.any + timeout) ──
// tfetch simulado: respeita o timeout `ms`; porta "morta" pendura até o
// abort (nunca resolve) — exatamente o loopback engolindo a conexão.
function mkFetch(alive: Record<number, number>) {
  return (url: string, ms: number) =>
    new Promise<{ ok: boolean; json: () => Promise<{ app: string; token: string }> }>((resolve, reject) => {
      const port = Number((url.match(/:(\d+)\//) || [])[1]);
      const to = setTimeout(() => reject(new Error('timeout')), ms);
      const delay = alive[port];
      if (delay != null) {
        setTimeout(() => {
          clearTimeout(to);
          resolve({ ok: true, json: async () => ({ app: 'darkolab-downloader-engine', token: 't' }) });
        }, delay);
      }
      // porta não-viva: nunca resolve — só o timeout a rejeita
    });
}
async function probe(p: number, f: ReturnType<typeof mkFetch>, ms: number) {
  const h = await f(`http://127.0.0.1:${p}/health`, ms);
  if (!h.ok) throw 0;
  const j = await h.json();
  if (!j || j.app !== 'darkolab-downloader-engine') throw 0;
  return { port: p };
}
async function discover(ports: number[], f: ReturnType<typeof mkFetch>, ms: number) {
  try {
    return await Promise.any(ports.map((p) => probe(p, f, ms)));
  } catch {
    return null;
  }
}
const PORTS = [47923, 47924, 47925, 47926, 47927, 47928, 47929, 47930, 47931];

async function proof() {
  console.log('\n  — prova de comportamento (porta zumbi não trava) —');
  // 1. Motor numa porta ALTA, todas as anteriores penduram → acha e não trava.
  {
    const t0 = Date.now();
    const r = await discover(PORTS, mkFetch({ 47930: 5 }), 100);
    const dt = Date.now() - t0;
    ok(!!r && r.port === 47930, 'acha o motor na 47930 mesmo com as outras penduradas');
    ok(dt < 90, `porta zumbi não atrasa: achou em ${dt}ms (< timeout 100ms)`);
  }
  // 2. TODAS as portas mortas → null por timeout, NUNCA infinito.
  {
    const t0 = Date.now();
    const r = await discover(PORTS, mkFetch({}), 100);
    const dt = Date.now() - t0;
    ok(r === null, 'todas mortas → Offline (null), sem travar');
    ok(dt >= 90 && dt < 500, `resolve por timeout em ${dt}ms (não pendura eterno)`);
  }
  // 3. Paralelo de verdade: a que responde primeiro ganha (não a 1ª da lista).
  {
    const r = await discover(PORTS, mkFetch({ 47923: 40, 47924: 5 }), 100);
    ok(!!r && r.port === 47924, 'a porta que responde primeiro ganha (paralelo, não serial)');
  }
}

proof()
  .then(() => {
    console.log(`\n${fail === 0 ? '✓' : '✗'} downloader-guard: ${pass} ok, ${fail} fail`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error('  FAIL a prova lançou:', e);
    process.exit(1);
  });
