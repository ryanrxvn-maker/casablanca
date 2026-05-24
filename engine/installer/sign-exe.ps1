# ============================================================
#  sign-exe.ps1 — auto-assina o AutoEditDownloaderSetup.exe
#  com certificado self-signed gerado localmente.
# ============================================================
#
# Por que isso ajuda mesmo sendo self-signed:
#  - Defender/Avast tratam .exe SEM assinatura digital MUITO pior
#    que .exe com assinatura "Unknown Publisher". A assinatura
#    self-signed adiciona um Publisher visível na aba "Detalhes"
#    do Explorer e no SmartScreen, reduzindo heurística de
#    "binário anonimo + comportamento de loader = malware".
#
#  - Não elimina SmartScreen warning 100% (só EV cert real faz),
#    mas reduz drasticamente o false-positive rate em Avast,
#    Kaspersky, ESET e Defender heurístico.
#
#  - Validade do cert: 5 anos. Cert privado fica em
#    %LOCALAPPDATA%\AutoEditSigning (não no repo, não exposto).
#
# Uso: powershell -File engine/installer/sign-exe.ps1 -Exe path\to\setup.exe

param(
  [Parameter(Mandatory=$true)]
  [string]$Exe,

  [string]$Subject = 'Auto Edit',
  [string]$FriendlyName = 'Auto Edit Code Signing'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Exe)) {
  Write-Host "[sign] ERRO: exe nao encontrado: $Exe"
  exit 1
}

# Local pra guardar o cert (persiste entre rebuilds)
$certDir = Join-Path $env:LOCALAPPDATA 'AutoEditSigning'
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
$pfxPath = Join-Path $certDir 'auto-edit-signing.pfx'
$pwdFile = Join-Path $certDir 'pwd.txt'

# Procura cert no store pessoal
$existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
  $_.Subject -eq "CN=$Subject" -and $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(30)
} | Select-Object -First 1

if (-not $existing) {
  Write-Host "[sign] gerando novo cert self-signed (validade 5 anos)..."
  $existing = New-SelfSignedCertificate `
    -Subject "CN=$Subject" `
    -FriendlyName $FriendlyName `
    -Type CodeSigningCert `
    -KeySpec Signature `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 4096 `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -HashAlgorithm SHA256 `
    -NotAfter ((Get-Date).AddYears(5))

  # Export pra .pfx pra backup
  if (-not (Test-Path $pwdFile)) {
    # Random 32-char base64 a partir de bytes seguros (sem
    # System.Web.Security, que não existe em PS Core)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] 24
    $rng.GetBytes($buf)
    $rand = [Convert]::ToBase64String($buf)
    Set-Content -LiteralPath $pwdFile -Value $rand -Encoding ASCII
  }
  $pwd = Get-Content -LiteralPath $pwdFile -Raw
  $secPwd = ConvertTo-SecureString -String $pwd -Force -AsPlainText
  Export-PfxCertificate -Cert $existing -FilePath $pfxPath -Password $secPwd | Out-Null
  Write-Host "[sign] cert exportado: $pfxPath"
} else {
  Write-Host "[sign] usando cert existente: $($existing.Thumbprint)"
}

# Assina o .exe — SHA256, timestamp do servidor DigiCert (gratis, RFC 3161)
Write-Host "[sign] assinando $Exe ..."
$result = Set-AuthenticodeSignature `
  -FilePath $Exe `
  -Certificate $existing `
  -HashAlgorithm SHA256 `
  -TimestampServer 'http://timestamp.digicert.com'

if ($result.Status -ne 'Valid' -and $result.Status -ne 'UnknownError') {
  # 'UnknownError' aqui é normal pra self-signed (CA não confiada)
  # mas a assinatura está aplicada — só não é confiável globalmente.
  # Pra Defender, isso já basta.
  Write-Host "[sign] aviso: status = $($result.Status) ($($result.StatusMessage))"
}

# Verifica
$sig = Get-AuthenticodeSignature -FilePath $Exe
Write-Host "[sign] assinatura aplicada:"
Write-Host "       Signer:    $($sig.SignerCertificate.Subject)"
Write-Host "       Thumbprint: $($sig.SignerCertificate.Thumbprint)"
Write-Host "       Timestamp: $($sig.TimeStamperCertificate.Subject)"
Write-Host "       Status:    $($sig.Status)"

exit 0
