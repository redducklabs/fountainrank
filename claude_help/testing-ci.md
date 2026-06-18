# Testing & CI

How we verify changes. CI is the source of truth; local checks mirror it so you
catch failures before opening a PR.

## Golden rule

**Never report green without running the checks yourself.** "Should work" is not
a status. Run it, read the output, then report what actually happened.

## Local checks (mirror CI)

Run them through the root task runner — `./run.ps1 check` is the full CI mirror:

| Scope | Command | Runs |
|---|---|---|
| Everything | `./run.ps1 check` | backend + frontend + mobile (= CI) |
| Backend | `./run.ps1 check -Backend` | `ruff check` + `ruff format --check` + `alembic upgrade head` + `alembic check` (no drift) + `pytest` |
| Web | `./run.ps1 check -Web` | ESLint + Prettier + `tsc --noEmit` + `vitest run` + `next build` |
| Mobile | `./run.ps1 check -Mobile` | `tsc --noEmit` + ESLint + `expo-doctor` |
| api-client | `./run.ps1 check -ApiClient` | ESLint + `tsc --noEmit` + `vitest run` |
| Fast loop | `./run.ps1 check -Fast` | as above but skips `next build` + `expo-doctor` |

`check` auto-starts the `db` container for backend steps and restores the files
`next build` rewrites (`web/next-env.d.ts`, `web/tsconfig.json`) so it never
dirties the tree. The backend `pytest` and `alembic check` need the database;
`./run.ps1 up` (db only) is enough. The frontend `generate` step is DB-free.

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
