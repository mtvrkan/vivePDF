param(
  [string]$Destination = (Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\resources\offline")
)

$ErrorActionPreference = "Stop"
$version = "26.2.6"
$sha256 = "f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660"
$fileName = "LibreOffice_${version}_Win_x86-64.msi"
$url = "https://download.documentfoundation.org/libreoffice/stable/$version/win/x86_64/$fileName"
$Destination = [System.IO.Path]::GetFullPath($Destination)
$target = Join-Path $Destination $fileName

function Test-Installer([string]$path) {
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() -ne $sha256) { return $false }
  $signature = Get-AuthenticodeSignature -LiteralPath $path
  return $signature.Status -eq "Valid" -and $signature.SignerCertificate.Subject -match "The Document Foundation"
}

New-Item -ItemType Directory -Force $Destination | Out-Null
if ((Test-Path -LiteralPath $target) -and (Test-Installer $target)) {
  Write-Host "$fileName is already in place"
  exit 0
}

$partial = "$target.part"
Write-Host "Downloading $url"
Invoke-WebRequest -UseBasicParsing $url -OutFile $partial
if (-not (Test-Installer $partial)) {
  Remove-Item -LiteralPath $partial -Force
  throw "$fileName failed its checksum or is not signed by The Document Foundation"
}
Move-Item -LiteralPath $partial -Destination $target -Force
Write-Host "Saved $target"
