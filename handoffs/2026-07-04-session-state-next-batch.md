# Handoff — Session state + next-batch pickup

**Date:** 2026-07-04
**Branch:** `main` @ `8bd7988` (clean, pushed). Production is up to date (deployed this session).
**Purpose:** Enough context to start a fresh conversation and pick the next batch of issues.

---

## What happened this session

1. **Backlog triage.** Researched all then-open issues against the actual code (open ≠ built).
   Closed **25 already-implemented-but-open** issues after verification: rankings #146/#147/#149,
   add-fountain #98/#99/#102, mobile bugs #103/#104/#105/#120, SEO #125/#126/#127/#128/#135,
   ratings/attributes #38/#39/#40/#41/#42/#44/#65, misc #19/#131/#95.

2. **Batch 1 shipped + deployed** (PR #172, squash-merged as `a517027`, deployed via
   `workflow_dispatch` run 28702774155, verified in prod). Closed #169, #170, #168. Details in
   `handoffs/2026-07-04-fountain-browsing-shipped-deployed.md`. Spec/plan:
   `docs/specs/2026-07-04-fountain-browsing-design.md`, `docs/plans/2026-07-04-fountain-browsing.md`.
   - **Follow-up already noted:** the **mobile Share button** (#168) only reaches users when the
     **next mobile build / EAS release** is cut — it is NOT in the web/backend DOKS deploy.

---

## Open backlog (8 issues) — verified status

Status below is from this session's code research; **re-verify before implementing** (code moves).

| # | Title | Status | Notes |
|---|---|---|---|
| **#167** | Fountain photo uploads + image carousel (detail, web+mobile) | **Not implemented** | Heaviest. Needs object storage (DO Spaces/S3), an upload endpoint, validation, **moderation** (public repo — user-uploaded images), and a carousel on web (overlaid arrows) + mobile (swipe). Storage/permissions/security must be designed **before** coding. Good candidate for its own spec. |
| **#43** | Map + list filters for ratings/status/attributes | **Partial** | Backend `DiscoveryFilters` (`backend/app/filters.py`) + **mobile** chips (`mobile/components/map/MapFilters.tsx`: Working now / Bottle filler / Wheelchair + rating) are **done**. **Missing: the web filter-chip UI** — no `workingNow`/`bottleFiller` chips in `web/components/`. Small-medium, web-only. |
| **#18** | Dark mode (app-wide + dark basemap) | **Not implemented** | Only a "dark-mode-ready" comment on the web basemap (`web/lib/map/style.ts`); mobile `theme.ts` is a single light palette. Needs theming tokens + toggle/`prefers-color-scheme` on both platforms + a dark basemap style. Design-first; touches lots of UI. |
| **#11** | Report content into a moderation queue | **Not implemented** | Moderation cluster. No content-report model/endpoint/UI. Feeds #12. |
| **#12** | Admin moderation queue + content removal | **Partial** | **Removal exists**: admin hide/delete fountains + hide/unhide notes w/ audit + point reversal (`backend/app/routers/admin.py`, `web/app/admin/page.tsx`). **Missing: the report-fed queue** to triage (depends on #11). |
| **#10** | User blocking (hide another user's content) | **Not implemented** | Moderation cluster. No block model/endpoint/UI. |
| **#13** | Admin account bans / suspensions | **Not implemented** | Moderation cluster. `User` has only `is_admin`; no ban/suspend field, endpoint, or admin UI. |
| **#124** | Limit point awards for repeat updates within 24h | **Implemented w/ caveat — DECISION NEEDED** | Condition/verify contributions dedup once per **UTC calendar day** (`dedup_key` embeds `%Y%m%d` in `backend/app/routers/fountains.py` / `contributions.py`), **not** a rolling 24h window as the title says. Decide: accept calendar-day (then just close it) or implement rolling-24h. No code needed if you accept the current behavior. |

### Natural groupings for batching
- **Moderation & safety (#11 → #12 → #10 → #13):** coherent but **design-first** (report model,
  admin queue UI, block model, ban enforcement + auth gating). #11 unlocks #12. Recommend a spec.
- **Quick web-only win (#43 web chips):** smallest remaining; backend + mobile already done, so it's
  "add the chips + wire to existing `DiscoveryFilters`."
- **#124:** likely a 2-minute decision, not a build.
- **#167 (photos)** and **#18 (dark mode):** each large and design-first — own spec, own batch.

**Suggested next pick:** either **#43 (web filter chips)** for a fast win, or open a **moderation
spec (#11/#12)** if you want to tackle the bigger safety cluster. #167 and #18 are the biggest lifts.

---

## How to work here (process — MUST follow; see `CLAUDE.md` + `claude_help/`)

- **Flow:** spec (`docs/specs/`) → plan (`docs/plans/`) → implement task-by-task → PR. **Both the
  spec/plan AND the PR must pass a Codex review loop to `VERDICT: APPROVED`** — gating, on top of CI.
  Read `claude_help/codex-review-process.md` before finalizing a spec/plan and before merging.
- **Branch → PR → CI green + Codex APPROVED + every PR comment addressed → `gh pr merge --squash`.**
  No AI attribution in commits/PRs; no time estimates.
- **Deploy:** gated `workflow_dispatch` on `deploy.yml` (or a `v*.*.*` tag) — the routine path is
  `gh workflow run deploy.yml`, which deploys current `main` HEAD to DOKS. Never deploy from local.
- **Backend endpoint change → regenerate the api-client** (`pnpm run generate`) and **commit** the
  regenerated `packages/api-client/{openapi.json,src/schema.d.ts}` (they are git-tracked; see gotcha).

## Environment gotchas discovered this session (save yourself the pain)

- **`run.ps1` (PowerShell 5.1) aborts on tool stderr.** `docker`/`turbo`/`pnpm` write banners to
  stderr, which PowerShell wraps as `NativeCommandError` and exit 1 — so `./run.ps1 check` dies
  before running anything. **Workaround:** run the underlying commands via the **Bash tool**
  (`pnpm exec turbo run lint typecheck test --filter=web`, etc.), which doesn't wrap stderr.
- **Backend runs under `uv`** (`cd backend && uv run pytest` / `ruff` / `alembic`). The db is a
  container on **port 5436** (`./run.ps1 up`); a fresh container needs `uv run alembic upgrade head`.
- **CI mirror pieces (run individually via Bash):** backend = ruff + `ruff format --check` +
  `alembic upgrade head` + `alembic check` + pytest; web/mobile/api-client =
  `pnpm exec turbo run lint typecheck test --filter=<pkg>`; web build = `turbo run build --filter=web`
  (it dirties `web/next-env.d.ts` + `web/tsconfig.json` — `git checkout --` them after); whole-repo
  format = `pnpm run format:check`.
- **`next build` route sanity:** the account subpages sort before `/admin` in the build route list.
- **api-client `.gitignore` inconsistency:** `packages/api-client/{openapi.json,src/schema.d.ts}` are
  **git-tracked yet also `.gitignore`d** (lines ~66–67). The ignore is dead for tracked files, so
  every endpoint PR commits the regenerated artifacts (SEO/leaderboard precedent). **Follow that —
  commit them.** Cleanup decision deferred: `git rm --cached` + rely on CI regen, OR delete the stale
  `.gitignore` lines. (Codex flagged the ambiguity; convention = commit.)
- **`mobile-doctor`/expo-doctor** may locally report **patch**-version drift (e.g. `expo` 56.0.13 vs
  expected `~56.0.14`) — that's server-side "expected" drift, **not** caused by your change unless you
  touched `mobile/package.json`. It **passed in CI** this session; don't bump Expo deps to chase it
  (out of scope; tracked loosely as #163, which is otherwise parked).
- **`node_modules` can get corrupted** if a `pnpm install` is interrupted (a Codex review shell did
  this). Symptom: `turbo`/`tsc` "not found" or "Cannot find module typescript", while
  `pnpm install --frozen-lockfile` says "Already up to date." **Fix:** `rm -rf node_modules
  {web,mobile,packages/api-client}/node_modules && pnpm install --frozen-lockfile` (store is cached,
  ~15s).

## Codex invocation (WSL) — quick reference

- MCP `mcp__codex__codex` / `codex-reply`. **`cwd` = `/mnt/c/Repos/fountainrank`** (derive from the
  Windows repo root: drive→`/mnt/c`, backslashes→slashes). **Bypass mode:**
  `sandbox: "danger-full-access"`, `approval-policy: "never"` (sandboxed = read-only FS, breaks
  `git fetch` and `gh`). **All paths in the prompt repo-relative.** Reviews are written to
  `temp/codex-reviews/<slug>-{spec|plan}-review-<N>.md` (gitignored) and, for PRs, posted as PR
  comments. Loop until `VERDICT: APPROVED`; address every finding + every PR comment.

## Repo facts

- `redducklabs/fountainrank` (public). Web (Next.js 16) + mobile (Expo/RN) + FastAPI/PostGIS +
  self-hosted Logto, on DigitalOcean Kubernetes.
- Key trees: `web/`, `mobile/`, `backend/`, `packages/api-client/`. Task runner `run.ps1`.
  Style guide `docs/style-guide.md` (update before adding any UI element).
- Auth: Logto JWT via JWKS; `/me/*` endpoints are caller-scoped. Public browsing; writes need auth.
