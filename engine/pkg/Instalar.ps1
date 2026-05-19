# DarkoLab Downloader — instalador. Baixa as dependencias no SEU PC
# (uma vez), configura auto-start e mostra o codigo de pareamento.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($m) { Write-Host ('  -> ' + $m) -ForegroundColor Cyan }

$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
Write-Host ''
Write-Host '=== Instalando DarkoLab Downloader (motor) ===' -ForegroundColor Green
Write-Host ('Pasta: ' + $dst)

# para instancia anterior
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $dst | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'bin') | Out-Null
Copy-Item (Join-Path $src 'server.cjs') $dst -Force
Copy-Item (Join-Path $src 'DarkoDownloader.cmd') $dst -Force
Copy-Item (Join-Path $src 'Desinstalar.ps1') $dst -Force
Copy-Item (Join-Path $src 'LEIA-ME.txt') $dst -Force -ErrorAction SilentlyContinue

$tmp = Join-Path $env:TEMP ('darko-dl-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# 1) Node runtime (isolado, sem conflito com o que o usuario tenha)
$nodeExe = Join-Path $dst 'node\node.exe'
if (-not (Test-Path $nodeExe)) {
  Step 'Baixando Node (~30 MB)...'
  $nz = Join-Path $tmp 'node.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip' -OutFile $nz
  Step 'Extraindo Node...'
  Expand-Archive -LiteralPath $nz -DestinationPath $tmp -Force
  $nd = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'node-*win-x64' } | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path (Join-Path $dst 'node') | Out-Null
  Copy-Item (Join-Path $nd.FullName '*') (Join-Path $dst 'node') -Recurse -Force
}
$node = Join-Path $dst 'node\node.exe'
$npmCli = Join-Path $dst 'node\node_modules\npm\bin\npm-cli.js'

# 2) Playwright (modulo) + Chromium
if (-not (Test-Path (Join-Path $dst 'node_modules\playwright'))) {
  Step 'Instalando Playwright...'
  '{ "name": "darko-engine", "private": true }' | Set-Content -Encoding ASCII (Join-Path $dst 'package.json')
  & $node $npmCli install playwright@1.60.0 --omit=dev --no-audit --no-fund --prefix "$dst" 2>&1 | Out-Null
}
if (-not (Test-Path (Join-Path $dst 'ms-playwright\chromium-1223'))) {
  Step 'Baixando Chromium (~180 MB, demora)...'
  $env:PLAYWRIGHT_BROWSERS_PATH = (Join-Path $dst 'ms-playwright')
  & $node (Join-Path $dst 'node_modules\playwright\cli.js') install chromium 2>&1 | Out-Null
}

# 3) yt-dlp.exe
$yt = Join-Path $dst 'bin\yt-dlp.exe'
if (-not (Test-Path $yt) -or (Get-Item $yt).Length -lt 5MB) {
  Step 'Baixando yt-dlp...'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $yt
}

# 4) ffmpeg.exe (build estatico)
$ff = Join-Path $dst 'bin\ffmpeg.exe'
if (-not (Test-Path $ff) -or (Get-Item $ff).Length -lt 10MB) {
  Step 'Baixando ffmpeg (~30 MB)...'
  $fz = Join-Path $tmp 'ff.zip'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip' -OutFile $fz
  Expand-Archive -LiteralPath $fz -DestinationPath (Join-Path $tmp 'ff') -Force
  $fe = Get-ChildItem -Recurse -Path (Join-Path $tmp 'ff') -Filter ffmpeg.exe | Select-Object -First 1
  Copy-Item $fe.FullName $ff -Force
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# 5) auto-start (atalho oculto na Inicializacao)
$vbs = Join-Path $dst 'run-hidden.vbs'
@'
Set s = CreateObject("WScript.Shell")
d = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
s.Run "cmd /c """ & d & "\DarkoDownloader.cmd""", 0, False
'@ | Set-Content -Encoding ASCII $vbs
$startup = [Environment]::GetFolderPath('Startup')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $startup 'DarkoLab Downloader.lnk'))
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = '"' + $vbs + '"'
$lnk.WorkingDirectory = $dst
$lnk.Save()

# 6) inicia e captura o codigo
Step 'Iniciando o motor...'
Remove-Item (Join-Path $dst 'engine.log') -ErrorAction SilentlyContinue
Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WindowStyle Hidden
$cfg = Join-Path $env:LOCALAPPDATA 'DarkoDownloader\config.json'
$tok = $null
for ($i=0; $i -lt 40; $i++) {
  Start-Sleep 1
  $log = Get-Content (Join-Path $dst 'engine.log') -Raw -ErrorAction SilentlyContinue
  if ($log -match '"token":"([0-9a-f]+)"') { $tok = $Matches[1]; break }
}
Write-Host ''
if ($tok) {
  Write-Host '=====================================================' -ForegroundColor Green
  Write-Host ' DarkoLab Downloader instalado e RODANDO!' -ForegroundColor Green
  Write-Host ' CODIGO DE PAREAMENTO (cole na extensao):'
  Write-Host ''
  Write-Host ('   ' + $tok) -ForegroundColor Yellow
  Write-Host ''
  Write-Host '=====================================================' -ForegroundColor Green
  Set-Clipboard -Value $tok
  Write-Host '(codigo copiado pra area de transferencia)'
} else {
  Write-Host 'Instalado, mas nao confirmei o start. Veja o log:' -ForegroundColor Yellow
  Write-Host ('  ' + (Join-Path $dst 'engine.log'))
}
Write-Host ''
Write-Host 'Agora instale a extensao no navegador e cole o codigo.'
