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
uv run uvicorn app.main:app --port 3021 --reload # serve on http://localhost:3021
uv run pytest                        # run tests (needs the DB for /readyz)
uv run ruff check . && uv run ruff format --check .
```

## Endpoints

Operational:

- `GET /healthz` — liveness (no DB).
- `GET /readyz` — readiness; verifies the DB connection and PostGIS.

### API (Phase 1)

All application endpoints are versioned under `/api/v1`. Coordinates are always
`latitude`/`longitude` in the API contract (PostGIS's `(lon, lat)` ordering is
confined to `app/geo.py`).

Reads (public — no auth):

- `GET /api/v1/rating-types` — the four seeded rating dimensions (Clarity, Taste,
  Pressure, Appearance), in `sort_order`.
- `GET /api/v1/fountains?lat=&lng=&radius_m=` — fountains near a point
  (`ST_DWithin`), nearest first, with `distance_m`. `radius_m` is optional
  (defaults to `nearby_default_radius_m`, capped at `nearby_max_radius_m`).
- `GET /api/v1/fountains/bbox?min_lat=&min_lng=&max_lat=&max_lng=` — fountains in
  a viewport envelope (`ST_Intersects`). Inverted bounds (min > max) → `422`.
- `GET /api/v1/fountains/{fountain_id}` — full detail with a per-dimension
  average/vote breakdown. Unknown id → `404`.

Writes (require auth — see below):

- `POST /api/v1/fountains` — add a fountain. Body:
  `{ "location": { "latitude", "longitude" }, "is_working"?, "comments"?, "ratings"?: [{ "rating_type_id", "stars" }] }`.
  Rejects a location within `duplicate_threshold_m` of an existing fountain
  (`409`); unknown `rating_type_id` or out-of-range `stars` → `422`. Returns the
  created fountain detail (`201`).
- `POST /api/v1/fountains/{fountain_id}/ratings` — create/update this user's
  ratings for a fountain (atomic upsert on `(fountain, user, dimension)`). Body:
  `{ "ratings": [{ "rating_type_id", "stars" }] }` (non-empty). Unknown fountain
  → `404`. Returns the updated fountain detail.

### Authentication (Phase 1 dev seam)

Write endpoints depend on `get_current_user`, which in Phase 1 is a **dev-only
seam that is disabled by default** (`dev_auth_enabled=False`) so production never
exposes an unauthenticated write path. To exercise writes locally:

1. Set `DEV_AUTH_ENABLED=true` (the `run.ps1 backend` dev command does this for
   you). Never enable it in production.
2. Send an `X-Dev-User: <logto-subject>` header identifying the caller. A local
   `User` is provisioned just-in-time on first sight. `X-Dev-Email` and
   `X-Dev-Name` are optional overrides (defaulted otherwise).

A missing header (when enabled) or any write while disabled returns `401`. In
Phase 2 this seam is replaced by Logto JWT validation (verify `iss`/`aud` via
JWKS, take `sub`); the just-in-time provisioning tail is unchanged.
