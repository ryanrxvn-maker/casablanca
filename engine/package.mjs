/**
 * Monta engine/pkg/ e empacota tudo num UNICO instalador:
 *   pkg/                       (KB de scripts + bundle do motor)
 *   pkg.zip                    (zip do pkg/)
 *   DarkoDownloaderSetup.exe   (stub C# nativo: clica -> instala)
 *                              <- distribuir SO ISSO pro usuario.
 *
 * Sem ZIP pro usuario final, sem codigo manual de pareamento.
 * Icone do exe = icone da extensao DarkoLab Downloader.
 *
 * Rode:  node engine/build.mjs && node engine/package.mjs
 */
import { build } from 'esbuild';
import { execFileSync } from 'child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
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
    path.join(pkg, 'AutoEditDownloader.cmd'),
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
  // Entrada interna (quando user roda manualmente o ZIP — fallback).
  // Janela VISÍVEL pra reduzir trigger AV.
  writeFileSync(
    path.join(pkg, 'INSTALAR.cmd'),
    [
      '@echo off',
      'title Auto Edit - Instalar Downloader',
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1"',
      'pause',
      '',
    ].join('\r\n'),
  );
  writeFileSync(
    path.join(pkg, 'DESINSTALAR.cmd'),
    [
      '@echo off',
      'title Auto Edit Downloader - Desinstalar',
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Desinstalar.ps1"',
      'pause',
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

  const csc =
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  if (!existsSync(csc)) {
    throw new Error(
      'csc.exe nao encontrado (.NET Framework 4 ausente). Esperado em: ' + csc,
    );
  }

  log('compilando MakeIco.exe (utilitario PNG->ICO classico)...');
  // ICO classico (BMP DIB) — Explorer/csc leem 100%. PNG-embedded ICO
  // pode falhar em alguns parsers e e o motivo do icone aparecer
  // branco/azul generico em alguns Windows.
  const makeIcoExe = path.join(here, 'installer', 'MakeIco.exe');
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      '/reference:System.Drawing.dll',
      `/out:${makeIcoExe}`,
      path.join(here, 'installer', 'MakeIco.cs'),
    ],
    { stdio: 'inherit' },
  );

  log('gerando icon.ico a partir dos PNGs da extensao (coelho DARKO)...');
  const extIcons = path.join(here, '..', 'extension-downloader', 'icons');
  const icoPath = path.join(here, 'installer', 'icon.ico');
  execFileSync(
    makeIcoExe,
    [
      icoPath,
      path.join(extIcons, 'icon-16.png'),
      path.join(extIcons, 'icon-32.png'),
      path.join(extIcons, 'icon-48.png'),
      path.join(extIcons, 'icon-128.png'),
    ],
    { stdio: 'inherit' },
  );

  log('compilando AutoEditDownloaderSetup.exe (csc.exe)...');
  const exeOut = path.join(here, 'AutoEditDownloaderSetup.exe');
  rmSync(exeOut, { force: true });

  // Anti-AV strategy:
  //   /target:EXE     → console application (janela visível, sem hide flags)
  //   AssemblyInfo.cs → metadata (CompanyName/Description/Version) que o
  //                     Defender lê pra calcular o trust score
  //   /win32manifest  → manifest XML com asInvoker + supportedOS Win10
  //   SEM /optimize+  → optimize+ ofusca código (gatilho de heurística)
  //   SEM packer/UPX  → packers são THE classic malware sign
  //   /resource:zip   → recurso embutido, lido pelo Setup.cs por nome
  const manifestPath = path.join(here, 'installer', 'AutoEditDownloaderSetup.manifest');
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:exe',         // console app — janela visível
      '/platform:anycpu',
      `/win32icon:${icoPath}`,
      `/win32manifest:${manifestPath}`,
      `/resource:${zipOut},AutoEdit.pkg.zip`,
      '/reference:System.dll',
      '/reference:System.IO.Compression.dll',
      '/reference:System.IO.Compression.FileSystem.dll',
      `/out:${exeOut}`,
      path.join(here, 'installer', 'AssemblyInfo.cs'),
      path.join(here, 'installer', 'Setup.cs'),
    ],
    { stdio: 'inherit' },
  );

  log('pronto:');
  log('  -> ' + exeOut + '  (distribuir SO ISSO pro usuario)');
  log('  -> ' + zipOut + '  (zip cru, opcional)');
  log('  -> ' + pkg + '\\   (pasta crua, opcional)');
}

// ===============================================================
//  Instalar.ps1 — gerado dentro do EXE via package.mjs
//  ANTI-AV: SEM hidden window, SEM VBS, SEM Startup folder direto,
//  USA Task Scheduler (schtasks), CONSOLE VISÍVEL com progresso.
// ===============================================================
const INSTALAR_PS1 = `
# Auto Edit Downloader - Instalador
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'Continue'

$dst    = Join-Path $env:LOCALAPPDATA 'AutoEditDownloader'
$src    = $PSScriptRoot
$log    = Join-Path $dst 'install.log'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

function Log {
  param([string]$msg)
  $line = ('{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg)
  Write-Host $line
  try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch {}
}
function Step { param([int]$pct, [string]$msg); Log ("[{0,3}%] {1}" -f $pct, $msg) }
function Fail { param([string]$msg, [int]$code = 1); Log ("ERRO: {0}" -f $msg); exit $code }
trap { Fail $_.Exception.Message 99 }

Log '======================================================'
Log ' Auto Edit Downloader - Instalador'
Log ('  destino: {0}' -f $dst)
Log '======================================================'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Step 2 'Parando instancia anterior do motor (se houver)...'
try {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" \`
    | Where-Object { $_.CommandLine -match 'server\\.cjs' } \`
    | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { Log ('aviso: ' + $_.Exception.Message) }

Step 5 'Copiando arquivos do motor...'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
foreach ($f in @('server.cjs', 'AutoEditDownloader.cmd', 'Desinstalar.ps1', 'LEIA-ME.txt')) {
  $sp = Join-Path $src $f
  if (Test-Path $sp) { Copy-Item $sp $dst -Force }
}
$starter = Join-Path $dst 'AutoEditDownloader.cmd'

$tmp = Join-Path $env:TEMP ('AutoEditInstall_' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$nodeExe = Join-Path $dst 'node\\node.exe'
if (-not (Test-Path $nodeExe)) {
  Step 12 'Baixando Node.js (~30 MB)...'
  $nodeZip = Join-Path $tmp 'node.zip'
  $nodeVer = '__NODE_VER__'
  try { Invoke-WebRequest -UseBasicParsing -Uri ("https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip") -OutFile $nodeZip }
  catch { Fail ('Falha baixando Node.js: ' + $_.Exception.Message) 11 }
  if (-not (Test-Path $nodeZip) -or (Get-Item $nodeZip).Length -lt 1MB) { Fail 'Download do Node.js veio incompleto.' 12 }
  Step 20 'Extraindo Node.js...'
  try { Expand-Archive -LiteralPath $nodeZip -DestinationPath $tmp -Force } catch { Fail ('Falha extraindo Node.js: ' + $_.Exception.Message) 13 }
  $nd = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'node-*win-x64' } | Select-Object -First 1
  if (-not $nd) { Fail 'Pasta do Node nao encontrada apos extracao.' 14 }
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'node') | Out-Null
  Copy-Item (Join-Path $nd.FullName '*') (Join-Path $dst 'node') -Recurse -Force
} else { Step 20 'Node.js ja instalado, pulando.' }

$node   = Join-Path $dst 'node\\node.exe'
$npmCli = Join-Path $dst 'node\\node_modules\\npm\\bin\\npm-cli.js'

if (-not (Test-Path (Join-Path $dst 'node_modules\\playwright'))) {
  Step 32 'Instalando dependencias do motor...'
  '{ "name": "auto-edit-engine", "private": true }' | Set-Content -Encoding ASCII (Join-Path $dst 'package.json')
  & $node $npmCli install playwright@1.60.0 --omit=dev --no-audit --no-fund --prefix "$dst" *>> $log
  if ($LASTEXITCODE -ne 0) { Fail ('npm install falhou. Veja o log: ' + $log) 30 }
} else { Step 32 'Dependencias ja instaladas, pulando.' }

if (-not (Test-Path (Join-Path $dst 'ms-playwright\\chromium-1223'))) {
  Step 48 'Baixando navegador embarcado (~140 MB)...'
  $env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path $dst 'ms-playwright')
  & $node (Join-Path $dst 'node_modules\\playwright\\cli.js') install chromium *>> $log
  if ($LASTEXITCODE -ne 0) { Fail 'Falha baixando o navegador embarcado.' 40 }
} else { Step 48 'Navegador ja presente, pulando.' }

$yt = Join-Path $dst 'bin\\yt-dlp.exe'
if (-not (Test-Path $yt) -or (Get-Item $yt).Length -lt 5MB) {
  Step 78 'Baixando motor de download (yt-dlp)...'
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt }
  catch { Fail ('Falha baixando yt-dlp: ' + $_.Exception.Message) 50 }
} else { Step 78 'yt-dlp ja presente, pulando.' }

$ff = Join-Path $dst 'bin\\ffmpeg.exe'
if (-not (Test-Path $ff) -or (Get-Item $ff).Length -lt 10MB) {
  Step 87 'Baixando ffmpeg (~85 MB)...'
  $fz = Join-Path $tmp 'ff.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz }
  catch { Fail ('Falha baixando ffmpeg: ' + $_.Exception.Message) 60 }
  Step 91 'Extraindo ffmpeg...'
  Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
  $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
  if (-not $fe) { Fail 'ffmpeg.exe nao encontrado apos extracao.' 61 }
  Copy-Item $fe.FullName $ff -Force
} else { Step 91 'ffmpeg ja presente, pulando.' }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# Auto-start via Task Scheduler (NAO Startup folder + VBS = AV-safe)
Step 94 'Configurando inicializacao com o Windows...'
$taskName = 'AutoEditDownloader'
try {
  schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  $action = ('cmd.exe /c "{0}"' -f $starter)
  $null = schtasks /Create /TN $taskName /TR $action /SC ONLOGON /RL LIMITED /F 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log 'aviso: schtasks falhou, fallback para Startup folder (sem .vbs)'
    $startup = [Environment]::GetFolderPath('Startup')
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $startup 'Auto Edit Downloader.lnk'))
    $lnk.TargetPath = $starter
    $lnk.WorkingDirectory = $dst
    $lnk.WindowStyle = 7
    $lnk.Save()
  }
} catch { Log ('aviso configurando autostart: ' + $_.Exception.Message) }

Step 97 'Iniciando o motor...'
Remove-Item (Join-Path $dst 'engine.log') -ErrorAction SilentlyContinue
Start-Process -FilePath $starter -WindowStyle Minimized

$alive = $false
$ports = @(47923, 47924, 47925, 47926, 47927, 47928)
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 700
  foreach ($p in $ports) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$p/health") -TimeoutSec 1 -ErrorAction Stop
      if ($r.Content -match 'darkolab-downloader-engine|auto-edit-downloader') { $alive = $true; break }
    } catch {}
  }
  if ($alive) { break }
}

if ($alive) {
  Step 100 'Motor online. Instalacao concluida.'
  Log 'PRONTO. A extensao Auto Edit Downloader ja deve detectar o motor.'
  exit 0
} else {
  Fail ('Motor instalado mas nao iniciou. Veja: ' + (Join-Path $dst 'engine.log')) 70
}
`;

const DESINSTALAR_PS1 = `
# Auto Edit Downloader - desinstalar
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Auto Edit Downloader - Desinstalar'
Write-Host '----------------------------------'
Write-Host 'Parando o motor...'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server\\.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Removendo auto-start...'
schtasks /Delete /TN 'AutoEditDownloader' /F 2>$null | Out-Null
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'Auto Edit Downloader.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $startup 'DarkoLab Downloader.lnk')  -Force -ErrorAction SilentlyContinue
$dst = Join-Path $env:LOCALAPPDATA 'AutoEditDownloader'
$legacyDst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
foreach ($d in @($dst, $legacyDst)) {
  if (Test-Path $d) {
    Write-Host ('Removendo ' + $d)
    Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Write-Host ''
Write-Host 'Motor desinstalado.'
Read-Host 'Enter para sair'
`;

const LEIAME = `
Auto Edit Downloader - Motor (Windows)
======================================

INSTALACAO:
1) DUPLO-CLIQUE em "AutoEditDownloaderSetup.exe".
   A janela do prompt abre VISIVEL mostrando o progresso. Pode
   levar 1-3 min na 1a vez (baixa Node + Chromium + yt-dlp +
   ffmpeg, ~250 MB).
   Se o SmartScreen avisar, clique "Mais informacoes" >
   "Executar assim mesmo".

2) Instale a extensao "Auto Edit Downloader" no Chrome:
   chrome://extensions > Modo desenvolvedor > Carregar sem compactacao.

3) Abra um video no YouTube/Insta/TikTok/Pinterest e o botao
   "Baixar" aparece sozinho.

SEGURANCA / ANTIVIRUS
---------------------
O EXE roda um PowerShell VISIVEL (nao oculto) que baixa os
componentes na sua pasta de usuario (%LOCALAPPDATA%). Sem VBS,
sem mods em Startup folder. Auto-start usa o Task Scheduler nativo
do Windows. Se ainda assim o Avast/Defender reclamar, e falso
positivo — adicione a pasta como excecao.

LOGS / SUPORTE
--------------
Log de instalacao: %LOCALAPPDATA%\\AutoEditDownloader\\install.log
Log do motor:      %LOCALAPPDATA%\\AutoEditDownloader\\engine.log

Desinstalar: rode "DESINSTALAR.cmd" dentro de
%LOCALAPPDATA%\\AutoEditDownloader

Requer Windows 10/11 64-bit. Internet so na 1a instalacao.
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
