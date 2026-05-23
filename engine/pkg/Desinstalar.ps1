# Auto Edit Downloader - desinstalar
$ErrorActionPreference = 'SilentlyContinue'

Write-Host 'Auto Edit Downloader - Desinstalar'
Write-Host '----------------------------------'

# 1) mata processos do motor
Write-Host 'Parando o motor...'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# 2) remove auto-start (Task Scheduler + fallback Startup folder)
Write-Host 'Removendo auto-start...'
schtasks /Delete /TN 'AutoEditDownloader' /F 2>$null | Out-Null
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'Auto Edit Downloader.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $startup 'DarkoLab Downloader.lnk')  -Force -ErrorAction SilentlyContinue  # legado

# 3) remove a pasta do motor
$dst = Join-Path $env:LOCALAPPDATA 'AutoEditDownloader'
$legacyDst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'  # legado
foreach ($d in @($dst, $legacyDst)) {
  if (Test-Path $d) {
    Write-Host ('Removendo ' + $d)
    Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host 'Pronto. Motor desinstalado.'
Write-Host '(Token da extensao no browser nao foi tocado.)'
Read-Host 'Enter para sair'
