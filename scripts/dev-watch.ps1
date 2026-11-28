<#
.SYNOPSIS
    Keeps the Yakodonyo frontend and backend dev servers running.

.DESCRIPTION
    - Starts either server if its port is not listening.
    - Restarts both when key config/dependency files change, or with -Force.
    - Intended to be invoked every minute by a user scheduled task.
    Normal source edits are handled by Next dev and uvicorn --reload.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-watch.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-watch.ps1 -Force
#>
param(
    [switch]$Force,
    [switch]$Status
)

# M46: surface start/config errors instead of continuing with half-started servers.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"

$statePath = Join-Path $env:TEMP "yakodonyo-dev-watch.state"
$lockPath = Join-Path $env:TEMP "yakodonyo-dev-watch.lock"
$watchLog = Join-Path $env:TEMP "yakodonyo-dev-watch.log"

$backendOut = Join-Path $env:TEMP "yakodonyo-backend-dev.log"
$backendErr = Join-Path $env:TEMP "yakodonyo-backend-dev.err.log"
$frontendOut = Join-Path $env:TEMP "yakodonyo-frontend-dev.log"
$frontendErr = Join-Path $env:TEMP "yakodonyo-frontend-dev.err.log"

function Write-WatchLog([string]$message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Add-Content -Path $watchLog -Value $line
}

function Get-PortOwner([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPort -eq $port } | Select-Object -First 1
    if ($conn) { return [int]$conn.OwningProcess }
    return 0
}

function Stop-PortProcess([int]$port) {
    $ownerPid = Get-PortOwner $port
    if ($ownerPid -eq 0) { return }

    taskkill /PID $ownerPid /T /F | Out-Null
    # Uvicorn's reloader exits after its child, so verify the port is actually
    # free before starting a replacement. A silent failure leaves two servers
    # competing for the port, and the old code keeps answering requests.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if ((Get-PortOwner $port) -eq 0) { return }
    }
    Write-WatchLog "failed to stop pid=$ownerPid on port=$port"
    throw "Failed to stop process $ownerPid on port $port"
}

function Start-Backend {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) {
        Write-WatchLog "python not found on PATH"
        throw "python not found on PATH"
    }
    $proc = Start-Process -FilePath $python `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr `
        -WindowStyle Hidden -PassThru
    if (-not $proc) {
        Write-WatchLog "failed to start backend"
        throw "failed to start backend"
    }
    Write-WatchLog "backend started pid=$($proc.Id)"
}

function Start-Frontend {
    $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npm) {
        Write-WatchLog "npm.cmd not found on PATH"
        throw "npm.cmd not found on PATH"
    }
    $proc = Start-Process -FilePath $npm `
        -ArgumentList @("run", "dev") `
        -WorkingDirectory $frontendDir `
        -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr `
        -WindowStyle Hidden -PassThru
    if (-not $proc) {
        Write-WatchLog "failed to start frontend"
        throw "failed to start frontend"
    }
    Write-WatchLog "frontend started pid=$($proc.Id)"
}

# Signature of files that require a full restart when changed.
$triggerFiles = @(
    (Join-Path $root "backend\requirements.txt"),
    (Join-Path $root "backend\.env"),
    (Join-Path $root "frontend\package.json"),
    (Join-Path $root "frontend\package-lock.json"),
    (Join-Path $root "frontend\next.config.js"),
    (Join-Path $root "frontend\next.config.mjs"),
    (Join-Path $root "frontend\.env.local"),
    $PSCommandPath
)
$signature = ($triggerFiles | Where-Object { Test-Path $_ } | ForEach-Object {
    $f = Get-Item $_
    "{0}|{1}|{2}" -f $f.FullName, $f.LastWriteTimeUtc.Ticks, $f.Length
}) -join ";"
$rawPrevious = Get-Content $statePath -Raw -ErrorAction SilentlyContinue
$previous = if ($rawPrevious) { $rawPrevious.Trim() } else { $null }

if ($Status) {
    "backend  port 8000 pid=$((Get-PortOwner 8000))"
    "frontend port 3000 pid=$((Get-PortOwner 3000))"
    "changed=$([bool]($previous -and $previous -ne $signature))"
    exit 0
}

# Avoid overlapping scheduler runs (explicit -Force always runs).
if (-not $Force -and (Test-Path $lockPath)) {
    $age = (Get-Date) - (Get-Item $lockPath).LastWriteTime
    if ($age.TotalSeconds -lt 50) { exit 0 }
}
Set-Content -Path $lockPath -Value (Get-Date -Format o)

# M46: always release the lock, even if a start/restart step throws.
try {
    $restart = $Force -or ($previous -and $previous -ne $signature)
    if ($restart) {
        Write-WatchLog "restart triggered (force=$Force, configChanged=$([bool]($previous -and $previous -ne $signature)))"
        Stop-PortProcess 8000
        Stop-PortProcess 3000
        Start-Backend
        Start-Frontend
    } else {
        $bePid = Get-PortOwner 8000
        $fePid = Get-PortOwner 3000
        if ($bePid -eq 0) { Write-WatchLog "backend down; starting"; Start-Backend }
        if ($fePid -eq 0) { Write-WatchLog "frontend down; starting"; Start-Frontend }
    }

    Set-Content -Path $statePath -Value $signature
} finally {
    Remove-Item -Path $lockPath -Force -ErrorAction SilentlyContinue
}
