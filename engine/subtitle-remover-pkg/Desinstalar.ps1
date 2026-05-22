$ErrorActionPreference = 'SilentlyContinue'
# Mata o server.py em execucao
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'server\.py' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Remove atalhos
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'DarkoLab Subtitle Remover.lnk') -Force
$progs = [Environment]::GetFolderPath('Programs')
Remove-Item (Join-Path $progs 'DarkoLab Subtitle Remover - Codigo.lnk') -Force

# Remove o app (python + deps + ffmpeg)
Remove-Item (Join-Path $env:LOCALAPPDATA 'DarkoSubtitleRemoverApp') -Recurse -Force

Write-Host 'Motor removido. (config/token em LOCALAPPDATA\DarkoSubtitleRemover preservada)'
