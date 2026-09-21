# Starts the local infra Pulse needs (MongoDB + Temporal), checks Redis.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-infra.ps1
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$localDir = Join-Path $repoRoot '.local'
New-Item -ItemType Directory -Force -Path $localDir | Out-Null

Write-Host '== MongoDB ==' -ForegroundColor Cyan
$mongod = Join-Path $env:USERPROFILE '.cache\mongodb-binaries\mongod-x64-win32-8.2.6.exe'
if (-not (Test-Path -LiteralPath $mongod)) {
    Write-Host 'cached mongod binary not found; run `npm test` once to fetch it via mongodb-memory-server, then re-run.' -ForegroundColor Yellow
} elseif (Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'already running on 27017.' -ForegroundColor Green
} else {
    $dbPath = Join-Path $localDir 'mongo'
    New-Item -ItemType Directory -Force -Path $dbPath | Out-Null
    Start-Process -FilePath $mongod -ArgumentList @('--dbpath', "`"$dbPath`"", '--port', '27017', '--bind_ip', '127.0.0.1', '--quiet') -RedirectStandardOutput (Join-Path $localDir 'mongo.out.log') -RedirectStandardError (Join-Path $localDir 'mongo.err.log') -WindowStyle Hidden
    Start-Sleep -Seconds 3
    if (Get-NetTCPConnection -LocalPort 27017 -State Listen -ErrorAction SilentlyContinue) {
        Write-Host 'started.' -ForegroundColor Green
    } else {
        Write-Host 'failed to start — check .local\mongo.err.log' -ForegroundColor Yellow
    }
}

Write-Host '== Redis (Memurai) ==' -ForegroundColor Cyan
$memurai = Get-Service -Name 'Memurai' -ErrorAction SilentlyContinue
if (-not $memurai) {
    Write-Host 'Redis is NOT installed. Install the free native Memurai (Microsoft elevation prompt):
    winget install -e --id Memurai.MemuraiDeveloper
then run this script again.' -ForegroundColor Yellow
} elseif ($memurai.Status -ne 'Running') {
    Start-Service -Name 'Memurai'
    Write-Host 'started Memurai service.' -ForegroundColor Green
} elseif (Get-NetTCPConnection -LocalPort 6379 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'already running on 6379.' -ForegroundColor Green
} else {
    Write-Host 'Memurai installed but not listening on 6379.' -ForegroundColor Yellow
}

Write-Host '== Temporal dev server ==' -ForegroundColor Cyan
if (Get-NetTCPConnection -LocalPort 7233 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'already running on 7233.' -ForegroundColor Green
} else {
    $temporalExe = Join-Path $localDir 'temporal-cli\temporal.exe'
    if (-not (Test-Path -LiteralPath $temporalExe)) {
        Write-Host 'temporal.exe not found. Download + extract into .local\temporal-cli from https://temporal.download/cli/archive/latest?platform=windows&arch=amd64 then re-run.' -ForegroundColor Yellow
    } else {
        $temporalLog = Join-Path $localDir 'temporal.log'
        $temporalCmd = ("cd /d `"{0}`" && "".local\temporal-cli\temporal.exe"" server start-dev --port 7233 > "".local\temporal.log"" 2>&1" -f $repoRoot)
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $temporalCmd -WindowStyle Minimized
        Start-Sleep -Seconds 4
        Write-Host 'temporal.exe started in a separate window (UI at http://localhost:8233).' -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Next: open 5 terminals at D:\JOB SEARCH\Pulse and run:' -ForegroundColor White
Write-Host '  1) npm run dev       --workspace @pulse/backend    (API, port 4000)'
Write-Host '  2) npm run worker    --workspace @pulse/backend    (Temporal health-check worker)'
Write-Host '  3) npm run ai-worker --workspace @pulse/backend    (Groq/Claude analysis)'
Write-Host '  4) npm run notify    --workspace @pulse/backend    (email notifications)'
Write-Host '  5) npm run dev       --workspace @pulse/frontend   (dashboard, port 3000)'
Write-Host 'Then open http://localhost:3000, sign up, and add your first API.'