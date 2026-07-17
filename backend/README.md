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
  average/vote breakdown plus crowd-sourced `attributes` (consensus per attribute
  type, observed types only). Unknown id → `404`.
- `GET /api/v1/attribute-types` — the seeded fountain attribute definitions
  (bottle filler, dual-height, accessibility observations), in `sort_order`.

Authenticated read (caller's own data only):

- `GET /api/v1/me/contributions` — the caller's contribution-point stats + recent
  contribution events (the gamification substrate). Auth required.
- `DELETE /api/v1/me` — delete the caller's account. Removes the local account,
  Logto identity, notes, photos, upload attempts, and report history; detaches
  retained fountain ratings/details from the user so public fountain data
  remains available.

Writes (require auth — see below):

- `POST /api/v1/fountains` — add a fountain. Body:
  `{ "location": { "latitude", "longitude" }, "is_working"?, "comments"?, "ratings"?: [{ "rating_type_id", "stars" }] }`.
  Rejects a location within `duplicate_threshold_m` of an existing (non-hidden)
  fountain with a typed `409` body `{ "detail": "duplicate_fountain", "fountain_id": <uuid> }`
  so the client can route the user to confirm/rate the existing fountain; unknown
  `rating_type_id` or out-of-range `stars` → `422`. Returns the created fountain
  detail (`201`). Adds and ratings emit contribution events (points); the
  `first_in_area_bonus` is awarded only when no other fountain exists within
  `first_in_area_radius_m` (default 600 m) of the new point. The whole write
  transaction (and the admin patch/delete below) runs under a bounded
  `lock_timeout` so an interactive write never queues indefinitely behind a
  boundary load / membership refresh — on a timeout it returns `503`
  `{ "detail": "busy" }` with `Retry-After: 30`. Bound via `ADD_LOCK_TIMEOUT_MS`
  (default `8000` ms; must be `> 0` and `≤ 60000`; bulk/CLI paths keep their
  deliberate unbounded wait). See `docs/specs/2026-07-17-scoped-add-fountain-lock-design.md`.
- `POST /api/v1/fountains/{fountain_id}/ratings` — create/update this user's
  ratings for a fountain (atomic upsert on `(fountain, user, dimension)`). Body:
  `{ "ratings": [{ "rating_type_id", "stars" }] }` (non-empty). Unknown fountain
  → `404`. Returns the updated fountain detail.
- `POST /api/v1/fountains/{fountain_id}/attributes` — create/update this user's
  structured attribute observations (`yes`/`no`/`unknown`), upsert on
  `(fountain, user, attribute_type)`; recomputes the consensus shown in detail.
  Body: `{ "observations": [{ "attribute_type_id", "value" }] }` (non-empty).
  Unknown/non-fountain `attribute_type_id` or an illegal `value` → `422`.

**Production auth (Phase 2a):** write endpoints require a Logto JWT access token —
`Authorization: Bearer <token>` — validated via JWKS (`iss`/`aud`/`exp`, ES384). The
token must be issued for the API Resource `https://api.fountainrank.com`. The dev-auth
headers below are a local-only convenience, active solely when `DEV_AUTH_ENABLED=true`
(default `false` in production) and only when no `Authorization` header is sent.

Account deletion also requires Logto Management API M2M credentials so
`DELETE /api/v1/me` can delete the authoritative Logto identity. Configure these
env vars in production:

- `LOGTO_MANAGEMENT_APP_ID` (CI sources this from `vars.LOGTO_M2M_APP_ID`)
- `LOGTO_MANAGEMENT_APP_SECRET` (CI sources this from `secrets.LOGTO_M2M_APP_SECRET`)
- `LOGTO_MANAGEMENT_RESOURCE` (optional OAuth resource indicator; defaults to
  `https://default.logto.app/api` — the literal indicator every **self-hosted** Logto
  uses, regardless of where it is served from. Set this only on Logto **Cloud**, where
  the indicator is `https://<tenant-id>.logto.app/api`.)
- `LOGTO_MANAGEMENT_API_BASE_URL` (optional HTTP API base URL; defaults to
  `{LOGTO_ENDPOINT}/api`)

The API tombstones the Logto subject before returning success, so stale pre-delete
tokens cannot recreate the local account. Once the local deletion transaction commits
it is irreversible, so everything after it — Spaces object deletion and the Logto
identity delete — is **best effort** and can never fail the request: `DELETE /api/v1/me`
returns `204` regardless. If Logto identity deletion is unavailable, the
`deleted_accounts` row remains `identity_delete_status='pending'`. If Spaces deletion is
unavailable, photo object keys remain as pending `storage_cleanup` rows.

Both ledgers are drained automatically by the hourly
`fountainrank-account-deletion-cleanup` CronJob (`infra/k8s/account-deletion-cleanup.yaml`),
which runs the command below. It exits non-zero while any row is still failing, so a
persistent failure (e.g. the M2M app losing its Management API role) surfaces as a
**Failed Job** rather than silently stranding a Logto identity. Check it with
`kubectl get cronjob,jobs -n fountainrank -l app=fountainrank-account-deletion-cleanup`
and read the pod logs (structured JSON; the failure reason is also persisted to
`deleted_accounts.identity_delete_error`).

To drain the ledgers by hand:

```bash
uv run python -m app.account_deletion_cleanup --limit 100
```

### Local dev-auth fallback

`get_current_user` resolves the Logto Bearer JWT above as the **production** path.
Alongside it is a **dev-only fallback, disabled by default** (`dev_auth_enabled=False`)
so production never exposes an unauthenticated write path. The fallback is reachable
only when `DEV_AUTH_ENABLED=true` **and** no `Authorization` header is present — a
present-but-invalid Bearer is always `401` and never falls through to it. To exercise
writes locally without standing up Logto:

1. Set `DEV_AUTH_ENABLED=true` (the `run.ps1 backend` dev command does this for
   you). Never enable it in production.
2. Send an `X-Dev-User: <logto-subject>` header identifying the caller. A local
   `User` is provisioned just-in-time on first sight. `X-Dev-Email` and
   `X-Dev-Name` are optional overrides (defaulted otherwise).

A missing header (when enabled) or any write while disabled returns `401`. Both the
Bearer path and this fallback share the same just-in-time provisioning tail
(`get_or_create_user`).

## OSM fountain import

Pre-seeds the map with public drinking-water locations from OpenStreetMap as
first-class, rateable `fountains` rows with separable provenance. Imported rows are
`created_source = 'osm'` with a null owner; they award no contribution credit and
render as standard unrated pins. Design: `docs/specs/2026-06-21-osm-fountain-ingestion-design.md`.
Runbook (dry-run / apply / refresh / audit / rollback): `docs/runbooks/osm-fountain-import.md`.

The importer is an **operator/CI CLI only** — there is no public/unauthenticated HTTP
import endpoint:

```
python -m app.imports.cli --path extract.geojson --scope-id us/ca \
    --dataset geofabrik:us/california --build-id 2026-06-21 --label "California" [--dry-run]
```

It reads a GeoJSON extract (stable OSM ids required), parses + filters candidates,
then merges them idempotently. The final stdout line is a JSON run summary (the
documented operator result contract); diagnostics go to structured logs.

Settings (safe defaults; override by env var name only — never commit values):

- `OSM_MOVE_SMALL_MAX_M` (default `25.0`) — auto-update an imported-only, unrated
  fountain's location only if it moved ≤ this.
- `OSM_MOVE_REVIEW_MIN_M` (default `100.0`) — movement ≥ this flags a review
  candidate instead of moving.
- `OSM_TAG_MAX_KEY_LEN` (`64`), `OSM_TAG_MAX_VALUE_LEN` (`255`),
  `OSM_TAGS_MAX_BYTES` (`4096`) — untrusted-tag guards for the allow-listed
  `source_tags` jsonb.
