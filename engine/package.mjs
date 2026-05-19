/**
 * Monta engine/pkg/ — pacote LEVE (uns KB). NADA de binario aqui:
 *   pkg/
 *     server.cjs            (bundle do motor)
 *     DarkoDownloader.cmd   (launcher)
 *     Instalar.ps1          (baixa Node+yt-dlp+ffmpeg+Chromium NO PC
 *                            do usuario, configura auto-start, mostra
 *                            o codigo de pareamento)
 *     Desinstalar.ps1 / LEIA-ME.txt
 *   pkg.zip                 (zip pequeno -> cabe na Vercel e no git)
 *
 * Rode:  node engine/build.mjs && node engine/package.mjs
 */
import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, 'pkg');
const log = (s) => console.log('[package] ' + s);

const NODE_VER = 'v22.11.0'; // LTS pinada (baixada no install)

async function main() {
  log('bundle do motor...');
  await build({
    entryPoints: [path.join(here, 'server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: path.join(here, 'dist', 'server.cjs'),
    external: ['playwright'],
    legalComments: 'none',
    logLevel: 'silent',
  });

  rmSync(pkg, { recursive: true, force: true });
  mkdirSync(pkg, { recursive: true });
  cpSync(path.join(here, 'dist', 'server.cjs'), path.join(pkg, 'server.cjs'));

  writeFileSync(
    path.join(pkg, 'DarkoDownloader.cmd'),
    [
      '@echo off',
      'setlocal',
      'set "HERE=%~dp0"',
      'cd /d "%HERE%"',
      'set "YTDLP_PATH=%HERE%bin\\yt-dlp.exe"',
      'set "FFMPEG_PATH=%HERE%bin\\ffmpeg.exe"',
      'set "PLAYWRIGHT_BROWSERS_PATH=%HERE%ms-playwright"',
      'if not defined DARKO_ALLOW_ADULT set "DARKO_ALLOW_ADULT=1"',
      'echo [%DATE% %TIME%] start >> "%HERE%engine.log"',
      '"%HERE%node\\node.exe" "%HERE%server.cjs" >> "%HERE%engine.log" 2>&1',
      'echo [%DATE% %TIME%] exit %ERRORLEVEL% >> "%HERE%engine.log"',
      '',
    ].join('\r\n'),
  );

  writeFileSync(
    path.join(pkg, 'Instalar.ps1'),
    INSTALAR_PS1.replace(/__NODE_VER__/g, NODE_VER).trim() + '\r\n',
  );
  // Entrada DUPLO-CLIQUE: o usuario so abre este. Chama o .ps1 com
  // ExecutionPolicy Bypass (sem precisar de admin, instala na conta).
  writeFileSync(
    path.join(pkg, 'INSTALAR.cmd'),
    [
      '@echo off',
      'title DarkoLab Downloader - Instalador',
      'echo.',
      'echo  Instalando o DarkoLab Downloader...',
      'echo  (baixa as dependencias na 1a vez, ~1-2 min)',
      'echo.',
      'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"',
      'echo.',
      'echo  Pode fechar esta janela.',
      'pause >nul',
      '',
    ].join('\r\n'),
  );
  writeFileSync(
    path.join(pkg, 'DESINSTALAR.cmd'),
    [
      '@echo off',
      'title DarkoLab Downloader - Desinstalar',
      'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Desinstalar.ps1"',
      'pause >nul',
      '',
    ].join('\r\n'),
  );
  writeFileSync(path.join(pkg, 'Desinstalar.ps1'), DESINSTALAR_PS1.trim() + '\r\n');
  writeFileSync(path.join(pkg, 'LEIA-ME.txt'), LEIAME.trim() + '\r\n');

  log('zip...');
  const zipOut = path.join(here, 'pkg.zip');
  rmSync(zipOut, { force: true });
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${pkg}\\*' -DestinationPath '${zipOut}' -Force`,
    ],
    { stdio: 'inherit' },
  );
  log('pronto -> engine/pkg + engine/pkg.zip (leve)');
}

const INSTALAR_PS1 = `
# DarkoLab Downloader — instalador. Baixa as dependencias no SEU PC
# (uma vez), configura auto-start e mostra o codigo de pareamento.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($m) { Write-Host ('  -> ' + $m) -ForegroundColor Cyan }

$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
Write-Host ''
Write-Host '=== Instalando DarkoLab Downloader (motor) ===' -ForegroundColor Green
Write-Host ('Pasta: ' + $dst)

# para instancia anterior
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $dst | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
Copy-Item (Join-Path $src 'server.cjs') $dst -Force
Copy-Item (Join-Path $src 'DarkoDownloader.cmd') $dst -Force
Copy-Item (Join-Path $src 'Desinstalar.ps1') $dst -Force
Copy-Item (Join-Path $src 'LEIA-ME.txt') $dst -Force -ErrorAction SilentlyContinue

$tmp = Join-Path $env:TEMP ('darko-dl-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# 1) Node runtime (isolado, sem conflito com o que o usuario tenha)
$nodeExe = Join-Path $dst 'node\\node.exe'
if (-not (Test-Path $nodeExe)) {
  Step 'Baixando Node (~30 MB)...'
  $nz = Join-Path $tmp 'node.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/__NODE_VER__/node-__NODE_VER__-win-x64.zip' -OutFile $nz
  Step 'Extraindo Node...'
  Expand-Archive -LiteralPath $nz -DestinationPath $tmp -Force
  $nd = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'node-*win-x64' } | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'node') | Out-Null
  Copy-Item (Join-Path $nd.FullName '*') (Join-Path $dst 'node') -Recurse -Force
}
$node = Join-Path $dst 'node\\node.exe'
$npmCli = Join-Path $dst 'node\\node_modules\\npm\\bin\\npm-cli.js'

# 2) Playwright (modulo) + Chromium
if (-not (Test-Path (Join-Path $dst 'node_modules\\playwright'))) {
  Step 'Instalando Playwright...'
  '{ "name": "darko-engine", "private": true }' | Set-Content -Encoding ASCII (Join-Path $dst 'package.json')
  & $node $npmCli install playwright@1.60.0 --omit=dev --no-audit --no-fund --prefix "$dst" 2>&1 | Out-Null
}
if (-not (Test-Path (Join-Path $dst 'ms-playwright\\chromium-1223'))) {
  Step 'Baixando Chromium (~180 MB, demora)...'
  $env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path $dst 'ms-playwright')
  & $node (Join-Path $dst 'node_modules\\playwright\\cli.js') install chromium 2>&1 | Out-Null
}

# 3) yt-dlp.exe
$yt = Join-Path $dst 'bin\\yt-dlp.exe'
if (-not (Test-Path $yt) -or (Get-Item $yt).Length -lt 5MB) {
  Step 'Baixando yt-dlp...'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt
}

# 4) ffmpeg.exe (build estatico)
$ff = Join-Path $dst 'bin\\ffmpeg.exe'
if (-not (Test-Path $ff) -or (Get-Item $ff).Length -lt 10MB) {
  Step 'Baixando ffmpeg (~30 MB)...'
  $fz = Join-Path $tmp 'ff.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz
  Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
  $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
  Copy-Item $fe.FullName $ff -Force
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# 5) auto-start (atalho oculto na Inicializacao)
$vbs = Join-Path $dst 'run-hidden.vbs'
@'
Set s = CreateObject("WScript.Shell")
d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
s.Run "cmd /c """ & d & "\\DarkoDownloader.cmd""", 0, False
'@ | Set-Content -Encoding ASCII $vbs
$startup = [Environment]::GetFolderPath('Startup')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $startup 'DarkoLab Downloader.lnk'))
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = '"' + $vbs + '"'
$lnk.WorkingDirectory = $dst
$lnk.Save()

# 6) inicia e captura o codigo
Step 'Iniciando o motor...'
Remove-Item (Join-Path $dst 'engine.log') -ErrorAction SilentlyContinue
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
$cfg = Join-Path $env:LOCALAPPDATA 'DarkoDownloader\\config.json'
$tok = $null
for ($i=0; $i -lt 40; $i++) {
  Start-Sleep 1
  $log = Get-Content (Join-Path $dst 'engine.log') -Raw -ErrorAction SilentlyContinue
  if ($log -match '"token":"([0-9a-f]+)"') { $tok = $Matches[1]; break }
}
Write-Host ''
if ($tok) {
  Write-Host '=====================================================' -ForegroundColor Green
  Write-Host ' DarkoLab Downloader instalado e RODANDO!' -ForegroundColor Green
  Write-Host ' CODIGO DE PAREAMENTO (cole na extensao):'
  Write-Host ''
  Write-Host ('   ' + $tok) -ForegroundColor Yellow
  Write-Host ''
  Write-Host '=====================================================' -ForegroundColor Green
  Set-Clipboard -Value $tok
  Write-Host '(codigo copiado pra area de transferencia)'
} else {
  Write-Host 'Instalado, mas nao confirmei o start. Veja o log:' -ForegroundColor Yellow
  Write-Host ('  ' + (Join-Path $dst 'engine.log'))
}
Write-Host ''
Write-Host 'Agora instale a extensao no navegador e cole o codigo.'
`;

const DESINSTALAR_PS1 = `
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'DarkoLab Downloader.lnk') -Force
Remove-Item (Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp') -Recurse -Force
Write-Host 'Motor removido. (config/token em LOCALAPPDATA\\DarkoDownloader preservada)'
`;

const LEIAME = `
DarkoLab Downloader — Motor (Windows)
=====================================
1) DE DUPLO-CLIQUE em "INSTALAR.cmd".
   (Baixa Node + yt-dlp + ffmpeg + Chromium ~250 MB UMA VEZ,
    configura auto-start e mostra/copia o CODIGO de pareamento.
    Se o Windows avisar, clique "Mais informacoes" > "Executar
    assim mesmo".)
2) Instale a extensao "DarkoLab Downloader" no navegador
   (chrome://extensions > modo dev > Carregar sem compactacao).
3) Abra a extensao > cole o CODIGO > Parear.
4) Pronto: em qualquer video (YouTube/Insta/TikTok/Pinterest/+18)
   aparece o botao "Baixar". Roda no seu PC, sem servidor.

Desinstalar: duplo-clique em "DESINSTALAR.cmd".
Precisa de internet so na 1a instalacao. Requer Windows 64-bit.
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
