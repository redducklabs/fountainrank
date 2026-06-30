# UI refresh (unrated pins · ratings/detail redesign · mobile splash) — released handoff (2026-06-29)

**Source:** owner request on 2026-06-29 (three UI changes from device screenshots + a leaderboard ticket),
brainstormed → spec'd → planned → implemented → reviewed → merged → released in one session.

**Purpose:** self-contained state so this can be picked up in a fresh session without the originating
conversation. Everything below is grounded in shipped code/commits and real run IDs.

---

## 🟢 RESUME HERE — current state

> **✅ MERGED + RELEASED (2026-06-29).** PR **[#118](https://github.com/redducklabs/fountainrank/pull/118)**
> squash-merged to `main` → commit **`a7948f4`** `feat: UI refresh — unrated pins, graphical ratings/detail, mobile splash (#118)`.
>
> - **Web + backend → production:** `Deploy` run **28398958390 → success** (Build+push 3m1s, Deploy to DOKS 58s).
>   Verified live: `https://fountainrank.com/` **200**, `https://api.fountainrank.com/healthz` **200**, and the
>   **new `https://fountainrank.com/pins/pin-unrated.png` serves 200** (proof the deploy carries this work).
> - **Mobile → store test channels:** `Mobile Store Release` run **28398959874 → success** —
>   **Android** build + **Play internal** submit (22m59s, job 84145006339), **iOS** build + **TestFlight**/App
>   Store Connect submit (10m53s, job 84145006363).
>
> **⚠️ Released via `workflow_dispatch` on `main`, NOT a `vX.Y.Z` tag** (deviates from the v0.9.0 / v0.10.0
> tag-based flow). Consequences: no new git version tag exists for this release; `appVersionSource: remote` +
> `autoIncrement` mean **EAS bumped only the build number** — the store build shows the **existing marketing
> version (0.10.0) with a higher build number**, containing this PR's code. If you want a clean `v0.11.0`
> marker, push the tag (it would trigger a fresh rebuild — usually not worth it since the build already shipped).

### ➡️ Next steps (post-release)

1. **On-device visual check (the one thing not verified yet).** The local headless emulator/Metro is broken
   here (see *Environment notes*), so the mobile screens were NOT eyeballed before release. Install the new
   build from **Play internal** (Android, should be live now) and **TestFlight** (iOS, after Apple processing)
   and confirm on real hardware:
   - **Splash** shows the pin on white — no black border, no inner white box.
   - **Map**: a fountain with **no ratings** shows the muted slate-blue / greyed-crown pin (distinct from the
     royal-blue/gold rated pins and the broken pin); selecting it shows the halo without recoloring.
   - **Fountain detail (read-only)**: big hero score + a real 5-star row + vote count; each dimension shows
     stars **and** the number **and** a blue meter bar; "Not yet rated" state for unrated; the
     Features/Accessibility/Access rows render as chips (✓ present / ✕ no / muted low-confidence with
     "(N reports)" / amber "~" mixed with "latest: …").
2. **TestFlight "What to Test"** is not auto-set on non-Enterprise EAS — paste it from the run's job summary in
   App Store Connect if you want notes.
3. Decide on the **`v0.11.0` tag** question above (optional).

---

## 📋 Suggested priority backlog (open issues, 2026-06-29)

Suggested order by severity (abuse/blockers → UX polish → verify-and-close → features → infra). Re-order to taste. `★` = filed in this session.

**P1 — correctness / abuse / blockers**

- **★ #119** `bug,moderation` — admin hard-delete of a fountain must **reverse the contributors' points** (anti-gaming). Owner-flagged. Backend only, **no migration** (the `status='reversed'` value + `user_contribution_stats` counters already exist; `admin_delete_fountain` + a new `reverse_contributions()` in `contributions.py` is the fix). Full plan in the issue.
- **#97** `bug` — iOS: user **cannot add a fountain at all** (placement silently blocked below zoom 16 when location isn't precise/granted). Blocks a core action.
- **#102** `bug` — Android: freshly-added pin **can't be tapped** (an inert draft pin is left on top after a successful add).
- **#103** `bug` — Apple/SSO account shows an **opaque id instead of the user's name** (mobile never calls `/me/sync`). User-facing identity; also feeds leaderboard display names (#117).

**P2 — mobile add-fountain + map-chrome polish (one coherent batch)**

- **#100** `bug` — "Use current location" must recenter; placement target must stay above the bottom sheet.
- **#101** `bug` — hide the "No fountains in this area" empty-state badge while adding.
- **#104** `bug` — iOS: the "+" add button overlaps the MapLibre attribution control.
- **#105** `bug` — map compass hidden under the top filter chips.
- **#99** `enh` — draft/placement pin must be visually distinct from saved pins. (The new `pin-unrated` asset from #118 is a candidate base for a greyed draft variant.)
- **#98** `enh` — drop a starter draft pin at the user's location on entering add mode.
- **★ #120** `bug` — iOS app icon shows the pin on **black** (`icon.png` transparent → iOS flattens alpha). Asset-only sibling of the #118 splash fix; reuse `scripts/assets/gen_splash_icon.py` approach.

**P3 — verify-and-close (released, pending on-device confirmation)**

- **#65** `enh` — show a user's existing rating (released in v0.10.0). Confirm on device → close.
- **#85** `bug` — map pins flicker / clustering (resolved on emulator per memory `fountainrank-mobile-85-newarch-mandatory`). Confirm on device → close.

**P4 — features**

- **★ #117** `enh` — leaderboard (tap the on-map points display → rankings). Backend `GET /api/v1/leaderboard/contributors` already exists; needs the UI + a category-sort backend extension.
- **#43** filters (map/list) · **#19** place search/geocoding · **#18** dark mode.
- **#10–#13** `moderation` — moderation roadmap (user blocking, report-to-queue, moderation queue, bans). Admin-moderation MVP already shipped; these are the next phases.

**P5 — infra / triage**

- **#48** OSM PBF large-scale import · **#95** pnpm 11 audit hang workaround.
- **#38–#42, #44** — older rating/attribute/access-context/bathrooms umbrella issues; much is already implemented — triage and close or re-scope.

---

## What shipped — PR #118 (web + mobile, except splash = mobile-only)

1. **Mobile splash** — `mobile/assets/splash-icon.png` regenerated as the pin on **opaque white** (the old
   asset baked a white box on transparency → rendered black on the Android-12 masked splash). Generator:
   `scripts/assets/gen_splash_icon.py`. (`adaptive-icon.png` / `icon.png` were already clean and untouched.)
2. **Unrated pin** (web + mobile) — new `pin-unrated.png` (web `web/public/pins/`, mobile `mobile/assets/pins/`),
   a slate-blue duotone with a greyed crown (`scripts/assets/gen_unrated_pin.py`). `basePinIcon()` now branches
   **`broken → gold → unrated → standard`** (unrated = working fountain with `ranking_score == null`) in both
   `web/lib/map/pins.ts` and `mobile/lib/map/pins.ts`. Web registers `pin-unrated` in `PIN_ASSETS`
   (`web/lib/map/style.ts`) and excludes unrated from the selected-pin swap (`selectedSwapIcon` +
   `SELECTED_ICON_EXPR` in `web/lib/map/layers.ts`). Mobile registers it in `PIN_IMAGES`
   (`mobile/components/map/FountainMap.tsx`); mobile has no selected-pin layer.
3. **Read-only ratings + detail redesign** (web + mobile):
   - New read-only **`Stars`** component — `web/components/fountain/Stars.tsx` (inline SVG, 50/50 gradient half
     star) and `mobile/components/fountain/Stars.tsx` (fractional gold overlay; no new dep). Gold `#F2C200` /
     slate `#CBD5E1`, nearest-half rounding, decorative with a numeric a11y label.
   - **Hero block** + **per-dimension star/number/meter rows** in `web/components/fountain/FountainDetail.tsx`
     and `mobile/components/fountain/FountainDetail.tsx` (meter = royal `#0E4DA4`, width = score/5).
   - **Attribute chips** — `web/components/fountain/AttributeChips.tsx` + rewritten `AttributeList.tsx`
     (web & mobile). Tone-aware variants `positive / negative / neutral / mixed / muted`; **confidence wins**
     (low-confidence consensus or all-unknown → `muted`, never promoted to a confident chip; value text +
     `(N reports)` / `latest: …` hint preserved).
   - Pure, unit-tested helpers `starFills()` + `attributeChipVariant()` added to **both** `lib/map/format.ts`
     (duplicated per the existing web/mobile format.ts convention).
   - `docs/style-guide.md` updated (read-only Stars, dimension meter, hero block, attribute-chip variants).
4. **Leaderboard** — ticket only: issue **[#117](https://github.com/redducklabs/fountainrank/issues/117)**
   "(web + mobile) Leaderboard: tap the on-map points display to view rankings" (total points default + region
   scope + optional major-category sort; grounded in the existing `GET /api/v1/leaderboard/contributors`). Not
   implemented.

**Docs:** spec `docs/specs/2026-06-29-ui-refresh-pins-ratings-splash-design.md`,
plan `docs/plans/2026-06-29-ui-refresh-pins-ratings-splash.md`.

## Gate status — all green

- **CI on PR #118 + on `main`:** backend, `workspace-js` (runs the web component render tests), `mobile-doctor`,
  CodeQL, pip/pnpm-audit, trivy-fs all pass (Trivy + image-scan skip as normal for PRs).
- **Codex:** `VERDICT: APPROVED` on review-2 (`temp/codex-reviews/pr-118-review-2.md`, gitignored). One
  **[MAJOR]** in review-1 — low-confidence attribute chips were promoted to confident positive/negative styling
  — was fixed (the `muted` variant + tests) and the inline thread resolved. No open PR comments.
- **Local (this Windows host):** web lib **183** + mobile **224** vitest pass; both `tsc --noEmit` clean;
  Prettier clean; both generated PNGs visually confirmed. Web **component-render** tests run **CI-only** here
  (WSL pnpm store doesn't link React).

## Known follow-ups

- **iOS app icon on black** — now filed as **#120** (P2 above). `mobile/assets/icon.png` is a transparent pin;
  iOS flattens icon alpha to black. Same fix as the #118 splash (pin on opaque white).
- Optional `v0.11.0` version tag (see RESUME HERE).
- See the **Suggested priority backlog** above for the full open-issue worklist.

## Environment notes (cost real time — see memory)

- **Local headless mobile build/emulator is broken** for automated use: Metro won't start
  (`TypeError: _ws(...).WebSocketServer is not a constructor` — `ws` mis-resolves in the WSL-created pnpm
  store), and the splash additionally needs `expo prebuild`. SDK is at `D:\Android\Sdk`, JDK-17 at
  `C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot`, AVD `fountainrank` (android-35) — the emulator boots and
  the debug APK installs, but no JS bundle serves. **Don't reinstall** (shared WSL store). → mobile *visual*
  verification = device / owner's PowerShell setup. Full detail + the working local invocations (vitest/tsc via
  the `.pnpm` entry; `.bat`-wrapper for cmd/gradle) are in memory
  `fountainrank-windows-wsl-local-check-workarounds`.
- **Deploys are manual `workflow_dispatch`** here: `gh workflow run deploy.yml --ref main` (web+backend) and
  `gh workflow run mobile-store-release.yml --ref main -f platform=all` (mobile). Both also fire on a
  `v*.*.*` tag.
- Asset regeneration is reproducible: `python scripts/assets/gen_splash_icon.py` and
  `python scripts/assets/gen_unrated_pin.py` (Pillow).
