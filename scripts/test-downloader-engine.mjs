import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
buildSync({ entryPoints: ['engine/jobs.ts'], outfile: '.test-tmp/downloader-jobs.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['playwright'] });
const { DownloadJobs, validateMedia } = require('../.test-tmp/downloader-jobs.cjs');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function settle(jobs, id) {
  for (let i = 0; i < 200; i++) {
    const j = jobs.get(id);
    if (j.state === 'ready' || j.state === 'error') return j;
    await tick();
  }
  throw Error('job did not settle');
}

test('persistent queue: idempotency, max concurrency, media validation, restart and errors', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autoedit-jobs-test-'));
  let active = 0, maxActive = 0, calls = 0, disposed = 0;
  const bytes = Buffer.concat([Buffer.from('0000ftypisom'), Buffer.alloc(4096, 7)]);
  const process = async input => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    await tick(); await tick(); active--;
    if (input.url === 'error') return { ok: false, status: 502, error: 'Fonte indisponível.' };
    const file = path.join(dir, input.url + '.mp4');
    await writeFile(file, input.url === 'json' ? JSON.stringify({ error: 'NOT VIDEO', detail: 'x'.repeat(100) }) : bytes);
    return { ok: true, kind: 'file', filePath: file, name: input.url + '.mp4', contentType: 'video/mp4', dispose: async () => { disposed++; } };
  };
  try {
    const jobs = new DownloadJobs(path.join(dir, 'jobs'), process);
    await jobs.init();
    const [a, duplicate] = await Promise.all([jobs.create({ url: 'one' }, 'same'), jobs.create({ url: 'one' }, 'same')]);
    assert.equal(a.id, duplicate.id);
    await assert.rejects(jobs.create({ url: 'different' }, 'same'));
    const more = await Promise.all(['two', 'three', 'error', 'json'].map(url => jobs.create({ url }, url)));
    const finished = await Promise.all([a, ...more].map(j => settle(jobs, j.id)));
    assert.deepEqual(finished.map(j => j.state), ['ready', 'ready', 'ready', 'error', 'error']);
    assert.equal(calls, 5); assert.ok(maxActive <= 2); assert.equal(disposed, 4);
    assert.match(finished[4].error, /erro no lugar/);
    assert.equal(finished[0].size, bytes.length);
    assert.deepEqual(await readFile(jobs.filePath(a.id)), bytes);
    await tick(); // metadata persistence follows the terminal state change
    const resumed = new DownloadJobs(path.join(dir, 'jobs'), process);
    await resumed.init();
    assert.equal(resumed.get(a.id).state, 'ready');
    assert.equal((await resumed.create({ url: 'one' }, 'same')).id, a.id);
    assert.equal(calls, 5);
    assert.equal(jobs.public(a).input, undefined);
    const invalid = path.join(dir, 'bad');
    await writeFile(invalid, '<!doctype html>' + 'error'.repeat(30));
    await assert.rejects(validateMedia(invalid, 'video/mp4'));
    await assert.rejects(validateMedia(jobs.filePath(a.id), 'application/json'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('delayed initial persistence cannot be processed early or overwrite completed metadata', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autoedit-jobs-write-race-'));
  const fsPromises = require('node:fs/promises');
  const originalWrite = fsPromises.writeFile;
  let releaseWrite;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  let signalBlocked;
  const blocked = new Promise(resolve => { signalBlocked = resolve; });
  const source = path.join(dir, 'source.mp4');
  await writeFile(source, Buffer.concat([Buffer.from('0000ftypisom'), Buffer.alloc(4096, 7)]));
  const calls = [];
  const process = async input => {
    calls.push(input.url);
    return { ok: true, kind: 'file', filePath: source, name: 'video.mp4', contentType: 'video/mp4', dispose: async () => {} };
  };
  const jobs = new DownloadJobs(path.join(dir, 'jobs'), process);
  await jobs.init();
  fsPromises.writeFile = async (file, data, ...args) => {
    if (String(file).startsWith(dir) && String(file).endsWith('.json.tmp') && typeof data === 'string') {
      const snapshot = JSON.parse(data);
      if (snapshot.requestId === 'delayed' && snapshot.state === 'queued') { signalBlocked(); await gate; }
    }
    return originalWrite(file, data, ...args);
  };
  try {
    const firstPromise = jobs.create({ url: 'first' }, 'first');
    const delayedPromise = jobs.create({ url: 'second' }, 'delayed');
    await blocked;
    const first = await firstPromise;
    await settle(jobs, first.id);
    assert.deepEqual(calls, ['first'], 'a job cannot run until its initial record reaches disk');
    let duplicateReturned = false;
    const duplicatePromise = jobs.create({ url: 'second' }, 'delayed').then(job => { duplicateReturned = true; return job; });
    await tick();
    assert.equal(duplicateReturned, false, 'duplicate acknowledgment also waits for durable creation');
    releaseWrite();
    const [delayed, duplicate] = await Promise.all([delayedPromise, duplicatePromise]);
    assert.equal(delayed.id, duplicate.id);
    await settle(jobs, delayed.id);
    await tick();
    const snapshot = JSON.parse(await readFile(path.join(dir, 'jobs', delayed.id + '.json'), 'utf8'));
    assert.equal(snapshot.state, 'ready', 'initial queued snapshot cannot replace the final ready snapshot');
    const resumed = new DownloadJobs(path.join(dir, 'jobs'), process);
    await resumed.init();
    await tick();
    assert.equal(resumed.get(delayed.id).state, 'ready');
    assert.deepEqual(calls, ['first', 'second'], 'restart never reruns a completed job');
  } finally {
    releaseWrite();
    fsPromises.writeFile = originalWrite;
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});

test('more than 100 terminal jobs do not block the next download', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autoedit-jobs-history-cap-'));
  const source = path.join(dir, 'source.mp4');
  await writeFile(source, Buffer.concat([Buffer.from('0000ftypisom'), Buffer.alloc(4096, 7)]));
  let calls = 0;
  const jobs = new DownloadJobs(path.join(dir, 'jobs'), async () => {
    calls++;
    return { ok: true, kind: 'file', filePath: source, name: 'video.mp4', contentType: 'video/mp4', dispose: async () => {} };
  });
  try {
    await jobs.init();
    for (let i = 0; i < 105; i++) {
      const job = await jobs.create({ url: `video-${i}` }, `request-${i}`);
      assert.equal((await settle(jobs, job.id)).state, 'ready');
    }
    const next = await jobs.create({ url: 'next-video' }, 'next-request');
    assert.equal((await settle(jobs, next.id)).state, 'ready');
    assert.equal(calls, 106);
    await tick();
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
