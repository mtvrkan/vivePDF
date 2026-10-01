$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$sidecarDir = Join-Path $root "sidecar"
$dest = Join-Path $root "apps\desktop\src-tauri\binaries"
$engine = Join-Path $dest "engine"
$pingRequest = '{"id":"1","method":"system.ping","params":{}}'
$maxRelativePathLength = 160

function Assert-ExitCode([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed with exit code $LASTEXITCODE"
    }
}

function Invoke-EnginePing([string]$executable) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo $executable
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    if ($PSVersionTable.PSEdition -eq "Desktop") {
        $consoleInputEncoding = [Console]::InputEncoding
        [Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
        try {
            $process = [System.Diagnostics.Process]::Start($startInfo)
        } finally {
            [Console]::InputEncoding = $consoleInputEncoding
        }
    } else {
        $process = [System.Diagnostics.Process]::Start($startInfo)
    }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.WriteLine($pingRequest)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(120000)) {
        $process.Kill()
        throw "engine did not exit after stdin closed"
    }
    $stopwatch.Stop()
    if ($stdout.Result -notmatch '"id":\s*"1"') {
        throw "engine ping got no answer: $($stdout.Result) $($stderr.Result)"
    }
    Write-Host "engine ping answered and exited in $($stopwatch.ElapsedMilliseconds) ms"
}

Push-Location $sidecarDir
try {
    uv sync --group dev
    Assert-ExitCode "uv sync"
    uv run pyinstaller vivepdf-sidecar.spec --noconfirm --clean
    Assert-ExitCode "pyinstaller"
} finally {
    Pop-Location
}

if (Test-Path $dest) {
    Get-ChildItem $dest -Force | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $sidecarDir "dist\vivepdf-engine") $engine -Recurse -Force
$engine = (Get-Item $engine).FullName
Write-Host "engine -> $engine"

& (Join-Path $engine "vivepdf-cli.exe") selftest
Assert-ExitCode "engine selftest"

$qpdf = Get-ChildItem (Join-Path $engine "_internal") -Recurse -File -Filter "qpdf*.dll"
if (-not $qpdf) {
    throw "qpdf library missing under engine\_internal"
}
Write-Host "qpdf -> $($qpdf[0].FullName.Substring($engine.Length + 1))"

Invoke-EnginePing (Join-Path $engine "vivepdf-sidecar.exe")

Push-Location $sidecarDir
try {
    uv run python (Join-Path $root "scripts\engine-smoke.py") $engine
    Assert-ExitCode "engine smoke"
} finally {
    Pop-Location
}

$longest = Get-ChildItem $engine -Recurse -File |
    ForEach-Object { $_.FullName.Substring($engine.Length + 1) } |
    Sort-Object Length -Descending |
    Select-Object -First 1
if ($longest.Length -ge $maxRelativePathLength) {
    throw "engine path too long ($($longest.Length) chars): $longest"
}
Write-Host "longest engine path: $($longest.Length) chars"
