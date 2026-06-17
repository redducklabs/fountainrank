# FountainRank — Architecture & Foundation Design

**Status:** Approved design (brainstorming output) · **Date:** 2026-06-16
**Author:** Aron Weiler (with Claude)
**Scope of this spec:** Whole-system architecture + **Phase 0 (Foundation/scaffolding)** in detail. Later phases (1–5) are a roadmap; each gets its own spec + plan, authored from inside the new repo.

---

## 1. Summary

FountainRank is a crowdsourced drinking-fountain discovery and rating application. Users find public water fountains on a map near their location, rate them across quality dimensions, add new fountains they discover, and see how fountains rank. This project is a ground-up rebuild of an old C#/Xamarin prototype into a modern, extensible, multi-platform product:

- **Web app** (server-rendered, SEO-friendly, public discovery)
- **Native iOS and Android apps**
- **Python/FastAPI backend** on PostgreSQL + PostGIS
- Deployed to **DigitalOcean Kubernetes (DOKS)**
- Open-source, public GitHub repository under the Red Duck Labs organization

The product is intentionally *not* a faithful reproduction of the old app — it is a slick, modern rebuild that keeps the core concept and feature set while filling the obvious gaps (real user accounts, photos, rating existing fountains, leaderboards).

## 2. Goals and non-goals

### Goals
- A durable, extensible architecture in languages with deep ecosystem support (TypeScript + Python).
- Genuinely native mobile apps plus a first-class web app, sharing one API contract.
- Map-centric UX as the heart of the product.
- Proper authentication and user identity from day one (the old app's auth was non-functional).
- A repository that is "properly set up" — hub-and-spoke `CLAUDE.md`, Codex tooling, full CI + security scanning — so that ongoing feature work can be driven by a Claude instance running *inside* the repo.

### Non-goals (for the first build)
- Real-time/social features (following, comment threads, likes) beyond a single comment field.
- Offline-first mobile sync.
- Internationalization/localization (English only initially).
- Advanced content moderation (basic report + admin review only; see §13).
- Migrating any data from the old MySQL prototype (there is no production data to preserve).

## 3. What we carry forward vs. what we add

**Carried forward (the valuable core of the old app):**
- The domain model: Fountains rated on multiple dimensions — **Clarity, Taste, Pressure, Appearance** (1–5 stars each).
- Map-based discovery centered on the user's GPS, with working vs. broken fountains visually distinguished.
- Radius-based "nearby" queries and **server-side duplicate-proximity prevention** when adding a fountain.
- The add-a-fountain flow (current location or tap-the-map), with rating-on-add and a comment.

**Added (gaps in the old app):**
- Real **user accounts** and authentication (Logto): Google, Apple, email magic link.
- **Per-user ratings** (one rating set per user per fountain; editable) instead of anonymous aggregate rows.
- **Photo upload** and display.
- **Rating an existing fountain** from its detail view (old app only allowed rating at add-time).
- **Ranking surfaced on the map** (overall rating + vote count on pins/detail) and a **leaderboard** (weighted ranking + number of votes), plus a contributor leaderboard.
- **iOS support** (old app was Android-only).

**Explicitly dropped:** the orphaned IdentityServer4 project; the old manual degrees-to-meters geo math (replaced by PostGIS); MySQL (replaced by PostgreSQL).

## 4. System architecture

```
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

**Components:**
- **Backend (`backend/`)** — FastAPI, SQLAlchemy 2 (async), Alembic migrations, PostGIS for geospatial queries. Validates Logto-issued JWTs via JWKS. Serves a versioned REST API (`/api/v1`) and an OpenAPI schema used to generate the shared TS client.
- **Web (`web/`)** — Next.js (App Router, TypeScript, Tailwind). Public, server-rendered pages for fountains and map; authenticated flows for rating/adding/photos.
- **Mobile (`mobile/`)** — Expo / React Native (TypeScript). Native iOS + Android; EAS Build for store binaries; MapLibre React Native SDK.
- **Shared packages (`packages/`)** — `api-client` (generated from backend OpenAPI), shared config/types, and shared UI primitives where practical. pnpm + Turborepo workspace covering `web`, `mobile`, `packages`.
- **Auth (Logto)** — self-hosted OIDC identity service in the cluster; owns login UI, social SSO, email magic link, sessions, token rotation. Needs its own PostgreSQL database (a separate database on the managed cluster).
- **Storage (DO Spaces)** — fountain photos + the Protomaps basemap `pmtiles` file, served via the Spaces CDN.

## 5. Technology stack

Exact versions are pinned during Phase 0 via the `version-research-expert` and recorded in `README.md` (house rule: always latest stable). Intended stack:

| Layer | Technology |
|---|---|
| Backend language/runtime | Python 3.13 |
| Backend framework | FastAPI + Uvicorn |
| ORM / migrations | SQLAlchemy 2 (async) + Alembic |
| Database | PostgreSQL 17 + PostGIS 3.x (DO Managed Postgres) |
| Dependency mgmt (Py) | uv (locked) |
| Web | Next.js (App Router) + React 19 + TypeScript + Tailwind |
| Mobile | Expo SDK (current) / React Native + TypeScript |
| Maps | MapLibre GL JS (web) + MapLibre React Native (mobile) + Protomaps pmtiles |
| Auth | Logto (self-hosted) |
| Monorepo | pnpm + Turborepo (Node 22) |
| Object storage | DO Spaces + CDN |
| Container orchestration | DOKS (Kubernetes) |
| IaC | Terraform (DigitalOcean provider) |
| CI/CD | GitHub Actions on redducklabs-runners |
| Email | Gmail API via a Logto custom email connector (SMTP fallback) |

## 6. Data model

Entities (PostgreSQL, SQLAlchemy 2). Geometry stored as `geography(Point, 4326)` (standard lon/lat order, unlike the old app's swapped axes).

- **User** — `id` (uuid), `logto_user_id` (unique, links to Logto subject), `display_name`, `email`, `avatar_url` (nullable), `is_admin` (bool), `created_at`. Users are provisioned/just-in-time-synced from Logto on first authenticated request.
- **Fountain** — `id` (uuid), `location` (`geography(Point,4326)`, spatial GiST index), `is_working` (bool), `comments` (text, nullable), `added_by_user_id` (fk User), `created_at`, `last_rated_at` (nullable). Derived/denormalized ranking fields kept current by triggers or service logic: `rating_count`, `average_rating`, `ranking_score` (see §8).
- **RatingType** — `id` (smallint/seed), `name`, `description`, `sort_order`. Seeded with Clarity, Taste, Pressure, Appearance (extensible).
- **Rating** — `id` (uuid), `fountain_id` (fk), `user_id` (fk), `rating_type_id` (fk), `stars` (smallint 1–5, validated), `created_at`, `updated_at`. **Unique constraint `(fountain_id, user_id, rating_type_id)`** — one score per user per dimension per fountain, upsert to edit.
- **Photo** — `id` (uuid), `fountain_id` (fk), `user_id` (fk), `spaces_key`, `thumbnail_key`, `width`, `height`, `content_type`, `is_hidden` (moderation), `created_at`.

Relationships: Fountain 1→many Rating, 1→many Photo; User 1→many Rating/Photo/Fountain(added); RatingType 1→many Rating.

## 7. Geospatial design (PostGIS)

- **Nearby query:** `ST_DWithin(location, :point::geography, :radius_meters)` ordered by `ST_Distance` — accurate meter-based radius search backed by a GiST index. Replaces the old app's `111139` degrees-per-meter approximation.
- **Distance to each pin:** `ST_Distance(location, :point::geography)` (true meters).
- **Duplicate prevention on add:** reject a new fountain if any existing fountain is within a configurable threshold (default 10 m) via `ST_DWithin` → HTTP 409.
- **Map bounds query:** fetch fountains within the current viewport bounding box (`ST_MakeEnvelope`) with a sane cap + clustering for dense areas.

## 8. Ranking design

- **Per-fountain overall rating** = mean across all its rating rows (all users, all dimensions), with **vote count** = distinct users who rated it. Both are shown **on the map** (pin info + detail view: stars + "N votes" + numeric), mirroring the old info-window UX.
- **Leaderboard ranking** uses a **weighted score**, not the raw average, so low-vote fountains don't dominate. A Bayesian/weighted-average approach:
  `ranking_score = (v / (v + m)) * R + (m / (v + m)) * C`
  where `R` = fountain average, `v` = its vote count, `C` = global mean rating, `m` = a tunable confidence constant. Leaderboards: **top fountains globally and by area**, each showing ranking score + vote count.
- **Contributor leaderboard** (secondary): users earn points for adding fountains and submitting ratings; ranked list of top contributors.
- `average_rating`, `rating_count`, and `ranking_score` are denormalized on `Fountain` and recomputed on rating create/update for fast map + leaderboard reads.

## 9. API surface (REST, `/api/v1`)

Indicative endpoints (full contract defined in Phase 1):
- `GET /api/v1/fountains?lat&lng&radius_m` — nearby fountains (map pins: id, location, is_working, average_rating, rating_count, distance_m). Public.
- `GET /api/v1/fountains/bbox?min_lat&min_lng&max_lat&max_lng` — fountains in viewport. Public.
- `GET /api/v1/fountains/{id}` — detail incl. per-dimension averages, vote counts, photos, comments. Public.
- `POST /api/v1/fountains` — add a fountain (location, is_working, ratings, comment). Auth required. 409 on proximity conflict.
- `POST /api/v1/fountains/{id}/ratings` — create/update the caller's ratings for a fountain (upsert). Auth required.
- `POST /api/v1/fountains/{id}/photos` — upload a photo (presigned Spaces flow). Auth required.
- `GET /api/v1/rating-types` — list dimensions. Public.
- `GET /api/v1/leaderboard?scope=global|area` — top fountains. Public.
- `GET /api/v1/leaderboard/contributors` — top contributors. Public.
- `GET /api/v1/me` — current user profile. Auth required.
- `GET /healthz` — liveness for the load balancer.

The OpenAPI schema is the single source of truth; `packages/api-client` is generated from it.

## 10. Authentication design (Logto)

- **Logto self-hosted** in DOKS is the identity authority. Connectors: **Google**, **Apple**, **email magic link (passwordless)**.
- **Web:** Logto Next.js SDK (OIDC auth-code + PKCE), session cookies server-side.
- **Mobile:** Logto React Native SDK with native OAuth (system browser / `expo-auth-session`, `expo-apple-authentication` for Apple), secure token storage.
- **Backend:** validates Logto-issued JWT access tokens via JWKS (`iss`/`aud` verified — no symmetric self-minted shortcut). On first authenticated request, just-in-time provisions a local `User` linked by Logto subject.
- **Guest access:** browsing fountains, map, detail, and leaderboards is **public**. Rating, adding fountains, and uploading photos require login.

## 11. Email design

- **Logto owns transactional auth email** (magic link, verification) via a **custom Logto email connector backed by the Gmail API** (Google service account + Workspace domain-wide delegation) — faithful reuse of the TherapyLink transport, with its Jinja2 `.html`/`.txt` template structure and email-tracking patterns as reference. **Fallback:** Logto's built-in SMTP connector pointed at Google Workspace if the custom connector is deferred.
- Any future app-originated email (e.g., notifications) reuses the same Gmail-API sending approach in the backend.
- Deliverability: SPF/DKIM/DMARC configured on the sending domain (checklist §19).

## 12. Photos design

- Client requests a **presigned upload URL**; uploads directly to **DO Spaces**; backend records the `Photo` row after confirming the object.
- Server-side **resize + thumbnail** generation; originals and thumbnails both in Spaces, served via CDN.
- Basic safeguards: content-type/size limits, per-user rate limiting, `is_hidden` flag for moderation.

## 13. Moderation (lightweight, MVP)

- Users can **report** a fountain or photo; reports surface to an **admin** (`is_admin`) review queue. Admins can hide photos/fountains. No automated moderation in the first build.

## 14. Frontend architecture

- **Monorepo** (pnpm + Turborepo) containing `web` (Next.js), `mobile` (Expo), and `packages/*`.
- **Shared API client** generated from backend OpenAPI; shared validation/types so a change to the API contract propagates to both clients.
- **Maps:** MapLibre GL JS (web) and MapLibre React Native (mobile) rendering the Protomaps basemap; custom pins for working/broken + rating; clustering at low zoom; tap-pin → detail.
- **UI/visual design is a separate collaborative track** (mockups + design system), brainstormed before Phase 3. A `docs/style-guide.md` is created when the first UI elements are designed (house rule).

## 15. Infrastructure (DOKS)

Reuses TherapyLink's proven single-file Terraform DO template, with deliberate divergences for this project's choices.

- **Terraform (`infra/terraform/`)** provisions: `digitalocean_project`, `digitalocean_kubernetes_cluster`, **`digitalocean_database_cluster` (Managed Postgres + PostGIS extension)** — *divergence from TherapyLink's in-cluster Postgres*, `digitalocean_spaces_bucket` (photos + pmtiles + Terraform state), `digitalocean_loadbalancer`, **`digitalocean_certificate` (Let's Encrypt, LB-terminated TLS)**, `digitalocean_record` (DNS), and the DO Container Registry. State in DO Spaces (S3 backend).
- **Kubernetes (`infra/k8s/`)** — raw YAML templated with `envsubst` (matching house style): namespace, backend Deployment/Service, web Deployment/Service, **Logto Deployment/Service + Ingress**, ingress-nginx (Helm-installed in CI), ingress routes, registry + app secrets created at deploy time from GitHub Environment secrets.
- **TLS:** DO **LB-managed Let's Encrypt** SAN cert (apex, `www`, `api`, `auth` for Logto). cert-manager is *not* used (matches TherapyLink's current approach).
- **Logto needs its own Postgres database** — a separate database within the managed cluster.

## 16. CI/CD

- **GitHub Actions** on **`redducklabs-runners`** for all no-secret jobs (lint, type-check, tests, build). **Secret-handling deploy jobs pinned to `ubuntu-latest`** for blast-radius isolation (defender.ai's Class-A/Class-B split). This satisfies "Red Duck Labs runners where possible."
- **Pipelines:** PR checks (lint + type-check + unit/integration tests for backend, web, mobile); image build/push to DO Container Registry; deploy to DOKS via `doctl` + `envsubst | kubectl apply` + `kubectl rollout status`; Alembic migrations via `kubectl exec` into the backend pod.
- **Deploy rollout** tuned for a small cluster (gate on `rollout status`, not `wait --for=available`).

## 17. Security & compliance (public repo)

- **GitHub-native:** CodeQL (Python + JavaScript/TypeScript), Dependabot (pip/npm/github-actions, grouped), secret scanning + push protection, security advisories. Enabled in repo settings + workflow.
- **Supply chain:** Trivy container scanning + justified `.trivyignore`; `pip-audit` (backend) + `pnpm audit` (frontend) in CI and on a daily schedule.
- **App security:** Logto-issued JWTs validated via JWKS; TLS everywhere; no secrets in the repo (all via GitHub Environment secrets / cluster secrets); `SECURITY.md` vulnerability-reporting policy; CODEOWNERS.
- **Conventions:** `.gitattributes` LF normalization (Windows + WSL + Linux); pre-commit hooks (ruff/format, eslint/prettier) mirroring CI.

## 18. AI tooling setup (replicated from defender.ai / TherapyLink)

- **`CLAUDE.md` hub** — router with `## Topic - CRITICAL/MANDATORY` sections, each carrying inline `NEVER`/`ALWAYS` rules + a `🔗 MANDATORY: Read <spoke> BEFORE <trigger>` pointer; closes with an "Architecture References" Document|When-to-Read table.
- **`claude_help/` spokes** (process runbooks) — initial set: `development-process.md`, `codex-review-process.md`, `kubernetes-infra.md`, `oauth-sso.md`, `email.md`, `testing-ci.md`, `github-cli.md`, `github-environments.md`. `docs/design/` holds architecture references; `docs/specs/` + `docs/plans/` hold dated artifacts.
- **Codex** — thin `AGENTS.md` pointing at `CLAUDE.md` + adapter rules; `claude_help/codex-review-process.md` defines the two gating review loops (spec/plan, and PR); `docs/codex/setup.md` + `scripts/launch-codex.sh` for onboarding/launch; review artifacts in gitignored `temp/codex-reviews/`.

## 19. External setup & registrations checklist

Actioned by Aron as the build progresses (the spec carries this as a living checklist):

- **Google Cloud:** project; OAuth 2.0 clients for Web, iOS, Android (with package name + SHA-1); OAuth consent screen; **service account + Google Workspace domain-wide delegation for Gmail sending**.
- **Apple Developer Program** (paid): App ID; **Sign in with Apple** (Services ID + key) for Logto; App Store Connect app record; (later) APNs key for push.
- **Google Play Console** (paid): developer account; app listing; Play App Signing.
- **Logto:** application registrations (web app, native app, machine-to-machine); connectors for Google, Apple, email; redirect URIs per platform.
- **DigitalOcean:** DOKS cluster; Managed Postgres (with PostGIS + a separate Logto DB); Spaces bucket + CDN; Container Registry; Load Balancer; Terraform-state Spaces bucket.
- **DNS (fountainrank.com):** A records (apex, `www`, `api`, `auth`); **SPF, DKIM, DMARC** for email deliverability.
- **GitHub:** enable security features (CodeQL, Dependabot, secret scanning + push protection); configure Environments + secrets; grant `redducklabs-runners` access.
- **Maps:** Protomaps basemap build/host on Spaces (no key if fully self-hosted); decide geocoding/search provider (self-hosted Nominatim vs. provider).
- **Push (later):** FCM (Android) + APNs (iOS).

## 20. Build phases / roadmap

- **Phase 0 — Foundation/scaffolding (this spec's implementation target).** See §21.
- **Phase 1 — Data model + fountains API** (PostGIS schema, migrations, nearby/bbox/detail/add endpoints, ranking computation).
- **Phase 2 — Auth (Logto)** end-to-end on web + mobile, magic-link email via Gmail connector, JIT user provisioning.
- **Phase 3 — Maps UI + add-fountain + rate-on-add** (web + mobile, MapLibre), after UI design brainstorm.
- **Phase 4 — Photos + rating existing fountains** from detail view.
- **Phase 5 — Leaderboards** (fountain + contributor) and profiles.

Each later phase gets its own spec + implementation plan, authored from inside the repo.

## 21. Phase 0 scope (Foundation)

**Deliverables:**
- New repo content in `../fountainrank` with the layout in §22, `.gitignore`, `.gitattributes`, `.trivyignore`, `SECURITY.md`, `README.md` (incl. pinned Software Versions section), `LICENSE` (already present).
- **AI tooling:** `CLAUDE.md` hub + `claude_help/` spokes + `AGENTS.md` + `docs/codex/setup.md` + `scripts/launch-codex.sh`.
- **Monorepo wiring:** pnpm workspace + Turborepo covering `web`, `mobile`, `packages`.
- **Walking-skeleton apps:** FastAPI backend with `/healthz` and one PostGIS-backed endpoint; Next.js web page that calls it; Expo app screen that calls it; shared `api-client` generated from OpenAPI.
- **Local dev:** `docker-compose.yml` (postgres+postgis, logto, backend, web) + `run.ps1` task runner.
- **Infra skeleton:** Terraform for DOKS + Managed Postgres+PostGIS + Spaces + LB + DNS + Logto (plan-clean; apply gated through CI).
- **CI + security:** GitHub Actions (lint/type-check/test/build) with the runner split; CodeQL, Dependabot, Trivy, pip-audit/pnpm audit; CODEOWNERS; issue templates; pre-commit config.

**Acceptance criteria:** repository pushed; all CI checks green; security scanning active; walking-skeleton runs locally via `docker-compose`; design + Phase 0 plan committed in-repo so an in-project Claude instance can continue. (Cloud `terraform apply` / live deploy may be actioned separately once DO + DNS registrations are in place.)

## 22. Repository layout

```
fountainrank/
├── CLAUDE.md                AGENTS.md  README.md  SECURITY.md  LICENSE
├── .gitignore  .gitattributes  .trivyignore  .pre-commit-config.yaml
├── claude_help/             # process spokes
├── docs/
│   ├── design/              # standing architecture references
│   ├── specs/               # dated design specs (this file)
│   ├── plans/               # dated implementation plans
│   ├── codex/setup.md
│   └── style-guide.md       # created when first UI elements are designed
├── backend/                 # FastAPI + PostGIS + Alembic + Logto JWT validation (uv)
├── web/                     # Next.js (App Router, TS, Tailwind)
├── mobile/                  # Expo / React Native (TS)
├── packages/                # shared TS: api-client, config, ui
├── infra/
│   ├── terraform/           # DOKS, Managed Postgres+PostGIS, Spaces, LB, DNS, registry
│   └── k8s/                 # raw YAML (envsubst): backend, web, logto, ingress, secrets
├── docker/  docker-compose.yml
├── scripts/  run.ps1  launch-codex.sh
└── .github/                 # workflows (CI + deploy), dependabot, CodeQL, CODEOWNERS,
                             #   ISSUE_TEMPLATE, composite actions
```

## 23. Open questions / deferred decisions

- **UI/visual design** — dedicated brainstorm before Phase 3 (mockups, design system, `style-guide.md`).
- **Geocoding/search** — self-hosted Nominatim vs. a hosted provider (decided in the maps phase).
- **Git workflow** — branch/PR flow vs. direct-to-main for the foundation work (confirm with Aron before first commit).
- **Push notifications** — deferred to a later phase (FCM/APNs).
- **Exact dependency versions** — pinned in Phase 0 via version research, recorded in `README.md`.

## 24. Risks

- **Operational surface:** self-hosted Logto + DOKS + Managed Postgres is more to operate than a managed-auth/App-Platform setup; mitigated by reusing TherapyLink's proven patterns and runners.
- **Protomaps/MapLibre setup** is more initial work than Google/Mapbox; mitigated by no per-load cost and full control (aligned with the open-source goal).
- **App Store review** (Apple) requires Sign in with Apple alongside Google — captured in the checklist so it isn't discovered late.
```
