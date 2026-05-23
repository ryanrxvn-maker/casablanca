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
      'rem abre a janela do instalador (UI DARKO) sem mostrar console',
      'start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0Instalar.ps1"',
      'exit',
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

  log('compilando DarkoDownloaderSetup.exe (csc.exe)...');
  const exeOut = path.join(here, 'DarkoDownloaderSetup.exe');
  rmSync(exeOut, { force: true });
  // /resource:zip,DarkoLab.pkg.zip -> nome lido pelo Setup.cs
  // System.IO.Compression.FileSystem.dll precisa do .NET 4.5+; csc v4
  // aceita referenciar essa DLL (no GAC). System.Windows.Forms pro
  // MessageBox de erro.
  execFileSync(
    csc,
    [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:anycpu',
      `/win32icon:${icoPath}`,
      `/resource:${zipOut},DarkoLab.pkg.zip`,
      '/reference:System.dll',
      '/reference:System.IO.Compression.dll',
      '/reference:System.IO.Compression.FileSystem.dll',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll',
      `/out:${exeOut}`,
      path.join(here, 'installer', 'Setup.cs'),
    ],
    { stdio: 'inherit' },
  );

  log('pronto:');
  log('  -> ' + exeOut + '  (distribuir SO ISSO pro usuario)');
  log('  -> ' + zipOut + '  (zip cru, opcional)');
  log('  -> ' + pkg + '\\   (pasta crua, opcional)');
}

const INSTALAR_PS1 = `
# DarkoLab Downloader — instalador com TELA (design DARKO).
# O trabalho pesado roda num Job de background; a janela WinForms so
# mostra "Instalando...", barra de progresso e, no fim, o codigo.
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
$status = Join-Path $env:TEMP 'darko-install-status.txt'
Set-Content -LiteralPath $status -Value '2|Preparando...' -Encoding UTF8

# esconde a janela de console (so a UI bonita aparece)
try {
  Add-Type -Name W -Namespace Win -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);'
  [Win.W]::ShowWindow([Win.W]::GetConsoleWindow(),0) | Out-Null
} catch {}

# ---- WORKER: roda em job, escreve "PCT|MSG" / "DONE|tok" / "ERR|msg" ----
$workSrc = @'
param($src,$dst,$nodeVer,$status)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
function St($p,$m){ Set-Content -LiteralPath $status -Value ("$p|$m") -Encoding UTF8 }
try {
  St 4 'Preparando...'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server.cjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
  Copy-Item (Join-Path $src 'server.cjs') $dst -Force
  Copy-Item (Join-Path $src 'DarkoDownloader.cmd') $dst -Force
  Copy-Item (Join-Path $src 'Desinstalar.ps1') $dst -Force
  Copy-Item (Join-Path $src 'LEIA-ME.txt') $dst -Force -ErrorAction SilentlyContinue
  $tmp = Join-Path $env:TEMP ('darko-dl-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  if (-not (Test-Path (Join-Path $dst 'node\\node.exe'))) {
    St 12 'Baixando o Node...'
    $nz = Join-Path $tmp 'node.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip" -OutFile $nz
    St 20 'Preparando o Node...'
    Expand-Archive -LiteralPath $nz -DestinationPath $tmp -Force
    $nd = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'node-*win-x64' } | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path (Join-Path $dst 'node') | Out-Null
    Copy-Item (Join-Path $nd.FullName '*') (Join-Path $dst 'node') -Recurse -Force
  }
  $node = Join-Path $dst 'node\\node.exe'
  $npmCli = Join-Path $dst 'node\\node_modules\\npm\\bin\\npm-cli.js'

  if (-not (Test-Path (Join-Path $dst 'node_modules\\playwright'))) {
    St 30 'Instalando componentes...'
    '{ "name": "darko-engine", "private": true }' | Set-Content -Encoding ASCII (Join-Path $dst 'package.json')
    & $node $npmCli install playwright@1.60.0 --omit=dev --no-audit --no-fund --prefix "$dst" 2>&1 | Out-Null
  }
  if (-not (Test-Path (Join-Path $dst 'ms-playwright\\chromium-1223'))) {
    St 45 'Baixando o navegador (a parte maior)...'
    $env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path $dst 'ms-playwright')
    & $node (Join-Path $dst 'node_modules\\playwright\\cli.js') install chromium 2>&1 | Out-Null
  }
  $yt = Join-Path $dst 'bin\\yt-dlp.exe'
  if (-not (Test-Path $yt) -or (Get-Item $yt).Length -lt 5MB) {
    St 78 'Baixando o motor de download...'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt
  }
  $ff = Join-Path $dst 'bin\\ffmpeg.exe'
  if (-not (Test-Path $ff) -or (Get-Item $ff).Length -lt 10MB) {
    St 87 'Baixando o conversor de midia...'
    $fz = Join-Path $tmp 'ff.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz
    Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
    $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
    Copy-Item $fe.FullName $ff -Force
  }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

  St 93 'Configurando inicializacao...'
  $vbs = Join-Path $dst 'run-hidden.vbs'
  $vbsContent = "Set s = CreateObject(""WScript.Shell"")" + [char]13 + [char]10 + "d = CreateObject(""Scripting.FileSystemObject"").GetParentFolderName(WScript.ScriptFullName)" + [char]13 + [char]10 + "s.Run ""cmd /c """""" & d & ""\\DarkoDownloader.cmd"""""", 0, False"
  Set-Content -LiteralPath $vbs -Value $vbsContent -Encoding ASCII
  $startup = [Environment]::GetFolderPath('Startup')
  $wsh = New-Object -ComObject WScript.Shell
  $lnk = $wsh.CreateShortcut((Join-Path $startup 'DarkoLab Downloader.lnk'))
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $dst
  $lnk.Save()

  # (sem atalho de "Codigo" no Menu Iniciar — auto-pair via /pair acabou
  # com a necessidade de o usuario ver/colar o token).

  St 97 'Iniciando o motor...'
  Remove-Item (Join-Path $dst 'engine.log') -ErrorAction SilentlyContinue
  Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
  # Espera o motor subir (ate 40s). Nao mostra mais o token pro usuario:
  # a extensao pega via /pair sozinha. Sucesso = /health respondendo.
  $alive = $false
  for ($i=0; $i -lt 50; $i++) {
    Start-Sleep -Milliseconds 800
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:47923/health' -TimeoutSec 2
      if ($r.Content -match 'darkolab-downloader-engine') { $alive=$true; break }
    } catch {}
    foreach ($p in 47924,47925,47926,47927,47928) {
      try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$p/health" -TimeoutSec 1
        if ($r.Content -match 'darkolab-downloader-engine') { $alive=$true; break }
      } catch {}
    }
    if ($alive) { break }
  }
  if ($alive) {
    Set-Content -LiteralPath $status -Value 'DONE|ok' -Encoding UTF8
  } else {
    Set-Content -LiteralPath $status -Value ("ERR|O motor nao subiu. Log: " + (Join-Path $dst 'engine.log')) -Encoding UTF8
  }
} catch {
  Set-Content -LiteralPath $status -Value ("ERR|" + $_.Exception.Message) -Encoding UTF8
}
'@

$job = Start-Job -ScriptBlock ([scriptblock]::Create($workSrc)) -ArgumentList $src,$dst,'__NODE_VER__',$status

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
  $f.ShowInTaskbar=$true; $f.Text='DarkoLab Downloader'

  $accent=New-Object Windows.Forms.Panel
  $accent.Size=New-Object Drawing.Size(520,4); $accent.Location=New-Object Drawing.Point(0,0)
  $accent.BackColor=$LIME; $f.Controls.Add($accent)

  $brand=New-Object Windows.Forms.Label
  $brand.Text='DARKO LAB'; $brand.ForeColor=$LIME
  $brand.Font=New-Object Drawing.Font('Segoe UI',15,[Drawing.FontStyle]::Bold)
  $brand.AutoSize=$true; $brand.Location=New-Object Drawing.Point(34,34); $f.Controls.Add($brand)

  $sub=New-Object Windows.Forms.Label
  $sub.Text='Downloader - instalacao'; $sub.ForeColor=$MUT
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
  $hint.Text='Baixando o necessario na 1a vez (~250 MB). Pode levar 1-2 min.'
  $hint.ForeColor=$MUT; $hint.Font=New-Object Drawing.Font('Segoe UI',8)
  $hint.AutoSize=$false; $hint.Size=New-Object Drawing.Size(452,20)
  $hint.Location=New-Object Drawing.Point(34,182); $f.Controls.Add($hint)

  $code=New-Object Windows.Forms.TextBox
  $code.ReadOnly=$true; $code.BorderStyle='FixedSingle'
  $code.BackColor=$CARD; $code.ForeColor=$LIME; $code.TextAlign='Center'
  $code.Font=New-Object Drawing.Font('Consolas',11,[Drawing.FontStyle]::Bold)
  $code.Size=New-Object Drawing.Size(452,28); $code.Location=New-Object Drawing.Point(34,150)
  $code.Visible=$false; $f.Controls.Add($code)

  $btnCopy=New-Object Windows.Forms.Button
  $btnCopy.Text='Copiar codigo'; $btnCopy.FlatStyle='Flat'
  $btnCopy.BackColor=$LIME; $btnCopy.ForeColor=$BG
  $btnCopy.FlatAppearance.BorderSize=0
  $btnCopy.Font=New-Object Drawing.Font('Segoe UI',9,[Drawing.FontStyle]::Bold)
  $btnCopy.Size=New-Object Drawing.Size(150,34); $btnCopy.Location=New-Object Drawing.Point(34,200)
  $btnCopy.Visible=$false; $f.Controls.Add($btnCopy)

  $btnClose=New-Object Windows.Forms.Button
  $btnClose.Text='Fechar'; $btnClose.FlatStyle='Flat'
  $btnClose.BackColor=$CARD; $btnClose.ForeColor=$TXT
  $btnClose.FlatAppearance.BorderColor=$MUT
  $btnClose.Font=New-Object Drawing.Font('Segoe UI',9)
  $btnClose.Size=New-Object Drawing.Size(110,34); $btnClose.Location=New-Object Drawing.Point(376,200)
  $btnClose.Visible=$false; $f.Controls.Add($btnClose)

  $script:tok=$null
  $btnCopy.Add_Click({ if ($script:tok) { [Windows.Forms.Clipboard]::SetText($script:tok); $btnCopy.Text='Copiado!' } })
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
      $st.Text='Instalado e vinculado!'
      $hint.Text='Pronto. A extensao DarkoLab Downloader ja esta conectada — sem codigos, sem pareamento. Roda toda vez que voce ligar o PC.'
      $btnClose.Visible=$true
    } elseif ($k[0] -eq 'ERR') {
      $tmr.Stop()
      $st.Text='Falhou'
      $st.ForeColor=[Drawing.Color]::FromArgb(255,107,107)
      $hint.Text=$k[1]
      $btnClose.Visible=$true
    } else {
      $p=0; [int]::TryParse($k[0],[ref]$p) | Out-Null
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
  Write-Host 'Instalando DarkoLab Downloader (sem interface)...'
  Wait-Job $job | Out-Null
  $line=(Get-Content -LiteralPath $status -Raw -ErrorAction SilentlyContinue)
  if ($line -match '^DONE\\|') {
    Write-Host ''
    Write-Host 'DarkoLab Downloader instalado e vinculado a extensao.'
    Write-Host '(roda automaticamente toda vez que o Windows liga)'
  } else {
    Write-Host ('Falhou: ' + $line)
  }
  Read-Host 'Enter para sair'
}
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
1) DUPLO-CLIQUE em "DarkoDownloaderSetup.exe".
   Baixa o necessario (Node + yt-dlp + ffmpeg + Chromium, ~250 MB)
   UMA UNICA VEZ, configura auto-start no Windows e ja vincula a
   extensao DarkoLab Downloader sozinho — sem codigo, sem pareamento.
   Se o Windows avisar (SmartScreen), clique "Mais informacoes" >
   "Executar assim mesmo".

2) Instale a extensao "DarkoLab Downloader" no navegador
   (chrome://extensions > modo dev > Carregar sem compactacao).

3) Pronto: em qualquer video (YouTube/Insta/TikTok/Pinterest/+18)
   aparece o botao "Baixar". Roda 100% no seu PC, sem servidor.

Desinstalar: rode "DESINSTALAR.cmd" dentro de %LOCALAPPDATA%\\DarkoDownloaderApp.
Precisa de internet so na 1a instalacao. Requer Windows 64-bit.
`;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
