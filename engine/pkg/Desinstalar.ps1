# Auto Edit Downloader - desinstalar
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Auto Edit Downloader - Desinstalar'
Write-Host '----------------------------------'
$dst = Join-Path $env:LOCALAPPDATA 'AutoEditDownloader'
$legacyDst = Join-Path $env:LOCALAPPDATA 'DarkoDownloaderApp'
$localRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
foreach ($d in @($dst, $legacyDst)) {
  if (-not ([IO.Path]::GetFullPath($d).StartsWith($localRoot, [StringComparison]::OrdinalIgnoreCase))) {
    throw 'Destino de desinstalacao invalido.'
  }
}
Write-Host 'Parando o motor...'
Get-CimInstance Win32_Process -Filter "Name='AutoEditRunner.exe'" |
  Where-Object { $_.ExecutablePath -eq (Join-Path $dst 'AutoEditRunner.exe') -or $_.ExecutablePath -eq (Join-Path $legacyDst 'AutoEditRunner.exe') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$serverPattern = [regex]::Escape((Join-Path $dst 'server.cjs')) + '|' + [regex]::Escape((Join-Path $legacyDst 'server.cjs'))
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match $serverPattern } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Removendo auto-start...'
schtasks /Delete /TN 'AutoEditDownloader' /F 2>$null | Out-Null
$startup = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startup 'Auto Edit Downloader.lnk') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $startup 'DarkoLab Downloader.lnk')  -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Auto Edit Downloader.lnk') -Force -ErrorAction SilentlyContinue
foreach ($d in @($dst, $legacyDst)) {
  if (Test-Path $d) {
    Write-Host ('Removendo ' + $d)
    Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Write-Host ''
Write-Host 'Motor desinstalado.'
Read-Host 'Enter para sair'
