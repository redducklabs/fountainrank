# Handoff — FountainRank (Phase 1 in progress + landing page deploying)

**Date:** 2026-06-18 (PDT, evening)
**From:** In-repo Claude session (Phase 1 implementation + temp landing page + logging/CORS + live-site debugging)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec + the Phase 1 plan and continue with no prior conversation.
**Supersedes nothing** — extends `handoffs/2026-06-18-phase-0f-complete-handoff.md` (Phase 0 complete; system LIVE on DOKS).

---

## TL;DR

Three workstreams ran this session:

1. **Phase 1 (data model + fountains API)** — Codex Loop A **APPROVED**; implemented Tasks 1–9 + a logging/CORS addition on branch **`feat/phase-1-fountains-api`** (13 commits, `55ed26e`…`85651e6`). **40 backend tests green**, `alembic check` clean. **NOT yet PR'd.** Remaining: plan Tasks 10–11 (OpenAPI client regen + docs), final whole-branch review, then PR → CI → Codex Loop B → squash-merge.
2. **Temporary landing page** — built, reviewed (Codex Loop B APPROVED, no findings), **merged to `main` (PR #6 → `caf2138`)**, tagged **`v0.1.2`**, **deployed + verified LIVE** (run `27806752882` = success). `https://fountainrank.com`=200 now serves the new page and the **"Backend status: error" is GONE**; www/api/auth all healthy.
3. **Live-site debugging + comprehensive logging** — diagnosed the live "Backend status: error" and mobile "Secure Connection Failed"; added comprehensive backend logging + CORS (in the Phase 1 branch) and a mandatory Logging standard to `CLAUDE.md`.

---

## ▶ RESUME HERE (in order)

1. **✅ v0.1.2 deploy is DONE + verified LIVE** (run `27806752882` = success). `https://fountainrank.com`=200 serves the new landing page; "Backend status: error" is gone; `www`=200, `api/healthz`=200, `auth`=302. Nothing further needed here. *(Optional cleanup: remove the now-merged landing-page worktree — `git worktree remove .claude/worktrees/landing-page` + `git branch -D worktree-landing-page` — which also stops the shell-cwd drift gotcha.)*
2. **Resume Phase 1** on `feat/phase-1-fountains-api` — **the main remaining work**: plan **Task 10** (OpenAPI guard test + regen api-client) → **Task 11** (run.ps1 dev-auth + README/spec docs) → **final whole-branch review** → `./run.ps1 check` (full) → **open the Phase 1 PR** → CI green → **Codex Loop B APPROVED** (explicitly review the logging/CORS addition) → squash-merge. Details in "Phase 1 remaining" below.
3. **Mobile SSL:** owner is re-testing (their choice). Server TLS verified-good — act only if they report it still fails (option: drop apex `AAAA`; see "Live site / SSL").

---

## Read-first

1. `CLAUDE.md` — operating-rules hub (now includes a **"Logging & Observability — MANDATORY"** section added this session).
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — approved whole-system design (§6 data model, §7 geo, §8 ranking, §9 API, §20 phases).
3. `docs/plans/2026-06-18-phase-1-data-model-and-fountains-api.md` — the **Codex-approved Phase 1 plan** (Tasks 1–11). Its "Codex Loop A — round 1 revisions" + "Task 1 implementation follow-ups" sections record fixes. Reviews: `temp/codex-reviews/phase-1-…-plan-review-{1,2}.md`.
4. `handoffs/2026-06-18-phase-0f-complete-handoff.md` — infra/deploy/CD-trigger model, first-live-deploy history.
5. The relevant `claude_help/*.md` spoke before any dev/CI/Codex/infra work.

---

## Branch / commit state

- **`main`** @ `caf2138` — landing page merged (PR #6). Tag `v0.1.2` points here (deploying).
- **`feat/phase-1-fountains-api`** @ `85651e6` — all Phase 1 backend work + logging/CORS. Branched from `ba82fb6`. **13 commits:**
  - `55ed26e` plan · `7fceea4` core schema/models/alembic · `fbafc18` fix ck name · `d774e8f` rating-types seed+endpoint · `6343570` dev-auth seam · `59da67c` ranking service · `4606166` POST /fountains add · `842d033` POST /fountains/{id}/ratings · `72eb3bc` de-deprecate 422 · `161047c` GET nearby · `e851897` GET bbox · `e6b5705` GET detail · `85651e6` logging + CORS.
- **`worktree-landing-page`** @ `041eda7` — landing page (now merged via PR #6; the local git **worktree** at `.claude/worktrees/landing-page` can be removed: `git worktree remove .claude/worktrees/landing-page`, then `git branch -D worktree-landing-page`). Removing it also stops the shell-cwd drift (see gotchas).
- Working tree: only `docs/setup/04-apple-and-app-stores.md` modified (owner's open IDE file — **leave untouched**).

---

## Phase 1 — what's DONE (Tasks 1–9 + logging, verified green)

Backend (`backend/app/…`): `models.py` (User/Fountain/RatingType/Rating, GeoAlchemy2 Geography, drift-free naming convention), `migrations/env.py` (alembic_helpers + verify-full TLS in the online engine), migrations `0002` (schema) + `0003` (seed Clarity/Taste/Pressure/Appearance), `schemas.py`, `auth.py` (dev-auth seam — **disabled by default, prod-safe**; `X-Dev-User` header; JIT user provisioning, Phase 2 swaps in Logto JWT), `ranking.py` (Bayesian recompute), `geo.py` (point/lat/lng helpers), `routers/rating_types.py`, `routers/fountains.py` (add + rate + nearby + bbox + detail), plus **logging** (`logging_config.py`, `middleware.py`) + **CORS** wired in `main.py`. Endpoints under `/api/v1`: `GET rating-types`, `POST fountains` (proximity-409 + inline ratings), `POST fountains/{id}/ratings` (atomic ON CONFLICT upsert), `GET fountains` (nearby ST_DWithin), `GET fountains/bbox` (inverted-bounds 422), `GET fountains/{id}` (per-dimension detail). Tests: 40 passing.

**Logging/CORS (commit `85651e6`, ADDED beyond the original plan, owner-directed):** structured JSON to stdout (`LOG_LEVEL`/`LOG_FORMAT` settings), pure-ASGI `RequestContextMiddleware` (per-request `X-Request-ID` + request/latency logging), centralized `Exception` handler logging full stack traces (no silent 500s), startup config logging with the DB password redacted, `CORSMiddleware` (origins: fountainrank.com/www + localhost:3020). `CLAUDE.md` gained the mandatory logging standard. **Flag this for the Phase 1 PR's Codex Loop B** — it was not in the Codex-approved plan.

## Phase 1 — REMAINING

- **Plan Task 10** — OpenAPI contract-guard test (`tests/test_openapi.py` asserts the new paths/schemas) + **regenerate the api-client** (`./run.ps1 generate`, gitignored output) + verify `./run.ps1 check -ApiClient`, `-Web`, `-Mobile` stay green (the new endpoints are additive; no consumer edits expected).
- **Plan Task 11** — set `DEV_AUTH_ENABLED=true` in `run.ps1`'s host `backend` command for local write testing; document the `/api/v1` surface + dev-auth header in `backend/README.md`; update spec §9 from "indicative" to "implemented" (keep `/me`, `/leaderboard`, photos as deferred).
- **Final whole-branch review** (capable model / Codex Loop A-style on the full diff) — generate `scripts/review-package $(git merge-base main HEAD) HEAD` and review. Then run `./run.ps1 check` (FULL: backend + workspace-js + web build + mobile).
- **Open the Phase 1 PR** → monitor CI green (backend/workspace-js/mobile-doctor + security-audit) → **Codex Loop B** to `VERDICT: APPROVED` (explicitly have it review the logging/CORS addition) → squash-merge.
- **Do NOT tag a release for Phase 1** unless the owner asks — that deploys it. Phase 1 write endpoints stay disabled in prod (`dev_auth_enabled=False`) until Phase 2 auth.

---

## Live site / SSL diagnosis (this session)

- **"Backend status: error" (desktop):** the live skeleton's `BackendStatus` client component fetched `http://localhost:3021/healthz` (the prod web build had no API URL, so it used the localhost default) → CORS-blocked. **The new landing page (v0.1.2, deploying) deletes that component**, so it disappears once deployed.
- **"Secure Connection Failed" (mobile):** **server TLS is verified-GOOD** — valid LE SAN cert (apex/www/api/auth, issued 2026-06-18 20:12 GMT, exp Sep 16), **full chain** (leaf + LE `E8` intermediate → ISRG Root X1) served over **both IPv4 and IPv6**, all hosts 200/302 with `ssl_verify=0`. The DO LB `fountainrank-production-lb` has both `146.190.0.127` (v4) and `2604:a880:4:1d0:0:2:fcb4:d000` (v6); apex `A`/`AAAA` correctly point at the LB. So the failure is **client/network (likely IPv6 path)**, not the server. Owner is **re-testing**. If it persists, the mitigation is to **drop the apex `AAAA`** (DO DNS record id `1822732006`) to force IPv4 — a live-DNS **removal** (needs owner OK; the LB keeps working on v4). Note: there's also a stray **duplicate `A @`** (id `1822732005`) — both pre-date Terraform and aren't in its state (also noted in the 0f handoff).
- **Phase 2 TODO:** set `NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com` at **web build time** (`web/Dockerfile` build-arg + `deploy.yml`) so the deployed web calls the real API, not localhost. Not needed for the landing page (no API calls). CORS is already added on the backend (in the Phase 1 branch).

---

## ⚠ Environment gotchas (IMPORTANT — cost real time this session)

- **Shell cwd drifts.** The Git Bash tool's working directory keeps **resetting to `D:\repos\fountainrank\.claude\worktrees\landing-page`** (the active git worktree). **Prefix every controller Bash command with `cd /d/repos/fountainrank`** (or `cd /d/repos/fountainrank/backend`). Removing the landing-page worktree (now merged) should stop this.
- **`pwsh` is NOT on PATH.** Use **`powershell.exe -NoProfile -File run.ps1 <cmd>`** (Windows PowerShell 5.1, works) or run `uv`/`docker`/`pnpm` directly in Git Bash. `run.ps1 check -Backend` is the authoritative backend gate.
- **Codex (WSL) can corrupt `backend/.venv`.** During review, Codex ran Python in WSL and created a **POSIX-layout** `.venv` (`lib64` symlink, no `Scripts/python.exe`), which broke Windows `uv` with `failed to remove .venv/lib64: Access is denied`. **Fix:** `cd /d/repos/fountainrank/backend && rm -rf .venv && uv sync`. Watch for this after any Codex run.
- **DB:** container `fountainrank-db-1` (postgis 17-3.5) on `localhost:5436` (the backend's default `DATABASE_URL`). `./run.ps1 up` or `docker compose -f docker/docker-compose.yml up -d db` starts it. Tests + `alembic` need it; current DB has migrations `0001→0003` applied + the 4 seeded rating types.
- **Windows file tools:** backslash paths for Read/Write/Edit (`D:\repos\fountainrank\…`); Git Bash uses forward slashes (`/d/repos/fountainrank/…`).

---

## Process notes (how this session worked)

- **Subagent-driven execution** (superpowers): cheap/sonnet implementer subagents per task batch (they transcribe the complete code from the plan + run TDD + commit); the **controller (main session) runs the authoritative `./run.ps1 check -Backend`** and reviews diffs before marking done. Per-task briefs at `.git/sdd/task-N-brief.md` (via `scripts/task-brief`), reports at `.git/sdd/task-NNN-report.md`. Ledger at **`.git/sdd/progress.md`** (gitignored) records each task's commit + verification. **Background agents send `idle_notification`; verify their actual git commits/reports — don't trust the notification.**
- **Codex** (MCP, bypass mode: `sandbox: danger-full-access`, `approval-policy: never`, cwd = WSL path `/mnt/d/repos/fountainrank…`): Loop A approved the Phase 1 plan over 2 rounds (8 findings fixed — UUID import, ck-name double-prefix, explicit `Double`, migration TLS, `last_rated_at` clear, atomic upsert, bbox bounds, gen_random_uuid claim). Loop B approved PR #6 (landing page) with no findings (`temp/codex-reviews/pr-6-review-1.md`). **Codex cannot `gh pr review --approve` its own account's PR — it posts the verdict as a PR comment** (still counts; squash-merge once CI green + verdict APPROVED + comments addressed).
- **A controller mistake worth knowing:** the Task 1 `ck_ratings_…` check-constraint name shipped double-prefixed (`alembic check` doesn't compare CHECK constraints, so it slipped past the gate) — caught in controller verification by querying `pg_constraint` directly, fixed in `fbafc18`. Verify schema constraint/index names in the DB, not just `alembic check`.

---

## Open items / future

- **Phase 1 PR** still to open + merge (see "Phase 1 remaining").
- **Landing page worktree cleanup** (`git worktree remove …`) once the deploy is confirmed.
- **Mobile SSL** owner re-test (pending).
- **Phase 2 web→API:** `NEXT_PUBLIC_API_BASE_URL` build wiring (above).
- **Carried from 0f (non-blocking):** dedicated least-priv DB users (app+logto use `doadmin`); apex dup-A/AAAA cleanup; `deploy.yml` tags images by git-SHA even on `v*` tags; add required reviewers to the `production` GitHub Environment; re-add Spaces buckets (Phase 3/4); Dependabot PRs #1–3 open.
- **Next feature phases:** 2) Logto auth + magic-link email; 3) maps UI + add/rate-on-add (UI brainstorm → `docs/style-guide.md` already seeded by the landing page); 4) photos; 5) leaderboards.
