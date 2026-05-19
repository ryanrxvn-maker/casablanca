$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'server.cjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'DarkoLab Downloader.lnk') -Force
Remove-Item (Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp') -Recurse -Force
Write-Host 'Motor removido. (config/token em LOCALAPPDATA\DarkoDownloader preservada)'
