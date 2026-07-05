# Handoff — #124 repeat-contribution point limit shipped; next pick = #18 dark mode

**Date:** 2026-07-05
**Branch:** `main` @ `df526f2` (clean, pushed). **Not yet deployed** (see below).
**Purpose:** Enough context to start a fresh conversation and continue.

---

## What happened this session

1. **Backlog triage.** Surveyed the then-open issues against actual code. Flagged **malware-spam
   comments** on #181/#182 (random `NONE`-association accounts posting `.apk` "fix" links — already
   reported by the owner; do not touch those links).

2. **#124 — Limit point awards for repeat condition reports — SHIPPED** (PR **#188**, squash-merged
   as **`df526f2`**, issue **#124 closed**).
   - **Spec:** `docs/specs/2026-07-04-repeat-contribution-point-limit-design.md` (Codex-approved, 5 rounds).
   - **Plan:** `docs/plans/2026-07-04-repeat-contribution-point-limit.md` (Codex-approved, 2 rounds).
   - **Key finding from brainstorming:** most of #124 was *already* enforced by the `dedup_key`
     design — `rate`/`observe_attribute`/`add_note` are one-and-done. The **only** unbounded
     farming vector was **condition reporting** (`verify_working` + `report_condition`, keyed per
     UTC calendar day → 5 pts/day/fountain forever, + a 23:59→00:01 boundary double-dip).
   - **What shipped (targeted fix):** a rolling-24h, **coalesced** point gate on condition reports
     (both event types share one per-(user,fountain) window) in `submit_condition`, run under the
     existing `Fountain … FOR UPDATE` lock; single-clock anchored via new `ContributionSpec.created_at`;
     legacy calendar-day rows honored (lookback matches `event_type`+`status`, never `dedup_key`);
     one **additive partial index** (migration `0020_condition_award_window`, index name
     `ix_contribution_events_condition_window`). Two **additive nullable** `FountainDetail` fields:
     `condition_points_eligible_at` (per-viewer pre-submit hint, null for anon) and
     `condition_points_awarded` (server-authoritative 3/2/0, only on the condition POST). Web +
     mobile show a non-blocking amber warning ("…won't earn points again for about N hours" via the
     new shared `conditionPointsEligibleInText()` helper) and drive success feedback off the server
     award, not a client constant. Style guide updated ("Points-ineligible inline warning").
   - **Executed subagent-driven**, 10 tasks / one commit each; task-reviews on the core gate and web.
   - **PR gate:** CI all green (backend, workspace-js, mobile-doctor, pip/pnpm-audit, trivy-fs,
     CodeQL); Codex PR-approved (5 rounds incl. post-merge). All PR comments addressed.

3. **App Store screenshots — SHIPPED** (PR **#185**, merged). Replaced the generated
   `app-store-6-5/` mockups with real iPhone 6.5″ TestFlight captures (PNG, named slots), fixed the
   screenshots README + regeneration recipe. Follow-up noted in that PR: the shots show the
   "TestFlight" status bar and there's no real **6.9″** set yet — re-capture before final Apple
   submission.

---

## ⚠️ Not deployed

`df526f2` (#124) is on `main` but has **not** been deployed. Deploy is a **manual dispatch**:
`gh workflow run deploy.yml --ref main` (deploys current `main` HEAD to DOKS — see
[[fountainrank-deploy-is-manual-dispatch]]). #124 is backend + web + mobile:
- **Backend + web** reach users via that DOKS deploy.
- **Mobile** changes ([id].tsx, ConditionContributionForm) only reach users on the **next EAS/mobile
  build** — not the DOKS deploy.

---

## Open backlog (10 issues) — status as of 2026-07-05 (re-verify before implementing; code moves)

| # | Title | Status | Notes |
|---|---|---|---|
| **#18** | Dark mode (app-wide + dark basemap) | **Not implemented** | **The owner's chosen next pick this session** (picked #124 + #18; #124 done). Only a "dark-mode-ready" seam on the web basemap; mobile `theme.ts` is a single light palette. Needs theming tokens + `prefers-color-scheme`/toggle on web + mobile + a dark Protomaps basemap flavor. Design-first, touches lots of UI. |
| **#167** | Fountain photo uploads + carousel (web + mobile) | **Likely COMPLETE — verify & close** | Backend landed in #176; **web UI #186 and mobile UI #187 both merged to main since**. Issue is still open — almost certainly just needs on-device verification then close (classic open≠unbuilt; [[fountainrank-verify-code-before-implementing-open-issue]]). Check current code before doing anything. |
| **#43** | Map + list filters | **Partial (web-only gap)** | Backend `DiscoveryFilters` + **mobile** chips done. **Missing: web filter-chip UI.** Smallest remaining build — a fast win. |
| **#11** | Report content → moderation queue | **Partial** | Photo-report slice shipped with #176 (`PhotoReport` + admin photo queue). Generic content reporting (reviews/ratings/fountains) not done. |
| **#12** | Admin moderation queue + removal | **Partial** | Fountain hide/delete + note hide + **photo** report queue exist. Generic report-fed queue remains (depends on #11). |
| **#10** | User blocking | **Not implemented** | No `user_blocks` table/endpoint/UI. |
| **#13** | Admin account bans / suspensions | **Not implemented** | `User` has only `is_admin`; no status/ban field, endpoint, or admin UI. |
| **#184** | Track transitive advisories (postcss/uuid) | **Not started** | Tiny — document two known-safe transitive advisories in `.trivyignore`/README. Board-clearing win. |
| **#182** | TypeScript 5.9 → 6.0 (+ @types/node 26) | **Hold** | Major bump Dependabot deliberately holds; high blast radius. The "fix" comment on it was malware. |
| **#181** | Expo SDK 56 → 57 + RN 0.85 → 0.86 | **Hold** | Big coordinated mobile upgrade, on-device testing, CI-gated (`minimumReleaseAge` + expo-doctor duplicate landmines — [[fountainrank-ci-minimum-release-age-gate]], [[fountainrank-hoisted-linker-masks-expo-doctor-duplicates]]). |

**Suggested next pick:** **#18 dark mode** (the owner's other selection) via the usual spec→plan→PR
flow — it's design-first, so start with a brainstorm/spec. Quick alternatives: **verify+close #167**
(likely already done), or **#43 web filter chips** (smallest build). Moderation (#11/#12/#10/#13) is
a coherent but design-first cluster if you want the bigger safety work.

---

## How to work here (process — MUST follow; see `CLAUDE.md` + `claude_help/`)

- **Flow:** spec (`docs/specs/`) → plan (`docs/plans/`) → implement task-by-task → PR. **Both the
  spec/plan AND the PR must pass a Codex review loop to `VERDICT: APPROVED`** — gating, on top of CI.
  Read `claude_help/codex-review-process.md` before finalizing a spec/plan and before merging.
  Codex runs via the Codex MCP in **bypass mode** (`sandbox: danger-full-access`,
  `approval-policy: never`); derive the WSL `cwd` (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`).
- **Branch → PR → CI green + Codex APPROVED + every PR comment addressed → `gh pr merge <N> --squash`.**
  No AI attribution in commits/PRs; no time estimates. Conventional Commits.
- **Backend schema change → regenerate the api-client AND commit** `packages/api-client/openapi.json`
  + `src/schema.d.ts` (both git-tracked). Isolated-env regen commands below.
- **Deploy:** `gh workflow run deploy.yml --ref main` (never from local). Mobile ships via EAS, not DOKS.

## Environment gotchas (this Windows host — save yourself the pain)

- **🔴 Unmergeable PR silently skips CI.** A branch that conflicts with `main` never dispatches
  `ci.yml`/`security-audit.yml` — only CodeQL's dynamic default-setup runs, so `gh pr checks` looks
  deceptively green with just 4 checks. Tell: `gh pr view <N> --json mergeable,mergeStateStatus` →
  `CONFLICTING`/`DIRTY`. This repo runs **many parallel PRs**, so branches conflict fast — **check
  mergeability before waiting on CI.** Fix: `git merge origin/main`, resolve, **regenerate the
  api-client from the merged backend** (don't trust a text-merge of two regenerated outputs), push.
  ([[fountainrank-unmergeable-pr-skips-ci]]) This bit hard this session (PR #188 vs the #186/#187
  photo-UI merge).
- **Backend local checks:** the repo `backend/.venv` is a WSL artifact Windows `uv` can't use
  (`failed to remove .venv/lib64: Access is denied`). Use an isolated env:
  `cd backend && UV_PROJECT_ENVIRONMENT='D:/repos/.uvenv-fountainrank-backend' uv run <cmd>`
  (that env already exists + is synced this session). Docker Postgres `fountainrank-db-1` runs on
  `:5436`; **`uv run alembic upgrade head` first** if tests error with `relation … does not exist`.
  Full backend mirror = `ruff check .` + `ruff format --check .` + `alembic upgrade head` +
  `alembic check` + `pytest`. ([[fountainrank-windows-wsl-local-check-workarounds]])
- **JS local checks are blocked** (`pnpm run` → `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, the
  WSL node_modules purge). **NEVER set `CI=true`** to force it (destructive purge). Verify JS via
  **CI's `workspace-js` job**, not locally. For one-off tools, run them isolated: OpenAPI regen =
  `cd backend && UV_PROJECT_ENVIRONMENT=… uv run python -m app.export_openapi ../packages/api-client/openapi.json`
  then `cd packages/api-client && pnpm dlx openapi-typescript@7.13.0 ./openapi.json -o ./src/schema.d.ts`;
  prettier = `pnpm dlx prettier@3.9.4 --check|--write <files>`. (The windows-wsl memory also lists
  direct-`.pnpm/.../bin` invocations that run tsc/vitest/prettier without the deps check.)
- **`docs/` is outside the prettier gate.** CI's `pnpm run format:check` globs `{web,mobile,packages}/**`
  only — do **not** run `prettier --write` on `docs/*.md` (it reformats unrelated pre-existing content
  and can mangle tables).
- `git branch -d` refuses a **squash-merged** branch — use `-D`.
