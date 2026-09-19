import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') {
  console.log('Downloader Windows supervisor: requires Windows; not run.');
  process.exit(0);
}
const root = path.resolve('.test-tmp');
mkdirSync(root, { recursive: true });
const dir = mkdtempSync(path.join(root, 'downloader-runner-'));
mkdirSync(path.join(dir, 'node'));
copyFileSync(process.execPath, path.join(dir, 'node', 'node.exe'));
const exe = path.join(dir, 'AutoEditRunner.exe');
const compile = spawnSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', [
  '/nologo', '/target:winexe', '/platform:anycpu', `/out:${exe}`,
  path.resolve('engine/installer/Runner.cs'),
], { windowsHide: true, encoding: 'utf8' });
assert.equal(compile.status, 0, compile.stdout + compile.stderr);
const statePath = path.join(dir, 'starts.json');
writeFileSync(path.join(dir, 'server.cjs'), `
const fs = require('node:fs');
const file = ${JSON.stringify(statePath)};
const starts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
starts.push({ pid: process.pid, time: Date.now(), node: process.execPath, yt: process.env.YTDLP_PATH });
fs.writeFileSync(file, JSON.stringify(starts));
console.log('fixture started', starts.length);
if (starts.length === 1) process.exit(17);
else if (starts.length === 2) setInterval(() => {}, 1000);
else process.exit(0);
`);
const starts = () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : [];
async function until(predicate, label, ms = 12000) {
  const untilAt = Date.now() + ms;
  while (Date.now() < untilAt) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(label + ' timed out');
}
const runner = spawn(exe, [], { windowsHide: true, stdio: 'ignore' });
try {
  await until(() => starts().length === 2, 'restart after nonzero exit');
  const first = starts();
  assert.ok(first[1].time - first[0].time >= 1900, 'restart must back off');
  assert.equal(first[1].yt, path.join(dir, 'bin', 'yt-dlp.exe'));
  const duplicate = spawn(exe, [], { windowsHide: true, stdio: 'ignore' });
  await until(() => duplicate.exitCode !== null, 'duplicate supervisor exit');
  assert.equal(duplicate.exitCode, 0);
  assert.equal(starts().length, 2, 'mutex must prevent duplicate engine');
  process.kill(first[1].pid);
  await until(() => starts().length === 3, 'restart after terminated engine');
  await until(() => runner.exitCode !== null, 'clean exit stops supervisor');
  assert.equal(runner.exitCode, 0);
  await delay(2300);
  assert.equal(starts().length, 3, 'clean exit must not respawn');
  console.log('Downloader supervisor: compiled; crash recovery, terminated process recovery, single instance, backoff, clean shutdown and runtime environment passed.');
} finally {
  if (runner.exitCode === null) runner.kill();
  for (const entry of starts()) {
    try { process.kill(entry.pid); } catch { }
  }
}
