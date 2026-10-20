$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendPath = Join-Path $projectRoot 'backend'
$mavenPath = $null

$javaCommand = Get-Command java -ErrorAction SilentlyContinue
if (-not $javaCommand) {
    Write-Host 'Java was not found. Install JDK 25 or newer, then run this launcher again.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$javaVersionOutput = & $javaCommand.Source -version 2>&1
$javaVersionMatch = ($javaVersionOutput | Select-String -Pattern 'version "(\d+)' | Select-Object -First 1)
if (-not $javaVersionMatch -or [int]$javaVersionMatch.Matches[0].Groups[1].Value -lt 25) {
    Write-Host 'ChatConnect requires JDK 25 or newer. Install a supported JDK, then run this launcher again.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$mavenCommand = Get-Command mvn -ErrorAction SilentlyContinue
if ($mavenCommand) {
    $mavenPath = $mavenCommand.Source
} else {
    $mavenRoots = @(
        (Join-Path $env:USERPROFILE '.m2\wrapper\dists'),
        (Join-Path $env:ProgramFiles 'Apache Maven')
    ) | Where-Object { Test-Path $_ }

    foreach ($root in $mavenRoots) {
        $candidate = Get-ChildItem -Path $root -Filter mvn.cmd -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($candidate) {
            $mavenPath = $candidate.FullName
            break
        }
    }
}

if (-not $mavenPath) {
    Write-Host 'Maven was not found. Install Maven 3.6.3 or newer, or use the Maven wrapper cache, then try again.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

Set-Location $backendPath
Write-Host 'Starting ChatConnect. Keep this window open while you chat.' -ForegroundColor Cyan
Write-Host 'When the server is ready, open http://localhost:8080 in your browser.' -ForegroundColor Cyan
& $mavenPath 'spring-boot:run'

if ($LASTEXITCODE -ne 0) {
    Write-Host "ChatConnect stopped with exit code $LASTEXITCODE." -ForegroundColor Red
}
Read-Host 'Press Enter to close'
