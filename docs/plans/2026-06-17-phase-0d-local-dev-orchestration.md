# Phase 0d — Local Dev Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `fr-postgis` container with a profile-gated `docker compose` stack (Postgres/PostGIS, self-hosted Logto, optional containerized backend) plus a root `run.ps1` PowerShell task runner that drives the local dev loop and mirrors CI, then finalize the local-checks documentation.

**Architecture:** `docker/docker-compose.yml` defines four-ish services behind Compose **profiles**. The default `docker compose up -d` starts only **`db`** (`postgis/postgis:17-3.5`, host port **5436**) — the everyday driver; a first-boot init script also creates a separate **`logto`** database/role in that same instance (mirrors prod: "separate database within the managed cluster"). The **`auth`** profile adds **Logto** (`svhd/logto:1.40.1`) pointed at the `logto` database. The **`full`** profile additionally containerizes the **backend** (built from `backend/Dockerfile`, migrates-then-serves). Day-to-day, the backend runs on the host via `uv run uvicorn --reload` and the web app via `pnpm --filter web dev` (best hot reload; matches the host-based api-client `generate` flow). `run.ps1` (repo root) exposes lifecycle verbs (`up`/`down`/`reset`), dev verbs (`backend`/`web`/`migrate`/`generate`/`bootstrap`), conveniences (`logs`/`psql`), and a `check` verb that runs the **full CI mirror** by default (backend ruff+format+`alembic check`+pytest; frontend lint+prettier+typecheck+test+`next build`; mobile tsc+eslint+`expo-doctor`), with `-Backend`/`-Web`/`-Mobile`/`-ApiClient` subset selectors and a `-Fast` switch that skips the slow `next build` + `expo-doctor`.

**Tech Stack:** Docker Compose v2 (profiles, healthchecks) · `postgis/postgis:17-3.5` · `svhd/logto:1.40.1` · PowerShell (Windows PowerShell 5.1 **and** PowerShell 7 compatible) · existing backend (FastAPI + uv + Alembic) and frontend (pnpm + Turborepo) toolchains.

## Global Constraints

- Repo `redducklabs/fountainrank` (public). **Phase 0 → commit directly to `main`** (no CI/PR gate yet; CI lands in 0f). Conventional Commits. **No AI attribution in commits/PRs. No time estimates anywhere.**
- **No secrets, no `.env` files** created or modified — ever. The only credentials in the Compose file are the **already-public local-dev throwaways** from `backend/README.md` / `backend/app/config.py` (`fountainrank` / `fountainrank_dev`) plus a local-only `logto` / `logto_dev` pair for the Logto database. These are not secrets; they are local fixtures. Do **not** introduce a `.env` file to hold them — inline them in the Compose file.
- **Windows host:** use **backslash paths** with Read/Write/Edit tools (`D:\repos\fountainrank\...`). The Bash tool is Git Bash (forward-slash, `/d/repos/fountainrank/...`). `run.ps1` must run under both **Windows PowerShell 5.1** and **PowerShell 7** — therefore **do not** use PS7-only syntax: no `&&`/`||` pipeline-chain operators, no ternary `? :`, no `??`. Use explicit `if ($LASTEXITCODE -ne 0) { throw }` after each native command.
- **Pinned images (verified 2026-06-17 — copy exactly):** `postgis/postgis:17-3.5` (unchanged from 0b/0c); `svhd/logto:1.40.1` (current stable self-hosted Logto; **not** `latest`/`edge`). Logto needs PostgreSQL ≥14 (PG17 satisfies it) and **no** extensions in its own DB.
- **Logto is topology-only in 0d.** Stand up the container + its database so 0e/0f/Phase 2 inherit a working Logto endpoint. **Do not** configure connectors, secrets, redirect URIs, or app registrations here (that is Phase 2). Leave `ENDPOINT` and `ADMIN_ENDPOINT` **unset** for localhost dev — setting them wrong triggers a known Logto 500 (logto-io/logto#6755).
- **`generate` is DB-free** (backend `app.export_openapi` does not connect). Frontend `typecheck`/`test`/`build` depend on `generate` via Turborepo, so they need `uv` + the backend importable, but **not** a running database.
- **`next build` mutates tracked files** (the 0c gotcha): it rewrites `web/next-env.d.ts` and flips `web/tsconfig.json`'s `jsx`. The committed forms are canonical. Any `run.ps1` path that runs `next build` **must** restore both files afterward (`git checkout -- web/next-env.d.ts web/tsconfig.json`) so the verb never dirties the tree.
- Each task ends with a direct-to-`main` commit; the final task pushes.

## Decisions (owner-approved 2026-06-17 — keep these)

- **Compose topology = profiles.** `up` → `db` only (fast everyday loop). `up -Auth` → `db` + `logto`. `up -Full` → `db` + `logto` + `backend` (the whole containerizable stack). Apps run on the host for daily dev.
- **`check` = full CI mirror by default**, with `-Backend` / `-Web` / `-Mobile` / `-ApiClient` subset selectors and a `-Fast` switch (skips `next build` + `expo-doctor`). "Green locally" must mean "green in CI."
- **Web is NOT containerized in 0d.** There is no `web/Dockerfile` yet (that is a 0f deliverable), and a dev web container is genuinely problematic here: the pnpm workspace `node_modules` is built for **Windows** (native deps `sharp`, `unrs-resolver`) and cannot be bind-mounted into a Linux container, while the api-client `generate` flow is host-coupled. So `-Full` containerizes **db + logto + backend**; **web runs on the host** (`run.ps1 web`) against the composed backend. The walking skeleton still "runs locally via docker-compose" (db + backend in containers); the real web image + web Compose service land in **0f**.
- **`run.ps1` lives at the repo root**, matching the already-committed `README.md` invocation (`.\run.ps1 up`). `scripts/` keeps `launch-codex.sh`. (The spec §22 layout sketch lists `scripts/run.ps1`; the root placement is the deliberate, owner-approved deviation — the implementation is the source of truth, per the 0c precedent.)
- **Logto gets its own database** (`logto`) and role in the same Postgres instance, created by the init script. This mirrors the production topology (separate database, same managed cluster).

---

### Task 1: Docker Compose stack + Logto DB init (+ alembic-commit fix)

**Files:**
- Create: `D:\repos\fountainrank\docker\docker-compose.yml`
- Create: `D:\repos\fountainrank\docker\initdb\99-create-logto-db.sql`
- Modify: `D:\repos\fountainrank\backend\migrations\env.py` (fix a pre-existing bug where online migrations never commit — see Step 3; **discovered during 0d verification, owner-approved to fold into 0d**)

**Interfaces:**
- Consumes: existing `backend/Dockerfile` (build context `../backend`); existing `backend/migrations` (Alembic `0001_enable_postgis`, idempotent); existing default `DATABASE_URL` shape from `backend/app/config.py`.
- Produces (relied on by Task 2 & Task 3):
  - Compose project **`fountainrank`** with services `db` (no profile), `logto` (profile `auth`), `backend` (profile `full`); named volume `db-data`.
  - `db`: `postgis/postgis:17-3.5`, env `POSTGRES_USER=fountainrank` / `POSTGRES_PASSWORD=fountainrank_dev` / `POSTGRES_DB=fountainrank`, host port `5436:5432`, `pg_isready` healthcheck. The logto init SQL is mounted as a **single file** at `/docker-entrypoint-initdb.d/99-create-logto-db.sql` (a directory mount would shadow the image's own `10_postgis.sh` and PostGIS would never be enabled).
  - A `logto` role (`LOGIN PASSWORD 'logto_dev'`) and `logto` database (owned by `logto`) created on first volume init.
  - `logto`: `svhd/logto:1.40.1`, `DB_URL=postgres://logto:logto_dev@db:5432/logto`, ports `3001:3001` (app) + `3002:3002` (admin), `depends_on db: service_healthy`.
  - `backend`: built from `../backend`, `DATABASE_URL=postgresql+asyncpg://fountainrank:fountainrank_dev@db:5432/fountainrank`, command `alembic upgrade head && uvicorn …`, port `8000:8000`, `depends_on db: service_healthy`.
  - `backend/migrations/env.py`: `alembic upgrade head` now **commits** (relied on by the `backend` service's startup command, by `run.ps1 migrate`/`backend`, and by the `check` verb's `alembic check`).

- [ ] **Step 1: Create the Logto DB init script**

`D:\repos\fountainrank\docker\initdb\99-create-logto-db.sql`:

```sql
-- Runs once on first volume initialization (docker-entrypoint-initdb.d), as the
-- POSTGRES_USER superuser. Creates a dedicated database + role for self-hosted
-- Logto, separate from the FountainRank application database. This mirrors the
-- production topology: a separate database within the same Postgres cluster.
-- Logto needs no PostGIS / extensions in its own database.
--
-- Local-dev-only throwaway credentials. NOT a secret. Do not reuse anywhere real.
CREATE ROLE logto WITH LOGIN PASSWORD 'logto_dev';
CREATE DATABASE logto OWNER logto;
```

- [ ] **Step 2: Create the Compose file**

`D:\repos\fountainrank\docker\docker-compose.yml`:

```yaml
# FountainRank local development stack. Driven by ../run.ps1.
#
# Profiles:
#   (default)  db only            -> docker compose up -d
#   auth       db + logto         -> docker compose --profile auth up -d
#   full       db + logto + backend (whole containerizable stack)
#                                 -> docker compose --profile auth --profile full up -d
#
# The web app is intentionally NOT containerized in Phase 0d (no web image yet;
# host-coupled api-client codegen). Run it on the host: `..\run.ps1 web`.
#
# All credentials here are local-dev throwaways (already documented in
# backend/README.md). They are NOT secrets. Do not add a .env file.
name: fountainrank

services:
  db:
    image: postgis/postgis:17-3.5
    environment:
      POSTGRES_USER: fountainrank
      POSTGRES_PASSWORD: fountainrank_dev
      POSTGRES_DB: fountainrank
    ports:
      - "5436:5432"
    volumes:
      - db-data:/var/lib/postgresql/data
      # Mount ONLY our file into the init dir. A directory mount of ./initdb here
      # would SHADOW the postgis image's own /docker-entrypoint-initdb.d/10_postgis.sh
      # (which creates template_postgis and loads PostGIS into the app DB), leaving
      # the database without PostGIS. Our file sorts after 10_postgis.sh, so the
      # extension is enabled first, then the logto DB/role are created.
      - ./initdb/99-create-logto-db.sql:/docker-entrypoint-initdb.d/99-create-logto-db.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fountainrank -d fountainrank"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s

  logto:
    image: svhd/logto:1.40.1
    profiles: ["auth"]
    depends_on:
      db:
        condition: service_healthy
    entrypoint: ["sh", "-c", "npm run cli db seed -- --swe && npm start"]
    environment:
      # Standard libpq URL to Logto's own database (created by initdb).
      DB_URL: postgres://logto:logto_dev@db:5432/logto
      # ENDPOINT / ADMIN_ENDPOINT intentionally unset for localhost dev
      # (setting them wrong triggers logto-io/logto#6755). App: 3001, Admin: 3002.
    ports:
      - "3001:3001"
      - "3002:3002"

  backend:
    profiles: ["full"]
    build:
      context: ../backend
    depends_on:
      db:
        condition: service_healthy
    environment:
      # Container talks to the db service over the compose network (not 5436).
      DATABASE_URL: postgresql+asyncpg://fountainrank:fountainrank_dev@db:5432/fountainrank
    command: ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
    ports:
      - "8000:8000"

volumes:
  db-data:
```

- [ ] **Step 3: Fix the alembic online-migration commit bug in `env.py`**

**Why (discovered during 0d verification):** `backend/migrations/env.py`'s `do_run_migrations` runs `connection.execute(text("SET search_path TO public"))` **before** `context.begin_transaction()`. In SQLAlchemy 2.0 that statement auto-begins a transaction, so Alembic sees an in-progress transaction and makes its own `begin_transaction()` a **no-op** (it assumes the caller will commit). The outer `async with engine.connect()` (commit-as-you-go, no `begin()`) then **rolls back** on close — so `alembic upgrade head` runs the migration, prints "Running upgrade", exits 0, but **never persists** (`alembic_version` is not created). This was masked in 0b/0c because PostGIS is enabled by the image regardless; it would silently break every Phase 1 migration and makes the `check` verb's `alembic check` meaningless. Fix: set `search_path` via asyncpg `server_settings` at connect time (a libpq connection parameter — no SQL, no transaction) and let Alembic own/commit its transaction.

In `D:\repos\fountainrank\backend\migrations\env.py`:

Change the import (drop now-unused `text`):
```python
from sqlalchemy import MetaData
```

Replace `do_run_migrations` + `run_migrations_online` with:
```python
def do_run_migrations(connection) -> None:
    # search_path is pinned to "public" at connection time via asyncpg server_settings
    # (see run_migrations_online) so autogenerate ignores the PostGIS extension schemas
    # (tiger, topology) the postgis/postgis Docker image adds to the DB-level search_path.
    # It is NOT set with an in-band `SET` here: that statement auto-begins a SQLAlchemy
    # 2.0 transaction, which makes Alembic's begin_transaction() a no-op (it assumes the
    # caller owns the commit) and leaves the migration uncommitted under engine.connect().
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    # server_settings sets search_path at connection establishment (a libpq connection
    # parameter), without issuing SQL that would open a transaction before Alembic does.
    engine = create_async_engine(
        get_url(),
        connect_args={"server_settings": {"search_path": "public"}},
    )
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()
```

Verify the fix (Git Bash; db must be up from Step 4's bring-up, or run `docker compose -f docker/docker-compose.yml up -d`):
```bash
cd /d/repos/fountainrank/backend
uv run alembic upgrade head
docker compose -f ../docker/docker-compose.yml exec -T db psql -U fountainrank -d fountainrank -tAc "SELECT version_num FROM alembic_version;"
uv run alembic current 2>&1 | tail -1
uv run alembic check
uv run ruff check migrations/env.py
uv run pytest -q
```
Expected: `alembic_version` prints `0001_enable_postgis`; `alembic current` shows `0001_enable_postgis (head)`; `alembic check` prints `No new upgrade operations detected.`; ruff passes; pytest is all-green (incl. `/readyz`). Commit this fix **separately** in Step 8.

- [ ] **Step 4: Verify the default (db-only) profile end to end**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
docker rm -f fr-postgis 2>/dev/null || true          # retire the old hand-rolled container if present
docker compose -f docker/docker-compose.yml down -v 2>/dev/null || true
docker compose -f docker/docker-compose.yml up -d
# wait for healthy
for i in $(seq 1 30); do
  docker compose -f docker/docker-compose.yml exec -T db pg_isready -U fountainrank -d fountainrank >/dev/null 2>&1 && break
  sleep 1
done
cd backend && uv run alembic upgrade head && cd ..
# PostGIS MUST be enabled (image's 10_postgis.sh ran; the single-file initdb mount did not shadow it):
docker compose -f docker/docker-compose.yml exec -T db psql -U fountainrank -d fountainrank -tAc "SELECT extname FROM pg_extension WHERE extname='postgis';"
docker compose -f docker/docker-compose.yml exec -T db psql -U fountainrank -d fountainrank -tAc "SELECT version_num FROM alembic_version;"
```
Expected: only the `db` container starts (no `logto`, no `backend`); `pg_isready` succeeds; `0001_enable_postgis` reports "Running upgrade" or already-at-head with no error; the extension query prints `postgis` (NOT empty — empty means the init mount shadowed `10_postgis.sh`); `alembic_version` prints `0001_enable_postgis`.

- [ ] **Step 5: Verify the `logto` database + role were created by initdb**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
docker compose -f docker/docker-compose.yml exec -T db psql -U fountainrank -d fountainrank -c "\l logto"
docker compose -f docker/docker-compose.yml exec -T db psql -U fountainrank -d fountainrank -tAc "SELECT rolname FROM pg_roles WHERE rolname='logto';"
```
Expected: `\l logto` lists a `logto` database owned by `logto`; the role query returns a single line `logto`. (The app DB's PostGIS path — the `/readyz` query — is exercised by backend `pytest` in Task 2's `check`.)

- [ ] **Step 6: Verify the `auth` profile (Logto boots and seeds)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
docker compose -f docker/docker-compose.yml --profile auth up -d
# Logto runs migrations + seed on first boot; give it time, then check the admin console:
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002 2>/dev/null || echo 000)
  echo "attempt $i -> $code"
  case "$code" in 2*|3*) break;; esac
  sleep 2
done
docker compose -f docker/docker-compose.yml logs --no-color --tail=20 logto
```
Expected: the `logto` container is `Up`; `http://localhost:3002` eventually returns a 2xx/3xx; logs show the seed completing and the server listening (no DB connection errors). The app endpoint `http://localhost:3001` is also reachable.

- [ ] **Step 7: Verify the `full` profile (containerized backend)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
docker compose -f docker/docker-compose.yml --profile auth --profile full up -d --build
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/healthz 2>/dev/null || echo 000)
  echo "attempt $i -> $code"
  [ "$code" = "200" ] && break
  sleep 2
done
curl -s http://localhost:8000/healthz
echo
curl -s http://localhost:8000/readyz
echo
```
Expected: the `backend` container builds and starts, runs `alembic upgrade head` against the composed `db`, then serves; `/healthz` returns `{"status":"ok"}` and `/readyz` returns the PostGIS version + the SF→NYC distance. Then tear the heavy services back down to leave only `db` for normal dev:
```bash
docker compose -f docker/docker-compose.yml down
docker compose -f docker/docker-compose.yml up -d   # db only
```

- [ ] **Step 8: Commit (two commits — keep the backend fix separate)**

```bash
cd /d/repos/fountainrank
# (1) the compose stack
git add docker/docker-compose.yml docker/initdb/99-create-logto-db.sql
git commit -m "build(dev): add docker compose stack with db/logto/backend profiles"
# (2) the alembic-commit fix, on its own so the backend change is isolated and bisectable
git add backend/migrations/env.py
git commit -m "fix(backend): commit alembic online migrations (search_path via server_settings)"
```

---

### Task 2: `run.ps1` task runner

**Files:**
- Create: `D:\repos\fountainrank\run.ps1`

**Interfaces:**
- Consumes: `docker/docker-compose.yml` (Task 1); the backend `uv` project in `backend/`; the pnpm/Turborepo workspace at the repo root (root scripts `lint`/`typecheck`/`test`/`build`/`format:check`/`generate`; turbo task graph with `generate` as a dependency of `typecheck`/`test`/`build`).
- Produces (verbs relied on by Task 3's docs):
  - `up [-Auth] [-Full]`, `down [-Volumes]`, `reset` — Compose lifecycle.
  - `backend`, `web`, `migrate`, `generate`, `bootstrap` — dev loop.
  - `check [-Backend|-Web|-Mobile|-ApiClient] [-Fast]` — local CI mirror.
  - `logs [service…]`, `psql`, `help`.

- [ ] **Step 1: Write the task runner**

`D:\repos\fountainrank\run.ps1`:

```powershell
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
        $args = @('down')
        if ($Volumes) { $args += '-v' }
        Invoke-Compose -Arguments $args
    }
    'reset' {
        Invoke-Compose -Arguments @('down', '-v')
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
```

> **Runtime for verification:** `run.ps1` must work under **Windows PowerShell 5.1** *and* PowerShell 7. On the Windows host, `powershell.exe` (always present) **is** 5.1 — so the steps below invoke `powershell.exe` from Git Bash, which both proves 5.1 compatibility and is the lowest-common-denominator runtime. Step 6 adds an explicit dual-runtime smoke (5.1 + 7-if-present). Do **not** verify only with `pwsh` — that would prove PS7 at most.

- [ ] **Step 2: Verify help + lifecycle verbs (Windows PowerShell 5.1)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
powershell.exe -NoProfile -File ./run.ps1 help
powershell.exe -NoProfile -File ./run.ps1 up
docker compose -f docker/docker-compose.yml ps
powershell.exe -NoProfile -File ./run.ps1 up -Auth
docker compose -f docker/docker-compose.yml ps
```
Expected: `help` prints the usage block; `up` starts only `db`; `up -Auth` additionally starts `logto`. `ps` shows the expected services running. (No PS7-only syntax error — proves 5.1 parses/runs the script.)

- [ ] **Step 3: Verify dev verbs (migrate + generate)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
powershell.exe -NoProfile -File ./run.ps1 migrate
powershell.exe -NoProfile -File ./run.ps1 generate
git status --porcelain
```
Expected: `migrate` brings up db (idempotent) and applies migrations with no error; `generate` regenerates the api-client (the generated `packages/api-client/openapi.json` + `src/schema.d.ts` are gitignored, so `git status` stays clean of them).

- [ ] **Step 4: Verify the full `check` (the CI mirror)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
powershell.exe -NoProfile -File ./run.ps1 check
git status --porcelain
```
Expected: backend ruff/format/`alembic check`/pytest all pass; frontend lint/format/typecheck/test pass; `web` builds; `expo-doctor` reports no issues; the script prints "All requested checks passed." in green. **`git status --porcelain` is empty** — proving the `next build` restore worked (no `web/next-env.d.ts` / `web/tsconfig.json` mutations left behind).

- [ ] **Step 5: Verify subset + `-Fast` selectors, and that a failed build still restores**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
powershell.exe -NoProfile -File ./run.ps1 check -Backend
powershell.exe -NoProfile -File ./run.ps1 check -Web -Fast
git status --porcelain
```
Expected: `check -Backend` runs only the backend checks; `check -Web -Fast` runs web eslint+prettier+typecheck+test but **skips `next build`**; tree stays clean.

Then prove the `finally`-restore on a build that fails **at the `next build` step** (not earlier). The failure must pass `lint`/`prettier`/`typecheck`/`test` and only blow up during Next's prerender — otherwise it never enters the `try` around the build. Use a **type-safe, env-guarded `throw` inside the page component**: it stays reachable (no unreachable-code lint error), type-checks cleanly, is not imported by any test, and fires only during `next build` (after Next has already rewritten `web/next-env.d.ts` / `web/tsconfig.json`).

Temporarily replace `web/app/page.tsx` with a guarded-throw version (prettier-clean), run a non-`-Fast` web check with the guard env set, confirm it fails **and** leaves the two tracked files clean, then revert:
```bash
cd /d/repos/fountainrank
cat > web/app/page.tsx <<'EOF'
import { BackendStatus } from "./backend-status";

export default function Home() {
  if (process.env.NEXT_PUBLIC_FORCE_BUILD_FAIL === "1") {
    throw new Error("forced build failure (run.ps1 finally test)");
  }
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">FountainRank</h1>
      <BackendStatus />
    </main>
  );
}
EOF
NEXT_PUBLIC_FORCE_BUILD_FAIL=1 powershell.exe -NoProfile -File ./run.ps1 check -Web ; echo "exit=$?"
git status --porcelain web/next-env.d.ts web/tsconfig.json
git checkout -- web/app/page.tsx
```
Expected: `lint`, Prettier, `typecheck`, and `test` all **pass** (the guard is valid, reachable code and no test imports the page); the run then **fails at `next build`** during prerender (`exit=` non-zero) because `Home()` throws with the env set. Crucially, `git status --porcelain web/next-env.d.ts web/tsconfig.json` prints **nothing** — the `finally { Restore-WebBuildArtifacts }` ran despite the build failure. (`git checkout` reverts the temporary page.) If instead the run had failed before reaching `next build`, those two files might be dirty and/or `.next` types never generated — that would mean the test didn't exercise the fix; re-check the guard is reachable and prettier-clean.

- [ ] **Step 6: Verify dual-runtime compatibility (PS 5.1 + PS 7 if present)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
echo "== Windows PowerShell 5.1 =="
powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
powershell.exe -NoProfile -File ./run.ps1 help >/dev/null && echo "5.1 help OK"
powershell.exe -NoProfile -File ./run.ps1 check -Backend >/dev/null && echo "5.1 check -Backend OK"
if command -v pwsh >/dev/null 2>&1; then
  echo "== PowerShell 7 =="
  pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'
  pwsh -NoProfile -File ./run.ps1 help >/dev/null && echo "7 help OK"
  pwsh -NoProfile -File ./run.ps1 check -Backend >/dev/null && echo "7 check -Backend OK"
else
  echo "pwsh (PS7) not installed on this host — 5.1 verified; note PS7 unverified locally."
fi
```
Expected: 5.1 reports a `5.1.x` version and runs `help` + `check -Backend` without a parse/runtime error; if `pwsh` is present it does the same under 7.x. If `pwsh` is absent, that is acceptable (5.1 is the binding floor) — record it.

- [ ] **Step 7: Commit**

```bash
cd /d/repos/fountainrank
git add run.ps1
git commit -m "build(dev): add run.ps1 task runner (stack lifecycle + local CI mirror)"
```

---

### Task 3: Finalize local-checks + getting-started docs

**Files:**
- Modify: `D:\repos\fountainrank\claude_help\testing-ci.md` (the "Local checks (mirror CI)" section)
- Modify: `D:\repos\fountainrank\README.md` (the "Getting started" section)
- Modify: `D:\repos\fountainrank\backend\README.md` (the "Prerequisites" + "Local database" sections)

**Interfaces:**
- Consumes: the `run.ps1` verbs from Task 2; the Compose stack from Task 1.
- Produces: documentation that names the exact `run.ps1 check …` commands as the local CI mirror, and points contributors at `run.ps1`/Compose instead of the retired hand-rolled `docker run`.

- [ ] **Step 1: Rewrite the testing-ci local-checks section**

In `D:\repos\fountainrank\claude_help\testing-ci.md`, replace the "## Local checks (mirror CI)" section body (the paragraph beginning "Exact commands are finalized…" through the line "Prefer running checks in the Docker Compose environment so they match CI.") with:

```markdown
## Local checks (mirror CI)

Run them through the root task runner — `./run.ps1 check` is the full CI mirror:

| Scope | Command | Runs |
|---|---|---|
| Everything | `./run.ps1 check` | backend + frontend + mobile (= CI) |
| Backend | `./run.ps1 check -Backend` | `ruff check` + `ruff format --check` + `alembic upgrade head` + `alembic check` (no drift) + `pytest` |
| Web | `./run.ps1 check -Web` | ESLint + Prettier + `tsc --noEmit` + `vitest run` + `next build` |
| Mobile | `./run.ps1 check -Mobile` | `tsc --noEmit` + ESLint + `expo-doctor` |
| api-client | `./run.ps1 check -ApiClient` | ESLint + `tsc --noEmit` + `vitest run` |
| Fast loop | `./run.ps1 check -Fast` | as above but skips `next build` + `expo-doctor` |

`check` auto-starts the `db` container for backend steps and restores the files
`next build` rewrites (`web/next-env.d.ts`, `web/tsconfig.json`) so it never
dirties the tree. The backend `pytest` and `alembic check` need the database;
`./run.ps1 up` (db only) is enough. The frontend `generate` step is DB-free.
```

- [ ] **Step 2: Update the root README getting-started section**

In `D:\repos\fountainrank\README.md`, replace the "## Getting started" section body (lines from "Local development uses Docker Compose…" through "Until then, the foundation work is documentation and configuration only.") with:

```markdown
## Getting started

Local development uses Docker Compose plus a PowerShell task runner (`run.ps1`):

```powershell
.\run.ps1 bootstrap   # install backend (uv) + workspace (pnpm) deps
.\run.ps1 up          # start Postgres/PostGIS (db only) on host port 5436
.\run.ps1 backend     # migrate + serve the API on http://localhost:8000 (host, --reload)
.\run.ps1 web         # serve the Next.js app on http://localhost:3000 (host)
```

Optional services are behind Compose profiles: `.\run.ps1 up -Auth` adds
self-hosted Logto (app `:3001`, admin `:3002`); `.\run.ps1 up -Full` also runs the
backend in a container. Mirror CI locally with `.\run.ps1 check` (see
[`claude_help/testing-ci.md`](claude_help/testing-ci.md)). Run `.\run.ps1 help`
for the full command list.
```

Then, in the same file, fix the **repository layout block** so it reflects the
root-level `run.ps1` decision (it currently shows `run.ps1` under `scripts/`).
Replace these two lines:

```
├── docker/  docker-compose.yml
├── scripts/  run.ps1  launch-codex.sh
```
with:
```
├── docker/  docker-compose.yml
├── scripts/  launch-codex.sh
├── run.ps1                   # local dev task runner (repo root)
```

- [ ] **Step 3: Update backend/README local-database guidance**

In `D:\repos\fountainrank\backend\README.md`:

Replace the "## Prerequisites" list with:
```markdown
## Prerequisites

- uv 0.11.x
- Docker (the local Postgres/PostGIS database runs via `docker compose`)
```

Replace the "## Local database" section (from the `docker run …` block through the "SSL options go through `connect_args`." line) with:
```markdown
## Local database

From the repo root, start Postgres/PostGIS via the task runner:

```powershell
.\run.ps1 up        # starts the `db` service (postgis/postgis:17-3.5) on host port 5436
.\run.ps1 migrate   # applies migrations (enables PostGIS)
```

The default `DATABASE_URL` points at this container
(`postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank`).
Override with the `DATABASE_URL` env var. **Do not** put `sslmode` in the URL
(asyncpg rejects it); SSL options go through `connect_args`.
```

- [ ] **Step 4: Verify docs are accurate**

Run (Git Bash):
```bash
cd /d/repos/fountainrank
grep -n "run.ps1 check" claude_help/testing-ci.md
grep -n "run.ps1" README.md backend/README.md
# Sanity: the commands named in the docs exist as verbs in run.ps1
grep -nE "'(up|down|reset|backend|web|migrate|generate|bootstrap|check|logs|psql|help)'" run.ps1
```
Expected: the testing-ci table references `./run.ps1 check` variants; both READMEs reference `run.ps1`; every documented verb appears in the `switch` block of `run.ps1`. Cross-check by eye that no doc still tells a contributor to run the old `docker run --name fr-postgis …` command.

- [ ] **Step 5: Commit and push**

```bash
cd /d/repos/fountainrank
git add claude_help/testing-ci.md README.md backend/README.md
git commit -m "docs: point local dev at run.ps1 + compose; finalize CI-mirror checks"
git push origin main
```

---

## Self-Review

**Spec coverage** (against spec §21 "Local dev" + the 0c handoff "Next steps → 0d"):
- "`docker-compose.yml` (postgres+postgis, logto, backend, web)" → Task 1 delivers db + logto + backend; **web is deliberately deferred to 0f** (owner-approved Decision; documented in the plan + commit). Substantially met; the literal "web" service is the one scoped-out item, with rationale.
- "host port 5436" → Task 1 `db` maps `5436:5432`. ✓
- "`run.ps1` task runner" → Task 2. ✓
- "Finalize the per-subsystem local checks in `claude_help/testing-ci.md`" → Task 3 Step 1. ✓
- "Consider wiring the api-client `generate` into the dev flow" → `run.ps1 generate` verb + `check` runs generate via turbo deps. ✓
- "replaces the manual `fr-postgis` container" → Task 1 Step 4 retires it; Task 3 removes the `docker run` instructions from `backend/README.md`. ✓
- **Added in 0d (owner-approved, found during verification):** Task 1 Step 3 fixes a pre-existing `env.py` bug where `alembic upgrade head` never committed (masked in 0b/0c by image-provided PostGIS). Required for the `check` verb's `alembic check` to be meaningful and to unblock Phase 1 migrations. Committed separately as `fix(backend):`. ✓

**Placeholder scan:** No "TBD"/"TODO"/"handle edge cases". All file contents are complete and copy-paste-ready; every verification step runs a concrete command with a stated expected result.

**Type/name consistency:** Service names (`db`/`logto`/`backend`), the `logto` role/db, profile names (`auth`/`full`), env keys (`DATABASE_URL`, `DB_URL`), and `run.ps1` verbs/switches are used identically across Tasks 1–3 and the docs. `check` subset switches (`-Backend`/`-Web`/`-Mobile`/`-ApiClient`/`-Fast`) match between `run.ps1` (Task 2) and `testing-ci.md` (Task 3).

**Codex plan-review-1 findings (all addressed):**
- [MAJOR] `next build` restore not guaranteed on failure → `Invoke-WebCheck` and `Invoke-FullCheck` now wrap the build in `try { … } finally { Restore-WebBuildArtifacts }`; Task 2 Step 5 adds a deliberate-break test proving the tree stays clean on a failed build.
- [MAJOR] PS 5.1 compat unverified → all Task 2 verification now invokes `powershell.exe` (Windows PowerShell 5.1, always present on the host) from Git Bash, plus a new Step 6 dual-runtime smoke (5.1 + PS7-if-present).
- [MINOR] README layout block still showed `scripts/ run.ps1` → Task 3 Step 2 now also fixes the repo-tree block to root-level `run.ps1`.

**Known residual risks (call out, don't hide):**
- `pnpm dlx expo-doctor` fetches `expo-doctor` over the network (unpinned by design — Expo ships it to be run via dlx/npx and self-checks against the installed SDK). If offline, `check -Mobile` / full `check` will fail at the doctor step; use `-Fast` to skip.
- `svhd/logto:1.40.1`'s first boot pulls a sizeable image and runs migrations; Task 1 Steps 6–7 poll with generous retries. This is a one-time cost per fresh volume.
