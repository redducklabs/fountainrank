# Handoff — FountainRank (Phase 0c complete; resume at Phase 0d)

**Date:** 2026-06-17
**From:** In-repo Claude session (Phase 0c frontend monorepo)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec and you can continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-17-phase-0b-complete-handoff.md` (still accurate for Phase 0a/0b history + the DigitalOcean bootstrap + the gotchas/external-setup sections, which are NOT repeated in full here).

---

## TL;DR

FountainRank is a modern rebuild of an old C#/Xamarin fountain-rating app into:
**FastAPI + PostgreSQL/PostGIS** backend, **Next.js** web, **Expo/React Native**
mobile, **self-hosted Logto** auth, **MapLibre + Protomaps** maps, on
**DigitalOcean Kubernetes (DOKS)**. Public OSS repo `redducklabs/fountainrank`.

**Done and on `main` (HEAD `f03eb43`):** Phase 0a (repo foundation + AI tooling),
the `docs/setup/` runbook, the **DigitalOcean account bootstrap**, **Phase 0b
(backend walking skeleton)**, and now **Phase 0c (frontend monorepo)** — all
committed and pushed.

**Next:** Phase 0d (local dev orchestration: `docker-compose.yml` + `run.ps1`),
then 0e (infra Terraform), 0f (CI/CD + security), then feature phases 1–5.

---

## Read these first (in order)

1. `CLAUDE.md` — the operating-rules hub (points to all `claude_help/*` spokes).
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — the approved
   whole-system design (§14 frontend, §15 infra, §16 CI, §20–21 build phases, §22 layout).
3. The dated, executed plans in `docs/plans/`:
   `…phase-0a-repo-foundation-and-ai-tooling.md`,
   `…phase-0b-backend-walking-skeleton.md`,
   `…phase-0c-frontend-monorepo.md`.
4. `handoffs/2026-06-17-phase-0b-complete-handoff.md` — for the DigitalOcean
   bootstrap details, the master external-setup checklist, and the still-pending
   external registrations (Google/Apple/DNS/GitHub/Logto). **Those are unchanged.**
5. The relevant `claude_help/*.md` spoke for whatever you're about to do.

---

## Process rules (how work happens here — non-negotiable)

- **Flow:** spec → plan → **Codex Loop A review (loop to `VERDICT: APPROVED`)** →
  implement → verify. See `claude_help/development-process.md`,
  `claude_help/codex-review-process.md`, `claude_help/testing-ci.md`.
- **Phase 0 commits go directly to `main`** (no CI gate until 0f). **After
  Phase 0:** branch → PR → CI green + Codex APPROVED + comments addressed →
  squash-merge.
- **Codex** runs via the Codex MCP (`mcp__codex__codex` / `…-reply`) in **bypass
  mode** (`sandbox: danger-full-access`, `approval-policy: never`), `cwd` in WSL
  form (`/mnt/d/repos/fountainrank`). Reviews land in `temp/codex-reviews/`
  (gitignored).
- **Implementation used subagent-driven development** (superpowers): a fresh
  implementer subagent per task (TDD), a task review (spec + quality) after each,
  and a final whole-branch review. Models: implementers/reviewers on **sonnet**,
  final review on **opus**. Working artifacts (briefs/reports/diffs/ledger) live
  in `.git/sdd/` (local, gitignored).
- **Hard rules:** no secrets, no `.env` files, **no AI attribution** in
  commits/PRs, **no time estimates** anywhere. Public repo — never push secrets.

---

## Phase 0c — frontend monorepo (done + verified)

Plan: `docs/plans/2026-06-17-phase-0c-frontend-monorepo.md`. Codex Loop A APPROVED
(review 2); all 6 task reviews Approved; final opus whole-branch review = **Ready
to merge: Yes**. Commits `2e557da`…`f03eb43`.

**What landed:**
- **Backend touch-up** (`backend/`): typed Pydantic response models `HealthResponse`
  / `ReadyzResponse` on `/healthz` + `/readyz` (clean OpenAPI components); new
  `app/export_openapi.py` (`python -m app.export_openapi [outfile]`, **DB-free**)
  that the frontend codegen calls. `backend/tests/test_openapi.py` added.
- **Monorepo root:** `package.json` (private; `packageManager` `pnpm@11.7.0`;
  `engines.node >=22 <23`; root scripts delegate to turbo; `format`/`format:check`
  scoped to `{web,mobile,packages}`), `pnpm-workspace.yaml` (`web`, `mobile`,
  `packages/*`), `turbo.json` (`generate` `cache:false`; `typecheck`/`test`/`build`
  `dependsOn:["generate","^generate"]`; `lint` no deps), `.nvmrc` (22.22.3),
  `.prettierrc.json` + `.prettierignore`, committed `pnpm-lock.yaml`.
- **`packages/api-client`** (`@fountainrank/api-client`): types generated **live
  from the backend** (`openapi-typescript`) + a tiny `openapi-fetch` `makeClient`
  wrapper. `type:module`; `exports`/`types` → raw `src/index.ts` (no build step).
- **`web/`** (Next.js 16 App Router + React 19.2.7 + Tailwind v4): a page that
  calls `/healthz` via the api-client (`BackendStatus`); `lib/api.ts`
  (`resolveApiBaseUrl`/`getApiClient`); ESLint flat (`eslint-config-next`); vitest
  unit test of `resolveApiBaseUrl`.
- **`mobile/`** (Expo SDK 56 / RN 0.85.3 / React 19.2.3): an `App` screen calling
  `/healthz` via the api-client; verified by `tsc --noEmit` + ESLint + `expo-doctor`
  (21/21). No bundling/unit tests in 0c (per the testing-ci policy).
- **Tooling:** ESLint + Prettier **pre-commit hooks** (local block in
  `.pre-commit-config.yaml`, frontend-scoped); README "Software Versions" filled.

**Pinned versions (verified 2026-06-17 — in README + the workspace `package.json`s):**
Node **22.22.3**, pnpm **11.7.0**, Turborepo **2.9.18**, TypeScript **6.0.3**
(api-client pins **5.9.3** locally — see below), Next.js **16.2.9**, React **19.2.7**
(web) / **19.2.3** (mobile), Expo SDK **56** (`expo 56.0.12`) / RN **0.85.3**,
Tailwind **4.3.1**, ESLint **9.39.4** (held off 10), `openapi-typescript` **7.13.0**,
`openapi-fetch` **0.17.0**, vitest **4.1.9**, vite **8.0.16**.

**Verified (Task 6 full run, all green):** `pnpm install`; `pnpm run generate`;
`pnpm run lint/typecheck/test/build` (web 2 + api-client 1 tests; web builds);
`mobile` `expo-doctor` 21/21; backend `ruff` clean + 5 pytest; `pre-commit
run --all-files` clean. Web typecheck also proven on a clean state
(`rm -rf web/.next` → `tsc --noEmit` exit 0).

---

## Decisions made in 0c (owner-approved or tool-forced — keep these)

- **api-client codegen = `openapi-typescript` + `openapi-fetch`** (owner choice).
- **Schema is generated LIVE from the backend** at codegen time (owner choice):
  `generate:schema` runs `cd ../../backend && uv run python -m app.export_openapi
  ../packages/api-client/openapi.json`. So **frontend `generate` depends on `uv` +
  the backend being importable** (sync with `cd backend && uv sync`). Generation is
  **DB-free** (no PostGIS container needed for `generate`).
- **TypeScript split:** `openapi-typescript@7.13.0` peers `typescript ^5` and uses
  the TS compiler API at runtime (unverified under TS 6). So `packages/api-client`
  pins **package-local `typescript@5.9.3`** while `web`/`mobile`/root use **6.0.3**.
  pnpm isolation keeps these separate (lockfile shows
  `openapi-typescript@7.13.0(typescript@5.9.3)`). **Don't "upgrade" api-client to TS 6.**
- **React isolation:** web and mobile each pin their own React; **never add `react`
  to the root `package.json`** or hoist a single React. `expo-doctor` enforces
  mobile's SDK-56 React/RN versions.
- **`pnpm-workspace.yaml` `allowBuilds:` map** is the **correct pnpm 11 key**
  (it replaced `onlyBuiltDependencies`). Currently lists `sharp`, `unrs-resolver`
  (Next's native deps). If a new dependency's build script is "ignored" on install,
  add it here as `<pkg>: true` — this is the right mechanism, not a hack.
- **`mobile/app.json` omits `newArchEnabled`** — `@expo/config-types@56.0.6`'s
  schema rejects it and new-arch is the SDK 56 default (the 0c plan's snippet still
  shows it; the implementation is the source of truth).
- **No real UI yet.** The web page / mobile screen are connectivity probes, not
  designed UI. The design system + `docs/style-guide.md` + MapLibre come in **Phase 3**.

---

## Next steps — remaining Phase 0 plans

Write each with `superpowers:writing-plans`, run **Codex Loop A** to `APPROVED`,
then execute (subagent-driven, TDD). Commit direct to `main`; push at milestones.

- **0d — Local dev orchestration:** `docker-compose.yml` (postgres+postgis on host
  port **5436**, logto, backend, web) + `run.ps1` task runner. This replaces the
  manual `fr-postgis` container used in 0b/0c. Finalize the per-subsystem local
  checks in `claude_help/testing-ci.md`. Consider wiring the api-client `generate`
  into the dev flow.
- **0e — Infra Terraform skeleton:** `infra/terraform/` (DOKS, Managed
  Postgres+PostGIS + a separate **Logto DB**, Spaces photos/pmtiles, LB + LE SAN
  cert, DNS, registry) + `infra/k8s/` (backend, web, **Logto**, ingress-nginx,
  envsubst secrets). S3 backend = `fountainrank-terraform-state` (sfo3); assign
  every resource to the **FountainRank** DO project. **Also required before the
  backend image ships:** Dockerfile **non-root `USER`** + a **`HEALTHCHECK`**
  hitting `/healthz` (deferred out of 0b). `validate`/`plan` only locally — never apply.
- **0f — CI/CD + security:** `.github/workflows/` with the runner split (Class A on
  `redducklabs-runners`, secret jobs on `ubuntu-latest`), image build/push, DOKS
  deploy; CodeQL, Dependabot, Trivy + `.trivyignore`, `pip-audit` + `pnpm audit`,
  CODEOWNERS, issue templates, README badges. **Note for CI:** the web/mobile
  typecheck/test/build jobs run `pnpm run generate` first, which **needs Python +
  uv** in the job (the owner accepted this live-codegen coupling). Enable repo
  security features in GitHub Settings and confirm `redducklabs-runners` access.

Then the **feature phases** (each gets its own spec + plan): 1) data model +
fountains API; 2) auth (Logto) + magic-link email; 3) maps UI + add/rate-on-add
(after a UI brainstorm — create `docs/style-guide.md`); 4) photos; 5) leaderboards.

---

## Gotchas / environment notes (0c additions; see the 0b handoff for the rest)

- **pnpm install on this box:** Corepack could not activate `pnpm@11.7.0` (Windows
  `EPERM` on `C:\Program Files\nodejs\`). A global `npm i -g pnpm@11.7.0` was used
  instead and works fine; the `packageManager` field still pins it. Run `pnpm`
  normally.
- **`web` `next build` mutates tracked files:** it rewrites `web/next-env.d.ts`
  (adds `import "./.next/types/routes.d.ts"`, a **gitignored** path) and flips
  `web/tsconfig.json` `jsx` to `react-jsx`. The committed forms are the **canonical**
  ones (clean-checkout-safe). **After running `next build` locally, do NOT commit
  those two mutations** — `git checkout -- web/next-env.d.ts web/tsconfig.json`.
- **api-client generated files** (`packages/api-client/openapi.json`,
  `packages/api-client/src/schema.d.ts`) and `mobile/expo-env.d.ts` are gitignored —
  they're regenerated by `pnpm run generate` / Expo. `web/next-env.d.ts` IS committed.
- **Local backend DB (until 0d compose):** `/readyz` + backend pytest need PostGIS:
  `docker run -d --name fr-postgis -e POSTGRES_USER=fountainrank -e POSTGRES_PASSWORD=fountainrank_dev -e POSTGRES_DB=fountainrank -p 5436:5432 postgis/postgis:17-3.5`
  then `cd backend && uv run alembic upgrade head`. (A `fr-postgis` container was
  left **running** at the end of this session — `docker ps`.) The frontend
  `generate` does NOT need it.
- **pre-commit** is configured but **not installed as a git hook**; run
  `pre-commit run --all-files` manually (it now also runs the frontend
  prettier/eslint hooks, which need `pnpm` on PATH).
- **Local toolchain drift (unchanged from 0b):** dev box has **uv 0.11.3 /
  Python 3.13.4**; project pins **uv 0.11.21 / Python 3.13.14**. `uv.lock` +
  CI/Docker are unaffected.
- **Pre-existing nit (deferred):** `.gitignore` has a duplicate `.env` line
  (line 40 and a stray line ~63) from Phase 0a — harmless, clean up when convenient.
- **Untracked `docs/logos/`** appeared in the working tree during 0c (not produced
  by this work) — left untracked/unpushed. Decide what it is before staging it.
