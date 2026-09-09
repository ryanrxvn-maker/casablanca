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
  request: (_: string, fn: () => unknown) => { const result = queue.then(fn); queue = result.then(() => {}, () => {}); return result; },
} } });
const cloud = new Map<string, any>();
const receipts = new Map<string, any>();
let account = 'account-a';
let online = true;
let loseResponse = false;
let posts = 0;
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: string, options?: RequestInit) => {
  if (!online) throw new Error('Offline');
  if (!options?.method) {
    const records = [...cloud.values()].filter(r => r.user_id === account && (r.kind === 'background' || r.occurred_at > Date.now() - HISTORY_RETENTION_MS));
    const page = Number(new URL(url, 'https://test.invalid').searchParams.get('page') ?? 0);
    const chunk = records.slice(page * 100, page * 100 + 100);
    return Response.json({ userId: account, records: chunk, more: chunk.length === 100 });
  }
  const b = JSON.parse(String(options.body));
  posts++;
  if (b.userId !== account) return Response.json({ error: 'Account changed' }, { status: 400 });
  const opKey = `${account}:${b.operationId}`;
  if (receipts.has(opKey)) return Response.json(receipts.get(opKey));
  const key = `${account}:${b.kind}:${b.id}`;
  const current = cloud.get(key);
  if ((current?.revision ?? 0) !== b.revision || (current?.deleted && b.data !== null)) return Response.json({ conflict: true, record: current }, { status: 409 });
  const record = { user_id: account, kind: b.kind, record_id: b.id, payload: b.data, deleted: b.data === null,
    revision: b.revision + 1, occurred_at: current?.occurred_at ?? (b.kind === 'history' ? b.data?.t : Date.now()) };
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
  console.log('PASS: empty reload, stale tab reconciliation, distinct writers, explicit deletion, tombstones, browser wipe recovery, offline queue, lost response, account isolation, quota, retention and sanitization.');
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
