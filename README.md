# FountainRank

> Find, rate, and improve public drinking fountains.

[![CI](https://github.com/redducklabs/fountainrank/actions/workflows/ci.yml/badge.svg)](https://github.com/redducklabs/fountainrank/actions/workflows/ci.yml)
[![Security audit](https://github.com/redducklabs/fountainrank/actions/workflows/security-audit.yml/badge.svg)](https://github.com/redducklabs/fountainrank/actions/workflows/security-audit.yml)
[![Code scanning](https://img.shields.io/badge/CodeQL-default%20setup-blue?logo=github)](https://github.com/redducklabs/fountainrank/security/code-scanning)

<!-- CodeQL uses GitHub default setup (no codeql.yml workflow); the badge links to the code-scanning page. -->

FountainRank is a community map of public drinking fountains. It helps people find
nearby water, see whether a fountain is working, compare quality, and add better
information for the next person.

The project is public and open source. It includes a web app, native mobile apps,
a shared API, and deployment automation.

## What You Can Do

- Browse nearby fountains on a map.
- Open fountain details with ratings, notes, attributes, and working status.
- Rate fountain quality across clarity, taste, pressure, and appearance.
- Report whether a fountain is working.
- Add observations such as bottle filler, accessibility, and dual-height details.
- Add new fountains.
- Track contribution points and leaderboard progress.

Some write features require sign-in. Native mobile sign-in and store-release flows
are still owner-gated until the app-store and Logto callback setup is fully verified
on real devices.

## How It Is Built

FountainRank is organized as a full-stack application:

- A backend API stores fountain, rating, contribution, and moderation data.
- Web and mobile apps give people map-based discovery and contribution tools.
- Shared TypeScript packages keep the client API contract consistent.
- Infrastructure, deployment, and security automation live in the same repository.

For implementation details and current planning, use the documentation under
[`docs/`](docs/) rather than treating this README as the project status log.

## For Contributors

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md). It covers the working rules,
branch/PR expectations, local verification, security expectations, and where to find
the deeper project runbooks.

Short version:

- Keep changes focused and tied to the existing specs/plans.
- Do not commit secrets, `.env` values, generated credentials, or AI attribution.
- Use the repo's task runner and existing package commands.
- Run the checks that match your change before claiming it is ready.
- PRs must pass CI and the required review gates before merge.

Security issues should be reported through [`SECURITY.md`](SECURITY.md), not opened
as public issues.

## Running Locally

Local development uses Docker Compose plus the root PowerShell task runner:

```powershell
.\run.ps1 bootstrap
.\run.ps1 up
.\run.ps1 backend
.\run.ps1 web
```

The default local services are:

| Service                           | URL / Port              |
| --------------------------------- | ----------------------- |
| Web app                           | `http://localhost:3020` |
| Backend API                       | `http://localhost:3021` |
| Postgres/PostGIS                  | `localhost:5436`        |
| Logto app, with `-Auth` profile   | `http://localhost:3022` |
| Logto admin, with `-Auth` profile | `http://localhost:3023` |

Common checks:

```powershell
.\run.ps1 check
.\run.ps1 check -Backend
.\run.ps1 check -Web
.\run.ps1 check -Mobile
```

Run `.\run.ps1 help` for the full command list. From WSL, keep using repo-relative
or Linux paths; do not use Windows absolute paths in Codex work.

## Repository Layout

```text
fountainrank/
├── backend/       FastAPI, SQLAlchemy, Alembic, PostGIS, auth, imports, tests
├── web/           Next.js App Router web app
├── mobile/        Expo / React Native mobile app
├── packages/      Shared TypeScript packages, including the generated API client
├── infra/         Terraform and Kubernetes deployment assets
├── docker/        Local Docker Compose support
├── docs/          Specs, plans, design notes, setup guides, runbooks, assets
├── claude_help/   Project process runbooks
├── .github/       CI, deploy, release, issue, PR, and ownership configuration
├── run.ps1        Local development task runner
└── CLAUDE.md      Source-of-truth project operating guide
```

## Technology Overview

| Area           | Stack                                                              |
| -------------- | ------------------------------------------------------------------ |
| Backend        | Python 3.13, FastAPI, Uvicorn, SQLAlchemy 2, Alembic               |
| Database       | PostgreSQL 17 + PostGIS                                            |
| Web            | Next.js App Router, React 19, TypeScript, Tailwind CSS             |
| Mobile         | Expo SDK 56, React Native, TypeScript                              |
| Maps           | MapLibre, Protomaps tiles, OpenStreetMap-derived fountain data     |
| Auth           | Self-hosted Logto with Google, Apple, and email magic-link support |
| Monorepo       | pnpm, Turborepo, uv                                                |
| Infrastructure | DigitalOcean Kubernetes, Managed Postgres, Spaces/CDN, Terraform   |
| CI/CD          | GitHub Actions on project runners                                  |
| Security       | CodeQL, Trivy, Dependabot, secret scanning, audit workflows        |

Pinned dependency versions live in `backend/pyproject.toml`, `backend/uv.lock`,
workspace `package.json` files, and `pnpm-lock.yaml`.

## Deeper Documentation

- [`CLAUDE.md`](CLAUDE.md) is the source of truth for project operating rules.
- [`docs/design/architecture.md`](docs/design/architecture.md) summarizes the system.
- [`docs/specs/2026-06-16-architecture-and-foundation-design.md`](docs/specs/2026-06-16-architecture-and-foundation-design.md)
  contains the original architecture and foundation design.
- [`backend/README.md`](backend/README.md), [`web/README.md`](web/README.md), and
  [`mobile/README.md`](mobile/README.md) cover app-specific details.
- [`infra/README.md`](infra/README.md) covers infrastructure layout and local
  validation boundaries.

## License

See [`LICENSE`](LICENSE).
