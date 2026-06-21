# Architecture (standing reference)

A concise, standing summary of the FountainRank system. For the full rationale,
data model, geo/ranking details, auth, infra, CI, and build phases, the **source
of truth** is `docs/specs/2026-06-16-architecture-and-foundation-design.md`.

## System diagram

```text
   Native iOS / Android (Expo / React Native, MapLibre RN)  ─┐
   Web (Next.js App Router, SSR + SEO, MapLibre GL JS)       ─┼─► FastAPI backend ─► DO Managed
        both consume one shared TypeScript API client         │   (Python 3.13,       Postgres
                                                               │    PostGIS geo,       + PostGIS
   Auth on all clients ──► Logto (self-hosted OIDC in DOKS) ───┤    Logto JWT verify)
                            • Google • Apple • Email magic link │
   Photos ──► DO Spaces (S3-compatible) + CDN                  │
   Basemap ──► MapLibre + Protomaps pmtiles on DO Spaces       │
                                                               │
   Everything runs in DOKS; CI/CD via GitHub Actions on redducklabs-runners
```

> Basemap serving: the planet Protomaps pmtiles is served as `z/x/y` vector tiles by a
> **go-pmtiles tile server** (`fountainrank.com/tiles`) that range-reads the archive from DO
> Spaces server-side — see `docs/specs/2026-06-21-basemap-tile-server-design.md`. (The browser
> uses no client-side pmtiles library.)

## Component responsibilities

- **`backend/`** — FastAPI (Python 3.13), async SQLAlchemy 2 + Alembic, PostGIS
  for geospatial queries. Validates Logto JWTs via JWKS; serves a versioned REST
  API (`/api/v1`) whose OpenAPI schema generates the shared TS client.
- **`web/`** — Next.js (App Router, TypeScript, Tailwind). Server-rendered,
  SEO-friendly public pages; authenticated rating/add/photo flows.
- **`mobile/`** — Expo / React Native (TypeScript). Native iOS + Android; EAS
  Build; MapLibre React Native SDK.
- **`packages/`** — shared TypeScript: `api-client` (generated from backend
  OpenAPI), shared config/types, and shared UI primitives where practical.
- **Logto** — self-hosted OIDC identity service in the cluster (Google, Apple,
  email magic link); its own Postgres database.
- **DO Spaces** — fountain photos and the Protomaps basemap `pmtiles`, served via
  the Spaces CDN.

## Further design references

Added as needed: `docs/design/data-model.md` (entities, PostGIS, ranking),
`docs/design/tech-stack.md` (pinned versions and rationale). Until then, see the
spec.
