# ===============================================================
#  Auto Edit Smart Remover - Instalador
#  Chamado pelo AutoEditSmartRemoverSetup.exe (WinForms UI).
#  Recebe -StatusFile pra UI ler progresso em tempo real.
# ===============================================================
#  Não esconde console (CreateNoWindow no Setup.exe já suprime).
#  Não usa WinForms inline (UI vem do .exe).
#  Auto-start via Task Scheduler (AV-safe).
# ===============================================================

param([string]$StatusFile)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
try { $PSNativeCommandUseErrorActionPreference = $false } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$dst = Join-Path $env:LOCALAPPDATA 'AutoEditSmartRemover'
$src = $PSScriptRoot
$log = Join-Path $dst 'install.log'
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

# Helper: escapa argumento pra cmd
function Q { param([string]$s) '"' + ($s -replace '"', '""') + '"' }

# Roda comando via .bat temporário (evita deadlock RedirectStandardOutput)
function Invoke-Cmd {
  param([string]$Exe, [string[]]$ExeArgs, [string]$Label='cmd')
  $logOut = Join-Path $env:TEMP ('autoedit-rm-' + $Label + '.out')
  $logErr = Join-Path $env:TEMP ('autoedit-rm-' + $Label + '.err')
  $batPath = Join-Path $env:TEMP ('autoedit-rm-' + $Label + '.bat')
  $line = (Q $Exe)
  foreach ($a in $ExeArgs) { $line += ' ' + (Q $a) }
  $line += ' > ' + (Q $logOut) + ' 2> ' + (Q $logErr)
  $bat = '@echo off' + [Environment]::NewLine + $line + [Environment]::NewLine + 'exit /b %ERRORLEVEL%'
  Set-Content -LiteralPath $batPath -Value $bat -Encoding ASCII
  $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $batPath) -Wait -PassThru -WindowStyle Hidden
  Remove-Item $batPath -Force -ErrorAction SilentlyContinue
  if ($proc.ExitCode -ne 0) {
    $tail = (Get-Content $logErr -ErrorAction SilentlyContinue | Select-Object -Last 8) -join ' | '
    throw ($Label + ' falhou (exit ' + $proc.ExitCode + '): ' + $tail)
  }
}
function Invoke-Pip {
  param([string]$Py, [string[]]$Pkgs)
  $a = @('-m','pip','install','--no-warn-script-location','--disable-pip-version-check','--prefer-binary','--no-cache-dir') + $Pkgs
  Invoke-Cmd $Py $a 'pip'
}

Log '======================================================'
Log ' Auto Edit Smart Remover - Instalador'
Log ('  destino: {0}' -f $dst)
Log '======================================================'

Step 2 'Parando motor anterior...'
try {
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'AutoEditSmartRemover.*server\.py|DarkoSubtitleRemoverApp.*server\.py' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

# ============ Copia arquivos do pacote pro destino ============
Step 5 'Copiando arquivos do motor...'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
foreach ($f in @('server.py', 'pipeline.py', 'propainter_engine.py', 'sttn_engine.py',
                 'AutoEditSmartRemover.cmd', 'DarkoSubtitleRemover.cmd',
                 'Desinstalar.ps1', 'DESINSTALAR.cmd', 'LEIA-ME.txt')) {
  $sp = Join-Path $src $f
  if (Test-Path $sp) { Copy-Item $sp $dst -Force }
}
foreach ($d in @('propainter', 'sttn')) {
  $sp = Join-Path $src $d
  if (Test-Path $sp) {
    Copy-Item $sp -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Cria starter .cmd se ainda não existe
$starter = Join-Path $dst 'AutoEditSmartRemover.cmd'
if (-not (Test-Path $starter)) {
  $cmd = @"
@echo off
setlocal
set ""HERE=%~dp0""
cd /d ""%HERE%""
set ""PATH=%HERE%bin;%HERE%python;%PATH%""
echo [%DATE% %TIME%] start >> ""%HERE%engine.log""
""%HERE%python\python.exe"" ""%HERE%server.py"" >> ""%HERE%engine.log"" 2>&1
echo [%DATE% %TIME%] exit %ERRORLEVEL% >> ""%HERE%engine.log""
"@
  Set-Content -LiteralPath $starter -Value $cmd -Encoding ASCII
}

# DESINSTALAR.cmd no destino
$desinstalCmd = Join-Path $dst 'DESINSTALAR.cmd'
if (-not (Test-Path $desinstalCmd)) {
  $cmd = @"
@echo off
title Auto Edit Smart Remover - Desinstalar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Desinstalar.ps1"
exit
"@
  Set-Content -LiteralPath $desinstalCmd -Value $cmd -Encoding ASCII
}

$tmp = Join-Path $env:TEMP ('AutoEditRmInstall_' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# ============ Python embarcado ============
$pyVer = '3.11.9'
$pyExe = Join-Path $dst 'python\python.exe'
if (-not (Test-Path $pyExe)) {
  Step 8 'Baixando Python 3.11 embarcado (~12 MB)...'
  $pz = Join-Path $tmp 'python.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$pyVer/python-$pyVer-embed-amd64.zip" -OutFile $pz }
  catch { Fail ('Falha baixando Python: ' + $_.Exception.Message) 11 }
  if (-not (Test-Path $pz) -or (Get-Item $pz).Length -lt 1MB) { Fail 'Python zip incompleto.' 12 }
  Step 12 'Extraindo Python...'
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'python') | Out-Null
  Expand-Archive -LiteralPath $pz -DestinationPath (Join-Path $dst 'python') -Force
  # Habilita site-packages no _pth pra pip funcionar
  $pth = Join-Path $dst ('python\python311._pth')
  if (Test-Path $pth) {
    (Get-Content $pth) -replace '^#?import site$', 'import site' | Set-Content -LiteralPath $pth -Encoding ASCII
  }
} else { Step 12 'Python ja instalado, pulando.' }

# ============ pip ============
if (-not (Test-Path (Join-Path $dst 'python\Lib\site-packages\pip'))) {
  Step 18 'Instalando pip...'
  $getPip = Join-Path $tmp 'get-pip.py'
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip }
  catch { Fail ('Falha baixando get-pip: ' + $_.Exception.Message) 20 }
  Invoke-Cmd $pyExe @($getPip, '--no-warn-script-location', '--disable-pip-version-check') 'getpip'
} else { Step 22 'pip ja instalado, pulando.' }

# ============ Dependências IA ============
if (-not (Test-Path (Join-Path $dst 'python\Lib\site-packages\simple_lama_inpainting'))) {
  Step 28 'Detectando GPU NVIDIA...'
  $hasGpu = $false
  try {
    $nvSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($nvSmi) { $hasGpu = $true }
  } catch {}

  if ($hasGpu) {
    Step 32 'GPU NVIDIA detectada. Baixando IA + CUDA (~2 GB, 7-10 min, 10x mais rapido)...'
    Invoke-Pip $pyExe @('torch==2.4.0', 'torchvision==0.19.0', '--index-url', 'https://download.pytorch.org/whl/cu121')
  } else {
    Step 32 'Sem GPU. Baixando IA modo CPU (~500 MB, 4-7 min)...'
    Invoke-Pip $pyExe @('torch==2.4.0', 'torchvision==0.19.0', '--index-url', 'https://download.pytorch.org/whl/cpu')
  }
  Step 65 'Instalando paddleocr + opencv + simple_lama_inpainting...'
  Invoke-Pip $pyExe @('paddleocr==2.7.0.3', 'paddlepaddle==2.5.2', 'opencv-python==4.10.0.84',
                     'simple_lama_inpainting==0.1.2', 'numpy<2', 'aiohttp')
} else { Step 65 'IA + dependencias ja instaladas, pulando.' }

# ============ ffmpeg ============
$ff = Join-Path $dst 'bin\ffmpeg.exe'
if (-not (Test-Path $ff) -or (Get-Item $ff).Length -lt 10MB) {
  Step 78 'Baixando ffmpeg (~85 MB)...'
  $fz = Join-Path $tmp 'ff.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz }
  catch { Fail ('Falha baixando ffmpeg: ' + $_.Exception.Message) 60 }
  Step 84 'Extraindo ffmpeg...'
  Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
  $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
  if (-not $fe) { Fail 'ffmpeg.exe nao encontrado.' 61 }
  Copy-Item $fe.FullName $ff -Force
} else { Step 84 'ffmpeg ja presente, pulando.' }
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# ============ Auto-start via Task Scheduler (AV-safe) ============
Step 90 'Configurando inicializacao com o Windows...'
$taskName = 'AutoEditSmartRemover'
try {
  schtasks /Delete /TN $taskName /F 2>$null | Out-Null
  $action = ('cmd.exe /c "{0}"' -f $starter)
  $null = schtasks /Create /TN $taskName /TR $action /SC ONLOGON /RL LIMITED /F 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log 'aviso: schtasks falhou, fallback Startup folder'
    $startup = [Environment]::GetFolderPath('Startup')
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $startup 'Auto Edit Smart Remover.lnk'))
    $lnk.TargetPath = $starter
    $lnk.WorkingDirectory = $dst
    $lnk.WindowStyle = 7
    $lnk.Save()
  }
} catch { Log ('aviso autostart: ' + $_.Exception.Message) }

# ============ Inicia motor ============
Step 95 'Iniciando o motor...'
Remove-Item (Join-Path $dst 'engine.log') -ErrorAction SilentlyContinue
Start-Process -FilePath $starter -WindowStyle Minimized

$ready = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Milliseconds 800
  $eng = Get-Content (Join-Path $dst 'engine.log') -Raw -ErrorAction SilentlyContinue
  if ($eng -and $eng -match '"event"\s*:\s*"ready"') { $ready = $true; break }
}

if ($ready) {
  Step 100 'Motor online'
  WriteStatus 'DONE' 'ok'
  exit 0
} else {
  Fail ('Motor instalado mas nao iniciou. Veja: ' + (Join-Path $dst 'engine.log')) 70
}
