import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync} from 'node:fs';
import path from 'node:path';
if(process.platform!=='win32')throw new Error('Installer completion tests require Windows .NET Framework.');
mkdirSync('.test-tmp',{recursive:true});
const folder=mkdtempSync(path.resolve('.test-tmp/installer-completion-'));
for(const remover of [false,true]){
 const executable=path.join(folder,remover?'RemoverCompletionTests.exe':'DownloaderCompletionTests.exe');
 const args=['/nologo','/target:exe','/main:AutoEdit.InstallerCompletionTests',`/out:${executable}`,
 '/reference:System.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',
 '/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',
 ...(remover?['/define:REMOVER']:[]),path.resolve('engine/installer/Setup.cs'),path.resolve('engine/ci/InstallerCompletionTests.cs')];
 const compiled=spawnSync('C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',args,{encoding:'utf8',windowsHide:true});
 assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
 const result=spawnSync(executable,[],{encoding:'utf8',windowsHide:true,timeout:20000});
 console.log((remover?'REMOVER':'DOWNLOADER')+' production Setup.cs branch:\n'+result.stdout);
 assert.equal(result.status,0,result.stderr+result.stdout);
}
console.log('PASS both Setup.cs branches compile and completion protocol is deterministic. Artifacts: '+folder);
