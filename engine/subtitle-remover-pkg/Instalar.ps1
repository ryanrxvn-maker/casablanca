# ===============================================================
#  Auto Edit Smart Remover - Instalador
#  Chamado pelo AutoEditSmartRemoverSetup.exe (WinForms UI).
#  Recebe -StatusFile pra UI ler progresso em tempo real.
# ===============================================================
#  ANTI-FALHA:
#   - Retry com backoff em downloads (3 tentativas: 0s, 3s, 8s)
#   - Skip por tamanho real (não só Test-Path)
#   - Cada pip install isolado (falha de um não mata os outros)
#   - Validação após cada install (import test)
#   - Mensagens de erro específicas com exit codes numerados
# ===============================================================
#  ANTI-AV: console suprimido pelo Setup.exe (CreateNoWindow +
#   RedirectStandardOutput). Sem -WindowStyle Hidden no PS.
# ===============================================================

param([string]$StatusFile)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
try { $PSNativeCommandUseErrorActionPreference = $false } catch {}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Net.ServicePointManager]::DefaultConnectionLimit = 16 } catch {}

$dst = Join-Path $env:LOCALAPPDATA 'AutoEditSmartRemover'
$src = $PSScriptRoot
$log = Join-Path $dst 'install.log'
New-Item -ItemType Directory -Force -Path $dst | Out-Null

# Site origin pra baixar o modelo via /api. Quando Setup.exe roda no PC
# do user, ele não tem acesso ao Vercel local — usa NEXT_PUBLIC_SITE_URL
# se setado, senão domínio padrão. Cliente pode override via env var
# AUTO_EDIT_ORIGIN.
$siteOrigin = $env:AUTO_EDIT_ORIGIN
if (-not $siteOrigin) {
  $siteOrigin = 'https://casablanca-ashen.vercel.app'  # ajuste se mudar
}

function Log { param([string]$msg)
  $line = ('{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg)
  Write-Host $line
  try { Add-Content -LiteralPath $log -Value $line -Encoding UTF8 } catch {}
}
function WriteStatus { param([string]$head, [string]$msg)
  if ($StatusFile) { try { Set-Content -LiteralPath $StatusFile -Value ("$head|$msg") -Encoding UTF8 } catch {} }
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

# ============ Retry com backoff ============
function Retry { param([scriptblock]$Action, [string]$Label, [int]$MaxTries = 3)
  $attempt = 0
  $waitSec = @(0, 3, 8)
  while ($true) {
    try {
      if ($waitSec[$attempt] -gt 0) {
        Log ("  retry {0} em {1}s..." -f $Label, $waitSec[$attempt])
        Start-Sleep -Seconds $waitSec[$attempt]
      }
      & $Action
      return
    } catch {
      $attempt++
      if ($attempt -ge $MaxTries) {
        throw ("$Label falhou após $MaxTries tentativas: " + $_.Exception.Message)
      }
      Log ("  $Label falhou (tentativa $attempt): " + $_.Exception.Message)
    }
  }
}

# ============ Skip robusto (size check) ============
function FileOk { param([string]$Path, [int]$MinBytes)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $size = (Get-Item -LiteralPath $Path).Length
  return $size -ge $MinBytes
}

# ============ Roda comando via .bat (evita deadlock RedirectStdout) ============
function Q { param([string]$s) '"' + ($s -replace '"', '""') + '"' }
function Invoke-Cmd {
  param([string]$Exe, [string[]]$ExeArgs, [string]$Label='cmd', [bool]$IgnoreExit=$false)
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
  if ((-not $IgnoreExit) -and $proc.ExitCode -ne 0) {
    $tail = (Get-Content $logErr -ErrorAction SilentlyContinue | Select-Object -Last 8) -join ' | '
    throw ($Label + ' falhou (exit ' + $proc.ExitCode + '): ' + $tail)
  }
}

function Invoke-Pip {
  param([string]$Py, [string[]]$Pkgs, [string[]]$ExtraArgs=@(), [string]$Label='pip')
  $allArgs = @('-m','pip','install',
               '--no-warn-script-location','--disable-pip-version-check',
               '--prefer-binary','--no-cache-dir',
               '--upgrade-strategy','only-if-needed') + $ExtraArgs + $Pkgs
  Invoke-Cmd $Py $allArgs $Label
}

function PyHasModule {
  param([string]$Py, [string]$Module)
  $logErr = Join-Path $env:TEMP 'autoedit-rm-pychk.err'
  $batPath = Join-Path $env:TEMP 'autoedit-rm-pychk.bat'
  $line = (Q $Py) + ' -c ' + (Q ("import " + $Module)) + ' 2> ' + (Q $logErr)
  Set-Content -LiteralPath $batPath -Value ("@echo off" + [Environment]::NewLine + $line) -Encoding ASCII
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $batPath) -Wait -PassThru -WindowStyle Hidden
  Remove-Item $batPath -Force -ErrorAction SilentlyContinue
  return ($p.ExitCode -eq 0)
}

Log '======================================================'
Log ' Auto Edit Smart Remover - Instalador'
Log ('  destino: {0}' -f $dst)
Log ('  origem CDN: {0}' -f $siteOrigin)
Log '======================================================'

Step 2 'Parando motor anterior...'
try {
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'AutoEditSmartRemover.*server\.py|DarkoSubtitleRemoverApp.*server\.py' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

# ============ Copia arquivos do pacote ============
Step 5 'Copiando arquivos do motor...'
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
foreach ($f in @('server.py', 'pipeline.py', 'propainter_engine.py', 'sttn_engine.py',
                 'AutoEditSmartRemover.cmd', 'DarkoSubtitleRemover.cmd',
                 'Desinstalar.ps1', 'DESINSTALAR.cmd', 'LEIA-ME.txt')) {
  $sp = Join-Path $src $f
  if (Test-Path $sp) { Copy-Item $sp $dst -Force }
}
# Copia código dos engines (módulos Python, sem o modelo .pth)
foreach ($d in @('propainter', 'sttn')) {
  $sp = Join-Path $src $d
  if (Test-Path $sp) {
    Copy-Item $sp -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Cria starter
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

# ============ Python embarcado (~12 MB, skip se ok) ============
$pyVer = '3.11.9'
$pyExe = Join-Path $dst 'python\python.exe'
if (FileOk $pyExe 5MB) {
  Step 12 'Python ja instalado, pulando.'
} else {
  Step 8 'Baixando Python 3.11 embarcado (~12 MB)...'
  $pz = Join-Path $tmp 'python.zip'
  Retry -Label 'download Python' -Action {
    Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$pyVer/python-$pyVer-embed-amd64.zip" -OutFile $pz -TimeoutSec 120
  }
  if (-not (FileOk $pz 1MB)) { Fail 'Python zip incompleto.' 12 }
  Step 12 'Extraindo Python...'
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'python') | Out-Null
  Expand-Archive -LiteralPath $pz -DestinationPath (Join-Path $dst 'python') -Force
  # Habilita site-packages no _pth (pra pip funcionar)
  $pth = Join-Path $dst ('python\python311._pth')
  if (Test-Path $pth) {
    (Get-Content $pth) -replace '^#?import site$', 'import site' | Set-Content -LiteralPath $pth -Encoding ASCII
  }
}

# ============ pip ============
if (Test-Path (Join-Path $dst 'python\Lib\site-packages\pip')) {
  Step 22 'pip ja instalado, pulando.'
} else {
  Step 18 'Instalando pip...'
  $getPip = Join-Path $tmp 'get-pip.py'
  Retry -Label 'download get-pip.py' -Action {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip -TimeoutSec 60
  }
  Retry -Label 'install pip' -Action {
    Invoke-Cmd $pyExe @($getPip, '--no-warn-script-location', '--disable-pip-version-check') 'getpip'
  }
}

# ============ PyTorch (~500 MB CPU / ~2 GB GPU) ============
# Verifica se torch já está instalado e importa
$torchOk = PyHasModule $pyExe 'torch'
if ($torchOk) {
  Step 60 'PyTorch ja instalado, pulando (~500 MB economizados).'
} else {
  Step 28 'Detectando GPU NVIDIA...'
  $hasGpu = $false
  try {
    $nvSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($nvSmi) { $hasGpu = $true }
  } catch {}

  if ($hasGpu) {
    Step 32 'GPU detectada. Baixando PyTorch + CUDA (~2 GB, 7-10 min)...'
    Retry -Label 'torch CUDA' -Action {
      Invoke-Pip $pyExe @('torch==2.4.0', 'torchvision==0.19.0') @('--index-url', 'https://download.pytorch.org/whl/cu121')
    }
  } else {
    Step 32 'Sem GPU. Baixando PyTorch CPU (~500 MB, 4-7 min)...'
    Retry -Label 'torch CPU' -Action {
      Invoke-Pip $pyExe @('torch==2.4.0', 'torchvision==0.19.0') @('--index-url', 'https://download.pytorch.org/whl/cpu')
    }
  }
  if (-not (PyHasModule $pyExe 'torch')) {
    Fail 'PyTorch nao validou apos install. Veja install.log.' 33
  }
}

# ============ paddleocr + opencv + lama (cada um isolado) ============
# Instala SEPARADAMENTE — se um falhar, os outros continuam.
$pyDeps = @(
  @{ Name = 'numpy'; Pkg = 'numpy<2'; Module = 'numpy'; Pct = 66 }
  @{ Name = 'opencv'; Pkg = 'opencv-python==4.10.0.84'; Module = 'cv2'; Pct = 70 }
  @{ Name = 'simple_lama'; Pkg = 'simple_lama_inpainting==0.1.2'; Module = 'simple_lama_inpainting'; Pct = 73 }
  @{ Name = 'paddlepaddle'; Pkg = 'paddlepaddle==2.5.2'; Module = 'paddle'; Pct = 76 }
  @{ Name = 'paddleocr'; Pkg = 'paddleocr==2.7.0.3'; Module = 'paddleocr'; Pct = 78 }
  @{ Name = 'aiohttp'; Pkg = 'aiohttp'; Module = 'aiohttp'; Pct = 80 }
)
foreach ($d in $pyDeps) {
  if (PyHasModule $pyExe $d.Module) {
    Step $d.Pct ("$($d.Name) ja instalado, pulando.")
    continue
  }
  Step $d.Pct ("Instalando $($d.Name)...")
  try {
    Retry -Label $d.Name -Action {
      Invoke-Pip $pyExe @($d.Pkg)
    }
    if (-not (PyHasModule $pyExe $d.Module)) {
      Log ("AVISO: $($d.Name) instalou mas nao importa.")
    }
  } catch {
    Log ("AVISO: $($d.Name) falhou. Continuando — pode afetar features especificas: " + $_.Exception.Message)
  }
}

# ============ ffmpeg ============
$ff = Join-Path $dst 'bin\ffmpeg.exe'
if (FileOk $ff 10MB) {
  Step 88 'ffmpeg ja presente, pulando.'
} else {
  Step 84 'Baixando ffmpeg (~85 MB)...'
  $fz = Join-Path $tmp 'ff.zip'
  Retry -Label 'download ffmpeg' -Action {
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz -TimeoutSec 600
  }
  Step 87 'Extraindo ffmpeg...'
  Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
  $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
  if (-not $fe) { Fail 'ffmpeg.exe nao encontrado.' 61 }
  Copy-Item $fe.FullName $ff -Force
}

# ============ Modelo STTN (66 MB) ============
# Baixa do /api do site (NOVO — antes estava embedded no EXE inflando ele)
$modelPath = Join-Path $dst 'sttn\infer_model.pth'
if (FileOk $modelPath 50MB) {
  Step 92 'Modelo STTN ja presente, pulando (~66 MB economizados).'
} else {
  Step 89 'Baixando modelo STTN (~66 MB)...'
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'sttn') | Out-Null
  $modelUrl = "$siteOrigin/api/subtitle-remover-engine/model"
  Retry -Label 'download modelo STTN' -Action {
    Invoke-WebRequest -UseBasicParsing -Uri $modelUrl -OutFile $modelPath -TimeoutSec 300
  }
  if (-not (FileOk $modelPath 50MB)) {
    Fail 'Modelo STTN veio incompleto. Reinstale.' 90
  }
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# ============ Auto-start via Task Scheduler ============
Step 94 'Configurando inicializacao com o Windows...'
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
Step 96 'Iniciando o motor...'
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
