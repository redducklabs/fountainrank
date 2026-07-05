# Handoff — #18 dark mode: spec + Plan 1 (dark basemap flavor) shipped; next = Plan 2 (web)

**Date:** 2026-07-05
**Branch:** `main` @ `3273d30` (clean, pushed). PR #191 squash-merged.
**Purpose:** Enough context to open a fresh conversation and continue #18 dark mode from Plan 2.

---

## What happened this session

1. **Deployed #124 (repeat-contribution point limit) to web + mobile.**
   - **Web+backend** → DOKS via `deploy.yml` (`f8bcd43`); verified live (`fountainrank.com` 200, API `/readyz` PostGIS healthy). This deploy also carried the two owner-merged PRs that had landed on `main` since the last deploy: **#189** (tabbed fountain detail drawer) and **#190** (mobile photo-upload FormData fix).
   - **Mobile** → EAS via `mobile-store-release.yml` (platform=all); Android → Google Play internal, iOS → App Store Connect/TestFlight. Both green. (Optional follow-up: paste release notes into the TestFlight "What to Test" field — EAS can't set it on the non-Enterprise plan.)

2. **#18 Dark mode — design spec written and Codex-APPROVED.**
   - **Spec:** `docs/specs/2026-07-05-dark-mode-design.md` (Codex-approved, 2 rounds; on `main`).
   - **Scope chosen by owner:** **all-in-one** (web + mobile + shared dark basemap), delivered as **3 sequenced PRs**.
   - **Locked decisions** (spec §2): full semantic **token system** (Tailwind v4 `@custom-variant dark` + `@theme inline` + `:root`/`.dark`); **3-state** System/Light/Dark toggle (default System), persisted; web provider = **`next-themes@0.4.6`** (React 19 compatible; no active `minimumReleaseAge` gate in this repo — only vestigial `minimumReleaseAgeExclude`); map basemap swap = **`setStyle` + re-install overlay** (preserve camera, split one-time listeners from per-style install, refs for latest pins/activeId + a `styleGenRef` generation counter); toggle placement = **header + account**; pins = **second dark-tuned baked set**.
   - Codex's round-1 spec review caught 6 real MAJORs (MapLibre handler-duplication + stale-data-across-`setStyle`, missing mobile add-fountain map, wrong workflow for basemap cleanup, unsupported supply-chain claim, too-broad local-check carve-out) — all fixed before approval.

3. **#18 Plan 1 (dark basemap flavor) — SHIPPED** (PR **#191**, squash-merged as **`3273d30`**).
   - **Plan:** `docs/plans/2026-07-05-dark-mode-1-basemap-flavor.md` (Codex-approved).
   - **What shipped:** `.github/workflows/basemap-upload.yml` now also generates + uploads **`style.dark.json`** (`namedFlavor("dark")`, `sprite: /sprites/v4/dark`) in the same step as the light style (one `npm install`); CDN purge extended to the dark objects; a new **`Validate dark basemap flavor`** step asserts the dark style's sprite ref + byte-identical `glyphs`/`sources.protomaps` vs light + dark sprite 200s. The dark **sprite** (`sprites/v4/dark.{json,png}`) was already on the CDN via the workflow's recursive sprite sync — no sprite generation needed.
   - **Verified live:** dispatched `basemap-upload` on the branch; run **succeeded** including `Validate dark basemap flavor: success`. `https://fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com/style.dark.json` serves 200 with 71 layers, correct sprite ref, full source parity (Codex confirmed directly from the CDN). CI green, Codex PR-review APPROVED (2 rounds), inline comment fixed + replied.
   - **Side effect (benign):** the dispatch also refreshed `planet.pmtiles` to a newer Protomaps daily build (a newer build existed → `SKIP_STREAM` was false), so the run streamed the ~127 GB planet. Completed successfully; fresher OSM map data is a bonus, not a problem.

---

## Next up: Plan 2 (web dark mode) — NOT yet written

Write it via the usual flow: **spec is already approved**, so go straight to **writing-plans** → `docs/plans/2026-07-05-dark-mode-2-web.md` → **Codex plan-review loop to APPROVED** → implement → PR (CI + Codex + comments) → squash-merge. Branch fresh from `main` (which now has the spec + Plan 1).

**Plan 2 scope (web), per spec §4, §5:**
- **Token layer** (`web/app/globals.css`): `@custom-variant dark (&:where(.dark, .dark *));` + semantic CSS vars in `:root`/`.dark` + `@theme inline { --color-*: var(--*) }`. Seed from `docs/style-guide.md` brand table. Palette table (light + **proposed** dark values) is in spec §3.1 — dark values are starting points; tune to WCAG AA against screenshots.
- **Provider + no-flash:** add `next-themes@0.4.6`; `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` in `web/app/layout.tsx` (+ `suppressHydrationWarning` on `<html>`).
- **`ThemeToggle`** (3-state) in `SiteHeader` + account page; hydration-safe; document in `docs/style-guide.md` (house rule).
- **Hex→token migration:** ~148 arbitrary hex utilities across 59 files → token utilities; update component tests asserting `bg-[#...]`.
- **Map runtime swap** (`web/components/map/MapBrowser.tsx`, `web/lib/map/style.ts`, `web/lib/map/layers.ts`): `styleUrlFor(theme)` (new `URL` basename swap `style.light.json`→`style.dark.json`, preserve `?v=`, `logMapError` fallback); extract `installOverlay`; split one-time listeners from per-style install; refs + `styleGenRef`. Map colors in a new **`web/lib/map/colors.ts`** JS constant (not CSS vars). Dark pins (`pin-*-dark.png`, `pill-bg-dark.png`) generated + tuned **here** (moved out of Plan 1 — see below).
- **Deploy availability probe** (spec §7): add a `curl …/style.dark.json?v=N → 200` gate to `deploy.yml` — this is the PR that makes dark requestable, so the gate belongs here. `style.dark.json` already exists (Plan 1), so the gate is safe to add now.

**Scope refinement made this session (vs the original "PR1 = basemap + pins" wording):** the dark **pin assets** and the **deploy probe** were moved OUT of Plan 1 into their consuming client PRs — pins need visual tuning against the real dark map, and the probe only matters once a client requests dark. So **web dark pins → Plan 2**, **mobile dark pins → Plan 3**.

## Then: Plan 3 (mobile dark mode) — per spec §6

Split `mobile/theme.ts` into light/dark; `ThemeProvider` (merges `useColorScheme()` + AsyncStorage `theme` key, isolated from web localStorage) as the **outermost** provider in `mobile/app/_layout.tsx:43-50` (wrapping SafeAreaProvider/QueryClientProvider/AuthProvider/ApiProvider); rewire 37 importers to `useTheme()`; theme-aware `StatusBar`; toggle on the account/profile tab; **both** map surfaces themed — `mobile/components/map/FountainMap.tsx` **and** `mobile/components/add-fountain/AddFountainMap.tsx` (the add-fountain basemap/pin/ring). Mobile dark pins = `pin-*-dark.png` (no `pin-selected`, no `pill-bg` — mobile pill is text+halo). Mobile pins currently: `pin-unrated` is dual-written by `scripts/assets/gen_unrated_pin.py`; the other three appear hand-copied from web — have the generator dual-write the dark set.

---

## Process reminders (MUST follow — `CLAUDE.md` + `claude_help/`)

- **Spec/plan AND PR each require a Codex review loop to `VERDICT: APPROVED`** (gating, on top of CI). Read `claude_help/codex-review-process.md`. Codex via Codex MCP in **bypass mode** (`sandbox: danger-full-access`, `approval-policy: never`); `cwd` = `/mnt/d/repos/fountainrank` (derive from `D:\repos\fountainrank`); all prompt paths repo-relative. Review artifacts in `temp/codex-reviews/<slug>-{spec|plan}-review-<N>.md` / `pr-<N>-review-<N>.md`.
- **Branch → PR → CI green + Codex APPROVED + every PR comment addressed → `gh pr merge <N> --squash`.** No AI attribution; no time estimates; Conventional Commits.
- Plan 2 does **not** touch the backend/api-client. Plan 3 doesn't either.
- **`docs/` is outside the prettier gate** — don't `prettier --write` docs.

## Environment gotchas discovered this session

- **`basemap-upload` dispatch may refresh the whole planet, not just assets.** With `upload_assets=true` and no `pmtiles_url`, if a **newer** Protomaps daily build exists, `SKIP_STREAM` is false → it streams the ~127 GB planet (ephemeral droplet + cost + ~long run) in addition to uploading the styles. The **style/asset upload is gated on `UPLOAD_ASSETS`, independent of the stream**, so `style.dark.json` publishes regardless. Expect a long run if the source moved.
- **`actionlint` locally:** the committed `temp/actionlint/actionlint` is a **Linux** binary (a WSL/Codex artifact) — it won't exec in Git Bash on Windows. Run it via WSL: `wsl.exe -e ./temp/actionlint/actionlint .github/workflows/<file>` (pinned v1.7.12). YAML sanity: `python -c "import yaml;yaml.safe_load(open('<file>'))"`.
- **`production` GitHub environment has NO `deployment_branch_policy`** — any branch can dispatch production workflows (so branch-dispatching `basemap-upload`/`deploy`/`mobile-store-release` gets production secrets). Confirmed via `gh api repos/redducklabs/fountainrank/environments/production`.
- **`main` advanced under us at session start** (owner merged #189/#190 in parallel). Always `git fetch` + check the deploy SHA before assuming what `main` HEAD is. The repo runs many parallel PRs; branch fresh from the latest `main` and check `mergeable` before waiting on CI ([[fountainrank-unmergeable-pr-skips-ci]]).

---

## Open backlog (unchanged from prior handoff, minus what moved)

#18 in progress (Plan 1 done; Plans 2+3 pending). Others still open: #167 (photos — likely verify+close), #43 (web filter chips), #11/#12/#10/#13 (moderation cluster), #184 (trivyignore transitive advisories), #182 (TS 6.0 — hold), #181 (Expo 57 — hold). See the prior handoff `handoffs/2026-07-05-repeat-contribution-point-limit-shipped.md` for the full table.
