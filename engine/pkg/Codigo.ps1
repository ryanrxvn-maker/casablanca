# Mostra o codigo de pareamento (e a porta) numa janela DARKO.
$ErrorActionPreference = 'SilentlyContinue'
try {
  Add-Type -Name W -Namespace Win -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'
  [Win.W]::ShowWindow([Win.W]::GetConsoleWindow(),0) | Out-Null
} catch {}

$cfgPath = Join-Path $env:LOCALAPPDATA 'DarkoDownloader\config.json'
$tok=''; $port=47923
if (Test-Path $cfgPath) {
  try {
    $c = Get-Content $cfgPath -Raw | ConvertFrom-Json
    $tok = "$($c.token)"; $port = $c.port
  } catch {}
}
# descobre a porta viva (pode ter migrado de 47923)
foreach ($p in @($port,47923,47924,47925,47926,47927,47928)) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$p/health" -TimeoutSec 2
    if ($r.Content -match 'darkolab-downloader-engine') { $port=$p; break }
  } catch {}
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$BG=[Drawing.Color]::FromArgb(11,13,12)
$CARD=[Drawing.Color]::FromArgb(20,24,22)
$LIME=[Drawing.Color]::FromArgb(200,255,0)
$TXT=[Drawing.Color]::FromArgb(232,234,233)
$MUT=[Drawing.Color]::FromArgb(138,143,139)

$f=New-Object Windows.Forms.Form
$f.FormBorderStyle='None'; $f.StartPosition='CenterScreen'
$f.Size=New-Object Drawing.Size(500,260); $f.BackColor=$BG; $f.TopMost=$true
$f.Text='DarkoLab Downloader - Codigo'

$accent=New-Object Windows.Forms.Panel
$accent.Size=New-Object Drawing.Size(500,4); $accent.Location=New-Object Drawing.Point(0,0)
$accent.BackColor=$LIME; $f.Controls.Add($accent)

$brand=New-Object Windows.Forms.Label
$brand.Text='DARKO LAB'; $brand.ForeColor=$LIME
$brand.Font=New-Object Drawing.Font('Segoe UI',14,[Drawing.FontStyle]::Bold)
$brand.AutoSize=$true; $brand.Location=New-Object Drawing.Point(30,28); $f.Controls.Add($brand)

$lbl=New-Object Windows.Forms.Label
$lbl.ForeColor=$MUT; $lbl.Font=New-Object Drawing.Font('Segoe UI',9)
$lbl.AutoSize=$false; $lbl.Size=New-Object Drawing.Size(440,20)
$lbl.Location=New-Object Drawing.Point(32,62); $f.Controls.Add($lbl)

$box=New-Object Windows.Forms.TextBox
$box.ReadOnly=$true; $box.BorderStyle='FixedSingle'
$box.BackColor=$CARD; $box.ForeColor=$LIME; $box.TextAlign='Center'
$box.Font=New-Object Drawing.Font('Consolas',11,[Drawing.FontStyle]::Bold)
$box.Size=New-Object Drawing.Size(436,30); $box.Location=New-Object Drawing.Point(32,92)
$f.Controls.Add($box)

$pl=New-Object Windows.Forms.Label
$pl.ForeColor=$TXT; $pl.Font=New-Object Drawing.Font('Segoe UI',9)
$pl.AutoSize=$true; $pl.Location=New-Object Drawing.Point(32,132); $f.Controls.Add($pl)

$btnC=New-Object Windows.Forms.Button
$btnC.Text='Copiar codigo'; $btnC.FlatStyle='Flat'
$btnC.BackColor=$LIME; $btnC.ForeColor=$BG
$btnC.FlatAppearance.BorderSize=0
$btnC.Font=New-Object Drawing.Font('Segoe UI',9,[Drawing.FontStyle]::Bold)
$btnC.Size=New-Object Drawing.Size(150,34); $btnC.Location=New-Object Drawing.Point(32,170)
$f.Controls.Add($btnC)

$btnX=New-Object Windows.Forms.Button
$btnX.Text='Fechar'; $btnX.FlatStyle='Flat'
$btnX.BackColor=$CARD; $btnX.ForeColor=$TXT
$btnX.FlatAppearance.BorderColor=$MUT
$btnX.Font=New-Object Drawing.Font('Segoe UI',9)
$btnX.Size=New-Object Drawing.Size(110,34); $btnX.Location=New-Object Drawing.Point(358,170)
$f.Controls.Add($btnX)

if ($tok) {
  $lbl.Text='Codigo de pareamento (cole na extensao):'
  $box.Text=$tok
  $pl.Text=("Porta: " + $port + "   (a extensao detecta sozinha - deixe 47923)")
  try { [Windows.Forms.Clipboard]::SetText($tok) } catch {}
  $btnC.Add_Click({ try { [Windows.Forms.Clipboard]::SetText($tok); $btnC.Text='Copiado!' } catch {} })
} else {
  $lbl.Text='Motor ainda nao instalado/iniciado.'
  $box.Text='--- rode o INSTALAR.cmd primeiro ---'
  $pl.Text=''
  $btnC.Enabled=$false
}
$btnX.Add_Click({ $f.Close() })

# arrastar
$script:drag=$false; $script:dx=0; $script:dy=0
$dn={ $script:drag=$true; $script:dx=[Windows.Forms.Cursor]::Position.X-$f.Left; $script:dy=[Windows.Forms.Cursor]::Position.Y-$f.Top }
$mv={ if($script:drag){ $f.Left=[Windows.Forms.Cursor]::Position.X-$script:dx; $f.Top=[Windows.Forms.Cursor]::Position.Y-$script:dy } }
$f.Add_MouseDown($dn); $f.Add_MouseMove($mv); $f.Add_MouseUp({ $script:drag=$false })
$brand.Add_MouseDown($dn); $brand.Add_MouseMove($mv)

[Windows.Forms.Application]::EnableVisualStyles()
[void]$f.ShowDialog()
