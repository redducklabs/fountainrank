# Display-name "kill Anonymous" MERGED (not deployed) + GA4 (web) is next — handoff (2026-06-30)

**Source:** the session that built #129 (kill "Anonymous": first-sign-in name capture + display-name
override). That PR was **merged by the owner**; this handoff captures the post-merge state and the
**next task: GA4 analytics on the web app (design already owner-approved below).**

---

## 🔴 NEXT SESSION — two things, in order

### 1. Deploy #129 (it is MERGED but NOT deployed)

`#129` squash-merged to `main` as **`1a3d8bd`** but **no deploy has run since** (last deploy was the
prior leaderboard release `28423597338` on `cf4877d`). Deploying is manual dispatch
([[fountainrank-deploy-is-manual-dispatch]]):

- **Web + backend:** `gh workflow run deploy.yml --ref main` — this runs the **`0012_users_nickname`
  Alembic migration** (adds the nullable `users.nickname` column) and ships the gate + `/me`/`PATCH
  /me` changes. Monitor to success.
- **Mobile:** `gh workflow run mobile-store-release.yml --ref main -f platform=all` — ships the
  account-tab name gate + root gate + 409 routing. (Owner then device-verifies via the #129
  checklist.)
- **After deploy:** the live **"Anonymous"** leaderboard row (subject `4zsznfwtd8cx`) is fixed the
  moment the owner re-signs-in on mobile and sets a name (no hand DB mutation). Verify the
  leaderboard no longer shows "Anonymous".

### 2. GA4 analytics on the **web** app — owner-approved design (write spec → plan → Codex → PR → deploy)

Owner wants Google Analytics 4 on the web app (mobile GA is a later, separate effort). **Design is
approved** (owner said "looks good" 2026-06-30); the two product decisions were made via
AskUserQuestion: **separate branch/PR** (not bundled) and **a consent banner** (not load-for-all).

**GA4 stream (provided by owner):**
- Stream Name: **FountainRank Web** · URL: **https://fountainrank.com**
- Stream ID: **15178325095** · **Measurement ID: `G-BG3PYM6T43`**
- The measurement ID is **public** (GA4 IDs are exposed in client HTML by design) — **not a secret**;
  no `.env` writes needed.

**Approved design (capture verbatim into the spec):**
- **A. Library + ID.** Add `@next/third-parties` (Next 16's official GA integration) and render its
  `GoogleAnalytics` component from the web root layout (`web/app/layout.tsx`, currently minimal).
  Bake `G-BG3PYM6T43` as a default constant with an optional `NEXT_PUBLIC_GA_MEASUREMENT_ID`
  override — **mirror the existing `resolveApiBaseUrl` default+override pattern** in
  `web/lib/api.ts` (read `process.env.NEXT_PUBLIC_*` via a LITERAL static member access so Next
  inlines it; the file's comment explains why bracket access breaks). **Production-only:** gate on
  `NODE_ENV === "production"` so local `next dev` never loads GA / pollutes analytics.
- **B. Consent banner — load-only-after-accept (owner's choice).** A **client** `ConsentBanner`
  shows a bottom bar (Accept / Decline + a link to `/privacy`) and persists the choice in
  `localStorage` (key e.g. `fr-analytics-consent` = `granted`|`denied`). **GA is NOT loaded at all
  until consent is `granted`** (simpler + more privacy-respecting than Consent-Mode "denied pings";
  no GA cookies before consent). Decline → nothing loads. **SSR-safe:** render nothing until the
  component mounts and reads `localStorage` (avoid hydration mismatch). Put the logic in a small
  **pure resolver** — `parseConsent(storageValue) → "granted"|"denied"|"undecided"` and
  `shouldLoadGa(consent, env)` — so it is **unit-testable** (the codebase's web JSX render tests are
  CI-only per [[fountainrank-windows-wsl-local-check-workarounds]]; the banner/script render is
  CI/owner-verified).
- **C. Privacy page.** Add a short "Analytics" section to `web/app/privacy/page.tsx`: what GA4
  collects, that it is consent-gated, and how to change the choice.
- **D. Style guide.** Document the **consent banner** as a new UI element in `docs/style-guide.md`
  (states: shown / accepted / declined; bottom placement; a11y — focusable buttons, dismissible),
  per the mandatory style-guide-before-new-UI rule.
- **E. Verify-against-docs.** Before finalizing the spec, **use Context7** to confirm the exact
  `@next/third-parties` `GoogleAnalytics` API for Next 16 (component name, `gaId` prop) — per the
  CLAUDE.md "use Context7 for docs" rule.
- **F. Testing.** Pure consent-state + should-load helpers unit-tested locally (`node
  node_modules/vitest/vitest.mjs run <file>` from `web/`); the banner render + GA script injection
  are CI/owner-verified. No backend changes.
- **G. Delivery.** Fresh branch off `main` (after #129 is reset in — already done; main = `1a3d8bd`)
  → spec (`docs/specs/2026-07-??-ga4-web-analytics-design.md`) → Codex spec/plan review loop → plan
  → implement → PR → CI green + Codex `VERDICT: APPROVED` + comments addressed → squash-merge →
  `gh workflow run deploy.yml --ref main`.

**Open follow-ups to confirm with owner during GA4 spec review (not blockers):** banner copy/exact
wording; whether "Decline" should be re-promptable later (e.g. a footer "cookie settings" link) or
sticky; whether to also send GA4 events for key actions (sign-in, add-fountain, rate) or page_view
only (default: page_view only for v1, YAGNI).

---

## 🟢 What #129 shipped (so you don't re-investigate)

Merged squash commit **`1a3d8bd`** — "kill Anonymous: first-sign-in name capture + display-name
override". Spec `docs/specs/2026-06-30-display-name-anonymous-design.md`, plan
`docs/plans/2026-06-30-display-name-anonymous.md` (both in `main`). The **spec/plan passed a full
4-round Codex review (APPROVED)**; see `temp/codex-reviews/2026-06-30-display-name-anonymous-plan-review-{1..4}.md` (gitignored).

- **Backend:** nullable `users.nickname` override column (migration `0012`, runs on deploy);
  `resolved_display_name` + nickname-aware `public_display_name` (`backend/app/display.py`) feed
  leaderboard (×2) + notes + admin notes; `GET /me` returns the **resolved** name + **`needs_name`**
  and **never leaks the raw subject** (`display_name=""` when anonymous; synthetic
  `{sub}@users.noreply.fountainrank.com` email blanked on the wire — `me_response` in
  `backend/app/routers/users.py`); **`PATCH /api/v1/me`** sets the name (trim, 1–80, ≠ subject, not
  unique); **`require_named_user`** (`backend/app/auth.py`) gates the **5 contribution-write
  endpoints** with **`409 display_name_required`**, documented via `DisplayNameRequiredConflict`
  (add-fountain's 409 is a `DuplicateFountainConflict | DisplayNameRequiredConflict` union).
- **Web:** `setDisplayName` action; contribution actions map `409 → needs_name`; `/account` field +
  hard first-sign-in gate; `getViewer`/`AuthControl` never expose the subject + a **route-safe
  sign-in-callback** redirect to the name gate (`getViewerForRoute`).
- **Mobile:** account-tab field + capture gate; **root `NameGate`** in `app/(tabs)/_layout.tsx`
  (catches sign-in started from the map); add + detail write `409 → needs_name` routing to the
  account tab. (The #103 `/me/sync` + scopes slice was already shipped earlier in `7ebb3ed`.)
- **Tests (all green locally before merge):** backend full CI mirror — ruff + format + `alembic
  upgrade head` + `alembic check` (no drift) + **381 pytest** (incl. no-subject-leak on the real
  Logto no-name/no-email path, the gate, and the OpenAPI union-409 contract). api-client regen
  produces no diff. Web/mobile `tsc` + prettier + pure-logic/action vitest pass; JSX render +
  route/gate tests are CI-only.

### ⚠️ Two honesty notes on the merge
- **The PR-level Codex review (Loop B in `claude_help/codex-review-process.md`) was NOT run** — the
  owner merged #129 before the PR-review loop executed. The **spec/plan** were Codex-APPROVED, and
  the local CI mirror was green, but the standard mergeability bar (CI green **AND** Codex PR
  `VERDICT: APPROVED` **AND** comments addressed) was short-circuited by the direct merge. Nothing to
  undo; just recorded. If desired, a retro Codex review of `1a3d8bd` can still be run.
- **`#129` is merged but UN-deployed** — see NEXT SESSION #1.

### #103 disposition
`#103` (mobile Apple/SSO opaque id) is superseded by this work and its sync slice already shipped.
After #129 deploys and the owner device-verifies, **close #103** (or keep only its on-device
verification checkbox). Local branch `feat/display-name-capture` is merged and can be deleted
(`git branch -d feat/display-name-capture`; the remote branch too).

---

## ⚙️ Environment reality (unchanged — read before picking up)

Windows host with Codex's WSL-built artifacts ([[fountainrank-windows-wsl-local-check-workarounds]]):
- **Backend fully verifiable locally** via an isolated `UV_PROJECT_ENVIRONMENT` (a scratchpad venv) +
  PostGIS on `localhost:5436` (`docker compose -f docker/docker-compose.yml up -d db`). Runs the whole
  CI mirror green.
- **Web/mobile:** only `tsc`, `prettier`, and **pure-logic** vitest run locally (invoke binaries via
  the pnpm store path, e.g. `node "$(ls node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs|head -1)" run <file>`);
  ESLint, `next build`, **JSX render tests**, `expo-doctor`, and mobile device visuals are CI-/owner-only.
  The root `.prettierignore` excludes `.next`/`.expo`/`packages/api-client/*` — run prettier on source
  globs (`app/** lib/** components/**`), not the whole dir.
- **api-client regen** (when backend schema changes): `cd backend && uv run python -m
  app.export_openapi ../packages/api-client/openapi.json` then `node
  node_modules/openapi-typescript/bin/cli.js packages/api-client/openapi.json -o
  packages/api-client/src/schema.d.ts`. `.gitattributes eol=lf` normalizes line endings; a fresh
  regen must produce a clean tree (CI checks this). **GA4 needs no api-client regen** (no backend
  changes).

---

## 🔁 Process gate (unchanged — per `CLAUDE.md`)

branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex spec/plan review before code AND PR review before merge, both bypass mode
(`sandbox: "danger-full-access"`, `approval-policy: "never"`), WSL `cwd` `/mnt/d/repos/fountainrank`,
repo-relative paths, loop until APPROVED. No AI attribution, no time estimates. New UI →
`docs/style-guide.md`. Handoff/docs commits go direct to `main`. Deploys are manual dispatch.

**Backlog:** ~29 open issues (e.g. P1 mobile #102 inert draft pin; P2 add-fountain/map polish batch
#98–#101/#104/#105/#120/#99; web #121 points-badge overlap; verify-and-close #65/#85). Pull with
`gh issue list --repo redducklabs/fountainrank` / `gh issue view <N>`.
