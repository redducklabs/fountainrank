# Mobile device-test bug-fix handoff (2026-06-27)

**Source:** an owner device-test pass on 2026-06-27 (real iOS + Android builds). Screenshots in
`temp/debugging/WhatsApp Image 2026-06-27 at 2.23.12 PM*.jpeg` and `…2.41.31 PM.jpeg`.

**Purpose:** a self-contained worklist + priority order so this can be picked up in a fresh session
without the originating conversation. Every item below is grounded in the current code (verified
file:line); the full root-cause write-up, evidence, and acceptance criteria live in the linked GitHub
issue. This doc summarizes and **sequences** them.

> Two of these were already "closed as fixed" (#85, #88) but the user-visible symptom never went away —
> the prior PRs implemented the prescribed change without verifying the symptom on a device. They are
> **reopened**. Treat the lesson as a hard rule for this pass: **a fix is not done until the original
> symptom is reproduced and then confirmed gone on a physical device.**

---

## ⚠️ CURRENT STATE — READ THIS FIRST (updated 2026-06-27, late session)

The batches below were implemented and **merged to `main`**, then store builds went to TestFlight / Play
internal for owner device-testing. Device testing surfaced **one blocker that supersedes everything: the
map renders only a random subset of fountains (often none), on BOTH platforms, while web renders all of
them.** Most other fixes can't be meaningfully verified until the map renders. The active investigation and
the candidate fix are below.

### Merged to `main` (all via branch → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge)

- **PR #106** — the device-test bugfixes (Batches 1–4: #88, #103, #85-partial, #97/#98/#100/#101/#102/#99,
  #104/#105) **+** the bundled store release-notes CI job. The squash used `Refs` (not `Fixes`), so the
  **GitHub issues remain OPEN** on purpose (device-verification rule).
- **PR #107** — hardened `mobile-store-release.yml` release-notes (lists `feat:`/`fix:` + `(#NN)` commits;
  no longer fails on a range with no PR refs).
- **PR #108** — added `appleTeamId: "VPQ79Y3WQ7"` to `submit.production.ios` in `eas.json`. (Was a *wrong*
  hypothesis for the iOS submit failure but is correct, non-secret config; kept.)
- **PR #109** — removed `--what-to-test` from the iOS `eas build --auto-submit`. EAS hosted submission's
  TestFlight changelog is **Enterprise-plan only** ("Changelog submission is currently available for
  Enterprise plan only") and was failing every iOS submit. iOS now submits **without** auto-notes.
- **PR #110** — Android `submit.production.android.releaseStatus` `draft` → **`completed`** so internal-test
  releases **auto-publish** on upload (no Play Console step). EAS doesn't carry Android release-note text.

Released `v0.8.1` early in the session; iOS/Android build numbers have since incremented via several
`workflow_dispatch` test builds. **Those store builds contain the bugfixes but the broken map (below).**

### Device-verification status (original device-test issues)

- **#88 points** — ✅ **verified** on device (Points chip showed 128).
- **#85 map render** — ❌ **broken** (the blocker — see below). The glyph fix is in but is moot until pins render.
- **#103, #97, #98, #99, #100, #101, #102, #104, #105** — **not verified**; the add-flow + ornament issues
  can't be exercised while the map shows no pins. Re-verify all of these once the map renders.

### 🔴 THE BLOCKER — #85 map shows only a random subset of fountains (works on web)

A multi-build on-device debugging session. A `MAP_DEBUG` overlay (on branch `debug/map-pin-diagnostics`)
shows per-frame: `z<zoom> en:<Y/N> <queryStatus>/<fetchStatus> pins:<N> fc:<N> nat:<N>` + the queried bbox,
where `pins` = bbox-query count, `fc` = JS featureCollection count, **`nat` = the NATIVE source's real count**
(`sourceRef.current.getData().features.length`, polled ~600–900 ms after each data change).

**RULED OUT (with on-device evidence):**
1. **Data** — pulled the broken (home) area *and* a working area from the public bbox API; byte-identical
   structure, valid coordinates, identical to what web renders. Not the data/backend.
2. **bbox query / JS transform** — `pins:N` always equals `fc:N`. Query + `pinsToFeatureCollection` are fine.
3. **Zoom / clusterMaxZoom boundary** — first theory (`nat:0` at z14 == clusterMaxZoom == landing zoom), but
   owner proved `nat:0` at **any** zoom over the same spot. Not zoom. (Tried clusterMaxZoom 14→20; reverted.)
4. **Clustering** — `cluster={false}` → still `nat:0`. Not clustering.
5. **Icons** — plain circle pins (no icon image, no data-driven lookups) → still `nat:0`, nothing renders.
   Not the pin PNGs / `<Images>` registration.
6. **maplibre version** — bumped 11.3.4 → **11.3.6** (fixes a Fabric "stale map child indexes" bug #1596 +
   an iOS image-loading crash). **No change to the map.** (Lockfile bumped on the debug branch; harmless, kept.)
7. **Remount / self-heal** — remount-the-source-on-data-change and self-heal-on-`nat:0` (bounded retries)
   did NOT fix it; on 11.3.4 the remount churn caused a **Points→0** regression (fixed by reverting). All reverted.

**DEFINITIVE FINDING:** with the simplest possible config (`cluster={false}` + plain circle pins) the overlay
reads e.g. `pins:16 fc:16 nat:0` and nothing draws. The `data` prop on maplibre-react-native's
`<GeoJSONSource>` **is not reaching the native map source under React Native's NEW ARCHITECTURE (Fabric)** on
this stack (Expo 56 / RN 0.85.3 / @maplibre/maplibre-react-native 11.3.6). Web (maplibre-gl) has no such issue.

**CANDIDATE FIX — IN FLIGHT at handoff time:** `newArchEnabled: false` in `mobile/app.config.ts` (pin the app
to the **old architecture / "Paper"** renderer). maplibre-react-native ships mature old-arch ViewManagers
(`MLRNMapViewManager.kt`, etc.) alongside its Fabric components, so it supports old arch, where its GeoJSON
rendering has been stable for years.
- Build **run `28313869077`** (branch `debug/map-pin-diagnostics`): the **iOS build + TestFlight submit
  SUCCEEDED** with newArch off — so **RN 0.85 *does* support the old architecture** (the build does not fail);
  Android was still building at handoff. **NEXT: install that build and check whether the map renders** (the
  overlay `nat` should now match `fc`).
- If old arch renders the map → SOLVED. If not → fall back to rendering fountains as individual native markers
  (`<MarkerView>`/`<PointAnnotation>`, which bypass the GeoJSON source) with clustering done in JS.

### The debug branch `debug/map-pin-diagnostics` — DO NOT merge as-is

Off `main` (after #107). Contains: the `MAP_DEBUG` overlay (`index.tsx`), the `onNativeFeatureCount` `getData`
poll + `onDidFailLoadingMap`/`Images onImageMissing` warns (`FountainMap.tsx`), maplibre **11.3.6** (lockfile),
**`newArchEnabled: false`**, and the real map config restored (cluster + icon pins, clusterMaxZoom 14). The
`MAP_DEBUG` overlay and all `console.*` instrumentation **must be stripped before landing the fix on `main`.**

### How to resume (fresh session)

1. Read this file + `claude_help/codex-review-process.md` + `claude_help/testing-ci.md` + `CLAUDE.md`.
2. `gh run view 28313869077` for the old-arch build result; have the owner install it and **test if the map
   renders under the old architecture** (the decisive question).
3. **If it renders:** new branch off `main` → `newArchEnabled: false` (+ keep maplibre 11.3.6) → **strip all
   diagnostics** → PR → CI + Codex → squash-merge → re-release (tag `v0.8.x` or `workflow_dispatch`). Then
   re-verify the add-flow + ornament issues (#97–#105) now that the map works.
4. **If it does NOT render:** pivot to native-marker rendering (above).

### Local env gotchas

- Local pnpm/node_modules is **inconsistent on the debug branch** (lockfile 11.3.6 via `--lockfile-only`,
  node_modules still 11.3.4) — `pnpm exec` may fail its deps check there; `main` is consistent at 11.3.4. A
  clean reinstall fixes local tooling; EAS builds do a fresh `--frozen-lockfile` install so they're unaffected.
  Use `CI=true npm_config_verify_deps_before_run=false pnpm exec <cmd>` for local checks.
- ASC API keys (`temp/AuthKey_*.p8`) + Play service-account JSON (`temp/keys/*.json`) are already in the EAS
  credentials service (not in git).

---

## Working rules for this pass (do not skip)

- **Process gate (per `CLAUDE.md`):** branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR
  comment addressed** → **squash-merge**. One task at a time, Conventional Commits, frequent commits.
- **Read the spokes before touching code:** `claude_help/development-process.md`, `claude_help/testing-ci.md`,
  and `claude_help/codex-review-process.md`. For auth work also `claude_help/oauth-sso.md`.
- **On-device verification is mandatory** for every issue here (that is the whole reason this list exists).
  Reproduce the original symptom first, then prove it gone. Note the platform(s) verified in the PR.
- **No AI attribution in commits/PRs. No time estimates.** (Project + global rules.)
- New UI elements (e.g. the distinct draft pin) must be documented in `docs/style-guide.md`.

---

## Priority order (recommended execution sequence)

Ordered to front-load **confirmed, low-surface, high-visibility** fixes, then the **fully-broken core
flows**, then polish — and **batched by shared code** so PRs do not collide (the add-fountain issues all
live in the same two files). Severity key: **P0** = core flow broken, **P1** = core flow badly degraded,
**P2** = visible polish/cosmetic, **P3** = minor / other codebase.

### Batch 1 — Auth & API correctness (small, confirmed, high payoff) → do first

| # | Sev | Problem | Confirmed root cause | Key files | Fix direction |
|---|-----|---------|----------------------|-----------|---------------|
| **#88** | P0 | Points always show **0** for a signed-in user (map chip + Account). | `isAuthenticatedApiRequest` is an **exact** match on `/api/v1/me`, so `GET /api/v1/me/contributions` (and `/me/badges`) carry **no bearer token** → backend 401 → query errors → `?? 0`. The PR #92 focus-refetch fix was applied but is irrelevant (it refetches a doomed request). | `mobile/lib/api.ts:80-85` (+ `:119-131`); test gap in `mobile/lib/api.test.ts` | Broaden the gate to the authenticated `GET /api/v1/me/*` subtree (boundary-safe prefix or allowlist incl. `contributions`,`badges`). Add api.test.ts cases for both paths. **Smallest change, highest visible payoff — start here.** |
| **#103** | P1 | Apple account shows an opaque id (`4zsznfwtd8cx`) as the name + avatar initial. | Mobile never calls `POST /api/v1/me/sync` (the web #62 fix) and requests **no scopes**, so the backend first-seen fallback `display_name = sub` (`backend/app/auth.py:116-119`) is shown raw by `GET /api/v1/me`. | `mobile/app/(tabs)/account.tsx:187-193`, `mobile/lib/auth/config.ts:22-30`, `mobile/lib/api.ts:93` (stale comment); backend `routers/users.py:120-146`, `userinfo.py:124-128` | After native sign-in, POST `/me/sync` with the Logto access token (mobile analog of web `syncProfile`); request `profile`/`email` scopes in the Logto native config. |

### Batch 2 — Map rendering (Android map is entirely empty) → highest impact

| # | Sev | Problem | Root cause | Key files | Fix direction |
|---|-----|---------|------------|-----------|---------------|
| **#85** (reopened) | P0 | **Android: no fountains EVER.** iOS: none until you zoom in/out repeatedly; even then not all. | Multiple: (1) **zoom gate** `MIN_ZOOM=8` vs initial camera `DEFAULT_ZOOM=3.5` + `region` starts null → query disabled until zoom 8 is crossed (only auto-crossed when location is granted). (2) **Android-only total failure is native** (no JS platform branch in the map) — leading theory: the post-fetch `data` prop never reaches the native `GeoJSONSource` under Fabric. (3) **Confirmed glyph-404:** `cluster-count`/`pins-pill` omit `text-font` → MapLibre requests `Open Sans`/`Arial Unicode` which the basemap CDN 404s (only `Noto Sans Regular` served) → labels never draw. (4) The #85 "keep last non-empty FC" guard was never implemented. | `mobile/components/map/FountainMap.tsx`, `mobile/lib/map/constants.ts:5,10`, `mobile/app/(tabs)/index.tsx` (bbox query + `featureCollection`) | Order: fix glyph `text-font` → `["Noto Sans Regular"]`; wire `onImageMissing`/`onDidFailLoadingMap` + log `featureCollection.features.length`; **run Android Logcat** to confirm/deny the native data-propagation theory and fix it; revisit the zoom gate so a populated viewport loads without manual zoom (incl. location-denied); add the last-non-empty guard. Biggest/riskiest — needs a physical Android device. |

### Batch 3 — Add-fountain flow (one coordinated effort; all in `index.tsx` + `FountainMap.tsx` + `lib/add-fountain/*`)

Do these together (1–2 PRs) to avoid merge conflicts. #97 is the blocker; the rest compound it.

| # | Sev | Problem | Root cause | Fix direction |
|---|-----|---------|------------|---------------|
| **#97** | P0 | **iOS user can't add a fountain at all.** | Placement hard-gated on `zoom >= PLACE_MIN_ZOOM(16)` (`placement.ts:73-79`), but the camera auto-zooms to 16 **only when a precise fix exists** (`index.tsx:245-254`). Location denied/approximate → stuck < 16 → taps silently rejected, **Next** never enables. | On add-entry without a precise fix, auto-zoom to placement zoom anyway (best location or viewport center); make rejection feedback visible + actionable; reconsider the hard `accuracy<=1000m` rule. |
| **#102** | P1 | After adding (Android), the new pin can't be tapped. | Success branch never clears the draft (`index.tsx:407-413`; reducer `state.ts:77-78`); the larger, **no-`onPress`** draft layer (`FountainMap.tsx:176-188`) sits on top of the real pin and absorbs the tap. | Call `resetAddDraft()` / clear `pin` on add success; optionally only render the draft layer in add mode. (Confirmed, tiny.) |
| **#101** | P1 | "No fountains in this area" badge shows while adding, over the Add button. | `MapOverlay` rendered with no add-mode guard (`index.tsx:433-438`, msgs `:844-850`); both anchor bottom. | Suppress the empty/capped/below-zoom banner while `addMode`. (Tiny.) |
| **#100** | P1 | "Use current location" doesn't recenter; placement target sits at geometric center, **hidden under the sheet**. | `onUseCurrentLocation` does no camera move (`index.tsx:346-359`); the only `flyTo` has no `padding`/`contentInset` (`FountainMap.tsx:64-71,90`); sheet covers ~62% (`styles.addPanel`). | Recenter on "Use current location"; apply a bottom `contentInset`/`padding` (≈ sheet height) so the target frames above the sheet. |
| **#98** | P2 | No starter pin dropped on add-entry. | `initialAddFountainState.pin=null` (`state.ts:25-33`); entry sets bound only, never `dropPin` (`index.tsx:183-197,245-254`). | On entry, drop a draft pin at the user's location (fallback: viewport center). |
| **#99** | P2 | Draft pin looks identical to real pins. | Draft layer reuses `icon-image:"pin-standard"` (`FountainMap.tsx:176-188`); no draft asset exists. | Add `pin-draft.png` (grayscale/distinct), register, point the draft layer at it. Document in `docs/style-guide.md`. |

### Batch 4 — Native map ornaments / overlays (shared: `FountainMap.tsx` ornaments + `index.tsx` overlay layout) → one PR

| # | Sev | Problem | Root cause | Fix direction |
|---|-----|---------|------------|---------------|
| **#104** | P2 | "+" FAB overlaps the attribution/info "ⓘ" on iOS. | Both anchored bottom-right; attribution defaults bottom-right both platforms (`FountainMap.tsx:74-78`), FAB at `index.tsx:312-325`; map screen isn't a SafeAreaView. | Move attribution to free bottom-left via `attributionPosition`; add safe-area insets to FAB/recenter. |
| **#105** | P2 | Compass hidden under the top filter chips. | Compass default top-right under the full-width chip bar (`index.tsx:290-292` `filterBar` `top:8,left:0,right:0`); no `compassPosition` set. **Caveat:** in `@maplibre/maplibre-react-native@11.3.4` the compass defaults to *disabled* under New Arch — confirm which build showed it before fixing. | Set `compassPosition` clear of the chips (or constrain the chip bar); confirm `compass` is enabled in the shipped build. |

---

## Out of scope for this device-test pass (track, don't bundle)

These are real open issues but in different codebases / lower urgency — keep them off the mobile bugfix PRs.

- **Web (mobile-viewport) bugs:** **#74** attribution overlaps the "Fountains in view" list (`web/components/map/FountainsInViewList.tsx`); **#53** empty-state pill wraps/breaks on narrow viewports (`web/components/map/MapStates.tsx`). P3.
- **Backend:** **#20** bbox endpoint returns 500 on a whole-globe envelope (PostGIS geography edge case). P3 — only triggers at extreme zoom-out; relevant to map robustness.
- **CI/chore:** **#95** track pnpm 11 audit hang workaround.
- **Enhancement backlog (not bugs):** **#93** mobile store automation, plus discovery/moderation/feature tickets (#65, #44, #43, #42, #41, #40, #39, #38, #19, #18, #13, #12, #11, #10, #48). Not part of this pass.

---

## Linear quick-reference (recommended order)

1. **#88** points token-gate (quick win)
2. **#103** Apple `/me/sync` + scopes
3. **#85** map rendering / Android-empty (needs Android device + Logcat)
4. **#97** iOS can't-add (add-flow blocker) →
5. **#102** clear draft on success →
6. **#101** hide badge in add →
7. **#100** recenter + keep target visible →
8. **#98** seed draft pin →
9. **#99** distinct draft pin (+ style-guide)
10. **#104** + / attribution overlap →
11. **#105** compass under chips

Issues 4–9 share `mobile/app/(tabs)/index.tsx` + `mobile/components/map/FountainMap.tsx` heavily — sequence
them on the same branch (or rebase each on the prior) to avoid conflicts. 10–11 share the ornament config —
one PR.

## Where the evidence lives
Each issue body has the full root-cause analysis with verified file:line, fix direction, and acceptance
criteria. Pull them with `gh issue view <N> --repo redducklabs/fountainrank`. Reopened context for #85/#88
is in their latest comments.

---

## Implementation status — per-issue reference (all merged via PR #106)

> ⚠️ This table is the per-issue *what-changed* reference. For the **live state** (what's merged, what's
> device-verified, and the #85 map blocker that supersedes the rest) see **CURRENT STATE — READ THIS FIRST**
> at the top of this file. Everything below shipped to `main` via PR #106 (squash, `Refs` — issues stay open).

| # | Status | What changed | Verify on device |
|---|--------|--------------|------------------|
| #88 | Code-complete | Auth gate broadened to the `GET /api/v1/me/*` subtree (boundary-safe) + `api.test.ts`. | Signed-in user sees real points on the map chip + Account. |
| #103 | Code-complete | `email`+`profile` Logto scopes; best-effort `POST /me/sync` after sign-in (new `lib/auth/sync`). | Apple sign-in shows the real name + initial, not an opaque id. |
| #85 | **BLOCKER — superseded** | Glyph `text-font: ["Noto Sans Bold"]` shipped, but the real cause is deeper: the native `GeoJSONSource` gets no data under the new architecture. | **See "🔴 THE BLOCKER" in CURRENT STATE at the top.** Candidate fix in flight: `newArchEnabled: false` (old-arch renderer). |
| #97 | Code-complete | Add-entry always flies to placement zoom and seeds a pin at user/viewport-center; below-zoom taps now say "zoom in". | Location-denied user can enter add mode, place, and Next enables. |
| #98 | Code-complete | Draft pin seeded on add-entry. | A pin appears immediately on entry. |
| #100 | Code-complete | "Use current location" recenters; flyTo bottom padding frames above the sheet (`ADD_SHEET_CAMERA_PADDING`). | Target frames above the sheet; **tune the padding constant** to the panel height. |
| #101 | Code-complete | Empty/capped/below-zoom banner suppressed while adding. | No banner over the Add button / panel while adding. |
| #102 | Code-complete | Draft layer renders only in add mode. | New pin is tappable right after adding. |
| #99 | Code-complete | Draft pin distinct (larger + translucent `icon-opacity`); documented in `docs/style-guide.md`. | Draft reads as distinct; owner may still prefer a dedicated grayscale `pin-draft.png`. |
| #104 | Code-complete | Attribution → bottom-left; FAB + locate lifted by the bottom safe-area inset. | "i" no longer under the +, controls clear the home indicator. |
| #105 | **Open (code set)** | `compassPosition` placed below the filter chips. | First confirm the compass is even enabled under the new arch; if so, confirm it's clear of the chips. |

Release-notes CI (`mobile-store-release.yml` PR-list notes + Play draft) is bundled on this branch as its
first commit per the owner's request.
