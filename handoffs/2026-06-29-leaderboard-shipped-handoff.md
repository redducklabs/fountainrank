# Leaderboard (#117) shipped + deployed (web+backend) — handoff (2026-06-29)

**Source:** a follow-on session after `handoffs/2026-06-29-anti-gaming-merged-and-backlog-handoff.md`.
This session built the #117 leaderboard across backend + web + mobile, merged it, and deployed
web+backend to prod (which also shipped the previously-merged-but-undeployed #119 anti-gaming fix).

---

## 🟢 RESUME HERE — current state

- **Branch:** `main`, clean, synced. Latest: **`cf4877d`** `feat: leaderboard (#117) — category sort
  + your-rank across backend/web/mobile (#123)`.
- **✅ #117 leaderboard MERGED (PR [#123](https://github.com/redducklabs/fountainrank/pull/123))**
  and **CLOSED**. Gates all passed: full CI green, Codex spec/plan **APPROVED** (review-2) and PR
  **APPROVED** (review-2, one `[MAJOR]` fixed in-loop), every PR comment addressed.
- **✅ DEPLOYED to prod (web + backend → DOKS).** Deploy run `28423597338` on `cf4877d` — both
  *Build + push images* and *Deploy to DOKS* succeeded. **Smoke-verified live:**
  `GET https://api.fountainrank.com/api/v1/leaderboard/contributors` returns the new
  `{"rows":[…],"you":…}` shape; `?sort=ratings` → 200; `?sort=bogus` → 422.
- **✅ #119 anti-gaming is now DEPLOYED** — `71098f2` is an ancestor of the deployed `cf4877d`, so
  this batched deploy shipped it. (The prior handoff's "⚠️ #119 not deployed" is now resolved.)
- **⏳ Mobile NOT yet on devices.** The mobile leaderboard code is merged, but `deploy.yml` only
  ships web+backend. Mobile reaches TestFlight/Play via a **separate** `mobile-store-release.yml`
  run (owner's call): `gh workflow run mobile-store-release.yml --ref main -f platform=all`.

### What #117 shipped (so you don't re-investigate)

- **Backend** (`backend/app/routers/leaderboard.py`, `schemas.py`): `GET …/leaderboard/contributors`
  gained a **`sort`** param — `total` (default) + the six major categories (`fountains`, `ratings`,
  `verifications`, `conditions`, `attributes`, `notes`; bonus events excluded). Optional auth
  (`get_optional_user`) adds a **`you`** standing (invalid bearer still 401s). **Response shape
  changed** from a bare list to **`LeaderboardOut { rows, you }`**; `ContributorRow` now =
  `rank`, `display_name`, `points`, `category_count`, `is_you` (dropped `fountains_added`/
  `ratings_count` — no consumer). Global category sorts on the denormalized counter; the **local**
  board computes rows **and** the caller's rank from **one** `ST_DWithin` scan (`base`/`ranked`
  CTEs). No migration (counters + `reversed` status already existed) → no Alembic drift.
- **Key insight (locked by a guardrail test):** for the current categories, ranking by **count** ==
  ranking by **points** (each event type has one fixed positive point value). If a future event
  gets a variable value, `test_leaderboard_category_map_guardrail` fails loudly.
- **Web** (`web/app/leaderboard/page.tsx`, `components/leaderboard/*`, `lib/leaderboard.ts`):
  server-rendered `/leaderboard` (scope toggle + category chips as query-param `<Link>`s; numbered
  rows; highlighted + pinned "You" row, shown even on an empty board). `PointsBadge` is now a
  `<Link>` whose href tracks the live map center (`moveend`) → `/leaderboard?lat&lng`.
- **Mobile** (`mobile/app/leaderboard.tsx`, `lib/leaderboard/query.ts`): stack screen (Global/Near
  here + category chips, FlatList rows + pinned You row) via the authed `useApi` client; `PointsChip`
  is now a `Pressable` that opens the leaderboard with the current map center.
- **Region = "where the map is looking"** (map center, captured on open). **"Your rank, always"**
  (highlight in-list + pinned You row, or "Not yet ranked").
- Spec: `docs/specs/2026-06-29-leaderboard-design.md`; plan: `docs/plans/2026-06-29-leaderboard.md`;
  style-guide updated; two older docs got supersession notes. Codex reviews:
  `temp/codex-reviews/2026-06-29-leaderboard-plan-review-{1,2}.md`, `pr-123-review-{1,2}.md`
  (gitignored).

---

## ⚙️ Environment reality (unchanged — read before picking a task)

Windows host with Codex's WSL-built artifacts (memory `fountainrank-windows-wsl-local-check-workarounds`):

- **Backend → fully verifiable here.** Isolated `UV_PROJECT_ENVIRONMENT` runs the whole CI mirror
  (ruff + format + `alembic upgrade head` + `alembic check` + 357 pytest) green. PostGIS on
  `localhost:5436` (`docker compose -f docker/docker-compose.yml up -d db`).
- **JS pure-logic tests → yes; rendering/mock tests → CI only.** `node node_modules/vitest/vitest.mjs
  run <file>` works for pure helpers (web/mobile leaderboard mappers passed locally), but **`vi.mock`
  doesn't intercept and React render produces empty HTML** in that invocation — so any jsdom/render
  or module-mock test (e.g. `ContributionStatusOverlay.test.tsx`, `LeaderboardRows.test.tsx`)
  **can only be verified in CI**. `tsc` and `prettier` run locally via the `.pnpm` store path; ESLint
  + `next build` + `expo-doctor` are CI-only (WSL `node_modules` EACCES). `pnpm run …` trips a
  deps-check EACCES — bypass with `--config.verify-deps-before-run=false` or run binaries via
  `node <pkg>/bin/...`. **api-client regen:** `cd backend && uv run python -m app.export_openapi
  ../packages/api-client/openapi.json` then `node node_modules/openapi-typescript/bin/cli.js
  packages/api-client/openapi.json -o packages/api-client/src/schema.d.ts`.
- **Mobile/web visual = owner-only here.** Mobile on-device + web map visuals need the owner.

---

## 📋 Prioritized open-issue backlog (was 28; #117 + #97 now closed → ~26 open)

Order unchanged from the prior handoff. Pull bodies with `gh issue view <N> --repo redducklabs/fountainrank`.

**P1 — correctness / blockers (mobile, device-gated)**
- **#102** Android: freshly-added pin can't be tapped (inert draft pin on top after add).
- **#103** Apple/SSO shows an opaque id instead of the user's name (mobile never calls `/me/sync`;
  needs the call + Logto native `profile`/`email` scopes). Feeds leaderboard display names too.

**P2 — mobile add-fountain + map-chrome polish (share `index.tsx`/`FountainMap.tsx`; batch)**
- **#100** recenter on "use current location" + keep target above the sheet · **#101** hide the
  empty badge while adding · **#104** iOS "+" overlaps attribution · **#105** compass under chips ·
  **#99** distinct draft pin · **#98** seed a draft pin on entering add mode · **#120** iOS icon on
  black (asset-only; reuse `scripts/assets/gen_splash_icon.py`).

**Web (doable here — code; owner confirms visual)**
- **#121** Points badge overlaps the map zoom/geolocate controls (top-right collision). **Note:** the
  badge is now an interactive `<Link>` (z-30) — re-confirm the overlap against `NavigationControl`/
  `GeolocateControl` (both top-right) before fixing; move one corner.

**P3 — verify-and-close (released; pending on-device confirmation)**
- **#65** existing rating on the rating screen · **#85** pin flicker/clustering (resolved on
  emulator per memory) — owner device-confirm → close.

**P4 — features** · **#43** filters · **#19** place search/geocoding · **#18** dark mode ·
**#10–#13** moderation roadmap (blocking, report→queue, queue, bans).
*(Leaderboard #117 is now done; a future enhancement could surface the category boards on mobile's
account screen, or add time-window variants — both explicitly out of scope for #117.)*

**P5 — infra/triage** · **#48** OSM PBF import · **#95** pnpm 11 audit hang · **#38–#42, #44**
older rating/attribute umbrella issues — triage/close rather than build blind.

---

## 🔁 Process gate (unchanged — per `CLAUDE.md`)

branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR comment addressed** →
**squash-merge**. Codex spec/plan review before code AND PR review before merge, both bypass mode,
WSL `cwd` = `/mnt/d/repos/fountainrank`, repo-relative paths, loop until APPROVED. No AI attribution,
no time estimates. New UI → `docs/style-guide.md`. Handoff/docs commits go direct to `main`.
Deploys are manual dispatch: `gh workflow run deploy.yml --ref main` (web+backend),
`gh workflow run mobile-store-release.yml --ref main -f platform=all` (mobile).
