# Testing & CI

How we verify changes. CI is the source of truth; local checks mirror it so you
catch failures before opening a PR.

## Golden rule

**Never report green without running the checks yourself.** "Should work" is not
a status. Run it, read the output, then report what actually happened.

## Local checks (mirror CI)

Exact commands are finalized as each subsystem lands (plans 0b/0c/0f). The
intended per-subsystem checks:

- **Backend** (`backend/`): `ruff check` + `ruff format --check`, type-check, and
  `pytest` (with a Postgres+PostGIS service or container). Migrations: `alembic
  upgrade head` then `alembic check` (no drift).
- **Web** (`web/`): ESLint + Prettier, `vitest`, and `next build`.
- **Mobile** (`mobile/`): `tsc --noEmit` + ESLint (and Expo checks).
- **Shared** (`packages/`): type-check + unit tests.

`run.ps1` (added in plan 0d) wraps these for local use. Prefer running checks in
the Docker Compose environment so they match CI.

## Runner policy

Two classes of CI jobs, by whether they touch secrets:

- **Class A — no secrets** (lint, type-check, unit/integration tests, build):
  run on **`redducklabs-runners`** (the self-hosted fleet).
- **Class B — secret-handling** (image push, DOKS deploy, anything with cloud
  credentials / tokens): run on **`ubuntu-latest`**, isolated off the shared
  fleet to limit blast radius.

**Do not change any job's `runs-on` without an explicit decision.** "Use Red Duck
Labs runners where possible" means: Class A on the fleet, Class B pinned to
`ubuntu-latest`.

## Supply-chain checks

CI runs `pip-audit` (backend) and `pnpm audit` (frontend), plus Trivy container
scans. A daily scheduled audit catches CVEs on unchanged dependencies. Trivy
suppressions go in `.trivyignore` and require a justification + revisit
condition.

## PR gate

A PR is mergeable only when: all CI checks are green, Codex returns
`VERDICT: APPROVED`, and every PR comment is addressed. Then squash-merge. See
`codex-review-process.md`.
