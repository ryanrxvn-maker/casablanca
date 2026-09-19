import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('Installer WinForms integration requires Windows.');
const args = process.argv.slice(2);
const exeFlag = args.indexOf('--exe');
const installer = path.resolve(exeFlag >= 0 ? args[exeFlag + 1] : 'engine/AutoEditDownloaderSetup.exe');
const artifactsRoot = path.resolve('.test-tmp');
mkdirSync(artifactsRoot, {recursive:true});
const artifacts = mkdtempSync(path.join(artifactsRoot, 'installer-gui-'));
const harness = path.join(artifacts, 'InstallerSmoke.exe');
const compile = spawnSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe', [
  '/nologo', '/target:exe', '/platform:anycpu', `/out:${harness}`,
  '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
  path.resolve('engine/ci/InstallerSmoke.cs'),
], {encoding:'utf8', windowsHide:true});
assert.equal(compile.status, 0, compile.stdout + compile.stderr);
console.log('WinForms integration artifacts: ' + artifacts);
const commandArgs = [installer, artifacts, ...(args.includes('--install') ? ['--install'] : [])];
const child = spawn(harness, commandArgs, {windowsHide:true, stdio:'inherit'});
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
assert.equal(code, 0, 'Installer integration failed; inspect artifacts above.');
