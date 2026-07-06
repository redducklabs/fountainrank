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

## 🔴 SESSION 2 UPDATE (2026-07-05) — Plan 2 scope DECIDED + full context gathered (plan still NOT written)

A second session picked up here, gathered all the web context, ran the hex inventory, and got an **owner decision** on a scope conflict in the spec. **The plan doc was not written yet** (owner had to restart) — the next session should go straight to writing `docs/plans/2026-07-05-dark-mode-2-web.md` with the scope + design below, then run the Codex plan-review loop. **Nothing below needs re-exploring.**

### 🔴 OWNER DECISION: migration scope = **FULL RE-TONE (all surfaces)**

The spec contradicts itself and the owner resolved it. **§3.2** says dark mode should "re-tone the white content surfaces and slate text," but **§4.4 / §11** describe the work as "migrate the hardcoded hex." Those are **different jobs**: the white cards/text/borders/status-chips use **NAMED Tailwind neutrals** (`bg-white`, `text-slate-700`, `bg-slate-50`, `border-slate-200`, `bg-emerald-100`, `bg-amber-50`, `text-red-800`, …) — **NOT** hardcoded hex. Migrating only the hex (what §4.4 literally says) would leave **white cards floating on a dark page**. This is a latent **spec defect** — flag it in the plan's self-review and to Codex.

**Owner chose "Full re-tone (all surfaces)."** So Plan 2's migration MUST cover, across **every** surface (incl. SEO/legal/admin/static pages):
- **(a) brand hex → brand tokens** (the 170 occurrences below), and
- **(b) neutral content-surface utilities → semantic tokens** — `bg-white`→`bg-surface`/`bg-surface-raised`, `text-slate-700/800/900`→`text-foreground`, `text-slate-400/500/600`→`text-muted`, `border-slate-100/200`→`border-border`, `bg-slate-50`→`bg-surface`, etc., and
- **(c) status/semantic chips → dark-tuned `dark:` variants** — the working/degraded/broken chips (`bg-emerald-100 text-emerald-800`, `bg-amber-100 text-amber-800`, `bg-red-100 text-red-800`), advisory ambers (`text-amber-700`), attribute-chip variants (`AttributeChips.tsx`: positive/negative/neutral/mixed/muted), and the light-blue highlights (`#EAF1FF`, `bg-blue-50`), so they read on dark surfaces.

### Hex inventory — DONE this session (do NOT re-run)

- **170 brand-hex occurrences / 49 files / 12 distinct values** (spec's "~148/59" was an undercount of files, over of nothing). Exact-map to tokens: `#0A357E`→**brand** (86×, 41 files), `#0C44A0`→**brand-mid** (38×, 19 files), `#0E4DA4`→**brand-royal** (8×, 7 files), `#F2C200`→**accent-gold** (22×, 15 files), `#5fc5f0`→**water** (1×, `globals.css` `.water-drop` background).
- **0 test files assert on any hex** — the spec's "update component tests asserting `bg-[#...]`" line is **moot**; nothing to update there. (Only `#nnn` in tests are GitHub issue refs.)
- **UNMAPPED hex → needs new tokens / decisions in the plan:**
  - `#ffce1f` (gold hover, 5×/4 files: AuthControl, SignInButton, ConsentBanner, AddFountainFab) → add `accent-gold-hover` token (same both themes).
  - `#E7F0FF` + `#EAF1FF` (two near-identical light brand-blue tints: `AttributeChips` chip surface + `LeaderboardRows` "you" highlight) → one new `accent-subtle` token with a dark variant.
  - `#e9efe7` (map-canvas placeholder, `MapBrowserLoader` + `MapStates` UnsupportedHint) → dark-surface token or a shared map constant.
  - `#cdd6e6` (`ShareButton` border ≈ `#E2E8F0`) → `border` token.
  - `#CBD5E1` (`Stars.tsx` empty-star SVG `fill`, a bare const `EMPTY`) → needs a dark-tuned muted value (Stars also has `GOLD="#F2C200"` const).
- **Map-paint hex → new `web/lib/map/colors.ts` JS constants (NOT CSS tokens):** `layers.ts` L31/32/50/95/128 (`#0C44A0` cluster, `#ffffff` cluster stroke + count, `#0A357E` pill text, `#0C44A0` selected-halo @0.18) **and** `web/components/map/placement-map.ts` L34 (`#0A357E` accuracy ring @0.4) + L71 (`#0A357E` draggable marker). **The web add-fountain placement map (`placement-map.ts`) is an overlay on the SAME MapBrowser map — theme its ring/marker colors too.**

### Locked design decisions (derived this session from spec §4/§5 + current code)

- **Token layer (`web/app/globals.css`, currently just `@import "tailwindcss";` + keyframes + `.water-drop`):** add `@custom-variant dark (&:where(.dark, .dark *));`, `:root{ …light vars… }` + `.dark{ …dark overrides… }`, `@theme inline { --color-*: var(--*) }`. Token set (spec §3.1): background, surface, surface-raised, foreground, muted, border, brand, brand-mid, brand-royal, accent-gold, accent-gold-hover, accent-subtle, water, danger, on-brand (+ a map-placeholder value). Convert `.water-drop { background: #5fc5f0 }` → `var(--water)`. Light values from §3.1 + style-guide brand table; dark values from §3.1 are **proposed** — the a11y task (step 8) tunes each pair to WCAG AA vs screenshots.
- **Provider:** **no `web/app/providers.tsx` exists** — create it (`"use client"`) wrapping next-themes `ThemeProvider attribute="class" defaultTheme="system" enableSystem`. In `layout.tsx`: add `suppressHydrationWarning` on `<html>`, wrap `{children}{modal}` (keep `<AnalyticsConsent/>` — it's the precedent for a client component mounted in the server root layout). Add dep: `pnpm --filter web add next-themes@0.4.6` (no active `minimumReleaseAge` gate in this repo; 0.4.6 is well-aged; React 19 compatible).
- **ThemeToggle:** `"use client"`, `useTheme()`, 3-state System/Light/Dark, hydration-safe (stable placeholder until mounted). Placed in `SiteHeader.tsx` (an **async server component** on the brand gradient — the toggle is a client child) in the right cluster (`ml-auto flex items-center gap-3`, near `AuthControl`), styled translucent-white for the gradient (like `HeaderSearch`/the Decline button). Mirrored on `account/page.tsx` signed-in view (also brand gradient). Document in `docs/style-guide.md` (house rule).
- **Map runtime swap (spec §5 — the delicate part):**
  - New `web/lib/map/colors.ts`: `type MapColors { cluster; clusterStroke; clusterCount; pillText; pillBg; halo; selectedPin }`, `MAP_COLORS: Record<"light"|"dark", MapColors>` (values from spec §3.1 map-token table: dark cluster `#4C82F0`, stroke `#0B1220`, pillText `#E7F0FF`, halo `#5FC5F0`; pillBg/selectedPin carry the theme-suffixed **image names**), `mapColorsFor(theme)`.
  - `style.ts`: make `PIN_ASSETS`/`PILL_BG_ASSET` theme-keyed (`…-dark.png`); add `styleUrlFor(theme)` — `new URL` basename swap `style.light.json`→`style.dark.json` preserving `?v=`, `logMapError("dark-style-derivation-fallback", …)` + return light on a non-matching URL.
  - `layers.ts`: factories take a resolved `MapColors` (clusterCircle/clusterCount/pill/selectedHalo); **theme-suffixed icon-image names** (`pill-bg`/`pill-bg-dark`, `pin-selected`/`pin-selected-dark`); `SELECTED_ICON_EXPR` → `selectedIconExpr(selectedPinName)`.
  - `pins.ts`: `pinsToFeatureCollection(pins, theme = "light")` appends `-dark` to the feature `icon` in dark (`basePinIcon` stays pure status→name).
  - `MapBrowser.tsx`: **split** the current `map.on("load")` monolith into (1) **one-time wiring** attached once & `off`'d on unmount — cluster/pin/selected-pin `click`, `mouseenter`/`mouseleave`, `moveend`, geolocation, nav/geolocate controls; and (2) **`installOverlay(map, colors, theme)`** run on every `map.on("style.load")` (fires on initial load AND each `setStyle`) — loadImage+addImage the theme pins/pill under suffixed names, `addSource("fountains")` seeded from a **`pinsRef`**, add layers from the theme-aware factories, reapply the `activeIdRef` filter; then kick `load()`. Add **`styleGenRef`** (bump per `setStyle`); `installOverlay` + any in-flight `load()` capture the gen and abort if superseded. Keep refs: `pinsRef`, `activeIdRef`, `themeRef`. Theme-change effect keyed on next-themes `resolvedTheme` → `map.setStyle(styleUrlFor(resolvedTheme))` (camera preserved; no rebuild). `MapBrowser` becomes a `useTheme()` consumer (already under the provider). `load()` must build the FC with the current theme (`themeRef`).
  - **Tests:** update `web/lib/map/layers.test.ts` (pass colors, assert dark values + suffixed names) and `web/lib/map/pins.test.ts` (dark suffix). Add `web/lib/map/style.test.ts` (`styleUrlFor` + fallback) and `web/lib/map/colors.test.ts`. MapBrowser wiring itself has **no** unit test → verify via `next build` + manual/CI visual (spec §10).
- **Dark pins (web, spec §8):** extend `scripts/gen-pin-assets.py` to also emit `pin-standard-dark.png`, `pin-selected-dark.png`, `pin-gold-dark.png`, `pin-broken-dark.png`, `pill-bg-dark.png` (brighter/lighter fills + stronger contrast outline via the existing `_ring`; `pill-bg-dark` = dark rounded-rect + light border so the light pill text reads). Extend `scripts/assets/gen_unrated_pin.py` to also write `web/public/pins/pin-unrated-dark.png` (brighter slate ramp). **Mobile dark pins = Plan 3.** Regenerate hermetically: `uvx --from pillow python scripts/gen-pin-assets.py`. Commit the PNGs.
- **Deploy probe (spec §7):** add a step to `deploy.yml` **`build-push`** job **before** "Build + push web" that `curl`s `https://${BASEMAP_CDN}/style.dark.json?v=${BASEMAP_STYLE_VER}` (`BASEMAP_CDN=fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com`, `BASEMAP_STYLE_VER="2"`) expecting `200`, failing the deploy if dark isn't live. `style.dark.json` already exists (Plan 1), so the gate is safe now.

### Files surveyed this session (don't re-read to re-derive)

spec, Plan 1, `claude_help/{development-process,codex-review-process}.md`, `docs/style-guide.md` (brand table + component catalog), `web/package.json` (no next-themes; **TS 6.0.3 / React 19.2.7 / Next 16.2.10 / maplibre 5.24.0**), `web/app/{globals.css,layout.tsx,account/page.tsx}`, `web/components/SiteHeader.tsx`, `web/components/map/{MapBrowser,MapBrowserLoader,MapStates}.tsx`, `web/lib/map/{style,layers,constants,log,pins}.ts`, `web/lib/map/{layers,pins}.test.ts`, `.github/workflows/deploy.yml`, `scripts/gen-pin-assets.py`, `scripts/assets/gen_unrated_pin.py`. **`main` is clean at `dfbb753` (= origin/main).**

### Suggested plan task order (writing-plans, TDD, per-surface commits)

1. Token layer (`globals.css`: `@custom-variant` + `:root`/`.dark` + `@theme inline`; convert `.water-drop`). 2. Provider + `layout.tsx` + `next-themes` + `providers.tsx`. 3. `ThemeToggle` in `SiteHeader` + account. 4. **FULL content re-tone migration** (brand hex→tokens + neutrals→tokens + dark status chips), grouped by surface, per-surface commits, `./run.ps1 check -Web` between groups. 5. Dark pin assets (web). 6. Map: `colors.ts` + `styleUrlFor` + theme-aware `layers`/`pins` + `MapBrowser` `setStyle` swap + `placement-map` theming. 7. `deploy.yml` dark probe. 8. A11y/contrast tune to WCAG AA vs light+dark screenshots (`/`, detail drawer, leaderboard, map, SEO/legal). 9. Docs (`style-guide.md`: ThemeToggle + dark token table). Then Codex plan-review loop → APPROVED → branch fresh from `main` → implement.

---

## Next up: Plan 2 (web dark mode) — NOT yet written

Write it via the usual flow: **spec is already approved**, so go straight to **writing-plans** → `docs/plans/2026-07-05-dark-mode-2-web.md` → **Codex plan-review loop to APPROVED** → implement → PR (CI + Codex + comments) → squash-merge. Branch fresh from `main` (which now has the spec + Plan 1). **⚠️ Read the SESSION 2 UPDATE above first — the migration scope is FULL RE-TONE, not hex-only, and the inventory + design are already done.**

**Plan 2 scope (web), per spec §4, §5:**
- **Token layer** (`web/app/globals.css`): `@custom-variant dark (&:where(.dark, .dark *));` + semantic CSS vars in `:root`/`.dark` + `@theme inline { --color-*: var(--*) }`. Seed from `docs/style-guide.md` brand table. Palette table (light + **proposed** dark values) is in spec §3.1 — dark values are starting points; tune to WCAG AA against screenshots.
- **Provider + no-flash:** add `next-themes@0.4.6`; `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>` in `web/app/layout.tsx` (+ `suppressHydrationWarning` on `<html>`).
- **`ThemeToggle`** (3-state) in `SiteHeader` + account page; hydration-safe; document in `docs/style-guide.md` (house rule).
- **Hex→token + content re-tone migration** — **SUPERSEDED by the SESSION 2 UPDATE above: scope is FULL RE-TONE**, not hex-only. Real numbers: 170 brand-hex occurrences / 49 files / 12 values, **plus** the named neutral utilities (`bg-white`, `text-slate-*`, `border-slate-*`, status chips) that §3.2 requires re-toned. **0 tests assert on hex** (nothing to update there).
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
