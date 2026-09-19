/** Regression coverage for live installation/version state and bounded engine discovery. */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DOWNLOADER_EXTENSION_VERSION,
  INITIAL_DOWNLOADER_CONNECTION,
  connectionFromPong,
  expireDownloaderConnection,
  getDownloaderStatus,
  versionAtLeast,
} from './downloader-connection';

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

const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
ok(manifest.version === DOWNLOADER_EXTENSION_VERSION, 'site e ZIP usam a mesma versão da extensão');
ok(getDownloaderStatus(INITIAL_DOWNLOADER_CONNECTION) === 'checking', 'primeiro render aguarda resposta real, sem cache otimista');
const missing = expireDownloaderConnection(INITIAL_DOWNLOADER_CONNECTION, 20000);
ok(getDownloaderStatus(missing) === 'missing', 'nenhuma resposta apresenta instalação da extensão');
for (const version of [undefined, '?', '1.6.0', '1.7.0', '1.8.0', '1.9.0']) {
  const legacy = connectionFromPong({ version, engine: true }, 10000);
  ok(getDownloaderStatus(legacy) === 'outdated', `extensão ${version || 'sem versão'} recebe atualização mesmo com Motor conectado`);
}
const current = connectionFromPong({ version: DOWNLOADER_EXTENSION_VERSION, engine: true, engineVersion: '1.2.1', engineCompatible: true }, 10000);
ok(getDownloaderStatus(current) === 'ready', 'extensão e Motor atuais apresentam conexão pronta');
ok(getDownloaderStatus(connectionFromPong({ version: DOWNLOADER_EXTENSION_VERSION, checking: true }, 12000, current)) === 'ready', 'anúncio de presença preserva Motor recentemente verificado durante rechecagem');
ok(getDownloaderStatus(connectionFromPong({ version: DOWNLOADER_EXTENSION_VERSION, checking: true }, 26000, current)) === 'engine-checking', 'anúncio sem resultado não mantém Motor online indefinidamente');
ok(getDownloaderStatus({ ...current, engine: false }) === 'engine-offline', 'extensão presente com Motor ausente mostra instalação do Motor');
ok(getDownloaderStatus({ ...current, engine: undefined }) === 'engine-checking', 'resposta inicial não confunde Motor ainda não verificado com offline');
ok(getDownloaderStatus({ ...current, engineVersion: '1.0.0', engineCompatible: false }) === 'engine-outdated', 'Motor instalado antigo mostra atualização');
ok(getDownloaderStatus({ ...current, engineVersion: '1.2.0', engineCompatible: true }) === 'engine-outdated', 'Motor 1.2.0 não finge possuir a correção de imagens do Pinterest');
ok(getDownloaderStatus({ ...current, engineVersion: undefined, engineCompatible: undefined }) === 'engine-outdated', 'Motor sem versão/protocolo não é considerado compatível');
ok(getDownloaderStatus(expireDownloaderConnection(current, 24000)) === 'ready', 'resposta recente resiste a um heartbeat perdido');
ok(getDownloaderStatus(expireDownloaderConnection(current, 25000)) === 'missing', 'extensão removida expira em 15 segundos sem manter online falso');
ok(getDownloaderStatus(connectionFromPong({ version: DOWNLOADER_EXTENSION_VERSION, engine: true, engineVersion: '1.2.1', engineCompatible: true }, 26000)) === 'ready', 'retorno da extensão recupera o estado pronto');
ok(getDownloaderStatus(current, '1.10.0') === 'outdated', 'nova versão publicada atualiza o aviso sem recarregar a página');
ok(versionAtLeast('1.10.0', '1.9.0') && !versionAtLeast('1.9.0', '1.10.0'), 'comparação numérica de versões não usa ordem de texto');
ok(versionAtLeast('1.9.0.1', '1.9.0'), 'versão Chrome com quarto componente é reconhecida');

// Only the durable worker probes the engine; the popup must not duplicate downloads.
ok(/AbortSignal\.timeout/.test(bg), 'worker: localhost fetch has a hard timeout');
ok(/Promise\.allSettled\(ports\.map\(probePort\)\)/.test(bg), 'worker: probes every port in parallel and prefers a compatible Motor');
ok(/tfetch\(`http:\/\/127\.0\.0\.1:\$\{port\}\/health`/.test(bg), 'worker: health is checked through bounded fetch');
ok(/tfetch\(`http:\/\/127\.0\.0\.1:\$\{port\}\/pair`/.test(bg), 'worker: pairing is checked through bounded fetch');
for (const port of [47923, 47929, 47930, 47931]) ok(bg.includes(String(port)), `worker covers port ${port}`);
ok(!popup.includes('chrome.downloads.download('), 'popup delegates transfers to durable worker');
ok(popup.includes('darko-enqueue') && popup.includes('downloadJobsV2'), 'popup starts and restores the durable queue');
ok(popup.includes('setTimeout(() => reject') && popup.includes('finally { refreshing = false;'), 'popup times out unresponsive workers and releases reconnect button');
ok(popup.includes('darko-force-rediscover') && bg.includes('darko-force-rediscover'), 'manual reconnect forces fresh discovery');
ok(content.includes("job.state === 'complete'") && content.includes('darko-enqueue'), 'page button tracks durable jobs and uses completed state');
const archiveRoute = readFileSync(join(__dirname, '..', 'app', 'api', 'downloader-extension', 'download', 'route.ts'), 'utf8');
ok(archiveRoute.includes("'download-utils.js'"), 'extension ZIP contains the worker and popup shared runtime');
ok(archiveRoute.includes("'no-store, max-age=0'"), 'extension ZIP cannot serve a stale browser/CDN cache');

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
