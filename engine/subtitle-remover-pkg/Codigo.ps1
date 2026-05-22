# Mostra status do motor e a porta numa janela DARKO.
# Versao 1.2 — zero-config, sem codigo de pareamento. Esta tela
# agora so existe pra diagnostico (ver se o motor ta rodando).
$ErrorActionPreference = 'SilentlyContinue'
try {
  Add-Type -Name W -Namespace Win -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'
  [Win.W]::ShowWindow([Win.W]::GetConsoleWindow(),0) | Out-Null
} catch {}

# descobre porta viva
$port = $null
foreach ($p in @(8765,8766,8767,8768,8769)) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$p/health" -TimeoutSec 2
    if ($r.Content -match 'darko-subtitle-remover') { $port=$p; break }
  } catch {}
}

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
$f.Size=New-Object Drawing.Size(500,260); $f.BackColor=$BG; $f.TopMost=$true
$f.Text='DarkoLab Subtitle Remover - Status'

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

$big=New-Object Windows.Forms.Label
$big.ForeColor=$LIME; $big.Font=New-Object Drawing.Font('Segoe UI',16,[Drawing.FontStyle]::Bold)
$big.AutoSize=$false; $big.Size=New-Object Drawing.Size(440,36)
$big.Location=New-Object Drawing.Point(32,90); $big.TextAlign='MiddleCenter'
$f.Controls.Add($big)

$pl=New-Object Windows.Forms.Label
$pl.ForeColor=$TXT; $pl.Font=New-Object Drawing.Font('Segoe UI',9)
$pl.AutoSize=$false; $pl.Size=New-Object Drawing.Size(440,40)
$pl.Location=New-Object Drawing.Point(32,135); $pl.TextAlign='MiddleCenter'
$f.Controls.Add($pl)

$btnX=New-Object Windows.Forms.Button
$btnX.Text='Fechar'; $btnX.FlatStyle='Flat'
$btnX.BackColor=$LIME; $btnX.ForeColor=$BG
$btnX.FlatAppearance.BorderSize=0
$btnX.Font=New-Object Drawing.Font('Segoe UI',9,[Drawing.FontStyle]::Bold)
$btnX.Size=New-Object Drawing.Size(440,34); $btnX.Location=New-Object Drawing.Point(32,190)
$f.Controls.Add($btnX)

if ($port) {
  $lbl.Text='Status do motor'
  $big.Text='ONLINE'
  $big.ForeColor=$LIME
  $pl.Text="Porta: $port`nAbra o DarkoLab > Remover Legenda. Conecta sozinho."
} else {
  $lbl.Text='Status do motor'
  $big.Text='OFFLINE'
  $big.ForeColor=$ERR
  $pl.Text='O motor nao esta rodando. Reabra pelo atalho do Menu Iniciar.'
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
