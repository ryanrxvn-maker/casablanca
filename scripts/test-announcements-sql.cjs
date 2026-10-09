// Prova a migration 038 (avisos e propagandas) num Postgres de verdade
// (PGlite): roda duas vezes sem quebrar, fecha tudo pros papéis do navegador,
// aceita/recusa o que deve, apaga em cascata e conta os números do painel.
//
// O PGlite não é dependência do projeto. Rodar com:
//   PGLITE_MODULE=<caminho>/node_modules/@electric-sql/pglite node scripts/test-announcements-sql.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(root, 'supabase/migrations/038_announcements.sql'), 'utf8');

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';

let falhas = 0;
async function caso(nome, fn) {
  try {
    await fn();
    console.log(`  ok   ${nome}`);
  } catch (e) {
    falhas++;
    console.log(`  FAIL ${nome}\n       ${String(e.message || e).split('\n')[0]}`);
  }
}
async function falha(db, sql, params = []) {
  let erro = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, 'deveria ter sido recusado: ' + sql.slice(0, 80));
}

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
  `);
  await db.query('insert into auth.users values ($1), ($2)', [U1, U2]);

  await caso('migration roda e roda de novo (idempotente)', async () => {
    await db.exec(SQL);
    await db.exec(SQL);
  });

  let A1;
  await caso('cria aviso com o padrão certo (pausado, janela ligada, audiência "todos")', async () => {
    const r = await db.query(`insert into public.announcements (kind, content, created_by) values ('aviso', '{"title":"Oi"}', $1) returning *`, [U1]);
    A1 = r.rows[0];
    assert.equal(A1.active, false);
    assert.equal(A1.popup, true);
    assert.deepEqual(A1.audience.segments, ['all']);
    assert.equal(A1.audience.includeAdmins, false);
  });

  await caso('recusa tipo desconhecido, conteúdo que não é objeto e conteúdo gigante', async () => {
    await falha(db, `insert into public.announcements (kind) values ('banner')`);
    await falha(db, `insert into public.announcements (kind, content) values ('aviso', '[]')`);
    await falha(db, `insert into public.announcements (kind, content) values ('aviso', $1)`, [JSON.stringify({ t: 'x'.repeat(17000) })]);
  });

  await caso('caixa: uma linha por conta+aviso, chaves de janela com teto de 24', async () => {
    await db.query(`insert into public.announcement_inbox (user_id, announcement_id) values ($1, $2)`, [U1, A1.id]);
    await db.query(`insert into public.announcement_inbox (user_id, announcement_id) values ($1, $2) on conflict (user_id, announcement_id) do nothing`, [U1, A1.id]);
    const n = await db.query(`select count(*)::int as n from public.announcement_inbox`);
    assert.equal(n.rows[0].n, 1);
    const r = await db.query(`select dismissed_keys from public.announcement_inbox where user_id = $1`, [U1]);
    assert.deepEqual(r.rows[0].dismissed_keys, []);
    await db.query(`update public.announcement_inbox set dismissed_keys = $1 where user_id = $2`, [Array.from({ length: 16 }, (_, i) => `s${i}:1`), U1]);
    await falha(db, `update public.announcement_inbox set dismissed_keys = $1 where user_id = $2`, [Array.from({ length: 25 }, (_, i) => `s${i}:1`), U1]);
  });

  await caso('números do painel (announcement_stats) contam entregues, lidas, cliques, fechadas e apagadas', async () => {
    await db.query(`insert into public.announcement_inbox (user_id, announcement_id, read_at, clicked_at, dismissed_at) values ($1, $2, now(), now(), now())`, [U2, A1.id]);
    await db.query(`update public.announcement_inbox set deleted_at = now() where user_id = $1`, [U1]);
    const r = await db.query(`select * from public.announcement_stats()`);
    assert.equal(r.rows.length, 1);
    const s = r.rows[0];
    assert.equal(Number(s.delivered), 2);
    assert.equal(Number(s.read), 1);
    assert.equal(Number(s.clicked), 1);
    assert.equal(Number(s.dismissed), 1);
    assert.equal(Number(s.deleted), 1);
  });

  await caso('navegador (anon/authenticated) não lê nem escreve nada; service_role sim', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await falha(db, `select * from public.announcements`);
      await falha(db, `select * from public.announcement_inbox`);
      await falha(db, `insert into public.announcements (kind) values ('aviso')`);
      await falha(db, `select * from public.announcement_stats()`);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await db.query(`select * from public.announcements`);
    await db.query(`select * from public.announcement_stats()`);
    await db.exec('reset role');
  });

  await caso('RLS ligada nas duas tabelas (sem política = fechado por padrão)', async () => {
    const r = await db.query(`select relname, relrowsecurity from pg_class where relname in ('announcements', 'announcement_inbox') order by relname`);
    assert.deepEqual(r.rows.map((x) => x.relrowsecurity), [true, true]);
  });

  await caso('excluir o aviso apaga da caixa de todo mundo (cascata)', async () => {
    await db.query(`delete from public.announcements where id = $1`, [A1.id]);
    const n = await db.query(`select count(*)::int as n from public.announcement_inbox`);
    assert.equal(n.rows[0].n, 0);
  });

  await caso('conta apagada leva a caixa junto; autor apagado deixa o aviso (sem autor)', async () => {
    const a = (await db.query(`insert into public.announcements (kind, created_by) values ('propaganda', $1) returning id`, [U2])).rows[0];
    await db.query(`insert into public.announcement_inbox (user_id, announcement_id) values ($1, $2)`, [U2, a.id]);
    await db.query(`delete from auth.users where id = $1`, [U2]);
    const n = await db.query(`select count(*)::int as n from public.announcement_inbox where user_id = $1`, [U2]);
    assert.equal(n.rows[0].n, 0);
    const r = await db.query(`select created_by from public.announcements where id = $1`, [a.id]);
    assert.equal(r.rows[0].created_by, null);
  });

  if (falhas) {
    console.error(`\n${falhas} falha(s) na migration 038`);
    process.exit(1);
  }
  console.log('\nmigration 038: tudo ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
