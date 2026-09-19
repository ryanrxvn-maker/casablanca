import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') {
  console.log('Downloader installer status: Windows required; not run.');
  process.exit(0);
}
const source = readFileSync('engine/package.mjs', 'utf8');
const template = vm.runInNewContext(source.slice(source.indexOf('const INSTALAR_PS1 ='), source.indexOf('const DESINSTALAR_PS1 =')) + '\nINSTALAR_PS1;');
const publish = template.slice(template.indexOf('function WriteStatus'), template.indexOf('function Step'));
mkdirSync('.test-tmp', { recursive: true });
const dir = mkdtempSync(path.resolve('.test-tmp/downloader-status-'));
const status = path.join(dir, 'status.txt');
const script = path.join(dir, 'status.ps1');
writeFileSync(status, '2|Preparando');
writeFileSync(script, '\ufeff' + `param([string]$StatusFile)
$ErrorActionPreference = 'Stop'
function Log { param([string]$msg) [Console]::Error.WriteLine($msg); exit 21 }
${publish}
1..300 | ForEach-Object { WriteStatus $_ 'Instalação em execução'; Start-Sleep -Milliseconds 3 }
WriteStatus 'DONE' 'Motor pronto'
exit 0
`);
const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-StatusFile', status], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
child.stdout.on('data', chunk => { diagnostics += chunk; });
child.stderr.on('data', chunk => { diagnostics += chunk; });
const completion = new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', code => resolve(code));
});
let observations = 0;
let unicodeSeen = false;
let unavailableSince = null;
let unavailableReads = 0;
const deadline = Date.now() + 20000;
try {
  while (child.exitCode === null && Date.now() < deadline) {
    let line;
    try { line = readFileSync(status, 'utf8').replace(/^\ufeff/, ''); }
    catch (error) {
      if (['EBUSY', 'EACCES', 'ENOENT'].includes(error.code)) {
        unavailableSince ??= Date.now();
        unavailableReads++;
        assert.ok(Date.now() - unavailableSince < 500, 'A transient file replacement must not leave status unavailable');
        await delay(1);
        continue;
      }
      throw error;
    }
    unavailableSince = null;
    assert.match(line, /^(?:2\|Preparando|\d+\|Instalação em execução|DONE\|Motor pronto)$/u, 'Readers must never observe empty, partial or corrupted status');
    unicodeSeen ||= line.includes('Instalação');
    observations++;
    await delay(1);
  }
  assert.notEqual(child.exitCode, null, 'Publisher must finish within deadline');
  assert.equal(await completion, 0, diagnostics);
  assert.equal(diagnostics, '');
  assert.equal(readFileSync(status, 'utf8'), 'DONE|Motor pronto');
  assert.ok(unicodeSeen);
  assert.ok(observations > 100);
  console.log(`Downloader installer status: ${observations} concurrent reads (${unavailableReads} transient retries); no partial writes, UTF-8 intact and terminal DONE persisted before exit 0.`);
} finally {
  if (child.exitCode === null) child.kill();
}
