# DarkoLab Subtitle Remover - instalador com TELA (design DARKO).
# Espelha o instalador do Downloader. O trabalho pesado roda num Job de
# background; a janela WinForms so mostra "Instalando...", barra de progresso
# e, no fim, o codigo de pareamento.
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'DarkoSubtitleRemoverApp'
$status = Join-Path $env:TEMP 'darko-subrm-install-status.txt'
Set-Content -LiteralPath $status -Value '2|Preparando...' -Encoding UTF8

# esconde a janela de console (so a UI bonita aparece)
try {
  Add-Type -Name W -Namespace Win -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'
  [Win.W]::ShowWindow([Win.W]::GetConsoleWindow(),0) | Out-Null
} catch {}

# ---- WORKER: roda em job, escreve "PCT|MSG" / "DONE|tok" / "ERR|msg" ----
$workSrc = @'
param($src,$dst,$pyVer,$status)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# pip imprime warnings com prefixo "ERROR:" no stderr (resolver
# warnings, etc) que NAO sao erros fatais - eles tem exit code 0.
# Em PS 7+ ($PSNativeCommandUseErrorActionPreference=true), isso
# vira exception. Desligamos pra usar exit code como verdade.
try { $PSNativeCommandUseErrorActionPreference = $false } catch {}
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
function St($p,$m){ Set-Content -LiteralPath $status -Value ("$p|$m") -Encoding UTF8 }

# Helper: escapa um argumento pra linha de comando do cmd.
function Q { param([string]$s) '"' + ($s -replace '"', '""') + '"' }

# Roda comando via arquivo .bat temporario que faz redirect OS-level.
# Sem buffer de PowerShell, sem deadlock, sem problema de aspas
# (cmd /c "..." come a primeira aspa, .bat nao tem esse bug).
# Start-Process -NoNewWindow -RedirectStandardOutput trava em deadlock
# quando o stdout enche enquanto o parent esta em WaitForExit (bug
# conhecido do .NET Framework no Windows).
function Invoke-Cmd {
  param([string]$Exe, [string[]]$ExeArgs, [string]$Label='cmd')
  $logOut = Join-Path $env:TEMP ('darko-' + $Label + '.out')
  $logErr = Join-Path $env:TEMP ('darko-' + $Label + '.err')
  $batPath = Join-Path $env:TEMP ('darko-' + $Label + '.bat')
  # monta linha do comando, com escape de aspas em paths
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
  $allArgs = @('-m','pip','install',
               '--no-warn-script-location','--disable-pip-version-check',
               '--prefer-binary','--no-cache-dir') + $Pkgs
  Invoke-Cmd $Py $allArgs 'pip'
}

function Invoke-Py {
  param([string]$Py, [string[]]$PyArgs, [string]$Label='python')
  Invoke-Cmd $Py $PyArgs $Label
}
try {
  St 2 'Verificando instalacao atual...'
  # Mata server.py anterior, se houver
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match 'DarkoSubtitleRemoverApp.*server\.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  # Detecta o que ja existe
  $hasPython = Test-Path (Join-Path $dst 'python\python.exe')
  $hasPip = Test-Path (Join-Path $dst 'python\Lib\site-packages\pip')
  $hasDeps = Test-Path (Join-Path $dst 'python\Lib\site-packages\simple_lama_inpainting')
  $hasFFmpeg = (Test-Path (Join-Path $dst 'bin\ffmpeg.exe')) -and ((Get-Item (Join-Path $dst 'bin\ffmpeg.exe') -ErrorAction SilentlyContinue).Length -gt 10MB)
  $fullyInstalled = $hasPython -and $hasPip -and $hasDeps -and $hasFFmpeg

  if ($fullyInstalled) {
    St 5 'Ja instalado. Atualizando codigo do motor...'
  } else {
    $partial = $hasPython -or $hasPip -or $hasDeps -or $hasFFmpeg
    if ($partial) {
      $faltam = @()
      if (-not $hasPython) { $faltam += 'Python' }
      if (-not $hasPip) { $faltam += 'pip' }
      if (-not $hasDeps) { $faltam += 'IA+deps' }
      if (-not $hasFFmpeg) { $faltam += 'ffmpeg' }
      St 3 ('Instalacao parcial. Continuando: ' + ($faltam -join ', '))
    } else {
      St 3 'Preparando instalacao do zero...'
    }
  }

  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null

  # Copia os arquivos estaticos do pacote pro destino (sempre — pode
  # ter atualizado server.py/pipeline.py mesmo se motor ja instalado)
  Copy-Item (Join-Path $src 'server.py') $dst -Force
  Copy-Item (Join-Path $src 'pipeline.py') $dst -Force
  Copy-Item (Join-Path $src 'sttn_engine.py') $dst -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $src 'DarkoSubtitleRemover.cmd') $dst -Force
  Copy-Item (Join-Path $src 'Desinstalar.ps1') $dst -Force
  Copy-Item (Join-Path $src 'Codigo.ps1') $dst -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $src 'CODIGO.cmd') $dst -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $src 'LEIA-ME.txt') $dst -Force -ErrorAction SilentlyContinue
  # STTN module + modelo treinado (~66 MB, qualidade Vmake)
  if (Test-Path (Join-Path $src 'sttn')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $dst 'sttn') | Out-Null
    Copy-Item (Join-Path $src 'sttn\*') (Join-Path $dst 'sttn') -Recurse -Force -ErrorAction SilentlyContinue
  }

  $tmp = Join-Path $env:TEMP ('darko-subrm-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  # ---- Deteccao de GPU NVIDIA pra escolher torch CUDA ----
  $hasNvidia = $false
  try {
    $nv = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'NVIDIA' -and $_.Name -notmatch 'NVS' }
    if ($nv) { $hasNvidia = $true }
  } catch {}

  # ---- 1) Python 3.11 embeddable ----
  $py = Join-Path $dst 'python\python.exe'
  if (-not (Test-Path $py)) {
    St 8 'Baixando o Python...'
    $pz = Join-Path $tmp 'python.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$pyVer/python-$pyVer-embed-amd64.zip" -OutFile $pz
    St 14 'Preparando o Python...'
    New-Item -ItemType Directory -Force -Path (Join-Path $dst 'python') | Out-Null
    Expand-Archive -LiteralPath $pz -DestinationPath (Join-Path $dst 'python') -Force
    # habilita import site no python311._pth (pra o pip enxergar site-packages)
    $pth = Get-ChildItem (Join-Path $dst 'python') -Filter 'python*._pth' | Select-Object -First 1
    if ($pth) {
      $c = Get-Content $pth.FullName
      $c = $c | ForEach-Object { if ($_ -match '^\s*#import site\s*$') { 'import site' } else { $_ } }
      if (-not ($c -match '^import site\s*$')) { $c += 'import site' }
      Set-Content -LiteralPath $pth.FullName -Value $c -Encoding ASCII
    }
  } else {
    St 15 'Python ja instalado (pulando).'
  }

  # ---- 2) pip via get-pip.py (com redirect pra nao travar buffer) ----
  $pipMarker = Join-Path $dst 'python\Lib\site-packages\pip'
  if (-not (Test-Path $pipMarker)) {
    St 18 'Instalando o pip...'
    $gp = Join-Path $tmp 'get-pip.py'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $gp
    Invoke-Py $py @($gp,'--no-warn-script-location') 'getpip'
  } else {
    St 22 'pip ja instalado (pulando).'
  }

  # ---- 3) deps Python - UMA CHAMADA pip pra acelerar resolver ----
  # Pip baixa todos os wheels em paralelo numa mesma sessao HTTP e
  # resolve dependencias uma so vez (vs 3 chamadas sequenciais).
  # --prefer-binary forca wheels (sem compilacao de source code).
  # --no-cache-dir evita IO desnecessario no Local AppData.
  $marker = Join-Path $dst 'python\Lib\site-packages\simple_lama_inpainting'
  if (-not (Test-Path $marker)) {
    if ($hasNvidia) {
      St 25 'GPU NVIDIA detectada! Baixando IA + CUDA (~2 GB, 7-10 min, 10x mais rapido depois)...'
      # torch CUDA 12.1 — ~10-25x mais rapido em GPU vs CPU
      Invoke-Pip $py @(
        'fastapi==0.115.6', 'uvicorn[standard]==0.32.1', 'python-multipart==0.0.20',
        'opencv-python==4.10.0.84', 'numpy==1.26.4', 'Pillow==9.5.0',
        'paddlepaddle==2.6.2', 'paddleocr==2.8.1',
        '--extra-index-url', 'https://download.pytorch.org/whl/cu121',
        'torch==2.4.1', 'simple-lama-inpainting==0.1.2'
      )
    } else {
      St 25 'Sem GPU NVIDIA. Baixando IA modo CPU (~500 MB, 4-7 min)...'
      Invoke-Pip $py @(
        'fastapi==0.115.6', 'uvicorn[standard]==0.32.1', 'python-multipart==0.0.20',
        'opencv-python==4.10.0.84', 'numpy==1.26.4', 'Pillow==9.5.0',
        'paddlepaddle==2.6.2', 'paddleocr==2.8.1',
        'torch==2.4.1', 'simple-lama-inpainting==0.1.2'
      )
    }
    St 75 'Componentes instalados.'
  } else {
    St 78 'IA + dependencias ja instaladas (pulando download).'
  }

  # ---- 4) ffmpeg.exe ----
  $ff = Join-Path $dst 'bin\ffmpeg.exe'
  if (-not (Test-Path $ff) -or (Get-Item $ff).Length -lt 10MB) {
    St 80 'Baixando o conversor de midia...'
    $fz = Join-Path $tmp 'ff.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz
    Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
    $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
    Copy-Item $fe.FullName $ff -Force
  } else {
    St 88 'ffmpeg ja instalado (pulando).'
  }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

  St 90 'Configurando inicializacao...'
  $vbs = Join-Path $dst 'run-hidden.vbs'
  $vbsContent = "Set s = CreateObject(""WScript.Shell"")" + [char]13 + [char]10 + "d = CreateObject(""Scripting.FileSystemObject"").GetParentFolderName(WScript.ScriptFullName)" + [char]13 + [char]10 + "s.Run ""cmd /c """""" & d & ""\DarkoSubtitleRemover.cmd"""""", 0, False"
  Set-Content -LiteralPath $vbs -Value $vbsContent -Encoding ASCII
  $startup = [Environment]::GetFolderPath('Startup')
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut((Join-Path $startup 'DarkoLab Subtitle Remover.lnk'))
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $dst
  $lnk.Save()

  # atalho no Menu Iniciar pra rever o codigo quando quiser
  try {
    $progs = [Environment]::GetFolderPath('Programs')
    $lc = $wsh.CreateShortcut((Join-Path $progs 'DarkoLab Subtitle Remover - Codigo.lnk'))
    $lc.TargetPath = 'powershell.exe'
    $lc.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dst 'Codigo.ps1') + '"'
    $lc.WorkingDirectory = $dst
    $lc.Save()
  } catch {}

  St 95 'Iniciando o motor...'
  Remove-Item (Join-Path $dst 'engine.log') -ErrorAction SilentlyContinue
  Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden

  # Zero-config: nao precisa capturar token nenhum, so confirmar que
  # o motor subiu (linha JSON "event":"ready" no engine.log).
  $ready = $false
  for ($i=0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 800
    $log = Get-Content (Join-Path $dst 'engine.log') -Raw -ErrorAction SilentlyContinue
    if ($log -and $log -match '"event"\s*:\s*"ready"') {
      $ready = $true; break
    }
  }

  if ($ready) {
    Set-Content -LiteralPath $status -Value 'DONE|' -Encoding UTF8
  } else {
    Set-Content -LiteralPath $status -Value ("ERR|O motor nao confirmou o start. Log: " + (Join-Path $dst 'engine.log')) -Encoding UTF8
  }
} catch {
  Set-Content -LiteralPath $status -Value ("ERR|" + $_.Exception.Message) -Encoding UTF8
}
'@

$job = Start-Job -ScriptBlock ([scriptblock]::Create($workSrc)) -ArgumentList $src,$dst,'3.11.9',$status

# ----------------------------- UI (DARKO) -----------------------------
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $BG=[Drawing.Color]::FromArgb(11,13,12)
  $CARD=[Drawing.Color]::FromArgb(20,24,22)
  $LIME=[Drawing.Color]::FromArgb(200,255,0)
  $TXT=[Drawing.Color]::FromArgb(232,234,233)
  $MUT=[Drawing.Color]::FromArgb(138,143,139)

  $f=New-Object Windows.Forms.Form
  $f.FormBorderStyle='None'; $f.StartPosition='CenterScreen'
  $f.Size=New-Object Drawing.Size(520,300); $f.BackColor=$BG; $f.TopMost=$true
  $f.ShowInTaskbar=$true; $f.Text='DarkoLab Subtitle Remover'

  $accent=New-Object Windows.Forms.Panel
  $accent.Size=New-Object Drawing.Size(520,4); $accent.Location=New-Object Drawing.Point(0,0)
  $accent.BackColor=$LIME; $f.Controls.Add($accent)

  $brand=New-Object Windows.Forms.Label
  $brand.Text='DARKO LAB'; $brand.ForeColor=$LIME
  $brand.Font=New-Object Drawing.Font('Segoe UI',15,[Drawing.FontStyle]::Bold)
  $brand.AutoSize=$true; $brand.Location=New-Object Drawing.Point(34,34); $f.Controls.Add($brand)

  $sub=New-Object Windows.Forms.Label
  $sub.Text='Remover Legenda - instalacao'; $sub.ForeColor=$MUT
  $sub.Font=New-Object Drawing.Font('Segoe UI',9); $sub.AutoSize=$true
  $sub.Location=New-Object Drawing.Point(36,64); $f.Controls.Add($sub)

  $st=New-Object Windows.Forms.Label
  $st.Text='Instalando...'; $st.ForeColor=$TXT
  $st.Font=New-Object Drawing.Font('Segoe UI',13,[Drawing.FontStyle]::Bold)
  $st.AutoSize=$false; $st.Size=New-Object Drawing.Size(452,28)
  $st.Location=New-Object Drawing.Point(34,118); $f.Controls.Add($st)

  $track=New-Object Windows.Forms.Panel
  $track.Size=New-Object Drawing.Size(452,10); $track.Location=New-Object Drawing.Point(34,160)
  $track.BackColor=$CARD; $f.Controls.Add($track)
  $fill=New-Object Windows.Forms.Panel
  $fill.Size=New-Object Drawing.Size(0,10); $fill.Location=New-Object Drawing.Point(0,0)
  $fill.BackColor=$LIME; $track.Controls.Add($fill)

  $hint=New-Object Windows.Forms.Label
  $hint.Text='Baixando o necessario na 1a vez (~600 MB). Pode levar 5-8 min.'
  $hint.ForeColor=$MUT; $hint.Font=New-Object Drawing.Font('Segoe UI',8)
  $hint.AutoSize=$false; $hint.Size=New-Object Drawing.Size(452,20)
  $hint.Location=New-Object Drawing.Point(34,182); $f.Controls.Add($hint)

  $btnClose=New-Object Windows.Forms.Button
  $btnClose.Text='Fechar'; $btnClose.FlatStyle='Flat'
  $btnClose.BackColor=$LIME; $btnClose.ForeColor=$BG
  $btnClose.FlatAppearance.BorderSize=0
  $btnClose.Font=New-Object Drawing.Font('Segoe UI',9,[Drawing.FontStyle]::Bold)
  $btnClose.Size=New-Object Drawing.Size(452,34); $btnClose.Location=New-Object Drawing.Point(34,200)
  $btnClose.Visible=$false; $f.Controls.Add($btnClose)

  $btnClose.Add_Click({ $f.Close() })

  # arrastar a janela (sem borda)
  $script:drag=$false; $script:dx=0; $script:dy=0
  $down={ $script:drag=$true; $script:dx=[Windows.Forms.Cursor]::Position.X-$f.Left; $script:dy=[Windows.Forms.Cursor]::Position.Y-$f.Top }
  $move={ if($script:drag){ $f.Left=[Windows.Forms.Cursor]::Position.X-$script:dx; $f.Top=[Windows.Forms.Cursor]::Position.Y-$script:dy } }
  $up={ $script:drag=$false }
  $f.Add_MouseDown($down); $f.Add_MouseMove($move); $f.Add_MouseUp($up)
  $brand.Add_MouseDown($down); $brand.Add_MouseMove($move); $brand.Add_MouseUp($up)

  # Path do log do pip pra heartbeat enquanto baixa as deps gigantes
  $script:pipLogPath = Join-Path $env:TEMP 'darko-pip.out'
  $script:pipPhaseStart = $null  # quando o status virou "25"

  $script:spin=0
  $tmr=New-Object Windows.Forms.Timer
  $tmr.Interval=400
  $tmr.Add_Tick({
    $line=$null
    try { $line=(Get-Content -LiteralPath $status -Raw -ErrorAction Stop).Trim() } catch {}
    if (-not $line) { return }
    $k=$line.Split('|',2)
    if ($k[0] -eq 'DONE') {
      $tmr.Stop()
      $fill.Width=$track.Width
      $st.Text='Pronto pra usar!'
      $hint.Text='Abra o DarkoLab no navegador. A ferramenta ja conectou sozinha - sem precisar de codigo.'
      $btnClose.Visible=$true
    } elseif ($k[0] -eq 'ERR') {
      $tmr.Stop()
      $st.Text='Falhou'
      $st.ForeColor=[Drawing.Color]::FromArgb(255,107,107)
      $hint.Text=$k[1]
      $btnClose.Visible=$true
    } else {
      $p=0; [int]::TryParse($k[0],[ref]$p) | Out-Null
      # Fase pesada do pip: o worker fica em 25 enquanto pip baixa
      # ~500MB. A UI vai animando 25->70 ao longo de 6 min + lendo o
      # log do pip pra mostrar pacote sendo baixado em tempo real.
      if ($p -eq 25) {
        if (-not $script:pipPhaseStart) { $script:pipPhaseStart = Get-Date }
        $elapsed = ((Get-Date) - $script:pipPhaseStart).TotalSeconds
        # 6 min = 360s linear de 25 a 70
        $p = [int](25 + [Math]::Min(45, $elapsed / 8.0))
        # tenta ler o log do pip pra mensagem dinamica
        $pkg = ''
        try {
          if (Test-Path $script:pipLogPath) {
            $tail = Get-Content $script:pipLogPath -Tail 5 -ErrorAction Stop
            $found = $tail | Where-Object { $_ -match '^(Downloading|Collecting|Installing\s+collected)' } | Select-Object -Last 1
            if ($found) {
              if ($found -match '^Downloading\s+(\S+?)-') { $pkg = 'Baixando ' + $Matches[1] + '...' }
              elseif ($found -match '^Downloading\s+(\S+)') { $pkg = 'Baixando ' + $Matches[1].Split('/')[-1] + '...' }
              elseif ($found -match '^Collecting\s+(\S+)') { $pkg = 'Coletando ' + $Matches[1] + '...' }
              elseif ($found -match '^Installing\s+collected') { $pkg = 'Instalando wheels baixados...' }
            }
          }
        } catch {}
        if ($pkg) { $k = @('', $pkg) } else { $k = @('', $k[1]) }
      } else {
        $script:pipPhaseStart = $null
      }
      $tw=[int]($track.Width * ([Math]::Max(2,[Math]::Min(100,$p)) / 100.0))
      if ($fill.Width -lt $tw) { $fill.Width=$tw }
      $dots='.' * (1 + ($script:spin % 3))
      $msg= if($k.Count -gt 1){ $k[1] } else { 'Instalando' }
      $st.Text = $msg.TrimEnd('.') + $dots
      $script:spin++
    }
  })
  $tmr.Start()
  $f.Add_FormClosing({ try{ $tmr.Stop() }catch{}; try{ Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue }catch{} })
  [Windows.Forms.Application]::EnableVisualStyles()
  [void]$f.ShowDialog()
} catch {
  # fallback: sem GUI -> espera o job e mostra no console
  try { [Win.W]::ShowWindow([Win.W]::GetConsoleWindow(),5) | Out-Null } catch {}
  Write-Host 'Instalando DarkoLab Subtitle Remover (sem interface)...'
  Wait-Job $job | Out-Null
  $line=(Get-Content -LiteralPath $status -Raw -ErrorAction SilentlyContinue)
  if ($line -match '^DONE') {
    Write-Host ''
    Write-Host 'INSTALADO. O motor ja esta rodando.'
    Write-Host 'Abra o DarkoLab > Remover Legenda. A pagina conecta sozinha.'
  } else {
    Write-Host ('Falhou: ' + $line)
  }
  Read-Host 'Enter para sair'
}
