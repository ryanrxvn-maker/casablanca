# Copia a migration 020_magnific_secrets.sql pro clipboard.
# Rode: powershell -ExecutionPolicy Bypass -File scripts/copy-magnific-migration.ps1
# Depois abre https://supabase.com/dashboard -> seu projeto -> SQL Editor -> New query -> Ctrl+V -> Run.

$sqlPath = Join-Path $PSScriptRoot "..\supabase\migrations\020_magnific_secrets.sql"
$sql = Get-Content -Path $sqlPath -Raw -Encoding UTF8
$sql | Set-Clipboard
Write-Host ""
Write-Host " Migration 020_magnific_secrets.sql copiada pro clipboard." -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos (30s):" -ForegroundColor Yellow
Write-Host "  1. Abre: https://supabase.com/dashboard"
Write-Host "  2. Clica no projeto da DARKO LAB"
Write-Host "  3. Menu lateral -> SQL Editor"
Write-Host "  4. Clica 'New query'"
Write-Host "  5. Ctrl+V (cola)"
Write-Host "  6. Clica 'Run' (ou Ctrl+Enter)"
Write-Host ""
Write-Host " Pronto! Volta no app -> /configuracoes/magnific" -ForegroundColor Cyan
