# DarkoLab Subtitle Remover - Desinstalador com GUI Darko.
# Mata o motor, remove app + config + atalhos. Mostra progresso em
# uma janela WinForms estilo Darko (espelha o instalador).
$ErrorActionPreference = 'Continue'

# esconde a janela de console (so a UI bonita aparece)
try {
  Add-Type -Name W -Namespace Win -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'
  [Win.W]::ShowWindow([Win.W]::GetConsoleWindow(),0) | Out-Null
} catch {}

$status = Join-Path $env:TEMP 'darko-subrm-uninstall-status.txt'
Set-Content -LiteralPath $status -Value '2|Preparando...' -Encoding UTF8

# ---- WORKER ----
$workSrc = @'
param($status)
$ErrorActionPreference = 'Continue'
function St($p,$m){ Set-Content -LiteralPath $status -Value ("$p|$m") -Encoding UTF8 }
try {
  St 10 'Parando o motor em execucao...'
  # mata processos python.exe / pythonw.exe rodando server.py do nosso dst
  $dst = Join-Path $env:LOCALAPPDATA 'DarkoSubtitleRemoverApp'
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match [regex]::Escape($dst)) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  # fallback: mata qualquer python rodando server.py (mesmo que fora do dst)
  Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -match 'DarkoSubtitleRemover') } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500

  St 30 'Removendo atalhos...'
  $startup = [Environment]::GetFolderPath('Startup')
  Remove-Item (Join-Path $startup 'DarkoLab Subtitle Remover.lnk') -Force -ErrorAction SilentlyContinue
  $progs = [Environment]::GetFolderPath('Programs')
  Remove-Item (Join-Path $progs 'DarkoLab Subtitle Remover - Codigo.lnk') -Force -ErrorAction SilentlyContinue

  St 50 'Removendo o motor (Python + IA + ffmpeg)...'
  if (Test-Path $dst) {
    Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
    # 2a tentativa se algo trancou
    if (Test-Path $dst) {
      Start-Sleep -Milliseconds 800
      Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
    }
  }

  St 85 'Removendo configuracao...'
  $cfg = Join-Path $env:LOCALAPPDATA 'DarkoSubtitleRemover'
  Remove-Item $cfg -Recurse -Force -ErrorAction SilentlyContinue

  St 95 'Limpando temporarios...'
  Get-ChildItem $env:TEMP -Filter 'darko-subrm-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

  # Verifica se sobrou alguma coisa
  $remaining = @()
  if (Test-Path $dst) { $remaining += "pasta do motor" }
  if (Test-Path $cfg) { $remaining += "config" }
  if ($remaining.Count -gt 0) {
    Set-Content -LiteralPath $status -Value ("ERR|Restou: " + ($remaining -join ', ') + ". Algum arquivo esta em uso. Reinicie o PC e tente de novo.") -Encoding UTF8
  } else {
    Set-Content -LiteralPath $status -Value 'DONE|' -Encoding UTF8
  }
} catch {
  Set-Content -LiteralPath $status -Value ("ERR|" + $_.Exception.Message) -Encoding UTF8
}
'@

$job = Start-Job -ScriptBlock ([scriptblock]::Create($workSrc)) -ArgumentList $status

# ---- UI ----
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $BG=[Drawing.Color]::FromArgb(11,13,12)
  $CARD=[Drawing.Color]::FromArgb(20,24,22)
  $LIME=[Drawing.Color]::FromArgb(200,255,0)
  $TXT=[Drawing.Color]::FromArgb(232,234,233)
  $MUT=[Drawing.Color]::FromArgb(138,143,139)
  $ERR=[Drawing.Color]::FromArgb(255,107,107)

  $f=New-Object Windows.Forms.Form
  $f.FormBorderStyle='None'; $f.StartPosition='CenterScreen'
  $f.Size=New-Object Drawing.Size(520,280); $f.BackColor=$BG; $f.TopMost=$true
  $f.ShowInTaskbar=$true; $f.Text='DarkoLab Subtitle Remover - Desinstalar'

  $accent=New-Object Windows.Forms.Panel
  $accent.Size=New-Object Drawing.Size(520,4); $accent.Location=New-Object Drawing.Point(0,0)
  $accent.BackColor=$LIME; $f.Controls.Add($accent)

  $brand=New-Object Windows.Forms.Label
  $brand.Text='DARKO LAB'; $brand.ForeColor=$LIME
  $brand.Font=New-Object Drawing.Font('Segoe UI',15,[Drawing.FontStyle]::Bold)
  $brand.AutoSize=$true; $brand.Location=New-Object Drawing.Point(34,30); $f.Controls.Add($brand)

  $sub=New-Object Windows.Forms.Label
  $sub.Text='Remover Legenda - desinstalacao'; $sub.ForeColor=$MUT
  $sub.Font=New-Object Drawing.Font('Segoe UI',9); $sub.AutoSize=$true
  $sub.Location=New-Object Drawing.Point(36,60); $f.Controls.Add($sub)

  $st=New-Object Windows.Forms.Label
  $st.Text='Desinstalando...'; $st.ForeColor=$TXT
  $st.Font=New-Object Drawing.Font('Segoe UI',13,[Drawing.FontStyle]::Bold)
  $st.AutoSize=$false; $st.Size=New-Object Drawing.Size(452,28)
  $st.Location=New-Object Drawing.Point(34,110); $f.Controls.Add($st)

  $track=New-Object Windows.Forms.Panel
  $track.Size=New-Object Drawing.Size(452,10); $track.Location=New-Object Drawing.Point(34,152)
  $track.BackColor=$CARD; $f.Controls.Add($track)
  $fill=New-Object Windows.Forms.Panel
  $fill.Size=New-Object Drawing.Size(0,10); $fill.Location=New-Object Drawing.Point(0,0)
  $fill.BackColor=$LIME; $track.Controls.Add($fill)

  $hint=New-Object Windows.Forms.Label
  $hint.Text='Removendo motor, atalhos e configuracoes.'
  $hint.ForeColor=$MUT; $hint.Font=New-Object Drawing.Font('Segoe UI',8)
  $hint.AutoSize=$false; $hint.Size=New-Object Drawing.Size(452,30)
  $hint.Location=New-Object Drawing.Point(34,172); $f.Controls.Add($hint)

  $btnClose=New-Object Windows.Forms.Button
  $btnClose.Text='Fechar'; $btnClose.FlatStyle='Flat'
  $btnClose.BackColor=$LIME; $btnClose.ForeColor=$BG
  $btnClose.FlatAppearance.BorderSize=0
  $btnClose.Font=New-Object Drawing.Font('Segoe UI',9,[Drawing.FontStyle]::Bold)
  $btnClose.Size=New-Object Drawing.Size(452,34); $btnClose.Location=New-Object Drawing.Point(34,210)
  $btnClose.Visible=$false; $f.Controls.Add($btnClose)
  $btnClose.Add_Click({ $f.Close() })

  # arrastar a janela (sem borda)
  $script:drag=$false; $script:dx=0; $script:dy=0
  $down={ $script:drag=$true; $script:dx=[Windows.Forms.Cursor]::Position.X-$f.Left; $script:dy=[Windows.Forms.Cursor]::Position.Y-$f.Top }
  $move={ if($script:drag){ $f.Left=[Windows.Forms.Cursor]::Position.X-$script:dx; $f.Top=[Windows.Forms.Cursor]::Position.Y-$script:dy } }
  $up={ $script:drag=$false }
  $f.Add_MouseDown($down); $f.Add_MouseMove($move); $f.Add_MouseUp($up)
  $brand.Add_MouseDown($down); $brand.Add_MouseMove($move); $brand.Add_MouseUp($up)

  $script:spin=0
  $tmr=New-Object Windows.Forms.Timer
  $tmr.Interval=160
  $tmr.Add_Tick({
    $line=$null
    try { $line=(Get-Content -LiteralPath $status -Raw -ErrorAction Stop).Trim() } catch {}
    if (-not $line) { return }
    $k=$line.Split('|',2)
    if ($k[0] -eq 'DONE') {
      $tmr.Stop()
      $fill.Width=$track.Width
      $st.Text='Desinstalado!'
      $hint.Text='Motor, atalhos e configuracao foram removidos do sistema.'
      $btnClose.Visible=$true
    } elseif ($k[0] -eq 'ERR') {
      $tmr.Stop()
      $st.Text='Falhou'
      $st.ForeColor=$ERR
      $hint.Text=$k[1]
      $btnClose.Visible=$true
    } else {
      $p=0; [int]::TryParse($k[0],[ref]$p) | Out-Null
      $tw=[int]($track.Width * ([Math]::Max(2,[Math]::Min(100,$p)) / 100.0))
      if ($fill.Width -lt $tw) { $fill.Width=$tw }
      $dots='.' * (1 + ($script:spin % 3))
      $msg= if($k.Count -gt 1){ $k[1] } else { 'Desinstalando' }
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
  Write-Host 'Desinstalando DarkoLab Subtitle Remover (sem interface)...'
  Wait-Job $job | Out-Null
  $line=(Get-Content -LiteralPath $status -Raw -ErrorAction SilentlyContinue)
  if ($line -match '^DONE') {
    Write-Host 'OK - motor removido.'
  } else {
    Write-Host ('Falhou: ' + $line)
  }
  Read-Host 'Enter para sair'
}
