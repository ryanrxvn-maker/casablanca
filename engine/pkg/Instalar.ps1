# Auto Edit Downloader - Instalador
# Quando chamado pelo Setup.exe (WinForms UI), recebe -StatusFile que
# escrevemos no formato "PCT|MSG" pra UI ler e mostrar progresso.
param([string]$StatusFile)

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
function WriteStatus { param([string]$head, [string]$msg)
  if ($StatusFile) {
    try { Set-Content -LiteralPath $StatusFile -Value ("$head|$msg") -Encoding UTF8 } catch {}
  }
}
function Step { param([int]$pct, [string]$msg)
  Log ("[{0,3}%] {1}" -f $pct, $msg)
  WriteStatus $pct $msg
}
function Fail { param([string]$msg, [int]$code = 1)
  Log ("ERRO: {0}" -f $msg)
  WriteStatus 'ERR' $msg
  exit $code
}
trap { Fail $_.Exception.Message 99 }

Log '======================================================'
Log ' Auto Edit Downloader - Instalador'
Log ('  destino: {0}' -f $dst)
Log '======================================================'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Step 2 'Parando instancia anterior do motor (se houver)...'
try {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" `
    | Where-Object { $_.CommandLine -match 'server\.cjs' } `
    | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { Log ('aviso: ' + $_.Exception.Message) }

Step 5 'Copiando arquivos do motor...'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
# Copia TODOS os arquivos do pacote (inclui DESINSTALAR.cmd visivel pro user)
# AutoEditRunner.exe = launcher SILENCIOSO (sem janela preta no startup)
foreach ($f in @('server.cjs', 'AutoEditRunner.exe', 'AutoEditDownloader.cmd', 'Desinstalar.ps1', 'DESINSTALAR.cmd', 'LEIA-ME.txt')) {
  $sp = Join-Path $src $f
  if (Test-Path $sp) { Copy-Item $sp $dst -Force }
}
# Starter = Runner.exe (hidden). Fallback pro .cmd se o runner faltar.
$runnerExe = Join-Path $dst 'AutoEditRunner.exe'
$starter = if (Test-Path $runnerExe) { $runnerExe } else { Join-Path $dst 'AutoEditDownloader.cmd' }

# Garante DESINSTALAR.cmd no destino mesmo se faltou no pacote
$desinstalCmd = Join-Path $dst 'DESINSTALAR.cmd'
if (-not (Test-Path $desinstalCmd)) {
  $cmd = @"
@echo off
title Auto Edit Downloader - Desinstalar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Desinstalar.ps1"
exit
"@
  Set-Content -LiteralPath $desinstalCmd -Value $cmd -Encoding ASCII
}

$tmp = Join-Path $env:TEMP ('AutoEditInstall_' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$nodeExe = Join-Path $dst 'node\node.exe'
if (-not (Test-Path $nodeExe)) {
  Step 12 'Baixando Node.js (~30 MB)...'
  $nodeZip = Join-Path $tmp 'node.zip'
  $nodeVer = 'v22.11.0'
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

$node   = Join-Path $dst 'node\node.exe'
$npmCli = Join-Path $dst 'node\node_modules\npm\bin\npm-cli.js'

if (-not (Test-Path (Join-Path $dst 'node_modules\playwright'))) {
  Step 32 'Instalando dependencias do motor...'
  '{ "name": "auto-edit-engine", "private": true }' | Set-Content -Encoding ASCII (Join-Path $dst 'package.json')
  & $node $npmCli install playwright@1.60.0 --omit=dev --no-audit --no-fund --prefix "$dst" *>> $log
  if ($LASTEXITCODE -ne 0) { Fail ('npm install falhou. Veja o log: ' + $log) 30 }
} else { Step 32 'Dependencias ja instaladas, pulando.' }

if (-not (Test-Path (Join-Path $dst 'ms-playwright\chromium-1223'))) {
  Step 48 'Baixando navegador embarcado (~140 MB)...'
  $env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path $dst 'ms-playwright')
  & $node (Join-Path $dst 'node_modules\playwright\cli.js') install chromium *>> $log
  if ($LASTEXITCODE -ne 0) { Fail 'Falha baixando o navegador embarcado.' 40 }
} else { Step 48 'Navegador ja presente, pulando.' }

$yt = Join-Path $dst 'bin\yt-dlp.exe'
if (-not (Test-Path $yt) -or (Get-Item $yt).Length -lt 5MB) {
  Step 78 'Baixando motor de download (yt-dlp)...'
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt }
  catch { Fail ('Falha baixando yt-dlp: ' + $_.Exception.Message) 50 }
} else { Step 78 'yt-dlp ja presente, pulando.' }

$ff = Join-Path $dst 'bin\ffmpeg.exe'
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
$usingRunner = (Test-Path $runnerExe)
try {
  schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  # Se temos o Runner.exe (winexe SEM console), a task roda ELE DIRETO —
  # sem cmd.exe /c (que abria a janela preta). Runner.exe não mostra nada.
  # Fallback (.cmd legado): roda via cmd minimizado.
  if ($usingRunner) {
    $action = ('"{0}"' -f $starter)
  } else {
    $action = ('cmd.exe /c "{0}"' -f $starter)
  }
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
# Runner.exe (winexe) inicia hidden; .cmd legado vai minimizado.
if ($usingRunner) {
  Start-Process -FilePath $starter -WorkingDirectory $dst
} else {
  Start-Process -FilePath $starter -WindowStyle Minimized
}

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
  Step 100 'Motor online'
  Log 'PRONTO. A extensao Auto Edit Downloader ja deve detectar o motor.'
  WriteStatus 'DONE' 'ok'
  exit 0
} else {
  Fail ('Motor instalado mas nao iniciou. Veja: ' + (Join-Path $dst 'engine.log')) 70
}
