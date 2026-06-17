# Handoff — FountainRank Foundation (Phase 0a complete)

**Date:** 2026-06-17
**From:** Migration/setup session (run out of `D:\repos\fountainrank-old`)
**To:** A Claude/Codex instance running **inside** `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec, and you can continue without the prior conversation.

---

## TL;DR

FountainRank is being rebuilt from an old C#/Xamarin prototype into a modern app:
**FastAPI + PostgreSQL/PostGIS** backend, **Next.js** web, **Expo/React Native**
mobile, **self-hosted Logto** auth, **MapLibre + Protomaps** maps, deployed to
**DigitalOcean Kubernetes (DOKS)**. Public OSS repo `redducklabs/fountainrank`.

**Phase 0a (repo foundation + AI tooling) is done and pushed to `main`.** The repo
is "properly set up" — conventions, hub-and-spoke `CLAUDE.md`, `claude_help/`
spokes, Codex `AGENTS.md`, the approved design spec, and the Phase 0a plan are all
committed. Next up: Phases 0b–0f (still need plans written + executed), then the
feature phases.

---

## Read these first (in order)

1. `CLAUDE.md` — the operating-rules hub. Points to everything else.
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — the **approved
   whole-system design** (architecture, data model, geo/PostGIS, ranking, auth,
   email, infra, CI, security, external-registrations checklist, build phases).
3. `docs/plans/2026-06-17-phase-0a-repo-foundation-and-ai-tooling.md` — the plan
   that produced the current state (now fully executed).
4. The relevant `claude_help/*.md` spoke for whatever you're about to do.

---

## Current state (what exists on `main`)

Committed and pushed (`git log` shows 9 commits from "Initial commit" through
"docs: add architecture reference and pre-commit baseline"):

- **Conventions:** `.gitattributes` (LF normalization), `.gitignore`,
  `.trivyignore`, `.pre-commit-config.yaml` (whitespace/EOF/yaml/large-file/
  merge-conflict/line-ending + gitleaks; pre-commit run passes clean).
- **Docs:** `README.md` (skeleton, with a "Software Versions" table to populate),
  `SECURITY.md`.
- **AI tooling (hub-and-spoke):** `CLAUDE.md` hub; `claude_help/` spokes —
  `development-process`, `testing-ci`, `codex-review-process`, `kubernetes-infra`,
  `github-cli`, `github-environments`, `oauth-sso`, `email`.
- **Codex:** `AGENTS.md` adapter, `docs/codex/setup.md`, `scripts/launch-codex.sh`
  (executable bit set; defaults `CODEX_POSTGRES_URL` to
  `postgresql://fountainrank:fountainrank_dev@localhost:5436/fountainrank`).
- **Design refs:** `docs/design/architecture.md`, plus the spec and the 0a plan.

**Not yet created** (intentionally — later plans): `backend/`, `web/`, `mobile/`,
`packages/`, `infra/`, `docker/`, `docker-compose.yml`, `run.ps1`, `.github/`
(workflows, CodeQL, Dependabot, CODEOWNERS, issue templates), `docs/style-guide.md`.

---

## Key decisions already made (don't relitigate; see spec for detail)

- **Stack:** TypeScript everywhere on the client (Expo mobile + Next.js web in a
  pnpm + Turborepo monorepo, shared `api-client` generated from backend OpenAPI);
  Python 3.13 / FastAPI / async SQLAlchemy 2 / Alembic / PostGIS; uv for Python deps.
- **Hosting:** DOKS + **DO Managed Postgres (PostGIS)**. Reuse TherapyLink's
  single-file Terraform pattern; diverge to Managed Postgres, add Logto, keep
  **LB-managed Let's Encrypt TLS** (no cert-manager).
- **Auth:** **self-hosted Logto** (its own Postgres DB); connectors Google, Apple,
  email magic link; backend validates Logto JWTs via JWKS; browsing public, writes
  require auth.
- **Email:** Logto owns auth email via a **custom Gmail-API connector** (Workspace
  service account + domain-wide delegation; reuse TherapyLink's Jinja2 templates +
  tracking patterns); SMTP-to-Workspace fallback. SPF/DKIM/DMARC required.
- **Maps:** **MapLibre GL** (web + RN) on a **Protomaps `pmtiles`** basemap hosted
  on DO Spaces (no per-tile fees).
- **MVP scope ("modern baseline"):** old app's working features + user accounts +
  photos + rating existing fountains + ranking on the map + a leaderboard
  (**weighted** ranking score + vote count) + contributor leaderboard.
- **Ranking:** overall rating + vote count shown on map pins/detail; leaderboard
  uses a Bayesian/weighted score (see spec §8) so low-vote fountains don't dominate.
- **CI runners:** no-secret jobs on `redducklabs-runners`; secret-handling deploy
  jobs pinned to `ubuntu-latest`.
- **Git policy:** Phase 0 commits go **directly to `main`**. **After Phase 0:**
  branch → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge. **No AI
  attribution; no time estimates** (ever).

---

## Next steps

### Remaining Phase 0 plans (write each with superpowers:writing-plans, then execute)

- **0b — Backend walking skeleton:** FastAPI app, `/healthz` + one PostGIS-backed
  endpoint, uv project, Alembic init, pytest, ruff, Dockerfile. Pin Python/dep
  versions via `version-research-expert` and fill the README "Software Versions"
  table.
- **0c — Frontend monorepo:** pnpm + Turborepo; Next.js `web/` skeleton; Expo
  `mobile/` skeleton; `packages/api-client` generated from backend OpenAPI. Add
  ruff/eslint/prettier hooks to `.pre-commit-config.yaml`.
- **0d — Local dev orchestration:** `docker-compose.yml` (postgres+postgis on host
  port **5436** to match `launch-codex.sh`, logto, backend, web) + `run.ps1`.
- **0e — Infra Terraform skeleton:** `infra/terraform/` (DOKS, Managed
  Postgres+PostGIS, Spaces, LB+LE cert, DNS, registry) + `infra/k8s/` (backend,
  web, **Logto**, ingress-nginx, secrets via envsubst). `terraform validate`/`plan`
  clean; **no local apply**.
- **0f — CI/CD + security scanning:** `.github/workflows/` (lint/test/build with the
  runner split; image build/push; DOKS deploy), CodeQL (Python + JS/TS),
  Dependabot (pip/npm/actions), Trivy + `.trivyignore`, `pip-audit`/`pnpm audit`,
  CODEOWNERS, issue templates, markdownlint config (formalize the README line-length
  / table-style defaults). Wire README badges.

**0f also requires enabling GitHub repo security features** (Settings → Security):
CodeQL/code scanning, Dependabot alerts + security updates, secret scanning + push
protection. This is a repo-settings action (use `gh`/the UI), not just workflow files.

### Then the feature phases (each gets its own spec + plan)

1. Data model + fountains API (PostGIS schema, nearby/bbox/detail/add, ranking).
2. Auth (Logto) end-to-end on web + mobile + magic-link email.
3. Maps UI + add-fountain + rate-on-add (after a **UI design brainstorm** — offer
   the visual companion; create `docs/style-guide.md`).
4. Photos + rating existing fountains.
5. Leaderboards (fountain + contributor) + profiles.

---

## External setup Aron needs to do (nothing done yet)

Track these as the relevant phases land (full list in spec §19 and
`claude_help/oauth-sso.md` / `email.md`):

- **Google Cloud:** project; OAuth clients (web/iOS/Android + consent screen);
  **service account + Workspace domain-wide delegation for Gmail sending**.
- **Apple Developer Program** (paid): App ID; Sign in with Apple (Services ID +
  key) for Logto; App Store Connect record.
- **Google Play Console** (paid): account; listing; app signing.
- **DigitalOcean:** DOKS cluster; Managed Postgres (PostGIS + a separate Logto DB);
  Spaces + CDN; Container Registry; Load Balancer; Terraform-state Spaces bucket.
- **DNS (fountainrank.com):** A records (apex, `www`, `api`, `auth`); SPF/DKIM/DMARC.
- **GitHub:** enable security features; create Environments + secrets; confirm
  `redducklabs-runners` access.
- **Logto:** app registrations (web/native/M2M) + connectors once it's deployed.

---

## Gotchas / notes for the next instance

- **Windows host:** file tools use backslash paths; the Bash tool is Git Bash
  (forward-slash, `/d/repos/fountainrank`). Codex runs in WSL (`/mnt/d/...`).
- **Keep the hub-and-spoke graph intact:** if you add a `claude_help/` spoke or a
  `🔗` pointer in `CLAUDE.md`, re-run the link-check from the 0a plan (Task 6,
  Step 4).
- **markdownlint defaults** flag README line-length (MD013/80) and table-separator
  spacing (MD060); these are accepted until 0f adds a markdownlint config. The repo
  layout code fence uses ```` ```text ```` to satisfy MD040.
- **pre-commit is configured but not installed as a git hook** in this environment
  (we ran `pre-commit run --all-files` manually). Run `pre-commit install` if you
  want it on every commit.
- **No secrets, no `.env` files, no AI attribution, no time estimates** — these are
  hard rules (see `CLAUDE.md`).
