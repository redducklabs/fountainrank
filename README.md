# FountainRank

> Find, rate, and rank public drinking fountains.

[![CI](https://github.com/redducklabs/fountainrank/actions/workflows/ci.yml/badge.svg)](https://github.com/redducklabs/fountainrank/actions/workflows/ci.yml)
[![Security audit](https://github.com/redducklabs/fountainrank/actions/workflows/security-audit.yml/badge.svg)](https://github.com/redducklabs/fountainrank/actions/workflows/security-audit.yml)
[![Code scanning](https://img.shields.io/badge/CodeQL-default%20setup-blue?logo=github)](https://github.com/redducklabs/fountainrank/security/code-scanning)

<!-- CodeQL uses GitHub default setup (no codeql.yml workflow) — the badge links to the code-scanning page. -->

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
├── scripts/  launch-codex.sh
├── run.ps1                   # local dev task runner (repo root)
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
| Node.js | 22.22.3 | 2026-06-17 |
| pnpm | 11.7.0 | 2026-06-17 |
| Turborepo | 2.9.18 | 2026-06-17 |
| TypeScript | 6.0.3 (api-client 5.9.3) | 2026-06-17 |
| Next.js | 16.2.9 | 2026-06-17 |
| React | 19.2.7 (web) / 19.2.3 (mobile) | 2026-06-17 |
| Expo SDK / React Native | 56 (expo 56.0.12) / 0.85.3 | 2026-06-17 |
| Tailwind CSS | 4.3.1 | 2026-06-17 |
| PostgreSQL / PostGIS | 17 / 3.5.2 | 2026-06-17 |
| uv | 0.11.21 | 2026-06-17 |
| FastAPI | 0.137.1 | 2026-06-17 |
| SQLAlchemy | 2.0.51 | 2026-06-17 |
| Alembic | 1.18.4 | 2026-06-17 |
| ruff | 0.15.17 | 2026-06-17 |
| Terraform | 1.12.2 local / 1.15.6 in CI (pin `>= 1.6`) | 2026-06-18 |
| GitHub Actions (checkout / setup-node / setup-uv / pnpm) | v6 / v6 / v8.2.0 / v6.0.9 | 2026-06-18 |
| CodeQL | GitHub default setup (action `*@v4` for SARIF upload) | 2026-06-18 |
| Trivy (aquasecurity/trivy-action) | 0.71.1 (action `v0.36.0`) | 2026-06-18 |
| actionlint | v1.7.12 | 2026-06-18 |
| kubeconform | v0.8.0 | 2026-06-18 |
| ingress-nginx Helm chart | 4.15.1 (app 1.15.1) | 2026-06-18 |
| Helm | v3.21.1 | 2026-06-18 |
| DigitalOcean TF provider | `~> 2.0` | 2026-06-17 |
| DOKS (Kubernetes) | 1.34.x (DO offers 1.33–1.36) | 2026-06-17 |
| Logto (self-hosted) | 1.40.1 | 2026-06-17 |
| maplibre-gl | 5.24.0 | 2026-06-20 |
| pmtiles | 4.4.1 | 2026-06-20 |
| @testing-library/react | 16.3.2 | 2026-06-20 |
| @testing-library/jest-dom | 6.9.1 | 2026-06-20 |
| jsdom | 29.1.1 | 2026-06-20 |
| (full pins) | `backend/pyproject.toml` + `backend/uv.lock`; workspace `package.json` + `pnpm-lock.yaml` | — |

## Getting started

Local development uses Docker Compose plus a PowerShell task runner (`run.ps1`):

```powershell
.\run.ps1 bootstrap   # install backend (uv) + workspace (pnpm) deps
.\run.ps1 up          # start Postgres/PostGIS (db only) on host port 5436
.\run.ps1 backend     # migrate + serve the API on http://localhost:3021 (host, --reload)
.\run.ps1 web         # serve the Next.js app on http://localhost:3020 (host)
```

Optional services are behind Compose profiles: `.\run.ps1 up -Auth` adds
self-hosted Logto (app `:3022`, admin `:3023`); `.\run.ps1 up -Full` also runs the
backend in a container. Mirror CI locally with `.\run.ps1 check` (see
[`claude_help/testing-ci.md`](claude_help/testing-ci.md)). Run `.\run.ps1 help`
for the full command list.

## Infrastructure

Infrastructure-as-code lives in [`infra/`](infra/README.md): Terraform for the
DigitalOcean stack (DOKS, Managed Postgres + PostGIS, Spaces, Load Balancer +
Let's Encrypt TLS, DNS, registry) and `envsubst`-templated Kubernetes manifests.
**Applies and deploys happen only in CI** — locally these are read-only
(`terraform validate`; `envsubst` + `kubeconform` for manifests). See
[`claude_help/kubernetes-infra.md`](claude_help/kubernetes-infra.md).

## Contributing & security

- Development process, testing, and the Codex review gate are documented in
  [`CLAUDE.md`](CLAUDE.md) and the `claude_help/` runbooks
  ([`codex-review-process.md`](claude_help/codex-review-process.md),
  [`testing-ci.md`](claude_help/testing-ci.md)).
- Changes must pass CI and a Codex review before merge.
- **Active security scanning:** CodeQL (default setup — Python + JS/TS + Actions),
  Trivy (filesystem secret gate + report-only image scans), `pip-audit` + `pnpm audit`
  (PR + daily), Dependabot (grouped version PRs), and GitHub secret scanning + push
  protection. Image/container deploys run **only in CI** — never from a local machine —
  and the deploy/Terraform workflows are gated (release-tag / manual dispatch).
- To report a vulnerability, see [`SECURITY.md`](SECURITY.md).

## License

See [`LICENSE`](LICENSE).
