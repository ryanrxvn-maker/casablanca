// Prova a migration 037 (histórico de acesso + acesso simultâneo) num
// Postgres de verdade (PGlite), cenário por cenário — inclusive os que NÃO
// podem disparar aviso (abas, troca de rede, troca de aparelho, aba esquecida).
//
// O PGlite não é dependência do projeto. Rodar com:
//   PGLITE_MODULE=<caminho>/node_modules/@electric-sql/pglite node scripts/test-access-log-sql.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'supabase/migrations/037_access_log.sql'), 'utf8');

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const T0 = Date.parse('2026-10-07T13:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();

const PC = { device: 'dev-pc-aaaaaaaa', fp: 'fp-pc', ua: 'UA pc', browser: 'Chrome', os: 'Windows', kind: 'desktop' };
const PC_INCOG = { ...PC, device: 'dev-pc-incognito' };
const PC_EDGE = { ...PC, device: 'dev-pc-edge-zzzz', browser: 'Edge' };
const OTHER_PC = { device: 'dev-other-pc-bbbb', fp: 'fp-other', ua: 'UA other', browser: 'Chrome', os: 'Windows', kind: 'desktop' };
const PHONE = { device: 'dev-phone-cccccc', fp: 'fp-phone', ua: 'UA phone', browser: 'Safari', os: 'iOS', kind: 'mobile' };

let db;

async function fresh() {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles (id uuid primary key);
  `);
  await db.query('insert into public.profiles values ($1), ($2)', [U1, U2]);
  await db.exec(SQL);
  await db.exec(SQL); // a migration é repetível
}

async function ping(user, dev, ip, sec, engaged, place = {}) {
  const r = await db.query(
    'select public.touch_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as r',
    [user, dev.device, dev.fp, ip, dev.ua, dev.browser, dev.os, dev.kind,
      place.city ?? null, place.region ?? null, place.country ?? null, engaged, at(sec)],
  );
  return r.rows[0].r;
}

/** Uma fonte de pings a cada `step` s entre [from, to], engajados enquanto
 *  `engaged(t)`. As fontes de um cenário rodam INTERCALADAS pelo relógio
 *  (como no mundo real), nunca uma inteira depois da outra. */
function stream(user, dev, ip, from, to, engaged = () => true, step = 25, place) {
  const out = [];
  for (let t = from; t <= to; t += step) out.push({ user, dev, ip, t, engaged: engaged(t), place });
  return out;
}
async function run(...streams) {
  const all = streams.flat().sort((a, b) => a.t - b.t);
  for (const p of all) await ping(p.user, p.dev, p.ip, p.t, p.engaged, p.place);
}

async function events(user = U1) {
  return (await db.query('select * from public.access_concurrency where user_id = $1 order by started_at', [user])).rows;
}
async function sessions(user = U1) {
  return (await db.query('select * from public.access_sessions where user_id = $1 order by started_at, id', [user])).rows;
}

const casos = [];
const caso = (nome, fn) => casos.push([nome, fn]);

caso('duas abas do MESMO navegador mexendo juntas = um aparelho, nenhum aviso', async () => {
  await run(
    stream(U1, PC, '200.1.1.1', 0, 900),
    stream(U1, PC, '200.1.1.1', 7, 907), // segunda aba, mesmos ids
  );
  assert.equal((await events()).length, 0);
  assert.equal((await sessions()).length, 1);
});

caso('troca de rede no mesmo aparelho (wi-fi → 4G, IPv4 ↔ IPv6) = só sessões novas, nenhum aviso', async () => {
  await run(
    stream(U1, PHONE, '189.10.0.1', 0, 300),
    stream(U1, PHONE, '177.20.0.9', 325, 600),
    stream(U1, PHONE, '2804:14c:1::abcd', 625, 900),
    stream(U1, PHONE, '189.10.0.1', 925, 1200),
  );
  assert.equal((await events()).length, 0);
  const s = await sessions();
  assert.equal(s.length, 4, 'cada IP vira uma linha no histórico');
  assert.deepEqual(s.map((x) => x.ip), ['189.10.0.1', '177.20.0.9', '2804:14c:1::abcd', '189.10.0.1']);
});

caso('troca de aparelho (larga o PC e pega o celular na hora) NÃO é simultâneo', async () => {
  // Último toque no PC em t=600: os pings do PC seguem "ativos" até t=645
  // (a aba continua aberta e visível até t=900). O celular começa a ser usado
  // 5 s depois do último toque no PC.
  await run(
    stream(U1, PC, '200.1.1.1', 0, 900, (t) => t <= 600 + 45),
    stream(U1, PHONE, '177.1.1.1', 605, 1500),
  );
  assert.equal((await events()).length, 0);
  // Pior caso: o último ping "ativo" do PC chega exatamente aos 45 s.
  await fresh();
  await run(
    stream(U1, PC, '200.1.1.1', 0, 645, () => true, 5),
    stream(U1, PC, '200.1.1.1', 650, 900, () => false, 25),
    stream(U1, PHONE, '177.1.1.1', 601, 1500, () => true, 5),
  );
  assert.equal((await events()).length, 0, '44 s de sobreposição no pior caso');
});

caso('aba esquecida aberta no PC enquanto usa o celular NÃO é simultâneo', async () => {
  await run(
    stream(U1, PC, '200.1.1.1', 0, 3600, () => false), // visível, sem ninguém mexendo
    stream(U1, PHONE, '177.1.1.1', 10, 3600),
  );
  assert.equal((await events()).length, 0);
});

caso('duas pessoas usando ao mesmo tempo em redes diferentes = 1 aviso com início e fim certos', async () => {
  const sp = { city: 'São Paulo', region: 'SP', country: 'BR' };
  const rj = { city: 'Rio de Janeiro', region: 'RJ', country: 'BR' };
  for (let t = 0; t <= 1200; t += 25) {
    await ping(U1, PC, '200.1.1.1', t, true, sp);
    await ping(U1, OTHER_PC, '177.9.9.9', t + 10, true, rj);
  }
  const ev = await events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].same_network, false);
  assert.equal(ev[0].same_machine, false);
  assert.equal(new Date(ev[0].started_at).toISOString(), at(10));
  assert.ok(new Date(ev[0].ended_at).getTime() >= T0 + 1200 * 1000, 'o fim acompanha o último uso');
  const places = [ev[0].place_a, ev[0].place_b].sort();
  assert.deepEqual(places, ['Rio de Janeiro, RJ, BR', 'São Paulo, SP, BR']);
  const ips = [ev[0].ip_a, ev[0].ip_b].sort();
  assert.deepEqual(ips, ['177.9.9.9', '200.1.1.1']);
});

caso('sobreposição curta (60 s) não vira aviso; 90 s vira', async () => {
  await run(
    stream(U1, PC, '200.1.1.1', 0, 600),
    stream(U1, PHONE, '177.1.1.1', 600 - 60, 600 - 60 + 50, () => true, 25), // acaba antes de completar 90 s juntos
  );
  assert.equal((await events()).length, 0, '60 s juntos não bastam');
  await fresh();
  await run(
    stream(U1, PC, '200.1.1.1', 0, 600),
    stream(U1, PHONE, '177.1.1.1', 500, 600),
  );
  assert.equal((await events()).length, 1, '100 s juntos bastam');
});

caso('mesmo computador (janela anônima / outro navegador) fica marcado same_machine', async () => {
  for (let t = 0; t <= 600; t += 25) {
    await ping(U1, PC, '200.1.1.1', t, true);
    await ping(U1, PC_INCOG, '200.1.1.1', t + 5, true);
  }
  const ev = await events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].same_machine, true);
  assert.equal(ev[0].same_network, true);
  await fresh();
  for (let t = 0; t <= 600; t += 25) {
    await ping(U1, PC, '200.1.1.1', t, true);
    await ping(U1, PC_EDGE, '200.1.1.1', t + 5, true);
  }
  assert.equal((await events())[0].same_machine, true, 'Chrome + Edge no mesmo PC');
});

caso('dois computadores diferentes na MESMA rede = simultâneo real (mesma rede, máquinas diferentes)', async () => {
  for (let t = 0; t <= 600; t += 25) {
    await ping(U1, PC, '200.1.1.1', t, true);
    await ping(U1, OTHER_PC, '200.1.1.1', t + 5, true);
  }
  const ev = await events();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].same_network, true);
  assert.equal(ev[0].same_machine, false);
});

caso('IPv6 no mesmo /64 conta como mesma rede', async () => {
  const r = await db.query(`select
    public.access_same_network('2804:14c:65:1::a', '2804:14c:65:1:ffff::9') as same64,
    public.access_same_network('2804:14c:65:1::a', '2804:14c:65:2::a') as other64,
    public.access_same_network('200.1.1.1', '200.1.1.2') as v4diff,
    public.access_same_network('200.1.1.1', null) as nulo,
    public.access_same_network('lixo', 'lixo2') as lixo`);
  assert.deepEqual(r.rows[0], { same64: true, other64: false, v4diff: false, nulo: false, lixo: false });
});

caso('pausa curta junta no mesmo episódio; pausa longa abre outro', async () => {
  // Episódio 1: 0..600 juntos. Pausa de 2 min no celular. Volta 720..1200.
  await run(
    stream(U1, PC, '200.1.1.1', 0, 2000),
    stream(U1, PHONE, '177.1.1.1', 0, 600),
    stream(U1, PHONE, '177.1.1.1', 720, 1200),
  );
  assert.equal((await events()).length, 1, 'pausa de 2 min = mesmo episódio');
  // Pausa de 15 min e volta 2100..2600 = outro episódio.
  await run(
    stream(U1, PC, '200.1.1.1', 2025, 3000),
    stream(U1, PHONE, '177.1.1.1', 2100, 2600),
  );
  const ev = await events();
  assert.equal(ev.length, 2);
  assert.equal(new Date(ev[0].ended_at).toISOString(), at(1195), "o fim é o último uso do celular (1195 s)");
});

caso('três aparelhos ao mesmo tempo = um aviso por par', async () => {
  for (let t = 0; t <= 600; t += 25) {
    await ping(U1, PC, '200.1.1.1', t, true);
    await ping(U1, OTHER_PC, '177.9.9.9', t + 5, true);
    await ping(U1, PHONE, '189.3.3.3', t + 9, true);
  }
  assert.equal((await events()).length, 3);
});

caso('contas diferentes nunca se misturam', async () => {
  for (let t = 0; t <= 600; t += 25) {
    await ping(U1, PC, '200.1.1.1', t, true);
    await ping(U2, OTHER_PC, '177.9.9.9', t + 5, true);
  }
  assert.equal((await events(U1)).length, 0);
  assert.equal((await events(U2)).length, 0);
});

caso('tempo de uso ativo soma só o intervalo real (duas abas não contam em dobro)', async () => {
  await run(
    stream(U1, PC, '200.1.1.1', 0, 600), // 600 s de uso
    stream(U1, PC, '200.1.1.1', 3, 603), // segunda aba ativa junto
  );
  const s = await sessions();
  assert.equal(s.length, 1);
  assert.ok(s[0].active_seconds >= 590 && s[0].active_seconds <= 610, `active_seconds=${s[0].active_seconds}`);
  assert.equal(s[0].pings, 50);
});

caso('sumiço maior que 10 min no mesmo IP abre sessão nova', async () => {
  await run(
    stream(U1, PC, '200.1.1.1', 0, 300),
    stream(U1, PC, '200.1.1.1', 300 + 11 * 60, 300 + 11 * 60 + 100),
  );
  assert.equal((await sessions()).length, 2);
});

caso('id de aparelho inválido é recusado sem gravar', async () => {
  const r = await ping(U1, { ...PC, device: 'curto' }, '200.1.1.1', 0, true);
  assert.equal(r.ok, false);
  assert.equal((await sessions()).length, 0);
});

caso('cliente logado (authenticated/anon) não executa a função nem lê as tabelas', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query(`select public.touch_access('${U1}','dev-pc-aaaaaaaa',null,'1.1.1.1',null,null,null,null,null,null,null,true)`));
    await assert.rejects(db.query('select * from public.access_sessions'));
    await assert.rejects(db.query('select * from public.access_concurrency'));
    await assert.rejects(db.query('select * from public.access_devices'));
    await db.exec('reset role');
  }
});

(async () => {
  let ok = 0;
  for (const [nome, fn] of casos) {
    await fresh();
    try {
      await fn();
      ok++;
      console.log('  ok  ' + nome);
    } catch (e) {
      console.error('FALHOU  ' + nome);
      console.error(e);
      process.exitCode = 1;
    }
  }
  console.log(`\n${ok}/${casos.length} cenários passaram`);
})();
