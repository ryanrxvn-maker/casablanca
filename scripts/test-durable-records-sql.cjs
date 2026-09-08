const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { randomUUID } = require('node:crypto');
const db = new PGlite();
const root = require('node:path').resolve(__dirname, '..');
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
async function asUser(uid) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('set role authenticated');
}
async function save(kind, id, payload, revision, op = randomUUID()) {
  return (await db.query('select public.save_durable_record($1,$2,$3::jsonb,$4,$5::uuid) as result', [kind, id, payload === null ? null : JSON.stringify(payload), revision, op])).rows[0].result;
}
async function run() {
  await db.exec(`create schema auth;
    create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  await db.query('insert into auth.users values ($1),($2)', [a,b]);
  const sql = fs.readFileSync(root + '/supabase/migrations/035_durable_records.sql', 'utf8');
  await db.exec(sql);
  await db.exec(sql); // migration is repeatable
  await asUser(a);
  const job = { taskId: 'A', taskName: 'A', parts: [], startedAt: 1, phase: 'done' };
  const op = randomUUID();
  assert.equal((await save('background','A',job,0,op)).record.revision, 1);
  assert.equal((await save('background','A',job,0,op)).record.revision, 1);
  assert.equal((await save('background','A',{...job, message:'stale'},0)).conflict, true);
  assert.equal((await save('background','A',{...job, startedAt:2},1)).record.revision, 2);
  const replay = await save('background','A',job,0,op);
  assert.equal(replay.conflict, true, 'late replay returns newer checkpoint for merge');
  assert.equal(replay.record.revision, 2);
  let rows = (await db.query('select * from public.durable_records')).rows;
  assert(rows.some(r => r.record_id.startsWith('archive:') && r.payload.startedAt === 1), 'restart preserves prior execution');
  assert.equal((await save('background','A',null,2)).record.deleted, true);
  assert.equal((await save('background','A',job,3)).conflict, true, 'deleted row cannot resurrect');
  await assert.rejects(db.query("update public.durable_records set deleted=false"));
  await assert.rejects(db.query("delete from public.durable_records"));
  const ev = { id:'H', t:Date.now(), title:'test', tool:'test' };
  await save('history','H',ev,0);
  await assert.rejects(save('history','old',{...ev,id:'old',t:0},0));
  await asUser(b);
  assert.equal((await db.query('select * from public.durable_records')).rows.length, 0, 'RLS isolates accounts');
  await save('background','A',job,0);
  await db.exec('reset role');
  await db.query("update public.durable_records set occurred_at=now()-interval '8 days' where user_id=$1", [a]);
  await asUser(a);
  rows = (await db.query('select * from public.durable_records')).rows;
  assert(rows.length > 0 && rows.every(r => r.kind==='background'), 'history TTL does not hide background');
  await assert.rejects(db.query('select public.prune_durable_history()'));
  await db.exec('reset role');
  await db.query('select public.prune_durable_history()');
  rows = (await db.query("select * from public.durable_records where user_id=$1", [a])).rows;
  assert(rows.length > 0 && rows.every(r=>r.kind==='background'), 'cleanup deletes only expired history');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from public.durable_records'));
  await assert.rejects(save('background','anonymous',job,0));
  console.log('PASS SQL: migration twice, CAS, idempotency, archived executions, tombstones, RLS, forbidden direct writes, 7-day expiry, cleanup isolation and anonymous denial.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
