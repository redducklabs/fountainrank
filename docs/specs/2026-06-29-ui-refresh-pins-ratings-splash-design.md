# UI Refresh: Unrated Pins, Ratings/Detail Redesign, Mobile Splash — Design

- **Date:** 2026-06-29
- **Status:** Approved (brainstorm) → ready for implementation plan
- **Scope:** Web (Next.js) + Mobile (Expo/React Native). One item (splash) is mobile-only.
- **Related backend:** no schema changes required for items 1–3. Item 4 (leaderboard) is a **ticket only** and is tracked as a GitHub issue, not implemented here.

## Context

Owner feedback on the shipped UI:

1. The mobile splash logo appears inside a white box on a black rounded square — it should be **just the pin** on a clean background.
2. Fountains that have **not been rated** render identically to rated ones; unrated should be visually distinct (muted/grey-blue).
3. The read-only fountain detail view is flat and text-heavy; ratings should be **more graphical** — real stars *and* numbers — and the other detail sections should be more eye-catching without burying the basic facts.
4. The on-map points display should be **tappable → a leaderboard** (total points, geographical region, optional sort by major point-origination categories). Described only; not built now.

### How it works today (verified in code)

- **Pins** (both platforms) are MapLibre **symbol layers** driven by **raster PNG sprites**; the variant is chosen by `basePinIcon()`:
  - web: `web/lib/map/pins.ts`, assets in `web/public/pins/` (`pin-standard|gold|broken|selected`), registered in `web/lib/map/style.ts` (`PIN_ASSETS`).
  - mobile: `mobile/lib/map/pins.ts`, assets in `mobile/assets/pins/` (`pin-standard|gold|broken`), registered in `mobile/components/map/FountainMap.tsx` (`PIN_IMAGES`).
  - Current logic: `!is_working → pin-broken`; `ranking_score > GOLD_THRESHOLD (4) → pin-gold`; else `pin-standard`. **Unrated (`ranking_score == null`, `rating_count == 0`) falls through to `pin-standard`** — no distinct treatment.
  - Raster icons **cannot be tinted at runtime** (`icon-color` does not apply), so a new variant requires a new asset.
- **Read-only ratings** are plain text on both platforms via `lib/map/format.ts`:
  - `formatAverage()` → `"3.5"` or `"Not yet rated"`; shown as overall (`FountainDetail`).
  - `formatDimension(avg, votes)` → `"★ 4.0 (1)"` per dimension.
  - There is **no read-only stars component**. Interactive star inputs exist (web `web/components/fountain/StarGroup.tsx`; mobile `mobile/components/fountain/RatingContributionForm.tsx` + `mobile/components/add-fountain/RatingFields.tsx`) but duplicate their star styling and are not reusable for display.
- **Attribute sections** (`FEATURES` / `ACCESSIBILITY` / `ACCESS`) render as label→value text rows in `web/components/fountain/AttributeList.tsx` and `mobile/components/fountain/AttributeList.tsx`, with a **consensus tone** (normal / muted / mixed) reflecting confidence — this semantic must be preserved.
- **Points display**: web has `PointsBadge` (`web/components/map/MapStates.tsx`, rendered in `web/components/map/MapBrowser.tsx` for signed-in users), currently a static `div`. Mobile has **no** on-map points display.
- **Leaderboard backend already exists**: `GET /api/v1/leaderboard/contributors` (`backend/app/routers/leaderboard.py`) — global by `UserContributionStats.total_points` (default) or local by `near_lat`/`near_lng`/`radius_m`. Response `ContributorRow` = `display_name`, `points`, and (global only) `fountains_added`, `ratings_count`. Point event types and per-user stat counters are defined in `backend/app/contributions.py`.

### Brand palette (from `docs/style-guide.md`)

Navy `#0A357E` · Royal blue `#0E4DA4` · Crown gold `#F2C200` · Water cyan `#5FC5F0` · neutrals via slate. Selected stars today use gold `#F2C200`; empty uses slate (`#E2E8F0` mobile / `slate-300` web).

## Goals

- Unrated fountains are immediately distinguishable on the map (muted slate-blue body, greyed crown) on web + mobile.
- The read-only detail view presents ratings graphically (hero score + star rows + meter bars) and renders attribute sections as chips, while keeping all current facts and the consensus-tone semantics.
- The mobile splash shows the pin only, on a solid white background.
- A leaderboard behavior ticket is filed (GitHub issue), grounded in the existing backend.

## Non-goals

- No backend schema/endpoint changes for items 1–3.
- No leaderboard implementation (UI, routing, or backend extension) — ticket only.
- No change to the rating *submission* flows, ranking algorithm, or `GOLD_THRESHOLD`.
- No dark-mode work (tracked separately, issue #18).

---

## Item 1 — Mobile splash: pin only, white background (mobile only)

**Root cause:** `mobile/app.config.ts` already sets the splash `backgroundColor: "#ffffff"` and `adaptiveIcon.backgroundColor: "#ffffff"`. The black surround / white box is **baked into the image assets**, not the config.

**Design:**
- Replace the source assets with a **transparent, pin-only** mark so the pin floats on the configured white background:
  - `mobile/assets/splash-icon.png` (splash), `mobile/assets/adaptive-icon.png` (Android adaptive foreground), and `mobile/assets/icon.png` (iOS/app icon) **iff** it carries the same surround.
- Source art: reuse the existing pin-only mark from web assets (`web/public/icon.png` / `filled-pin-logo-only`), exported at the resolutions Expo expects (icon 1024×1024; adaptive foreground 1024×1024 with safe-zone padding so the Android circular/rounded mask doesn't clip the pin; splash sized for `imageWidth: 200`, `resizeMode: "contain"`).
- Keep `backgroundColor: "#ffffff"` for both splash and adaptive icon.
- **Verification step (in plan):** open each existing PNG and confirm whether the surround is in the asset before swapping; only replace assets that actually carry it.

**Acceptance:** on a fresh install (Android emulator + iOS sim), the splash shows the pin on white with no black border and no inner white box; the launcher/adaptive icon shows the pin with no clipping.

---

## Item 2 — Unrated pin variant (web + mobile)

**Definition of "unrated":** a working fountain with no ratings — `ranking_score == null` (equivalently `rating_count == 0`). `is_working == false` still takes precedence (broken).

**Asset:** new `pin-unrated.png` for each platform (`web/public/pins/pin-unrated.png`, `mobile/assets/pins/pin-unrated.png`), produced by recoloring the existing pin art: **desaturated slate-blue body, crown muted to grey**, so unrated pins recede behind standard/gold. (Derive from the existing pin source/PNG; document the generation step in the plan. Match the existing sprite dimensions and anchor.)

**Logic (`basePinIcon` on both platforms), new order:**
1. `!is_working` (or mobile `current_status === "not_working"`) → `pin-broken`
2. `ranking_score != null && ranking_score > GOLD_THRESHOLD` → `pin-gold`
3. `ranking_score == null` → `pin-unrated`  ← **new**
4. else → `pin-standard`

**Registration:** add `pin-unrated` to `PIN_ASSETS` (web `web/lib/map/style.ts`) and `PIN_IMAGES` (mobile `mobile/components/map/FountainMap.tsx`), and to the icon-image union types in `pins.ts`.

**Selected state:** the selected-pin swap currently re-renders working non-gold pins as `pin-selected`. Unrated selected pins should keep reading as unrated; simplest correct behavior is to leave unrated unchanged on selection (only the selected halo applies). The plan will adjust `selectedSwapIcon()` / `SELECTED_ICON_EXPR` so unrated is **not** swapped to `pin-selected`.

**Rating pill:** unchanged — unrated fountains have `pill == null` and already render no pill.

**Acceptance:** an unrated working fountain shows the muted slate-blue/grey-crown pin on both platforms; rated (standard/gold) and broken pins are unchanged; selecting an unrated pin shows the halo without recoloring to the rated "selected" art.

---

## Item 3 — Read-only ratings + detail redesign (web + mobile)

### 3a. Read-only `Stars` display component (new, per platform)

A small, isolated, read-only component — **not** the interactive inputs.

- **Input:** `value: number` (0–5), optional `size`, optional `count`/label for a11y.
- **Rendering:** 5 star glyphs; filled gold `#F2C200`, empty slate; **half-star support** (e.g. 3.5 → 3½). Web: SVG (or clipped overlay) for a crisp half; mobile: half via an overlaid clipped star or a half-glyph. Stars are decorative (`aria-hidden` / RN `accessibilityElementsHidden`); the accessible name is the numeric value (e.g. "Rated 3.5 out of 5").
- **Location:** web `web/components/fountain/Stars.tsx`; mobile `mobile/components/fountain/Stars.tsx`.
- Reusable wherever a static rating is shown (hero + per-dimension here; map callouts later).

### 3b. Hero rating block

At the top of the detail (near the title and the existing `StatusBlock`):
- Large overall score (keep `formatAverage()` for the number), a `Stars` row for that score, and the rating count (`formatVotes()`).
- When `average_rating == null`: show a friendly "Not yet rated" state with an empty star row (no fabricated number) — pairs naturally with the new unrated pin.

### 3c. Per-dimension rows

For each `DimensionSummary` (Clarity / Taste / Pressure / Appearance):
- Row = dimension name · `Stars` (the dimension average) · numeric value · vote count · a **slim meter bar**.
- **Meter:** royal-blue `#0E4DA4` fill on a slate track (`slate-100` web / `colors.border` mobile), width = `average/5`. Decorative (`aria-hidden`); the numeric value carries the meaning.
- Unrated dimension (`average == null`): muted "Not yet rated", empty stars, empty meter.

### 3d. Attribute sections as chips

Convert the label→value text rows in `AttributeList` (both platforms) to **chips/pills**, grouped under the existing `FEATURES` / `ACCESSIBILITY` / `ACCESS` headers:
- **Positive/present** → brand-tinted chip (navy text on light-blue fill) with a small leading icon.
- **Negative ("No") / unknown** → muted/outline chip.
- **Mixed / low-confidence** → preserve the existing `mixed` tone (amber `#92400E`) and the observation-count hint; keep the muted tone for low-confidence consensus.
- Reuse the existing grouping (`groupAttributes` / `formatCategory`) and `attributeDisplay()` tone/hint logic; only the **presentation** changes (text row → chip), not the semantics.
- Icons: a small per-attribute/per-category icon set. Web may use inline SVG or an existing icon dependency if present; mobile uses its existing icon approach (e.g. `@expo/vector-icons` if already a dependency) or simple glyphs — **no new dependency** unless one already exists in that workspace.

### 3e. Style guide

Document the new components in `docs/style-guide.md` (mandatory): read-only `Stars` (filled/empty/half, sizes, a11y), the dimension **meter bar**, the hero rating block, and the attribute **chip** variants (present / negative / unknown / mixed tones).

**Acceptance:** the detail view (web modal + full page; mobile detail screen) shows the hero block, per-dimension star+meter rows with numbers preserved, and attribute chips; the "not yet rated" and mixed/low-confidence states render correctly; existing tests for `format.ts` outputs still pass (numbers unchanged) and new component tests cover half-star and tone mapping.

---

## Item 4 — Leaderboard ticket (GitHub issue only)

> **Superseded (2026-06-29):** Item 4 is now designed and implemented — see
> `docs/specs/2026-06-29-leaderboard-design.md` (#117). The endpoint response shape described
> below (a bare list of `ContributorRow` with `fountains_added`/`ratings_count`) changed there to
> `LeaderboardOut { rows, you }`; treat the leaderboard spec as authoritative for the contract.

Filed as a GitHub issue (label `enhancement`). Summary of the behavior it must capture:

- **Entry point (web + mobile):** tap the on-map points display → navigate to a Leaderboard screen.
  - Web: make `PointsBadge` (`web/components/map/MapStates.tsx`) a link/button → `/leaderboard` (new `web/app/leaderboard/page.tsx`; `PointsBadge` is top-level so the map stays mounted on soft nav).
  - Mobile: add (or locate) an on-map points display on the Map screen and make it tappable → a leaderboard route.
- **Ranking model:**
  1. **Total points** — the default and always-on sort.
  2. **Geographical region** — scope the ranking to a region (reuse the existing local in-area mode: `near_lat`/`near_lng`/`radius_m`, e.g. current viewport / nearby radius).
  3. **Optional sort by a major point-origination category** — *major categories only*: Fountains added, Ratings, Verifications (working confirmations), Conditions reported, Attributes observed, Notes. **Excludes** minor bonus events (`first_fountain_bonus`, `first_in_area_bonus`, `first_rating_bonus`). **Default = no category sort** (total points only).
- **Backend note:** `/api/v1/leaderboard/contributors` + `UserContributionStats` counters already exist. Sorting by category *points* needs a backend extension — a per-`(user_id, event_type)` sum over `contribution_events` (the log carries `points` + `event_type`).
- **Out of scope for the ticket:** visual design, badges, and time-window variants ("most helpful this month").

---

## Delivery plan

Four deliverables. Each PR follows branch → CI green → Codex `VERDICT: APPROVED` → squash-merge.

- **Issue (now):** leaderboard ticket (Item 4).
- **PR A:** mobile splash/icon assets (Item 1) — mobile only.
- **PR B:** unrated pin variant (Item 2) — web + mobile.
- **PR C:** read-only ratings + attribute-chips redesign (Item 3) — web + mobile, incl. style-guide updates.

(Order B/C/A is flexible; A is independent and smallest.)

## Testing & CI

- Web: `lint` + `test` + `build`; new tests for `Stars` (half-star, a11y label) and attribute-chip tone mapping; existing `format.ts` tests unchanged.
- Mobile: type-check + lint; component test(s) for `Stars` and the dimension row; manual on-device/emulator verification for splash and pins (per the project's "verify on device" norm — see related memory).
- Asset generation (pin-unrated, splash/icon) verified visually on web (browser) and mobile (emulator/sim).
- Backend: no changes expected for items 1–3; run backend lint/tests if any shared schema is touched (none planned).

## Open questions / risks

- **Asset generation pipeline:** confirm a usable source for the pin art (existing PNG vs. a vector). If only PNGs exist, generate `pin-unrated` by programmatic desaturation + slate-blue/grey recolor and review visually. Same for regenerating transparent splash/icon assets.
- **Mobile icon library:** use only an icon set already present in the mobile workspace for attribute chips; otherwise fall back to glyphs (no new dependency).
- **Half-star fidelity** differs web (SVG) vs mobile (overlay/glyph); both must read clearly at small sizes.
