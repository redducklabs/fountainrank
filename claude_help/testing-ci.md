# Testing & CI

How we verify changes. CI is the source of truth; local checks mirror it so you
catch failures before opening a PR.

## Golden rule

**Never report green without running the checks yourself.** "Should work" is not
a status. Run it, read the output, then report what actually happened.

## Local checks (mirror CI)

Run them through the root task runner — `./run.ps1 check` is the full CI mirror:

| Scope      | Command                      | Runs                                                                                                  |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Everything | `./run.ps1 check`            | backend + frontend + mobile (= CI)                                                                    |
| Backend    | `./run.ps1 check -Backend`   | `ruff check` + `ruff format --check` + `alembic upgrade head` + `alembic check` (no drift) + `pytest` |
| Web        | `./run.ps1 check -Web`       | ESLint + Prettier + `tsc --noEmit` + `vitest run` + `next build`                                      |
| Mobile     | `./run.ps1 check -Mobile`    | `tsc --noEmit` + ESLint + `vitest run` + `expo-doctor`                                                |
| api-client | `./run.ps1 check -ApiClient` | ESLint + `tsc --noEmit` + `vitest run`                                                                |
| Fast loop  | `./run.ps1 check -Fast`      | as above but skips `next build` + `expo-doctor`                                                       |

`check` auto-starts the `db` container for backend steps and restores the files
`next build` rewrites (`web/next-env.d.ts`, `web/tsconfig.json`) so it never
dirties the tree. The backend `pytest` and `alembic check` need the database;
`./run.ps1 up` (db only) is enough. The frontend `generate` step is DB-free.

## PR readiness — run the checks before you push

**CI runs are not your dev loop. Never push code that hasn't passed the local
mirror — verify green locally first.** Before you open a PR _or push another
commit to one_:

1. **Run the full mirror green:** `./run.ps1 check` (backend + workspace-js + web
   build + mobile). If you only touched one workspace you may scope it
   (`-Backend`, `-Web`, `-Mobile`, `-ApiClient`), but run the **full** `check`
   before the PR and before each push so a cross-workspace contract break (e.g. a
   regenerated `api-client` that web/mobile no longer typecheck against) can't
   slip through.
2. **Schema changed?** Confirm `alembic upgrade head` applies cleanly and
   `alembic check` reports **no drift** — and verify constraint/index _names_ in
   the DB (`pg_constraint`/`pg_indexes`), because `alembic check` does **not**
   compare CHECK-constraint definitions, so a misnamed check can ship silently.
3. **Re-run after every change.** Each push triggers a full CI run; every push
   must be locally green first. If a CI run already failed, diagnose it from the
   logs (`gh run view <id> --log-failed`) and understand the break before pushing
   a fix — do not push hoping CI behaves differently.
4. **Then run the Codex PR loop** (`claude_help/codex-review-process.md`) — it is
   the merge gate on top of CI.

## Settings & environment variables (CI has no `.env`)

CI does not have your local `.env`. Any new setting/env var must:

- Have a **safe default** in `app/config.py` so the app starts without it (and so
  production stays safe — e.g. `dev_auth_enabled` defaults `False`).
- Be **documented** (env-var name only — never commit a value, never write a
  `.env`). Reference it in `backend/README.md` and/or the relevant doc.

**🚨 Comma-separated list settings: use `str` + a split, NOT `list[str]`.**
`pydantic-settings` parses a complex (list/dict) field from the environment as
**JSON**. So a `list[str]` setting fed the natural `FOO=https://a.com,https://b.com`
(or an empty string) raises `SettingsError` and the app **fails to boot**. For any
env-overridable list (CORS origins, allowed hosts, etc.), declare it as `str` and
split in a `field_validator`/property, or accept a JSON array and document that the
value MUST be a JSON array. Do not ship a bare `list[str]` that an operator can set
via env.

**The authoritative mirror is [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)**
(landed in Phase 0f). Job ↔ local parity:

- `backend` = `check -Backend` (ruff + format + `alembic upgrade head` + `alembic check` +
  pytest, against a `postgis/postgis:17-3.5` service published on **5436** so the backend's
  default `DATABASE_URL` reaches it — no env override, exactly like `run.ps1`).
- `workspace-js` = the workspace-wide `turbo run lint typecheck test` (enforces **mobile**
  lint+typecheck+**test** too — mobile has a Vitest suite for its pure helpers) +
  `pnpm run format:check` + `turbo run build --filter=web`.
- `mobile-doctor` = `expo-doctor`.

CodeQL runs via GitHub **default setup** (no workflow file). Security scanning lives in
[`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml)
(`pip-audit`/`pnpm audit`/Trivy). Deploy + Terraform workflows are gated (release-tag /
manual dispatch) and do not run on routine pushes.

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
