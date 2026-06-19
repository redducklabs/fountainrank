# Handoff — FountainRank (Phase 1 MERGED + Codex review-process ported)

**Date:** 2026-06-19 (early UTC; 2026-06-18 evening PDT)
**From:** In-repo Claude session (finished Phase 1 → PR #7 → Codex-approved → squash-merged; ported the defender.ai Codex review process into this repo)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec + the Phase 1 plan and continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-18-phase-1-in-progress-handoff.md` (that session's "Phase 1 remaining" is now DONE + merged).

---

## TL;DR

1. **Phase 1 is DONE and MERGED to `main`.** PR **#7** (`feat(backend): Phase 1 — data model + fountains API (/api/v1)`) squash-merged → **`main` @ `2d037e3`**. CI fully green, **Codex `VERDICT: APPROVED`** (3 rounds), all PR comments addressed/resolved. **NOT deployed** (deliberately not tagged — see below).
2. **Codex review process ported from `../defender.ai`** (owner-directed). `claude_help/codex-review-process.md` rewritten to the full operating guide; PR-readiness folded into `claude_help/testing-ci.md`; `CLAUDE.md` Codex-Reviews + Source-Control sections sharpened. This is now the standing review process — **follow it for every spec/plan and every PR.**
3. **Codex review caught 3 real concurrency races + 2 observability/config bugs** in the Phase 1 code; all fixed with tests before merge (details below). This is the value of the gate — keep using it.

---

## ▶ RESUME HERE (pick the next phase)

Phase 1 is closed. The next feature phases (from the design, §20) are:

1. **Phase 2 — Logto auth + magic-link email.** This is the natural next step: replace the Phase 1 **dev-auth seam** with real Logto JWT validation (verify `iss`/`aud` via JWKS, take `sub`), reusing the existing `get_or_create_user` tail **unchanged**. Then flip writes on in prod. Also: set `NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com` at **web build time** (`web/Dockerfile` build-arg + `deploy.yml`) so the deployed web calls the real API (CORS is already wired on the backend). Read `claude_help/oauth-sso.md` + `claude_help/email.md` first; write a spec/plan and run **Codex Loop A** before coding.
2. **Phase 3** — maps UI + add/rate-on-add (UI brainstorm → `docs/style-guide.md` already seeded by the landing page).
3. **Phase 4** — photos. **Phase 5** — leaderboards.

**Before any code:** spec → plan → **Codex Loop A APPROVED** → implement (see `claude_help/codex-review-process.md`).

---

## Read-first

1. `CLAUDE.md` — operating-rules hub (Codex-Reviews + Source-Control sections were sharpened this session).
2. `claude_help/codex-review-process.md` — **the full Codex operating guide** (ported this session: be-critical/4-dimensions, file-naming table, WSL↔Windows path derivation, Loop A/B, invocation prompts). MANDATORY before finalizing a spec/plan or merging a PR.
3. `claude_help/testing-ci.md` — local CI mirror (`./run.ps1 check`) + the PR-readiness checklist (incl. the pydantic-settings list-env footgun).
4. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — approved whole-system design (§9 now marks Phase 1 endpoints "implemented").
5. `docs/plans/2026-06-18-phase-1-data-model-and-fountains-api.md` — the (completed) Phase 1 plan.
6. `handoffs/2026-06-18-phase-0f-complete-handoff.md` — infra/deploy/CD-trigger model, first-live-deploy history.

---

## Branch / commit state

- **`main`** @ `2d037e3` — Phase 1 merged (PR #7). Linear history: `2d037e3` (Phase 1, #7) → `caf2138` (landing page, #6) → `ba82fb6` (Phase 0f) → …
- **`feat/phase-1-fountains-api`** — squash-merged and **deleted** (local + remote, pruned). The 20-commit branch is collapsed into `2d037e3`.
- **Working tree:** only `docs/setup/04-apple-and-app-stores.md` is modified — this is the **owner's open IDE file; leave it untouched** (it has been left unstaged across this whole session).
- **No release tag** was added — Phase 1 is intentionally **not deployed** (a `v*.*.*` tag triggers `deploy.yml`). Prod still runs **v0.1.2** (landing page + pre-Phase-1 backend). Deploying Phase 1 is a separate, deliberate step, and write endpoints stay closed in prod (`dev_auth_enabled=False`) until Phase 2 auth lands.

---

## Source-control policy (decided 2026-06-19) — READ

- The repo has a GitHub **ruleset requiring PRs** for `main` (classic branch-protection API returns 404 — the rule lives in **Repository → Rulesets**, not classic protection; don't be fooled by the 404). The owner's account has **bypass** privileges, so a direct `git push origin main` *succeeds* but prints `remote: - Changes must be made through a pull request.`
- **Policy (owner decision):** **all code AND governance-doc changes (`CLAUDE.md`, `claude_help/`, specs, plans, infra) go through branch → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge.** The **only** sanctioned direct-to-`main` exception is **session-continuity handoffs** (`handoffs/*.md`) — like this file — so a session can persist its state for an immediate restart. Do **not** direct-push anything else, even though the bypass would let you.
- **TODO (do via a PR, not a direct push):** update `CLAUDE.md` → *Source Control Strategy* to record this handoff-only direct-to-`main` exception (right now that section reads "all work → branch → PR", which doesn't mention the exception).

---

## What shipped in Phase 1 (PR #7)

**Backend (`backend/app/…`), all under `/api/v1`:**
- Models `User`/`Fountain`/`RatingType`/`Rating` (SQLAlchemy 2 async, GeoAlchemy2 `geography(Point,4326)`, drift-free naming convention); migrations `0002` (schema) + `0003` (seed Clarity/Taste/Pressure/Appearance); `alembic check` drift-free; migration engine uses verify-full TLS in prod.
- Endpoints: `GET /rating-types`, `POST /fountains` (proximity-409 + optional inline ratings), `POST /fountains/{id}/ratings` (atomic upsert), `GET /fountains` (nearby `ST_DWithin`), `GET /fountains/bbox` (viewport, inverted-bounds 422), `GET /fountains/{id}` (per-dimension detail). lon/lat ordering centralized in `app/geo.py`.
- Bayesian `ranking_score` recomputed + denormalized on every rating change (`app/ranking.py`).
- **Dev-auth seam** (`app/auth.py`): disabled by default (`dev_auth_enabled=False`), `X-Dev-User` header, JIT user provisioning — **Phase 2 swaps in Logto JWT with no change to the provisioning tail**.
- **Structured logging + CORS** (`app/logging_config.py`, `app/middleware.py`, `app/main.py`): JSON to stdout, per-request `X-Request-ID`, request/latency access log (now fires on 500s too), centralized exception handler (no silent 500s), startup config log with DB password redacted, `CORSMiddleware`.
- **50 backend tests** green. `backend/README.md` documents the `/api/v1` surface + dev-auth headers. `run.ps1 backend` sets `DEV_AUTH_ENABLED=true` for local write testing only.

**Concurrency / robustness fixes (added during review — these are the bugs Codex caught):**
- `submit_ratings` locks the fountain row `SELECT … FOR UPDATE` before upsert+recompute (serializes per-fountain aggregate recompute).
- `get_or_create_user` uses `INSERT … ON CONFLICT DO NOTHING` + re-select (race-safe JIT provisioning; no unique-violation 500).
- `add_fountain` takes a transaction-level **advisory lock** (`pg_advisory_xact_lock`, key `_ADD_FOUNTAIN_LOCK_KEY`) before the proximity check (closes the check-then-insert duplicate race). Single global key is fine for Phase 1 (adds are rare); a spatial-grid key is a noted future refinement.
- 500-path now emits the access log + `X-Request-ID` on the error response.
- `CORS_ALLOW_ORIGINS` accepts comma-separated **or** JSON (was a bare `list[str]` that crashed startup on a non-JSON env value — uses `NoDecode` + a `field_validator`).
- Each fix has a concurrency/regression test (`test_ratings_api.py`, `test_auth_seam.py`, `test_fountains_add.py`, `test_logging.py`, `test_config.py`).

**Docs / process (also in PR #7, owner-directed):**
- `claude_help/codex-review-process.md` — full rewrite to defender.ai-grade.
- `claude_help/testing-ci.md` — PR-readiness fold (run full `./run.ps1 check` before every PR/push; the pydantic-settings comma-separated-list footgun).
- `CLAUDE.md` — Codex-Reviews + Source-Control sections sharpened ("Codex is THE gating reviewer"; squash-merge).
- `docs/specs/…§9` updated; `backend/README.md` API docs.

---

## How the Codex review process works now (USE THIS)

Ported from `../defender.ai` and now standing in `claude_help/codex-review-process.md`. Key points proven this session:
- **Codex MCP** (`mcp__codex__codex` to start, `mcp__codex__codex-reply` to continue the SAME thread) in **bypass mode** (`sandbox: "danger-full-access"`, `approval-policy: "never"`). A sandboxed Codex can't write the review, `git fetch`, or post PR comments.
- **`cwd` = derived WSL path** of the repo root: `D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`. **Never hardcode**; all paths in the prompt are repo-relative.
- Reviews are written to `temp/codex-reviews/pr-<N>-review-<round>.md` (gitignored), each ending with `VERDICT: APPROVED` or `VERDICT: CHANGES REQUESTED`. Codex also posts findings as PR comments (`gh`).
- **Loop until APPROVED**, addressing every finding (fix or reply). This session: PR #7 took **3 rounds** (rounds 1–2 each found a MAJOR race; round 3 approved). Codex posts the verdict as a PR *comment* (it can't `gh pr review --approve` the owner's own-account PR) — that still counts.
- A PR is mergeable only when **CI green AND Codex APPROVED AND every PR comment addressed**, then **squash-merge** (`gh pr merge <N> --squash`).

---

## ⚠ Environment gotchas (cost real time — read before running anything)

- **Codex (WSL) corrupts `backend/.venv`.** After ANY `mcp__codex__codex` / `codex-reply` run, the next Windows `uv` command may fail with `failed to remove .venv/lib64: Access is denied` (Codex creates a POSIX-layout venv). **Fix:** `cd /d/repos/fountainrank/backend && rm -rf .venv && uv sync`. Hit this once this session.
- **`pwsh` is NOT on PATH.** Use **`powershell.exe -NoProfile -File run.ps1 <cmd>`** (Windows PowerShell 5.1) from the **repo root** (don't `cd backend` first — `run.ps1` lives at the root). `run.ps1 check -Backend` is the authoritative backend gate; `run.ps1 check` is the full mirror.
- **Shell cwd can drift** to `.claude/worktrees/landing-page` (the leftover git worktree — see cleanup below). **Prefix Bash commands with `cd /d/repos/fountainrank`.**
- **DB:** container `fountainrank-db-1` (postgis 17-3.5) on `localhost:5436` (the backend's default `DATABASE_URL`). `./run.ps1 up` starts it; migrations `0001→0003` + 4 seeded rating types are applied. Backend `pytest`/`alembic` need it.
- **Windows file tools:** backslash paths (`D:\repos\fountainrank\…`); Git Bash uses forward slashes (`/d/repos/fountainrank/…`).
- **CI:** PR jobs are `backend`, `workspace-js`, `mobile-doctor`, `pip-audit`, `pnpm-audit`, `trivy-fs`, CodeQL (`Analyze (actions|javascript-typescript|python)` + aggregate `CodeQL`). `image-scan` and `Trivy` (container) **skip** on code PRs — that's expected/green.

---

## Open items / future

- **Landing-page worktree cleanup (optional, recommended):** the merged landing-page git worktree still exists. Remove it (also stops the cwd-drift gotcha): `git worktree remove .claude/worktrees/landing-page` then `git branch -D worktree-landing-page`. Not done this session (repo-state mutation — left for owner/next session).
- **Phase 2 web→API build wiring:** `NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com` at web build time (`web/Dockerfile` build-arg + `deploy.yml`).
- **Mobile SSL** (from prior handoffs): server TLS verified-good; owner was re-testing a client/IPv6-path issue. If it persists, mitigation is to drop the apex `AAAA` (DO DNS record id `1822732006`) to force IPv4. Also a stray duplicate apex `A` (id `1822732005`) pre-dates Terraform.
- **Carried from 0f (non-blocking):** dedicated least-priv DB users (app+logto currently use `doadmin`); apex dup-A/AAAA cleanup; `deploy.yml` tags images by git-SHA even on `v*` tags; add required reviewers to the `production` GitHub Environment; re-add Spaces buckets (Phase 3/4); Dependabot PRs open.
- **Phase 1 deploy:** when the owner wants Phase 1 live, tag a release (`v*.*.*`) — but writes stay closed until Phase 2 sets real auth.

---

## Process notes (how this session worked)

- Finished Phase 1 Tasks 10–11 directly (small: 1 test + docs + a `run.ps1` env var + cross-workspace verify).
- Did a **pre-PR whole-branch review** (code-reviewer subagent) → fixed 2 Important issues (500-path observability, CORS env crash) before opening the PR.
- Opened PR #7 (combined: Phase 1 + the review-process doc port, per owner choice), then ran **Codex Loop B** to APPROVED over 3 rounds, fixing each finding with a test and re-watching CI green between rounds.
- Verified every gate (CI green, `VERDICT: APPROVED`, all comments addressed + threads resolved) before squash-merge. No release tag.
