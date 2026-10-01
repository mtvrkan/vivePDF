param(
  [string]$Version = "",
  [string]$Destination = (Join-Path $PSScriptRoot "..\apps\desktop\src-tauri\resources\libreoffice")
)

$ErrorActionPreference = "Stop"
$mirror = "https://download.documentfoundation.org/libreoffice/stable"

if (-not $Version) {
  $index = Invoke-WebRequest -UseBasicParsing "$mirror/"
  $versions = [regex]::Matches($index.Content, 'href="(\d+\.\d+\.\d+)/"') | ForEach-Object { [version]$_.Groups[1].Value }
  $Version = ($versions | Sort-Object -Descending | Select-Object -First 1).ToString()
}

$fileName = "LibreOffice_${Version}_Win_x86-64.msi"
$url = "$mirror/$Version/win/x86_64/$fileName"
$work = Join-Path $env:TEMP "vivepdf-libreoffice"
$msi = Join-Path $work $fileName
$extract = Join-Path $work "extract"

New-Item -ItemType Directory -Force $work | Out-Null
if (-not (Test-Path $msi)) {
  Write-Host "Downloading $url"
  Invoke-WebRequest -UseBasicParsing $url -OutFile $msi
}

if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Write-Host "Extracting (administrative install image)"
$process = Start-Process msiexec.exe -ArgumentList "/a", "`"$msi`"", "/qn", "TARGETDIR=`"$extract`"" -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "msiexec failed with $($process.ExitCode)" }

$soffice = Get-ChildItem -Path $extract -Recurse -Filter soffice.exe | Select-Object -First 1
if (-not $soffice) { throw "soffice.exe not found in the extracted image" }
$root = $soffice.Directory.Parent.FullName

$Destination = [System.IO.Path]::GetFullPath($Destination)
if (Test-Path $Destination) { Get-ChildItem $Destination -Force | Where-Object { $_.Name -ne ".gitkeep" } | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force $Destination | Out-Null
Write-Host "Copying to $Destination"
robocopy $root $Destination /E /XF *.msi /NFL /NDL /NJH /NJS /NP | Out-Null
Get-ChildItem $Destination -Filter *.msi | Remove-Item -Force

foreach ($trim in @("share\extensions", "help", "readmes", "share\wizards", "share\template", "share\gallery", "share\Scripts", "share\basic", "share\autotext", "share\wordbook", "program\wizards", "sdk")) {
  $path = Join-Path $Destination $trim
  if (Test-Path $path) { Remove-Item -Recurse -Force $path }
}
Get-ChildItem "$Destination\share\config" -Filter "images_*.zip" | Where-Object { $_.Name -ne "images_colibre.zip" } | Remove-Item -Force
Get-ChildItem "$Destination\program" -Directory -Filter "python-core-*" | Remove-Item -Recurse -Force
foreach ($pyFile in @("python.exe", "pythonw.exe", "python313.dll", "python313.zip")) {
  $path = Join-Path "$Destination\program" $pyFile
  if (Test-Path $path) { Remove-Item -Force $path }
}

$size = (Get-ChildItem $Destination -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ("LibreOffice {0} ready: {1:N0} MB at {2}" -f $Version, $size, $Destination)
