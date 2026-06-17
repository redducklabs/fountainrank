# Phase 0b — Backend Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a minimal but real FastAPI + PostgreSQL/PostGIS backend in `backend/` — a `/healthz` liveness endpoint and a `/readyz` endpoint that proves async DB connectivity + PostGIS work — with a uv-locked project, async Alembic migrations, pytest, ruff, and a container image.

**Architecture:** A uv-managed, non-packaged Python application. FastAPI app (`app/`) with a lazily-initialized async SQLAlchemy 2.0 engine over asyncpg. `/healthz` is DB-free (load-balancer liveness); `/readyz` opens an async session and runs `PostGIS_version()` + an `ST_Distance(...::geography)` computation (readiness + PostGIS proof, no table needed — the real data model is Phase 1). Alembic runs async and its first migration enables the PostGIS extension. Tests use httpx `ASGITransport`; the DB-backed test runs against a `postgis/postgis` container reachable via `DATABASE_URL` (mirroring how 0f CI will supply a Postgres `services:` container).

**Tech Stack:** Python 3.13, FastAPI, Uvicorn, SQLAlchemy 2.0 (async) + asyncpg, Alembic, GeoAlchemy2 (declared for Phase 1; installed now), Pydantic v2 + pydantic-settings, pytest + pytest-asyncio + httpx, ruff, uv, Docker. PostgreSQL 17 + PostGIS 3.5.

## Global Constraints

- Repo `redducklabs/fountainrank` (public). **Phase 0 → commit directly to `main`** (no CI/PR gate yet; CI lands in 0f). Conventional Commits. **No AI attribution. No time estimates.**
- **No secrets, no `.env` files** created or modified. Config reads real environment variables only; `Settings` is configured with `env_file=None`.
- Windows host: use **backslash paths** with Read/Write/Edit tools; the Bash tool is Git Bash (forward-slash, `/d/repos/fountainrank/...`).
- **Pinned versions (verified 2026-06-17 — copy exactly):**
  - Python **3.13.14** (`requires-python = ">=3.13,<3.14"`; `.python-version` = `3.13`). Do **not** use 3.14.
  - uv **0.11.21** · FastAPI **0.137.1** · Uvicorn **0.49.0** (`uvicorn[standard]`) · Pydantic **2.13.4** · pydantic-settings **2.14.1** · SQLAlchemy **2.0.51** (`sqlalchemy[asyncio]`, stay on 2.0 — no 2.1) · asyncpg **0.31.0** · Alembic **1.18.4** · GeoAlchemy2 **0.20.0** · pytest **9.1.0** · pytest-asyncio **1.4.0** · httpx **0.28.1** · ruff **0.15.17**.
  - App base image **`python:3.13-slim-trixie`** · PostGIS image **`postgis/postgis:17-3.5`** (Postgres 17 + PostGIS 3.5.2).
  - **Pin 0.x packages exactly** (FastAPI, uvicorn, ruff, httpx, GeoAlchemy2): minors can change behavior/lint/format.
- **Async correctness rules (from version research):**
  - DSN scheme is `postgresql+asyncpg://`. **asyncpg rejects libpq `?sslmode=` query args** — never put `sslmode` in the URL; SSL (DO Managed Postgres, 0e) goes through `connect_args`. Local/CI use no SSL.
  - `async_sessionmaker(..., expire_on_commit=False)` — avoids the GeoAlchemy2/`AsyncSession` expired-attribute reload gotcha (matters once geometry columns exist in Phase 1).
  - **`asyncio_mode = "auto"`** in pytest config — otherwise unmarked `async def` tests are silently skipped (false green).
  - PostGIS availability comes from an **Alembic migration** (`CREATE EXTENSION IF NOT EXISTS postgis`), not merely from the image.
- Local dev Postgres is exposed on host port **5436** (matches `scripts/launch-codex.sh` and the future `docker-compose.yml`). The `Settings.database_url` default points there.
- All work happens under `D:\repos\fountainrank\backend\`. Each task ends with a direct-to-`main` commit; the final task pushes.

---

### Task 1: uv project scaffold + tooling config

**Files:**
- Create: `D:\repos\fountainrank\backend\pyproject.toml`
- Create: `D:\repos\fountainrank\backend\.python-version`
- Create: `D:\repos\fountainrank\backend\app\__init__.py`
- Create: `D:\repos\fountainrank\backend\app\routers\__init__.py`
- Create: `D:\repos\fountainrank\backend\tests\__init__.py`
- Generate: `D:\repos\fountainrank\backend\uv.lock`

**Interfaces:**
- Produces: a resolvable uv project. Later tasks rely on `app/` being importable (package=false; run via `uv run`), on the dev tools (`pytest`, `pytest-asyncio`, `httpx`, `ruff`), and on `asyncio_mode = "auto"`.

- [ ] **Step 1: Confirm uv is available**

Run: `uv --version`
Expected: prints `uv 0.11.21` (or compatible 0.11.x). If missing, install per <https://docs.astral.sh/uv/> and re-run.

- [ ] **Step 2: Create `.python-version`**

```text
3.13
```

- [ ] **Step 3: Create `pyproject.toml`**

```toml
[project]
name = "fountainrank-backend"
version = "0.0.0"
description = "FountainRank FastAPI + PostGIS backend (walking skeleton)"
requires-python = ">=3.13,<3.14"
dependencies = [
    "fastapi==0.137.1",
    "uvicorn[standard]==0.49.0",
    "pydantic==2.13.4",
    "pydantic-settings==2.14.1",
    "sqlalchemy[asyncio]==2.0.51",
    "asyncpg==0.31.0",
    "alembic==1.18.4",
    "geoalchemy2==0.20.0",
]

[dependency-groups]
dev = [
    "pytest==9.1.0",
    "pytest-asyncio==1.4.0",
    "httpx==0.28.1",
    "ruff==0.15.17",
]

[tool.uv]
package = false

[tool.ruff]
line-length = 100
target-version = "py313"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "ASYNC"]

[tool.ruff.lint.isort]
known-first-party = ["app"]

[tool.ruff.lint.flake8-bugbear]
# FastAPI uses these as argument defaults by design; don't flag B008 for them.
extend-immutable-calls = [
    "fastapi.Depends",
    "fastapi.Query",
    "fastapi.Path",
    "fastapi.Header",
    "fastapi.Body",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 4: Create empty package markers**

Create three empty files: `app/__init__.py`, `app/routers/__init__.py`, `tests/__init__.py` (each zero bytes).

- [ ] **Step 5: Resolve and lock**

Run: `cd /d/repos/fountainrank/backend && uv sync`
Expected: uv provisions Python 3.13.14, creates `.venv`, writes `uv.lock`, installs all deps + dev group with no resolution error.

- [ ] **Step 6: Verify imports + ruff**

Run: `cd /d/repos/fountainrank/backend && uv run python -c "import fastapi, sqlalchemy, geoalchemy2, asyncpg, alembic; print('imports ok')"`
Expected: `imports ok`.

Run: `cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check .`
Expected: ruff reports no errors (no Python source beyond empty `__init__` files yet).

- [ ] **Step 7: Commit**

```bash
cd /d/repos/fountainrank
git add backend/pyproject.toml backend/.python-version backend/uv.lock backend/app/__init__.py backend/app/routers/__init__.py backend/tests/__init__.py
git commit -m "build(backend): scaffold uv project with pinned deps and tooling config"
```

---

### Task 2: Settings + async DB engine/session

**Files:**
- Create: `D:\repos\fountainrank\backend\app\config.py`
- Create: `D:\repos\fountainrank\backend\app\db.py`
- Test: `D:\repos\fountainrank\backend\tests\test_config.py`

**Interfaces:**
- Produces:
  - `app.config.Settings` (pydantic-settings) with `database_url: str` (default `postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank`) and `app_name: str`; `get_settings() -> Settings` (lru-cached).
  - `app.db.get_engine() -> AsyncEngine`, `get_sessionmaker() -> async_sessionmaker[AsyncSession]`, and the FastAPI dependency `get_session() -> AsyncGenerator[AsyncSession, None]`. Engine creation is **lazy** (first call), so importing the app does not open a connection — Task 3's `/healthz` test needs no DB.

- [ ] **Step 1: Write the failing test**

`tests/test_config.py`:

```python
from app.config import Settings


def test_default_url_is_async_postgres():
    settings = Settings()
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert ":5436/" in settings.database_url


def test_env_override(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    settings = Settings()
    assert settings.database_url == "postgresql+asyncpg://u:p@h:5432/d"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 3: Implement `app/config.py`**

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    # Async SQLAlchemy URL. NOTE: asyncpg rejects libpq `?sslmode=` args —
    # never add sslmode here; SSL (DO Managed Postgres) goes via connect_args.
    database_url: str = (
        "postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank"
    )
    app_name: str = "fountainrank-backend"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Implement `app/db.py`**

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        # expire_on_commit=False avoids the GeoAlchemy2/AsyncSession expired-
        # attribute reload gotcha once geometry columns exist (Phase 1).
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessionmaker is None:
        get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_sessionmaker()() as session:
        yield session
```

- [ ] **Step 5: Run test to verify it passes + lint**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_config.py -v`
Expected: 2 passed.

Run: `cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/config.py backend/app/db.py backend/tests/test_config.py
git commit -m "feat(backend): add settings and async database session"
```

---

### Task 3: FastAPI app + `/healthz` (DB-free)

**Files:**
- Create: `D:\repos\fountainrank\backend\app\main.py`
- Create: `D:\repos\fountainrank\backend\app\routers\health.py`
- Create: `D:\repos\fountainrank\backend\tests\conftest.py`
- Test: `D:\repos\fountainrank\backend\tests\test_health.py`

**Interfaces:**
- Consumes: `app.config.get_settings` (Task 2).
- Produces:
  - `app.main.create_app() -> FastAPI` and module-level `app = create_app()`.
  - `app.routers.health.router` (an `APIRouter`) exposing `GET /healthz` → `{"status": "ok"}`.
  - pytest fixture `client` (async httpx `AsyncClient` over `ASGITransport`) in `conftest.py`, reused by later tests.

- [ ] **Step 1: Write the failing test**

`tests/test_health.py`:

```python
async def test_healthz_ok(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

`tests/conftest.py`:

```python
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Implement `app/routers/health.py`**

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 4: Implement `app/main.py`**

```python
from fastapi import FastAPI

from app.config import get_settings
from app.routers import health


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    app.include_router(health.router)
    return app


app = create_app()
```

- [ ] **Step 5: Run test to verify it passes + lint**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_health.py -v`
Expected: 1 passed (no DB connection attempted).

Run: `cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/main.py backend/app/routers/health.py backend/tests/conftest.py backend/tests/test_health.py
git commit -m "feat(backend): add FastAPI app and /healthz liveness endpoint"
```

---

### Task 4: Async Alembic + PostGIS extension migration

**Files:**
- Create (via `alembic init`): `D:\repos\fountainrank\backend\alembic.ini`, `D:\repos\fountainrank\backend\migrations\` (incl. `script.py.mako`, `versions\`)
- Modify/Replace: `D:\repos\fountainrank\backend\migrations\env.py`
- Create: `D:\repos\fountainrank\backend\migrations\versions\0001_enable_postgis.py`

**Interfaces:**
- Consumes: `app.config.get_settings` (Task 2) for the DB URL.
- Produces: a runnable async Alembic setup whose head migration `0001_enable_postgis` enables PostGIS. `target_metadata` is an empty `MetaData()` plus an `include_object` filter that excludes PostGIS's `spatial_ref_sys`, so `alembic check` runs the autogenerate path and reports no drift on an extension-only database. Task 5's `/readyz` relies on the extension being present.

- [ ] **Step 1: Start a local PostGIS container** (needed for Steps 4–5)

Run:
```bash
docker rm -f fr-postgis 2>/dev/null || true
docker run -d --name fr-postgis \
  -e POSTGRES_USER=fountainrank -e POSTGRES_PASSWORD=fountainrank_dev -e POSTGRES_DB=fountainrank \
  -p 5436:5432 postgis/postgis:17-3.5
# Wait deterministically until Postgres accepts connections:
for i in $(seq 1 30); do
  docker exec fr-postgis pg_isready -U fountainrank -d fountainrank >/dev/null 2>&1 && break
  sleep 1
done
docker exec fr-postgis pg_isready -U fountainrank -d fountainrank
```
Expected: prints a container id, then a line ending `accepting connections`.

- [ ] **Step 2: Initialize the async Alembic scaffold**

Run: `cd /d/repos/fountainrank/backend && uv run alembic init -t async migrations`
Expected: creates `alembic.ini` and `migrations/` (with `env.py`, `script.py.mako`, `versions/`).

- [ ] **Step 3: Replace `migrations/env.py`** (drive the URL from app settings; async; no metadata yet)

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No ORM models yet (Phase 1 introduces them). An empty MetaData gives Alembic a
# valid comparison target so `alembic check` runs the autogenerate path and can
# report no drift.
target_metadata = MetaData()

# PostGIS's own objects (from CREATE EXTENSION postgis) must be excluded from
# autogenerate/check, or an extension-only DB looks like a pending DROP of
# spatial_ref_sys. geometry_columns/geography_columns are views, already ignored.
_POSTGIS_MANAGED_TABLES = {"spatial_ref_sys"}


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    if type_ == "table" and name in _POSTGIS_MANAGED_TABLES:
        return False
    return True


def get_url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        include_object=include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(get_url())
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

> `env.py` builds the engine from `get_url()`, so the `sqlalchemy.url` line in `alembic.ini` is unused (leave it as generated).

- [ ] **Step 4: Create the first migration `migrations/versions/0001_enable_postgis.py`**

```python
"""enable postgis

Revision ID: 0001_enable_postgis
Revises:
Create Date: 2026-06-17
"""

from alembic import op

revision = "0001_enable_postgis"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS postgis")
```

- [ ] **Step 5: Apply and verify no drift**

Run: `cd /d/repos/fountainrank/backend && uv run alembic upgrade head`
Expected: runs `0001_enable_postgis` with no error.

Run: `cd /d/repos/fountainrank/backend && uv run alembic check`
Expected: `No new upgrade operations detected.` (exit 0).

Run (confirm the extension is installed): `docker exec fr-postgis psql -U fountainrank -d fountainrank -tAc "SELECT extname FROM pg_extension WHERE extname='postgis';"`
Expected: `postgis`.

- [ ] **Step 6: Lint + commit**

Run: `cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean (run `uv run ruff format .` first if needed, then re-check).

```bash
cd /d/repos/fountainrank
git add backend/alembic.ini backend/migrations
git commit -m "feat(backend): add async Alembic setup and PostGIS extension migration"
```

---

### Task 5: `/readyz` PostGIS-backed readiness endpoint

**Files:**
- Modify: `D:\repos\fountainrank\backend\app\routers\health.py`
- Test: `D:\repos\fountainrank\backend\tests\test_readyz.py`

**Interfaces:**
- Consumes: `app.db.get_session` (Task 2), the PostGIS extension (Task 4).
- Produces: `GET /readyz` → `{"status": "ok", "postgis_version": "<str>", "sf_to_nyc_m": <float>}`. Requires a reachable DB with PostGIS; this is the project's first DB-backed integration test.

- [ ] **Step 1: Ensure the DB is up and migrated** (from Task 4)

Run: `docker ps --filter name=fr-postgis --format "{{.Names}} {{.Status}}"`
Expected: shows `fr-postgis Up ...`. If not, repeat Task 4 Step 1 (including the `pg_isready` readiness wait) and Step 5.

- [ ] **Step 2: Write the failing test**

`tests/test_readyz.py`:

```python
async def test_readyz_reports_postgis(client):
    resp = await client.get("/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["postgis_version"]  # non-empty version string, e.g. "3.5 USE_GEOS=1 ..."
    # SF (-122.4194, 37.7749) -> NYC (-73.9857, 40.7484) geodesic ~4,129 km.
    assert 4_000_000 < body["sf_to_nyc_m"] < 4_300_000
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_readyz.py -v`
Expected: FAIL — 404 (route not defined), so the `status_code == 200` assertion fails.

- [ ] **Step 4: Add `/readyz` to `app/routers/health.py`**

Replace the file with:

```python
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
async def readyz(session: AsyncSession = Depends(get_session)) -> dict[str, str | float]:
    version = (await session.execute(text("SELECT PostGIS_version()"))).scalar_one()
    distance_m = (
        await session.execute(
            text(
                "SELECT ST_Distance("
                "ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography, "
                "ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326)::geography)"
            )
        )
    ).scalar_one()
    return {"status": "ok", "postgis_version": version, "sf_to_nyc_m": float(distance_m)}
```

- [ ] **Step 5: Run the full test suite to verify it passes + lint**

Run: `cd /d/repos/fountainrank/backend && uv run pytest -v`
Expected: all tests pass (`test_config`, `test_healthz_ok`, `test_readyz_reports_postgis`).

Run: `cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check .`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/routers/health.py backend/tests/test_readyz.py
git commit -m "feat(backend): add /readyz PostGIS-backed readiness endpoint"
```

---

### Task 6: Multi-stage uv Dockerfile

**Files:**
- Create: `D:\repos\fountainrank\backend\Dockerfile`
- Create: `D:\repos\fountainrank\backend\.dockerignore`

**Interfaces:**
- Consumes: `pyproject.toml` + `uv.lock` (Task 1), `app/` + `migrations/` + `alembic.ini` (Tasks 2–5).
- Produces: a runtime image serving the app via uvicorn on port 8000. `/healthz` works with no DB; `/readyz` needs `DATABASE_URL` at runtime.

- [ ] **Step 1: Create `.dockerignore`**

```text
.venv
__pycache__
*.pyc
.pytest_cache
.ruff_cache
tests
.git
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.13-slim-trixie AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /usr/local/bin/uv
WORKDIR /app

FROM base AS deps
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
# package=false => this installs only the locked dependencies (no project build).
RUN uv sync --frozen --no-dev

FROM base AS runtime
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Build the image**

Run: `cd /d/repos/fountainrank/backend && docker build -t fountainrank-backend:dev .`
Expected: build completes; final stage tagged `fountainrank-backend:dev`.

- [ ] **Step 4: Run the container and probe `/healthz`** (DB-free path)

Run:
```bash
docker rm -f fr-backend 2>/dev/null || true
docker run -d --name fr-backend -p 8000:8000 fountainrank-backend:dev
for i in $(seq 1 15); do curl -fsS http://localhost:8000/healthz && break; sleep 1; done
curl -fsS http://localhost:8000/healthz
```
Expected: `{"status":"ok"}` (the final `curl` fails non-zero if the endpoint never came up).

- [ ] **Step 5: Tear down the probe container**

Run: `docker rm -f fr-backend`
Expected: prints `fr-backend`.

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/Dockerfile backend/.dockerignore
git commit -m "build(backend): add multi-stage uv Dockerfile"
```

---

### Task 7: pre-commit ruff hooks, backend README, pinned versions, push

**Files:**
- Modify: `D:\repos\fountainrank\.pre-commit-config.yaml`
- Modify: `D:\repos\fountainrank\README.md` (Software Versions table)
- Create: `D:\repos\fountainrank\backend\README.md`

**Interfaces:**
- Consumes: the backend project (Tasks 1–6).
- Produces: ruff lint+format enforced on `backend/` via pre-commit (mirrors the backend CI lint that 0f will add); a filled-in root Software Versions table; a backend run/test/migrate runbook.

- [ ] **Step 1: Add ruff hooks to `.pre-commit-config.yaml`**

Append this repo block to the existing `repos:` list (after the gitleaks block):

```yaml
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.17
    hooks:
      - id: ruff-check
        args: ["--fix"]
        files: ^backend/
      - id: ruff-format
        files: ^backend/
```

- [ ] **Step 2: Run pre-commit on the backend + config**

Run:
```bash
cd /d/repos/fountainrank
pre-commit run --files .pre-commit-config.yaml $(git ls-files 'backend/**/*.py')
```
Expected: `ruff-check` and `ruff-format` (and the baseline hooks) pass. If a hook id errors as unknown, the current ruff-pre-commit ids are `ruff-check` + `ruff-format`; correct and re-run. If ruff auto-fixes/reformats, re-stage and re-run until clean.

- [ ] **Step 3: Update the root `README.md` Software Versions table**

Replace the existing table body under `## Software Versions` with:

```markdown
| Component | Version | Last checked |
|---|---|---|
| Python | 3.13.14 | 2026-06-17 |
| Node.js | 22.x | _pending 0c_ |
| PostgreSQL / PostGIS | 17 / 3.5.2 | 2026-06-17 |
| uv | 0.11.21 | 2026-06-17 |
| FastAPI | 0.137.1 | 2026-06-17 |
| SQLAlchemy | 2.0.51 | 2026-06-17 |
| Alembic | 1.18.4 | 2026-06-17 |
| ruff | 0.15.17 | 2026-06-17 |
| (full backend pins) | see `backend/pyproject.toml` + `backend/uv.lock` | — |
```

- [ ] **Step 4: Create `backend/README.md`**

```markdown
# FountainRank Backend

FastAPI + PostgreSQL/PostGIS, managed with [uv](https://docs.astral.sh/uv/).
Async SQLAlchemy 2.0 over asyncpg; migrations via Alembic.

## Prerequisites

- uv 0.11.x
- Docker (for a local PostGIS database until `docker-compose.yml` lands in 0d)

## Local database

```bash
docker run -d --name fr-postgis \
  -e POSTGRES_USER=fountainrank -e POSTGRES_PASSWORD=fountainrank_dev -e POSTGRES_DB=fountainrank \
  -p 5436:5432 postgis/postgis:17-3.5
```

The default `DATABASE_URL` points at this container
(`postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank`).
Override with the `DATABASE_URL` env var. **Do not** put `sslmode` in the URL
(asyncpg rejects it); SSL options go through `connect_args`.

## Common commands

```bash
uv sync                              # install deps (creates .venv)
uv run alembic upgrade head          # apply migrations (enables PostGIS)
uv run uvicorn app.main:app --reload # serve on http://localhost:8000
uv run pytest                        # run tests (needs the DB for /readyz)
uv run ruff check . && uv run ruff format --check .
```

## Endpoints

- `GET /healthz` — liveness (no DB).
- `GET /readyz` — readiness; verifies the DB connection and PostGIS.
```

- [ ] **Step 5: Final verification — full suite green**

Run:
```bash
cd /d/repos/fountainrank && pre-commit run --files README.md backend/README.md
cd /d/repos/fountainrank/backend && uv run ruff check . && uv run ruff format --check . && uv run pytest -v
```
Expected: pre-commit passes on the READMEs; ruff clean; all tests pass.

- [ ] **Step 6: Commit and push Phase 0b**

```bash
cd /d/repos/fountainrank
git add .pre-commit-config.yaml README.md backend/README.md
git commit -m "docs(backend): add ruff pre-commit hooks, backend README, and pin versions"
git push origin main
```

- [ ] **Step 7: Clean up the local DB container** (optional)

Run: `docker rm -f fr-postgis fr-backend 2>/dev/null; echo done`
Expected: `done` (containers removed if present).

---

## Self-Review

**Spec coverage (spec §21 Phase 0b items + handoff "0b"):**
- FastAPI app + `/healthz` → Task 3. ✅
- One PostGIS-backed endpoint → Task 5 (`/readyz`: `PostGIS_version()` + `ST_Distance` geography). ✅
- uv project → Task 1. ✅  Alembic init (async) → Task 4. ✅  pytest → Tasks 2/3/5. ✅  ruff → Task 1 config + Task 7 pre-commit. ✅  Dockerfile → Task 6. ✅
- Pin Python/dep versions + fill README "Software Versions" → Task 1 (pins) + Task 7 (README). ✅
- Deferred (correctly out of 0b): ORM models / fountains API (Phase 1), docker-compose + run.ps1 (0d), CI workflows + pip-audit + Trivy + the backend CI lint/test jobs (0f), DO Managed Postgres SSL `connect_args` + PostGIS enablement on the managed cluster (0e). Each noted inline.

**Placeholder scan:** Every code/config file is given complete content (pyproject, config.py, db.py, main.py, health.py, env.py, the migration, Dockerfile, .dockerignore, both READMEs, the pre-commit block). No "TBD/implement later." The one conditional ("if the ruff hook id errors, use `ruff-check`/`ruff-format`") is a verified-fallback note, not a missing value — the given ids are already the current ones.

**Type/name consistency:** `get_settings`/`Settings.database_url` defined in Task 2 and used in Task 4 `env.py`. `get_session` defined in Task 2, consumed by `/readyz` in Task 5. `app.routers.health.router` created in Task 3 and extended (not renamed) in Task 5; `app.main.app` imported by `conftest.py` (Task 3) and used by all endpoint tests. The `fr-postgis` container name, port `5436`, and credentials are identical across Task 4, Task 5, `backend/README.md`, and `Settings.database_url`. Pinned versions are identical between Global Constraints, `pyproject.toml` (Task 1), the Dockerfile (Task 6), the pre-commit `rev` (Task 7), and the README table (Task 7).
