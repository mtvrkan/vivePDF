param(
  [switch]$SkipEngine
)

$ErrorActionPreference = "Stop"
$appDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\apps\desktop"))
$version = (Get-Content -Raw -LiteralPath (Join-Path $appDir "src-tauri\tauri.conf.json") | ConvertFrom-Json).version
$built = Join-Path $appDir "src-tauri\target\release\bundle\nsis\vivePDF_${version}_x64-setup.exe"
$outDir = Join-Path $appDir "src-tauri\target\release\windows-release\$version"
$updateInstaller = Join-Path $outDir "vivePDF_${version}_x64-update.exe"
$fullInstaller = Join-Path $outDir "vivePDF_${version}_x64-setup.exe"
$noUpdaterConfig = Join-Path $outDir "no-updater-artifacts.conf.json"

foreach ($path in @($built, "$built.sig", $updateInstaller, $fullInstaller)) {
  if (Test-Path -LiteralPath $path) { throw "$path already exists; move it somewhere else before building $version" }
}

function Invoke-InstallerBuild([string[]]$extraConfigs) {
  $configs = @("--config", "src-tauri/tauri.release.conf.json")
  foreach ($config in $extraConfigs) { $configs += @("--config", $config) }
  $configs += @("--config", $noUpdaterConfig)
  & pnpm tauri build @configs --bundles nsis
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath $built)) { throw "tauri build did not write $built" }
}

New-Item -ItemType Directory -Force $outDir | Out-Null
Set-Content -LiteralPath $noUpdaterConfig -Encoding ascii -Value '{"bundle":{"createUpdaterArtifacts":false}}'

if (-not $SkipEngine) {
  & (Join-Path $PSScriptRoot "build-sidecar.ps1")
  if ($LASTEXITCODE -ne 0) { throw "build-sidecar.ps1 failed with exit code $LASTEXITCODE" }
}
& (Join-Path $PSScriptRoot "fetch-office-msi.ps1")

Push-Location $appDir
try {
  Invoke-InstallerBuild @()
  Move-Item -LiteralPath $built -Destination $updateInstaller
  Invoke-InstallerBuild @("src-tauri/tauri.office.conf.json")
  Move-Item -LiteralPath $built -Destination $fullInstaller
} finally {
  Pop-Location
}

$sizes = @($updateInstaller, $fullInstaller) | ForEach-Object { "{0}  {1:N0} MB" -f $_, ((Get-Item -LiteralPath $_).Length / 1MB) }
Write-Host ""
Write-Host "Built vivePDF $version"
$sizes | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Sign the update installer for the in-app updater:"
Write-Host "  pnpm tauri signer sign -f ~/.tauri/vivepdf.key `"$updateInstaller`""
