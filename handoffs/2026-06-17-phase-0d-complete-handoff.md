# Handoff — FountainRank (Phase 0d complete; resume at Phase 0e)

**Date:** 2026-06-17
**From:** In-repo Claude session (Phase 0d local dev orchestration)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec and you can continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-17-phase-0c-complete-handoff.md` (still accurate for Phase 0a/0b/0c history + the DigitalOcean bootstrap + the still-pending external registrations, which are NOT repeated in full here).

---

## TL;DR

FountainRank: **FastAPI + PostgreSQL/PostGIS** backend, **Next.js** web, **Expo/React Native**
mobile, **self-hosted Logto** auth, **MapLibre + Protomaps** maps, on **DigitalOcean
Kubernetes (DOKS)**. Public OSS repo `redducklabs/fountainrank`.

**Done and pushed on `main`:** Phase 0a (repo foundation + AI tooling), the `docs/setup/`
runbook, the **DigitalOcean account bootstrap**, **0b** (backend walking skeleton), **0c**
(frontend monorepo), and now **0d (local dev orchestration)**. The 0d work is commits
`81cc071`…`e87ff45` (pushed to `origin/main`). Run `git log --oneline -10` to confirm.

**Next:** Phase 0e (infra Terraform skeleton), then 0f (CI/CD + security), then feature
phases 1–5.

---

## Read these first (in order)

1. `CLAUDE.md` — the operating-rules hub (points to all `claude_help/*` spokes).
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — approved whole-system design
   (§15 infra, §16 CI, §20–21 build phases, §22 layout).
3. The dated, executed plans in `docs/plans/` — including
   `…phase-0d-local-dev-orchestration.md`.
4. `handoffs/2026-06-17-phase-0c-complete-handoff.md` — DigitalOcean bootstrap, the master
   external-setup checklist, the pending external registrations (Google/Apple/DNS/GitHub/Logto).
   **Those are unchanged.**
5. The relevant `claude_help/*.md` spoke for whatever you're about to do.

---

## Process rules (how work happens here — non-negotiable, unchanged)

- **Flow:** spec → plan → **Codex Loop A review (loop to `VERDICT: APPROVED`)** → implement → verify.
- **Phase 0 commits go directly to `main`** (no CI gate until 0f). **After Phase 0:** branch → PR
  → CI green + Codex APPROVED + comments addressed → squash-merge.
- **Codex** via the Codex MCP (`mcp__codex__codex` / `…-reply`) in **bypass mode**
  (`sandbox: danger-full-access`, `approval-policy: never`), `cwd` in WSL form
  (`/mnt/d/repos/fountainrank`). Reviews land in `temp/codex-reviews/` (gitignored).
- **Implementation used subagent-driven development** (superpowers): a fresh implementer subagent
  per task, a task review (spec + quality) after each, a final whole-branch review (opus). Working
  artifacts (briefs/reports/diffs/ledger) live in `.git/sdd/` (local, gitignored).
  **NOTE for 0d:** the env-heavy verification (docker compose up, `run.ps1 check`, Logto boot) was
  run by the **controller in the main session**, not the implementer subagents — subagents lack a
  reliable Docker/uv/pnpm/powershell runtime. Keep doing this.
- **Hard rules:** no secrets, no `.env` files, **no AI attribution** in commits/PRs, **no time
  estimates** anywhere. Public repo — never push secrets.

---

## Phase 0d — local dev orchestration (done + verified + pushed)

Plan: `docs/plans/2026-06-17-phase-0d-local-dev-orchestration.md`. Codex Loop A APPROVED (plan
review 3; env.py/mount delta review 4). All 3 task reviews Approved; final opus whole-branch review
= **Ready to merge: Yes**. Commits `81cc071`…`e87ff45`.

**What landed:**
- **`docker/docker-compose.yml`** — project `fountainrank`, profile-gated:
  - default `up` → **`db`** only (`postgis/postgis:17-3.5`, host **5436**→5432, `pg_isready`
    healthcheck, named volume `db-data`).
  - `--profile auth` → adds **`logto`** (`svhd/logto:1.40.1`, `DB_URL=postgres://logto:logto_dev@db:5432/logto`,
    listens on **3022 app / 3023 admin** via `PORT`/`ADMIN_PORT`, entrypoint `sh -c "npm run cli db seed -- --swe && npm start"`,
    `ENDPOINT`/`ADMIN_ENDPOINT` intentionally unset). **Topology only — no connectors/secrets
    (that's Phase 2).**
  - `--profile full` → adds **`backend`** (built from `../backend`, `DATABASE_URL=…@db:5432/…`,
    command `alembic upgrade head && uvicorn …`, published **host 3021 → container 8000**).
- **`docker/initdb/99-create-logto-db.sql`** — creates a **separate `logto` database + role
  (`LOGIN CREATEROLE`)** in the same instance (mirrors prod "separate DB, same cluster"). Mounted as
  a **single file** (a directory mount would shadow the image's own `10_postgis.sh`).
- **`backend/migrations/env.py`** — **fix(backend): online migrations now COMMIT.** (See "bugs" below.)
- **`run.ps1`** (repo **root**) — PowerShell task runner, **PS 5.1 + 7 compatible**. Verbs:
  `up [-Auth] [-Full]`, `down [-Volumes]`, `reset`, `backend`, `web`, `migrate`, `generate`,
  `bootstrap`, `check [-Backend|-Web|-Mobile|-ApiClient] [-Fast]`, `logs`, `psql`, `help`. `check`
  is the **full CI mirror** by default (backend ruff+format+`alembic check`+pytest; frontend
  lint+prettier+typecheck+test; web `next build`; mobile `expo-doctor`); restores the files
  `next build` mutates in a `finally`.
- **Docs:** `claude_help/testing-ci.md` local-checks table finalized; `README.md` getting-started +
  root-level `run.ps1` layout; `backend/README.md` points at compose/`run.ps1`.

**Three real bugs found + fixed during 0d verification (keep these in mind):**
1. **Init mount shadowed PostGIS** — a *directory* mount of `./initdb` over
   `/docker-entrypoint-initdb.d` hid the postgis image's `10_postgis.sh`, so PostGIS never enabled.
   Fixed with a **single-file** mount.
2. **Alembic online migrations never committed** (pre-existing from 0c, masked because the image
   enables PostGIS regardless). Cause: an in-band `SET search_path` auto-began a SQLAlchemy-2.0 txn,
   making Alembic's `begin_transaction()` a no-op → `engine.connect()` rolled back. Fixed by setting
   `search_path` via asyncpg `server_settings` and letting Alembic own/commit. **This unblocks all
   Phase 1 migrations** — without it `alembic upgrade head` silently did nothing.
3. **Logto seed needed CREATEROLE** — the `logto` role lacked it; seed failed `42501`. Fixed.

**Verified (controller, main session — all green):** db profile (postgis 3.5.2 + topology; logto
db/role); env.py fix (`alembic upgrade head` persists; `alembic check` clean; pytest 5/5);
auth profile (Logto seeds; 3022/3023 reachable); full backend (`/healthz`+`/readyz` ok, via an
ephemeral port — see gotcha); full `run.ps1 check` EXIT=0 incl. expo-doctor 21/21; subset checks;
PS 5.1 dual-runtime; failed-build `finally`-restore negative test; `down` full teardown.

---

## Decisions made in 0d (owner-approved — keep these)

- **Compose topology = profiles** (default db / `-Auth` +logto / `-Full` +backend). Apps run on the
  **host** for daily dev (`run.ps1 backend` = `uv run uvicorn --reload`; `run.ps1 web` = `pnpm dev`).
- **`run.ps1 check` = full CI mirror by default**, with `-Backend`/`-Web`/`-Mobile`/`-ApiClient`
  subsets and `-Fast` (skips `next build` + `expo-doctor`).
- **Web is NOT containerized in 0d** — no web image yet, and the Windows-built pnpm `node_modules`
  (native `sharp`/`unrs-resolver`) can't bind-mount into a Linux container. `-Full` = db+logto+backend;
  web on host. The real web image + web compose service land in **0f**.
- **`run.ps1` lives at the repo root** (matches the README; `scripts/` keeps `launch-codex.sh`).
- **The alembic-commit fix (env.py) was folded into 0d** (owner-approved) because the `check` verb's
  `alembic check` depends on it and it would break Phase 1.

---

## Next steps — remaining Phase 0 plans

Write each with `superpowers:writing-plans`, run **Codex Loop A** to `APPROVED`, then execute
(subagent-driven, controller runs env-heavy verification). Commit direct to `main`; push at milestones.

- **0e — Infra Terraform skeleton:** `infra/terraform/` (DOKS, Managed Postgres+PostGIS + a separate
  **Logto DB**, Spaces photos/pmtiles, LB + LE SAN cert, DNS, registry) + `infra/k8s/` (backend, web,
  **Logto**, ingress-nginx, envsubst secrets). S3 backend = `fountainrank-terraform-state` (sfo3);
  assign every resource to the **FountainRank** DO project. **Also required before the backend image
  ships:** Dockerfile **non-root `USER`** + a **`HEALTHCHECK`** hitting `/healthz` (deferred out of
  0b). `validate`/`plan` only locally — never apply.
- **0f — CI/CD + security:** `.github/workflows/` with the runner split (Class A on
  `redducklabs-runners`, secret jobs on `ubuntu-latest`), image build/push, DOKS deploy; CodeQL,
  Dependabot, Trivy + `.trivyignore`, `pip-audit` + `pnpm audit`, CODEOWNERS, issue templates, README
  badges. **The web/mobile typecheck/test/build jobs run `pnpm run generate` first, which needs
  Python + uv in the job** (live-codegen coupling, owner-accepted). The web Dockerfile + a web compose
  service also land here. When CI lands, re-confirm `testing-ci.md`'s "= CI" parity claim against the
  real workflow files.

Then the **feature phases** (each gets its own spec + plan): 1) data model + fountains API; 2) auth
(Logto) + magic-link email; 3) maps UI + add/rate-on-add (after a UI brainstorm — create
`docs/style-guide.md`); 4) photos; 5) leaderboards.

---

## Gotchas / environment notes (0d additions; see the 0b/0c handoffs for the rest)

- **FountainRank uses a `302x` host-port block** (this box runs other projects on the default ports —
  e.g. TherapyLink held host 8000). Owner-requested 2026-06-17, applied across the stack:
  **web 3020, backend 3021, Logto 3022 (app) / 3023 (admin), db 5436 (unchanged).** Backend keeps its
  container/Dockerfile-internal `8000` (matches prod) and is only host-published as `3021:8000`; the
  host-run backend (`run.ps1 backend`) listens on `3021` directly; Logto actually listens on 3022/3023
  via `PORT`/`ADMIN_PORT` (it builds self-referential URLs from its port). The web app's default backend
  URL (`web/lib/api.ts`, `mobile/App.tsx`) is `http://localhost:3021`. This resolved the earlier 8000
  collision with TherapyLink.
- **`docker compose down -v` can wedge the network.** Mid-session, a `down -v` followed by `up` hit
  `network … not found` because a profiled container (logto) survived a plain `down` and held the
  network. **`run.ps1 down`/`reset` now pass `--profile auth --profile full`** so they fully tear down.
  If you still hit it: `docker ps -aq --filter name=fountainrank | xargs -r docker rm -f` then
  `docker network prune -f`, then `run.ps1 up`.
- **`pwsh` (PowerShell 7) is NOT installed on this box** — only Windows PowerShell **5.1.26100.8655**.
  `run.ps1` is written 5.1-compatible and verified under 5.1; PS7 is the binding floor's upper bound,
  unverified locally. Invoke from Git Bash as `powershell.exe -NoProfile -File ./run.ps1 …`.
- **pnpm** is the global `npm i -g pnpm@11.7.0` install (Corepack EPERM on this box — see 0c handoff);
  works fine. **uv** on PATH.
- **api-client generated files** (`packages/api-client/openapi.json`, `…/src/schema.d.ts`) and
  `mobile/expo-env.d.ts` are gitignored; `run.ps1 generate` / `check` regenerate them. `generate` is
  **DB-free**. `web/next-env.d.ts` IS committed; `next build` re-mutates it + `web/tsconfig.json` —
  `run.ps1 check` restores both (don't commit those mutations).
- **Local toolchain drift (unchanged):** dev box has **uv 0.11.3 / Python 3.13.4**; project pins **uv
  0.11.21 / Python 3.13.14**. `uv.lock` + CI/Docker unaffected.
- **Pre-existing nit (deferred):** `.gitignore` has a duplicate `.env` line from Phase 0a — harmless.
- **Untracked `docs/logos/`** is still in the working tree (not produced by 0a–0d work) — left
  untracked/unpushed. Decide what it is before staging it.
- **At the end of this session the stack was left running** (`db` + `logto` via `run.ps1 up`; db
  migrated to head). `docker compose -f docker/docker-compose.yml ps` to check; `run.ps1 down` to stop.
