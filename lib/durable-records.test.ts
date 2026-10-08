import assert from 'node:assert/strict';
import { checkpoint, encode, inRetention, mergeRecord, HISTORY_RETENTION_MS, validateRecord } from './durable-records-core';
import type * as Registry from './durable-records';

class MemoryStorage {
  bag = new Map<string, string>();
  fail = false;
  get length() { return this.bag.size; }
  key(i: number) { return [...this.bag.keys()][i] ?? null; }
  getItem(k: string) { return this.bag.get(k) ?? null; }
  setItem(k: string, v: string) { if (this.fail) throw new Error('Quota exceeded'); this.bag.set(k, v); }
  removeItem(k: string) { this.bag.delete(k); }
}
const local = new MemoryStorage();
let queue = Promise.resolve();
Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
  request: (_: string, optionsOrFn: unknown, callback?: () => unknown) => {
    const fn = (typeof optionsOrFn === 'function' ? optionsOrFn : callback) as () => unknown;
    const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result;
  },
} } });
const cloud = new Map<string, any>();
const receipts = new Map<string, any>();
let account = 'account-a';
let online = true;
let loseResponse = false;
let posts = 0;
// Database clock for updated_at (the incremental pull never reads the browser's).
let clock = Date.parse('2026-10-01T00:00:00Z');
const tick = () => new Date(clock += 1000).toISOString();
let lastGet: { since: string | null; owner: string | null; delta: boolean; count: number } | null = null;
let failDelta = false;
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, options?: RequestInit) => {
  if (!online) throw new Error('Offline');
  if (!options?.method) {
    const params = new URL(url, 'https://test.invalid').searchParams;
    const since = params.get('since');
    const owner = new Headers(options?.headers).get('x-records-owner');
    const delta = since !== null && Number.isFinite(Date.parse(since)) && owner === account;
    if (delta && failDelta) return Response.json({ error: 'filter unavailable' }, { status: 503 });
    const records = [...cloud.values()].filter(r => r.user_id === account && (r.kind === 'background' || r.occurred_at > Date.now() - HISTORY_RETENTION_MS))
      .filter(r => !delta || Date.parse(r.updated_at) > Date.parse(since!));
    const page = Number(params.get('page') ?? 0);
    const chunk = records.slice(page * 100, page * 100 + 100);
    lastGet = { since, owner, delta, count: chunk.length };
    return Response.json({ userId: account, records: chunk, more: chunk.length === 100, delta });
  }
  const b = JSON.parse(String(options.body));
  posts++;
  if (b.userId !== account) return Response.json({ error: 'Account changed' }, { status: 400 });
  const opKey = `${account}:${b.operationId}`;
  if (receipts.has(opKey)) return Response.json(receipts.get(opKey));
  const key = `${account}:${b.kind}:${b.id}`;
  const current = cloud.get(key);
  const validRevival = current?.deleted && b.data !== null && b.revive === true && b.kind === 'background' &&
    b.data?.taskId === b.id && typeof b.data?.startedAt === 'number';
  if ((current?.revision ?? 0) !== b.revision || (current?.deleted && b.data !== null && !validRevival)) {
    return Response.json({ conflict: true, record: current }, { status: 409 });
  }
  const record = { user_id: account, kind: b.kind, record_id: b.id, payload: b.data, deleted: b.data === null,
    revision: b.revision + 1, occurred_at: current?.occurred_at ?? (b.kind === 'history' ? b.data?.t : Date.now()), updated_at: tick() };
  cloud.set(key, record);
  const result = { conflict: false, record };
  receipts.set(opKey, result);
  if (loseResponse) { loseResponse = false; throw new Error('Connection lost after commit'); }
  return Response.json(result);
} });
const job = (id: string, extra = {}) => ({ taskId: id, taskName: id, parts: [], startedAt: Date.now(), phase: 'done', ...extra });
async function client(): Promise<typeof Registry> {
  delete require.cache[require.resolve('./durable-records')];
  const c: typeof Registry = require('./durable-records');
  await c.initializeDurableRecords();
  return c;
}
function createArchivedRow(c: typeof Registry): string {
  const id = 'archive:0123456789abcdef';
  const owner = c.durabilityStatus().ready ? account : '';
  local.bag.set(`autoedit:records:v2:${owner}:background:${encodeURIComponent(id)}`, JSON.stringify({ kind: 'background', id, data: { taskId: id, archivedExecution: true, startedAt: 1, phase: 'done', parts: [] }, base: null, revision: 1 }));
  return id;
}
async function settled(c: typeof Registry) { await c.syncDurableRecords(); await c.syncDurableRecords(); }

async function main() {
  const a = await client();
  const wa = a.createRecordWriter('background'); wa.hydrate();
  const A = job('A');
  await wa.save({ A }); await settled(a);
  assert(cloud.has('account-a:background:A'));
  const b = await client();
  const wb = b.createRecordWriter('background'); const old = wb.hydrate();
  await wb.save({}); await settled(b);
  assert(b.readDurableRecords('background').A, 'empty mount must not delete stored jobs');

  const B = job('B');
  await wa.save({ A, B }); await settled(a);
  await wb.save({ ...old, A: { ...A, message: 'update from older tab' } }); await settled(b);
  assert(b.readDurableRecords('background').B, 'older tab cannot delete another tab’s new job');
  const postsBefore = posts;
  await wb.save({ ...old, A: { ...A, message: 'update from older tab' } }); await settled(b);
  assert.equal(posts, postsBefore, 'unchanged snapshots do not write or prolong retention');

  const wc = a.createRecordWriter('background'); const stale = wc.hydrate<any>();
  const wd = b.createRecordWriter('background'); const fresh = wd.hydrate<any>();
  await wd.save({ ...fresh, A: { ...fresh.A, message: 'new authoritative message' } }); await settled(b);
  await wc.save({ ...stale, A: { ...stale.A, message: 'stale conflicting message' } }); await settled(a);
  assert.equal(a.readDurableRecords<any>('background').A.message, 'stale conflicting message', 'concurrent progress snapshots reconcile instead of blocking the Pilot');
  assert.equal(a.durabilityStatus().conflicts, 0, 'ordinary concurrent checkpoints never create a recovery conflict');

  const beforeDelete = b.createRecordWriter('background'); const snapshot = beforeDelete.hydrate<any>();
  await a.deleteDurableRecords('background', ['B']); await settled(a);
  await beforeDelete.save({ ...snapshot, B: { ...snapshot.B, message: 'late result' } });
  assert(!b.readDurableRecords('background').B, 'explicit deletion cannot be resurrected by a stale tab');
  assert(cloud.get('account-a:background:B').deleted);

  // A completely fresh browser recovers the account’s records, excluding tombstones.
  local.bag.clear();
  const restored = await client();
  assert(restored.readDurableRecords('background').A);
  assert(!restored.readDurableRecords('background').B);
  assert(Object.keys(restored.readDurableRecords('history')).length > 0, 'dispatch history survives browser loss');

  const revivalWriter = restored.createRecordWriter('background');
  const afterTombstone = revivalWriter.hydrate<any>();
  const B2 = job('B', { startedAt: B.startedAt + 1, message: 'deliberate new execution' });
  await revivalWriter.save({ ...afterTombstone, B: B2 }); await settled(restored);
  assert.equal(restored.readDurableRecords<any>('background').B.message, 'deliberate new execution', 'a new execution can reuse a deliberately removed ClickUp task id');
  assert.equal(cloud.get('account-a:background:B').deleted, false, 'the exact tombstone revision is revived in the account');

  const draftWriter = restored.createRecordWriter('background'); draftWriter.hydrate();
  const draft = { taskId: 'pilot-draft:team:A', sourceTaskId: 'A', taskName: 'AD01', baseAdId: 'AD01', phase: 'draft', parts: [], startedAt: 1, scope: 'clickup:team', analysis: { taskId: 'A', taskName: 'AD01', roleSlots: [], partTemplates: [] }, updatedAt: 1 };
  await draftWriter.save({ [draft.taskId]: draft }); await settled(restored);
  assert.equal(validateRecord('background', draft.taskId, draft), null);
  assert(restored.readDurableRecords('background')[draft.taskId], 'prepared Pilot task is stored independently');

  const wr = restored.createRecordWriter('background'); const restoredData = wr.hydrate();
  online = false;
  await wr.save({ ...restoredData, C: job('C') }); await settled(restored);
  assert(restored.durabilityStatus().error && restored.durabilityStatus().pending > 0);
  assert(restored.readDurableRecords('background').C, 'offline outbox persists before remote confirmation');
  online = true;
  loseResponse = true;
  await settled(restored); await settled(restored);
  assert.equal(cloud.get('account-a:background:C').revision, 1, 'lost response retry must be idempotent');
  assert.equal(restored.durabilityStatus().pending, 0);

  const h = restored.createRecordWriter('history'); h.hydrate();
  const event = { id: 'seven-days', t: Date.now(), tool: 'test', title: 'test', kind: 'done' };
  await h.save({ 'seven-days': event }); await settled(restored);
  await restored.deleteDurableRecords('history', ['seven-days']); await settled(restored);
  assert(restored.readDurableRecords('background').A, 'history deletion is independent of background');
  assert(!inRetention('history', { t: Date.now() - HISTORY_RETENTION_MS - 1 }));
  assert(inRetention('background', { startedAt: 0 }), 'background has no TTL');
  const oldCloud = cloud.get('account-a:background:A');
  oldCloud.occurred_at = 0;
  cloud.set('account-a:history:expired', { user_id: account, kind: 'history', record_id: 'expired', revision: 1, deleted: false, occurred_at: 0, payload: { id: 'expired', t: 0 } });
  local.bag.clear();
  const afterRetention = await client();
  assert(afterRetention.readDurableRecords('background').A);
  assert(afterRetention.readDurableRecords('background')[draft.taskId], 'prepared Pilot task survives a fresh browser');
  assert(!afterRetention.readDurableRecords('history').expired);

  const quotaWriter = afterRetention.createRecordWriter('background'); const beforeQuota = quotaWriter.hydrate();
  local.fail = true;
  await assert.rejects(quotaWriter.save({ ...beforeQuota, D: job('D') }));
  assert(afterRetention.durabilityStatus().error, 'quota failure is user-visible');
  local.fail = false;
  assert(!afterRetention.readDurableRecords('background').D);

  account = 'account-b';
  const other = await client();
  assert.deepEqual(other.readDurableRecords('background'), {}, 'cached records are account-scoped');
  assert.equal(other.durabilityStatus().legacy, 0);
  assert.equal(validateRecord('background', 'A', A), null);
  assert(validateRecord('background', 'wrong', A));
  assert.equal(encode(checkpoint({ url: 'blob:old', token: 'secret', nested: { password: 'secret', videoId: 'v1' } })), encode({ nested: { videoId: 'v1' } }));
  assert.deepEqual(mergeRecord({ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }), { x: 2, y: 2 });
  assert.deepEqual(mergeRecord({ x: 1 }, { x: 2 }, { x: 3 }), { x: 2 });
  assert.equal(mergeRecord({ x: 1 }, { x: 2 }, null), null, 'explicit remote deletion wins over stale progress');

  // Incremental pull: a reload downloads only what changed since the last complete pull.
  account = 'account-a';
  local.bag.clear();
  clock += 3_600_000; // everything above happened an hour ago
  const fresh1 = await client();
  assert(lastGet && lastGet.since === null, 'a browser with no local copy pulls the whole account');
  const wf = fresh1.createRecordWriter('background'); const wfData = wf.hydrate<any>();
  await wf.save({ ...wfData, E: job('E') }); await settled(fresh1); // E + its dispatch event
  await fresh1.refreshDurableRecords(); // cursor moves to E
  clock += 3_600_000; // another hour, beyond the 10-minute overlap
  const remoteA = cloud.get('account-a:background:A');
  cloud.set('account-a:background:A', { ...remoteA, payload: { ...remoteA.payload, message: 'from another device' }, revision: remoteA.revision + 1, updated_at: tick() });
  const inc = await client();
  assert(lastGet && lastGet.since && lastGet.owner === 'account-a' && lastGet.delta, 'reload asks only for changes of the same account');
  const accountRows = [...cloud.values()].filter(r => r.user_id === 'account-a').length;
  assert.equal(lastGet!.count, 3, `only A plus the overlap (E and its event) come back, not all ${accountRows}`);
  assert(accountRows > 10);
  assert.equal(inc.readDurableRecords<any>('background').A.message, 'from another device', 'a change from another device arrives');
  assert(inc.readDurableRecords('background').E, 'rows outside the window stay in the local copy');
  assert(inc.readDurableRecords('background')[draft.taskId], 'prepared Pilot task survives incremental pulls');
  const remoteE = cloud.get('account-a:background:E');
  cloud.set('account-a:background:E', { ...remoteE, payload: null, deleted: true, revision: remoteE.revision + 1, updated_at: tick() });
  await inc.refreshDurableRecords();
  assert(lastGet && lastGet.delta, 'the periodic refresh is incremental too');
  assert(!inc.readDurableRecords('background').E, 'a tombstone arrives through the incremental pull');
  const wInc = inc.createRecordWriter('background'); const incData = wInc.hydrate<any>();
  await wInc.save({ ...incData, F: job('F') }); await settled(inc);
  assert(cloud.get('account-a:background:F'), 'writes keep working after incremental pulls');
  account = 'account-b';
  const switched = await client();
  assert(lastGet && lastGet.owner === 'account-a' && !lastGet.delta, 'another account on the same browser gets a full pull');
  assert.deepEqual(switched.readDurableRecords('background'), {}, 'incremental cursor never leaks between accounts');
  account = 'account-a';
  const back = await client();
  assert(lastGet && !lastGet.delta, 'coming back from another account pulls everything once');
  assert(back.readDurableRecords('background').F && back.readDurableRecords('background').A);
  await client();
  assert(lastGet && lastGet.delta, 'and the next reload is incremental again');
  failDelta = true;
  const degraded = await client();
  failDelta = false;
  assert(lastGet && lastGet.since === null, 'a failed incremental pull is redone as the full pull');
  assert(degraded.durabilityStatus().ready && !degraded.durabilityStatus().error, 'the fallback leaves the tools ready, without an error');
  assert(degraded.readDurableRecords('background').A && degraded.readDurableRecords('background').F);
  local.bag.set('autoedit:records:v2:cursor', '{broken');
  const broken = await client();
  assert(lastGet && lastGet.since === null && broken.durabilityStatus().ready, 'an unreadable cursor falls back to a full pull');
  // Readers that never show archived executions skip them without parsing.
  const arch = createArchivedRow(broken);
  assert(broken.readDurableRecords('background')[arch], 'archived executions are still readable');
  assert(!broken.readDurableRecords('background', { skipArchived: true })[arch], 'skipArchived leaves archive rows out');
  assert(broken.readDurableRecords('background', { skipArchived: true }).A, 'skipArchived keeps ordinary rows');
  // Single-record read gives the same answer as the full read, without decoding the account.
  assert.deepEqual(broken.readDurableRecord('background', 'A'), broken.readDurableRecords('background').A);
  assert.equal(broken.readDurableRecord('background', 'E'), undefined, 'a tombstone reads as absent');
  assert.equal(broken.readDurableRecord('background', 'nope'), undefined, 'a missing id reads as absent');
  assert.deepEqual(broken.readDurableRecord('background', arch), broken.readDurableRecords('background')[arch]);
  console.log('PASS: empty reload, stale tab reconciliation, distinct writers, explicit deletion, protected tombstone revival, browser wipe recovery, offline queue, lost response, account isolation, quota, retention, sanitization and incremental pull.');
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
