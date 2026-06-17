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
