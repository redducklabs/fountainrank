# FountainRank Backend

FastAPI + PostgreSQL/PostGIS, managed with [uv](https://docs.astral.sh/uv/).
Async SQLAlchemy 2.0 over asyncpg; migrations via Alembic.

## Prerequisites

- uv 0.11.x
- Docker (the local Postgres/PostGIS database runs via `docker compose`)

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
