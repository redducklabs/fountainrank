#!/usr/bin/env pwsh
# FountainRank local task runner. Run `./run.ps1 help` for usage.
# Compatible with Windows PowerShell 5.1 and PowerShell 7 (no &&/||/ternary).
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'help',

    # up / down / reset
    [switch]$Auth,
    [switch]$Full,
    [switch]$Volumes,

    # check selectors
    [switch]$Backend,
    [switch]$Web,
    [switch]$Mobile,
    [switch]$ApiClient,
    [switch]$Fast,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = 'Stop'
$RepoRoot = $PSScriptRoot
$ComposeFile = Join-Path $RepoRoot 'docker/docker-compose.yml'
$BackendDir = Join-Path $RepoRoot 'backend'

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Arguments = @(),
        [string]$WorkingDir
    )
    if ($WorkingDir) { Push-Location $WorkingDir }
    try {
        Write-Host "    $Exe $($Arguments -join ' ')" -ForegroundColor DarkGray
        & $Exe @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed (exit $LASTEXITCODE): $Exe $($Arguments -join ' ')"
        }
    }
    finally {
        if ($WorkingDir) { Pop-Location }
    }
}

function Invoke-Compose {
    param([string[]]$Arguments = @())
    Invoke-Native -Exe 'docker' -Arguments (@('compose', '-f', $ComposeFile) + $Arguments)
}

function Get-UpProfiles {
    $p = @()
    if ($Auth -or $Full) { $p += @('--profile', 'auth') }
    if ($Full) { $p += @('--profile', 'full') }
    return , $p
}

function Get-AllProfiles {
    # All defined profiles, so `down`/`reset` tear down the WHOLE stack (db + logto +
    # backend). `docker compose down` WITHOUT these flags leaves profiled services
    # (logto/backend) running; they then hold the project network and cause
    # "network ... not found / resource is still in use" errors on the next `up`.
    return @('--profile', 'auth', '--profile', 'full')
}

function Start-Db {
    # Idempotent: ensure the db service is up before DB-dependent steps.
    Invoke-Compose -Arguments @('up', '-d', 'db')
}

function Restore-WebBuildArtifacts {
    # `next build` rewrites these tracked files; the committed forms are canonical.
    Invoke-Native -Exe 'git' -Arguments @('checkout', '--', 'web/next-env.d.ts', 'web/tsconfig.json') -WorkingDir $RepoRoot
}

function Invoke-BackendCheck {
    Write-Section 'check: backend (ruff + format + alembic check + pytest)'
    Start-Db
    Invoke-Native -Exe 'uv' -Arguments @('run', 'ruff', 'check', '.') -WorkingDir $BackendDir
    Invoke-Native -Exe 'uv' -Arguments @('run', 'ruff', 'format', '--check', '.') -WorkingDir $BackendDir
    Invoke-Native -Exe 'uv' -Arguments @('run', 'alembic', 'upgrade', 'head') -WorkingDir $BackendDir
    Invoke-Native -Exe 'uv' -Arguments @('run', 'alembic', 'check') -WorkingDir $BackendDir
    Invoke-Native -Exe 'uv' -Arguments @('run', 'pytest') -WorkingDir $BackendDir
}

function Invoke-ApiClientCheck {
    Write-Section 'check: api-client (lint + typecheck + test)'
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'lint', 'typecheck', 'test', '--filter=@fountainrank/api-client') -WorkingDir $RepoRoot
}

function Invoke-WebCheck {
    Write-Section 'check: web (eslint + prettier + typecheck + test + build)'
    Invoke-Native -Exe 'pnpm' -Arguments @('--filter', 'web', 'run', 'lint') -WorkingDir $RepoRoot
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'prettier', '--check', 'web/**/*.{ts,tsx,js,jsx,mjs,cjs,json,css,md}') -WorkingDir $RepoRoot
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'typecheck', 'test', '--filter=web') -WorkingDir $RepoRoot
    if (-not $Fast) {
        # try/finally so a FAILED `next build` still restores the mutated tracked
        # files (the 0c gotcha). Restore runs on success and failure alike.
        try {
            Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'build', '--filter=web') -WorkingDir $RepoRoot
        }
        finally {
            Restore-WebBuildArtifacts
        }
    }
}

function Invoke-MobileCheck {
    Write-Section 'check: mobile (eslint + typecheck + expo-doctor)'
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'lint', 'typecheck', '--filter=mobile') -WorkingDir $RepoRoot
    if (-not $Fast) {
        Invoke-Native -Exe 'pnpm' -Arguments @('dlx', 'expo-doctor') -WorkingDir (Join-Path $RepoRoot 'mobile')
    }
}

function Invoke-FullCheck {
    # Full CI mirror. Uses turbo across the whole workspace (generate runs as a dep).
    Invoke-BackendCheck
    Write-Section 'check: frontend lint + format + typecheck + test'
    Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'lint', 'typecheck', 'test') -WorkingDir $RepoRoot
    Invoke-Native -Exe 'pnpm' -Arguments @('run', 'format:check') -WorkingDir $RepoRoot
    if (-not $Fast) {
        Write-Section 'check: web build (+ restore mutated files)'
        # try/finally so a FAILED `next build` still restores the mutated tracked files.
        try {
            Invoke-Native -Exe 'pnpm' -Arguments @('exec', 'turbo', 'run', 'build', '--filter=web') -WorkingDir $RepoRoot
        }
        finally {
            Restore-WebBuildArtifacts
        }
        Write-Section 'check: mobile expo-doctor'
        Invoke-Native -Exe 'pnpm' -Arguments @('dlx', 'expo-doctor') -WorkingDir (Join-Path $RepoRoot 'mobile')
    }
}

function Show-Help {
    Write-Host @"
FountainRank task runner — ./run.ps1 <command> [switches]

Stack lifecycle:
  up [-Auth] [-Full]   Start the stack. Default: db only.
                       -Auth adds Logto; -Full adds the containerized backend.
  down [-Volumes]      Stop the stack. -Volumes also removes the db volume.
  reset                Stop and DELETE the db volume (fresh database), then start db.

Dev loop (apps on host):
  backend              Ensure db is up, migrate, then serve with --reload (host).
  web                  Run the Next.js dev server (host).
  migrate              Ensure db is up, then `alembic upgrade head`.
  generate             Regenerate the api-client from the backend OpenAPI schema.
  bootstrap            Install deps: `uv sync` (backend) + `pnpm install` (workspace).

Verification (local CI mirror):
  check                Full matrix (backend + frontend + mobile). = CI.
    -Backend           Only backend (ruff + format + alembic check + pytest).
    -Web               Only web (eslint + prettier + typecheck + test + build).
    -Mobile            Only mobile (eslint + typecheck + expo-doctor).
    -ApiClient         Only the shared api-client (lint + typecheck + test).
    -Fast              Skip the slow steps (next build + expo-doctor).

Conveniences:
  logs [service...]    Follow container logs (all services, or the named ones).
  psql                 Open psql on the app database.
  help                 Show this help.
"@
}

switch ($Command.ToLowerInvariant()) {
    'up' {
        Invoke-Compose -Arguments ((Get-UpProfiles) + @('up', '-d'))
        Write-Host "Stack up. db:5436  logto:3001/3002 (if -Auth)  backend:8000 (if -Full)" -ForegroundColor Green
    }
    'down' {
        $downArgs = (Get-AllProfiles) + @('down')
        if ($Volumes) { $downArgs += '-v' }
        Invoke-Compose -Arguments $downArgs
    }
    'reset' {
        Invoke-Compose -Arguments ((Get-AllProfiles) + @('down', '-v'))
        Start-Db
        Write-Host "Database volume reset; db is starting fresh (initdb re-ran)." -ForegroundColor Green
    }
    'backend' {
        Start-Db
        Invoke-Native -Exe 'uv' -Arguments @('run', 'alembic', 'upgrade', 'head') -WorkingDir $BackendDir
        Invoke-Native -Exe 'uv' -Arguments @('run', 'uvicorn', 'app.main:app', '--reload') -WorkingDir $BackendDir
    }
    'web' {
        Invoke-Native -Exe 'pnpm' -Arguments @('--filter', 'web', 'run', 'dev') -WorkingDir $RepoRoot
    }
    'migrate' {
        Start-Db
        Invoke-Native -Exe 'uv' -Arguments @('run', 'alembic', 'upgrade', 'head') -WorkingDir $BackendDir
    }
    'generate' {
        Invoke-Native -Exe 'pnpm' -Arguments @('run', 'generate') -WorkingDir $RepoRoot
    }
    'bootstrap' {
        Invoke-Native -Exe 'uv' -Arguments @('sync') -WorkingDir $BackendDir
        Invoke-Native -Exe 'pnpm' -Arguments @('install') -WorkingDir $RepoRoot
    }
    'check' {
        $subset = $Backend -or $Web -or $Mobile -or $ApiClient
        if ($subset) {
            if ($Backend) { Invoke-BackendCheck }
            if ($ApiClient) { Invoke-ApiClientCheck }
            if ($Web) { Invoke-WebCheck }
            if ($Mobile) { Invoke-MobileCheck }
        }
        else {
            Invoke-FullCheck
        }
        Write-Host ""
        Write-Host "All requested checks passed." -ForegroundColor Green
    }
    'logs' {
        Invoke-Compose -Arguments (@('logs', '-f') + $Rest)
    }
    'psql' {
        Invoke-Compose -Arguments @('exec', 'db', 'psql', '-U', 'fountainrank', '-d', 'fountainrank')
    }
    'help' { Show-Help }
    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Help
        exit 2
    }
}
