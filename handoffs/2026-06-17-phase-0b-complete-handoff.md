# Handoff — FountainRank (Phase 0b complete; resume at Phase 0c)

**Date:** 2026-06-17
**From:** In-repo Claude session (DigitalOcean bootstrap + Phase 0b backend skeleton)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec and you can continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-17-phase-0-foundation-handoff.md` (still accurate for Phase 0a history).

---

## TL;DR

FountainRank is a modern rebuild of an old C#/Xamarin fountain-rating app into:
**FastAPI + PostgreSQL/PostGIS** backend, **Next.js** web, **Expo/React Native**
mobile, **self-hosted Logto** auth, **MapLibre + Protomaps** maps, on
**DigitalOcean Kubernetes (DOKS)**. Public OSS repo `redducklabs/fountainrank`.

**Done and on `main` (HEAD `0a0d801`):** Phase 0a (repo foundation + AI tooling),
the `docs/setup/` external-setup runbook, the **DigitalOcean account bootstrap**,
and **Phase 0b (backend walking skeleton)** — all committed and pushed.

**Next:** Phase 0c (frontend monorepo), then 0d (local dev), 0e (infra Terraform),
0f (CI/CD + security), then the feature phases (1–5).

---

## Read these first (in order)

1. `CLAUDE.md` — the operating-rules hub (points to all `claude_help/*` spokes).
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — the approved
   whole-system design (architecture, data model, geo/PostGIS, ranking, auth,
   email, infra, CI, security, external-registrations §19, build phases §20–21).
3. `docs/plans/2026-06-17-phase-0a-repo-foundation-and-ai-tooling.md` and
   `docs/plans/2026-06-17-phase-0b-backend-walking-skeleton.md` — executed plans.
4. `docs/setup/README.md` — the owner runbook for external accounts/credentials
   (DigitalOcean, DNS, Google, Apple, GitHub secrets, Logto) + master secret
   inventory + progress checklist.
5. The relevant `claude_help/*.md` spoke for whatever you're about to do (the
   `CLAUDE.md` "Architecture References" table maps trigger → spoke).

---

## Process rules (how work happens here — non-negotiable)

- **Flow:** spec → plan → **Codex Loop A review (loop to `VERDICT: APPROVED`)** →
  implement → verify. See `claude_help/development-process.md`,
  `claude_help/codex-review-process.md`, `claude_help/testing-ci.md`.
- **Phase 0 commits go directly to `main`** (no CI gate until 0f). **After
  Phase 0:** branch → PR → CI green + Codex APPROVED + comments addressed →
  squash-merge.
- **Codex** runs via the Codex MCP (`mcp__codex__codex` / `…-reply`) in **bypass
  mode** (`sandbox: danger-full-access`, `approval-policy: never`), `cwd` in WSL
  form (`/mnt/d/repos/fountainrank`). Reviews land in `temp/codex-reviews/`
  (gitignored).
- **Implementation used subagent-driven development** (superpowers): a fresh
  implementer subagent per task (TDD), a task review (spec + quality) after each,
  and a final whole-branch review. Models: implementers/reviewers on **sonnet**,
  final review on **opus**.
- **Hard rules:** no secrets, no `.env` files, **no AI attribution** in
  commits/PRs, **no time estimates** anywhere. Public repo — never push secrets.

---

## Current state on `main`

### Phase 0a — foundation (done earlier)
Conventions (`.gitattributes`/`.gitignore`/`.trivyignore`/`.pre-commit-config.yaml`),
`README.md`, `SECURITY.md`, hub-and-spoke `CLAUDE.md` + `claude_help/` spokes,
Codex `AGENTS.md` + `docs/codex/setup.md` + `scripts/launch-codex.sh`,
`docs/design/architecture.md`.

### `docs/setup/` runbook (done)
Operator guide so Aron can do the external setup in parallel: `README.md` (index +
priority + **master secret inventory** + checklist) and `01`–`06` for DigitalOcean,
DNS/email, Google Cloud (OAuth + Gmail), Apple/app-stores, GitHub, Logto.

### DigitalOcean bootstrap (done — the ONLY external setup done so far)
Performed with Aron's DO token. Authoritative details in
`docs/setup/01-digitalocean.md`. Summary:
- **Account:** Red Duck Labs — **shared** with other production projects
  (TherapyLink, zipbot, autoduck, etc.). Be careful with shared resources.
- **DO project:** `FountainRank` (all FountainRank resources should be assigned
  here; Terraform in 0e must assign cluster/DB/Spaces/registry to it).
- **Region:** `sfo3` (co-located with the rest of the RDL fleet + managed PG).
- **Terraform-state bucket:** `fountainrank-terraform-state` (sfo3, private, in
  the FountainRank project). Created manually (state must pre-exist Terraform).
- **CI Spaces key:** `fountainrank-gh-key` — **scoped `readwrite` to the state
  bucket only** (least privilege). App-bucket (`photos`/`pmtiles`) grants get
  added in 0e.
- **GitHub `production` environment** holds (names only — values set in GitHub):
  secrets `DIGITALOCEAN_ACCESS_TOKEN` (a dedicated long-lived CI PAT — already
  swapped in for the bootstrap token), `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY`;
  variables `DO_REGION=sfo3`, `DO_REGISTRY=fountainrank`.
- **Not created by hand (Terraform's job in 0e/0f):** DOKS cluster, Managed
  Postgres (+ PostGIS + Logto DB), app Spaces buckets, LB + LE cert, DNS,
  registry.

### Phase 0b — backend walking skeleton (done + verified)
Lives in `backend/`. Plan: `docs/plans/2026-06-17-phase-0b-backend-walking-skeleton.md`.
- **uv-managed, non-packaged** (`[tool.uv] package = false`) Python 3.13 project;
  `pyproject.toml` + committed `uv.lock`; ruff (E/F/I/UP/B/ASYNC, `known-first-party=["app"]`,
  bugbear `extend-immutable-calls` for `fastapi.Depends`); pytest `asyncio_mode="auto"`.
- `app/config.py` — pydantic-settings `Settings` (`database_url` default
  `postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5436/fountainrank`,
  `env_file=None`); `app/db.py` — **lazy** async engine + `async_sessionmaker(expire_on_commit=False)`
  + `get_session` dependency (importing the app opens no DB connection).
- `app/main.py` (`create_app()` + `app`); `app/routers/health.py` — `GET /healthz`
  (liveness, DB-free) and `GET /readyz` (readiness: `SELECT PostGIS_version()` +
  an `ST_Distance(...::geography)` SF→NYC calc).
- Async **Alembic** (`migrations/`) with first migration `0001_enable_postgis`
  (`CREATE EXTENSION IF NOT EXISTS postgis`). `env.py` pins `search_path` to
  `public` and filters `spatial_ref_sys` so `alembic check` is zero-drift.
- Multi-stage **Dockerfile** (`python:3.13-slim-trixie`, uv `0.11.21`,
  `uv sync --frozen --no-dev`); `.dockerignore`; `backend/README.md`.
- ruff hooks added to `.pre-commit-config.yaml` (`ruff-check`/`ruff-format`,
  `files: ^backend/`). Root README "Software Versions" table filled.
- **Pinned versions (verified 2026-06-17):** Python 3.13.14, uv 0.11.21,
  FastAPI 0.137.1, uvicorn[standard] 0.49.0, pydantic 2.13.4, pydantic-settings
  2.14.1, SQLAlchemy 2.0.51, asyncpg 0.31.0, Alembic 1.18.4, GeoAlchemy2 0.20.0,
  pytest 9.1.0, pytest-asyncio 1.4.0, httpx 0.28.1, ruff 0.15.17;
  `postgis/postgis:17-3.5` (PG17 + PostGIS 3.5.2).
- **Verified:** `ruff check`/`format --check` clean; **4/4 pytest** pass (incl.
  the live PostGIS `/readyz` integration test); `alembic check` zero-drift;
  `docker build` + container `/healthz` OK; `pre-commit run --all-files` green.
- **Reviews:** every task passed its task review (spec + quality); final
  whole-branch review (opus) = **Ready to merge: Yes**.

---

## Next steps — remaining Phase 0 plans

Write each with `superpowers:writing-plans`, run the **Codex Loop A** review to
`APPROVED`, then execute (subagent-driven, TDD). Commit direct to `main`.

- **0c — Frontend monorepo:** pnpm + Turborepo; Next.js `web/` skeleton; Expo
  `mobile/` skeleton; `packages/api-client` generated from the backend OpenAPI.
  Add eslint/prettier hooks to `.pre-commit-config.yaml`. Pin Node 22.x + JS deps
  via `version-research-expert`; fill the README "Node.js" row (currently
  `_pending 0c_`). Consider a typed `/readyz` response model in the backend so
  OpenAPI→TS codegen is clean (deferred from 0b).
- **0d — Local dev orchestration:** `docker-compose.yml` (postgres+postgis on host
  port **5436**, logto, backend, web) + `run.ps1`. This replaces the manual
  `docker run … fr-postgis` used during 0b.
- **0e — Infra Terraform skeleton:** `infra/terraform/` (DOKS, Managed
  Postgres+PostGIS + a separate **Logto DB**, Spaces photos/pmtiles, LB + LE SAN
  cert for apex/www/api/auth, DNS, registry) + `infra/k8s/` (backend, web,
  **Logto**, ingress-nginx, envsubst secrets). Use the DO bootstrap creds; **S3
  backend = `fountainrank-terraform-state` (sfo3)**; **assign every resource to
  the `FountainRank` DO project**. `validate`/`plan` only locally — never apply.
- **0f — CI/CD + security:** `.github/workflows/` (lint/test/build with the
  runner split — Class A on `redducklabs-runners`, secret jobs on `ubuntu-latest`;
  image build/push; DOKS deploy), CodeQL, Dependabot, Trivy + `.trivyignore`,
  pip-audit/pnpm audit, CODEOWNERS, issue templates, markdownlint config, README
  badges. **Enable repo security features** in GitHub Settings (CodeQL, Dependabot
  alerts+updates, secret scanning + push protection) and confirm
  `redducklabs-runners` access (may need org-admin).

Then the **feature phases** (each gets its own spec + plan): 1) data model +
fountains API; 2) auth (Logto) end-to-end + magic-link email; 3) maps UI +
add/rate-on-add (after a UI brainstorm — create `docs/style-guide.md`);
4) photos + rating existing fountains; 5) leaderboards + profiles.

---

## Deferred items carried out of 0b (don't lose these)

- **REQUIRED before the backend image ships to DOKS (do in 0e/0f):** Dockerfile
  **non-root `USER`** + a **`HEALTHCHECK`** hitting `/healthz`.
- **Phase 1:** typed Pydantic response model for `/readyz` (seeds better
  OpenAPI→TS `api-client` types).
- **Minor/optional:** `app/db.py` `get_sessionmaker` single-responsibility tidy;
  type the `include_object` params in `migrations/env.py`; add a comment in
  `run_migrations_offline` noting reflection doesn't run in offline mode.

---

## External setup Aron still owes (see `docs/setup/` + spec §19)

DigitalOcean = **DONE**. Still pending (start the slow/paid ones early):
- **Google Cloud:** OAuth clients (web/iOS/Android) + consent screen; **service
  account + Workspace domain-wide delegation for Gmail sending** (`03`).
  ⚠️ Gmail-API sending **requires Google Workspace on `fountainrank.com`** — the
  DO account email is a plain `@gmail.com`; confirm Workspace or use the SMTP
  fallback.
- **Apple Developer Program** (paid) + Sign in with Apple; **Google Play Console**
  (paid) (`04`).
- **DNS (`fountainrank.com`):** A records apex/www/api/auth + SPF/DKIM/DMARC (`02`).
- **GitHub:** enable security features; confirm `redducklabs-runners` access (`05`).
- **Logto:** app registrations + connectors, after Logto is deployed in 0e (`06`).

---

## Gotchas / environment notes

- **Windows host:** file tools (Read/Write/Edit) use **backslash** paths; the Bash
  tool is **Git Bash** (forward-slash, `/d/repos/fountainrank`). Codex runs in
  **WSL** (`/mnt/d/repos/fountainrank`).
- **Local toolchain drift:** dev box has **uv 0.11.3 / Python 3.13.4**; project
  pins **uv 0.11.21 / Python 3.13.14**. `uv.lock` + CI/Docker are unaffected; run
  `uv self update` and `uv python install 3.13.14` to match.
- **Local backend DB (until 0d compose):** the `/readyz` test needs PostGIS. Run:
  `docker run -d --name fr-postgis -e POSTGRES_USER=fountainrank -e POSTGRES_PASSWORD=fountainrank_dev -e POSTGRES_DB=fountainrank -p 5436:5432 postgis/postgis:17-3.5`
  then `cd backend && uv run alembic upgrade head && uv run pytest`. (A
  `fr-postgis` container may still be running from the 0b session — `docker ps`.)
- **`postgis/postgis` image quirk:** it auto-installs `postgis_tiger_geocoder` +
  `postgis_topology` and sets a DB-level `search_path` across `tiger`/`topology`.
  `migrations/env.py` pins `search_path TO public` so Alembic ignores them — keep
  this when ORM models arrive in Phase 1.
- **DO Spaces grant rule (for 0e):** `permission=fullaccess` is only valid on an
  **account-wide** grant (`bucket=`); per-bucket grants must be `read`/`readwrite`,
  and a `readwrite` key **cannot create** a bucket. To add `photos`/`pmtiles`
  buckets, create them with a throwaway account-wide key (then delete it) or a key
  whose grant names those buckets, and extend `fountainrank-gh-key` accordingly.
- **pre-commit** is configured but **not installed as a git hook** here; run
  `pre-commit run --all-files` manually (or `pre-commit install`).
- **Working artifacts (local only, not pushed):** SDD ledger at
  `.git/sdd/progress.md`; Codex reviews in `temp/codex-reviews/`. Safe to delete.
- **Port 8000** on the dev box is sometimes taken by another project's container;
  map the backend to a free host port when testing locally.
