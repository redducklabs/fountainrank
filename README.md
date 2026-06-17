# FountainRank

> Find, rate, and rank public drinking fountains.

<!-- Badges (CI / CodeQL) are wired in Phase 0f. -->

**Status:** Walking skeleton — under active development.

## What it is

FountainRank is a crowdsourced map for discovering and rating public drinking
fountains. Find fountains near you, rate them across multiple quality dimensions
(clarity, taste, pressure, appearance), add new ones you discover, and see how
they rank. It ships as a web app and native iOS/Android apps backed by a Python
API. The backend is **FastAPI on PostgreSQL + PostGIS**; the apps share one
TypeScript API contract; everything is deployed to **DigitalOcean Kubernetes**.

This is a modern, ground-up rebuild of an earlier C#/Xamarin prototype — see
[`docs/specs/2026-06-16-architecture-and-foundation-design.md`](docs/specs/2026-06-16-architecture-and-foundation-design.md)
for the full design.

## Repository layout

```text
fountainrank/
├── CLAUDE.md                AGENTS.md  README.md  SECURITY.md  LICENSE
├── .gitignore  .gitattributes  .trivyignore  .pre-commit-config.yaml
├── claude_help/             # process spokes (operating runbooks)
├── docs/
│   ├── design/              # standing architecture references
│   ├── specs/               # dated design specs
│   ├── plans/               # dated implementation plans
│   ├── codex/setup.md       # Codex onboarding
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
└── .github/                 # workflows (CI + deploy), dependabot, CodeQL, CODEOWNERS
```

> Most of the application directories above are added in later Phase 0 plans
> (`docs/plans/`). The foundation (conventions + AI tooling) lands first.

## Tech stack

| Layer | Technology |
|---|---|
| Backend language/runtime | Python 3.13 |
| Backend framework | FastAPI + Uvicorn |
| ORM / migrations | SQLAlchemy 2 (async) + Alembic |
| Database | PostgreSQL 17 + PostGIS 3.x (DO Managed Postgres) |
| Dependency mgmt (Py) | uv (locked) |
| Web | Next.js (App Router) + React 19 + TypeScript + Tailwind |
| Mobile | Expo SDK / React Native + TypeScript |
| Maps | MapLibre GL JS (web) + MapLibre React Native (mobile) + Protomaps `pmtiles` |
| Auth | Logto (self-hosted) |
| Monorepo | pnpm + Turborepo (Node 22) |
| Object storage | DO Spaces + CDN |
| Orchestration | DigitalOcean Kubernetes (DOKS) |
| IaC | Terraform (DigitalOcean provider) |
| CI/CD | GitHub Actions on `redducklabs-runners` |
| Email | Gmail API via a Logto custom email connector (SMTP fallback) |

## Software Versions

Populated and pinned during Phase 0b/0c via version research; project policy is
to track the latest stable release. Pinned dependency versions live in
`backend/` (`pyproject.toml`/`uv.lock`) and the workspace `package.json` files.

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

## Getting started

Local development uses Docker Compose plus a PowerShell task runner (added in the
local-dev plan, `docs/plans/` 0d):

```powershell
.\run.ps1 up      # start the local stack (postgres+postgis, logto, backend, web)
```

Until then, the foundation work is documentation and configuration only.

## Contributing & security

- Development process, testing, and the Codex review gate are documented in
  [`CLAUDE.md`](CLAUDE.md) and the `claude_help/` runbooks
  ([`codex-review-process.md`](claude_help/codex-review-process.md),
  [`testing-ci.md`](claude_help/testing-ci.md)).
- Changes must pass CI and a Codex review before merge.
- To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## License

See [`LICENSE`](LICENSE).
