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
    # A interface pode ler a qualquer instante. Nunca deixe o arquivo vazio
    # entre truncar e escrever, especialmente antes do processo encerrar.
    $statusTemp = $StatusFile + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
      [IO.File]::WriteAllText($statusTemp, ("$head|$msg"), (New-Object Text.UTF8Encoding($false)))
      for ($statusAttempt = 0; $statusAttempt -lt 10; $statusAttempt++) {
        try {
          if ([IO.File]::Exists($StatusFile)) {
            [IO.File]::Replace($statusTemp, $StatusFile, [NullString]::Value)
          } else {
            [IO.File]::Move($statusTemp, $StatusFile)
          }
          return
        } catch {
          if ($statusAttempt -eq 9) { throw }
          Start-Sleep -Milliseconds 25
        }
      }
    } catch { Log ('Falha comunicando status ao instalador: ' + $_.Exception.Message) }
    finally { if ([IO.File]::Exists($statusTemp)) { [IO.File]::Delete($statusTemp) } }
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
function Test-YtDlp {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    $probe = Start-Process -FilePath $Path -ArgumentList '--version' -WindowStyle Hidden -PassThru -ErrorAction Stop
    if (-not $probe.WaitForExit(20000)) { $probe.Kill(); return $false }
    return $probe.ExitCode -eq 0
  } catch { return $false }
}
trap { Fail $_.Exception.Message 99 }

Log '======================================================'
Log ' Auto Edit Downloader - Instalador'
Log ('  destino: {0}' -f $dst)
Log '======================================================'

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

Step 2 'Parando instancia anterior do motor (se houver)...'
try {
  # Pare o supervisor antes do node, para ele nao reiniciar durante a troca.
  $runnerPath = Join-Path $dst 'AutoEditRunner.exe'
  $legacyDst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
  $serverPattern = [regex]::Escape((Join-Path $dst 'server.cjs')) + '|' + [regex]::Escape((Join-Path $legacyDst 'server.cjs'))
  Get-CimInstance Win32_Process -Filter "Name='AutoEditRunner.exe'" `
    | Where-Object { $_.ExecutablePath -eq $runnerPath -or $_.ExecutablePath -eq (Join-Path $legacyDst 'AutoEditRunner.exe') } `
    | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" `
    | Where-Object { $_.CommandLine -match $serverPattern } `
    | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { Log ('aviso: ' + $_.Exception.Message) }

Step 5 'Copiando arquivos do motor...'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
# Copia TODOS os arquivos do pacote (inclui DESINSTALAR.cmd visivel pro user)
# AutoEditRunner.exe = launcher SILENCIOSO (sem janela preta no startup)
foreach ($f in @('server.cjs', 'AutoEditRunner.exe', 'AutoEditDownloader.cmd', 'Desinstalar.ps1', 'DESINSTALAR.cmd', 'LEIA-ME.txt')) {
  $sp = Join-Path $src $f
  if (-not (Test-Path -LiteralPath $sp)) { Fail ('Arquivo obrigatorio ausente no pacote: ' + $f) 15 }
  Copy-Item -LiteralPath $sp -Destination $dst -Force -ErrorAction Stop
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
$ytNew = Join-Path $dst 'bin\yt-dlp.install.exe'
$ytBackup = Join-Path $dst 'bin\yt-dlp.previous.exe'
Step 78 'Atualizando o componente de download...'
try {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $ytNew -TimeoutSec 180 -ErrorAction Stop
  if ((Get-Item -LiteralPath $ytNew).Length -lt 5MB -or -not (Test-YtDlp $ytNew)) {
    throw 'O componente baixado nao passou na verificacao.'
  }
  if (Test-Path -LiteralPath $yt) {
    [IO.File]::Replace($ytNew, $yt, $ytBackup, $true)
  } else {
    [IO.File]::Move($ytNew, $yt)
  }
  Log 'Componente de download atualizado e validado.'
} catch {
  $updateError = $_.Exception.Message
  Remove-Item -LiteralPath $ytNew -Force -ErrorAction SilentlyContinue
  if (-not (Test-YtDlp $yt)) { Fail ('Falha preparando yt-dlp: ' + $updateError) 50 }
  Log ('A atualizacao nao respondeu; a versao funcional foi preservada. O motor tentara novamente. ' + $updateError)
}

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
  $taskCommand = if ($usingRunner) { $starter } else { Join-Path $env:SystemRoot 'System32\cmd.exe' }
  $taskArguments = if ($usingRunner) { '' } else { '/c "' + $starter + '"' }
  $taskCommandXml = [Security.SecurityElement]::Escape($taskCommand)
  $taskArgumentsXml = [Security.SecurityElement]::Escape($taskArguments)
  $taskWorkingDirXml = [Security.SecurityElement]::Escape($dst)
  $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $taskXmlFile = Join-Path $dst 'startup-task.xml'
  # Defaults do schtasks encerram tarefas apos 72h ou ao entrar na bateria.
  # O motor e um servico de usuario continuo, sem limite de execucao.
  $taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>$taskSid</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="User"><UserId>$taskSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="User"><Exec><Command>$taskCommandXml</Command><Arguments>$taskArgumentsXml</Arguments><WorkingDirectory>$taskWorkingDirXml</WorkingDirectory></Exec></Actions>
</Task>
"@
  Set-Content -LiteralPath $taskXmlFile -Value $taskXml -Encoding Unicode
  $null = schtasks /Create /TN $taskName /XML $taskXmlFile /F 2>&1
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
  # Remove atalhos do motor legado, que poderiam iniciar uma versao antiga
  # antes do supervisor. Apenas atalhos dentro das duas pastas do produto.
  $startup = [Environment]::GetFolderPath('Startup')
  $wsh = New-Object -ComObject WScript.Shell
  $oldLinkPath = Join-Path $startup 'DarkoLab Downloader.lnk'
  if (Test-Path -LiteralPath $oldLinkPath) {
    $oldLink = $wsh.CreateShortcut($oldLinkPath)
    $ownedTarget = $oldLink.TargetPath + ' ' + $oldLink.Arguments
    if ($ownedTarget -match ([regex]::Escape($dst) + '|' + [regex]::Escape((Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp')))) {
      Remove-Item -LiteralPath $oldLinkPath -Force -ErrorAction SilentlyContinue
    }
  }
} catch { Log ('aviso configurando autostart: ' + $_.Exception.Message) }

# O caminho orientado pela interface precisa existir no menu Iniciar.
try {
  $programs = [Environment]::GetFolderPath('Programs')
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut((Join-Path $programs 'Auto Edit Downloader.lnk'))
  $lnk.TargetPath = $starter
  $lnk.WorkingDirectory = $dst
  $lnk.WindowStyle = 7
  $lnk.Save()
} catch { Log ('aviso criando atalho: ' + $_.Exception.Message) }

Step 97 'Iniciando o motor...'
# O supervisor preserva o diagnostico e so gira logs acima de 5 MB.
# Runner.exe (winexe) inicia hidden; .cmd legado vai minimizado.
if ($usingRunner) {
  Start-Process -FilePath $starter -WorkingDirectory $dst -WindowStyle Hidden
} else {
  Start-Process -FilePath $starter -WindowStyle Hidden
}

$alive = $false
$ports = @(47923, 47924, 47925, 47926, 47927, 47928, 47929, 47930, 47931)
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 700
  foreach ($p in $ports) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:$p/health") -TimeoutSec 1 -ErrorAction Stop
      $health = $r.Content | ConvertFrom-Json
      if ($health.app -eq 'darkolab-downloader-engine' -and $health.version -eq '1.2.1' -and $health.capabilities -contains 'download-jobs-v1') { $alive = $true; break }
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
