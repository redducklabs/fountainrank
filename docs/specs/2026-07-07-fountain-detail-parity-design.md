# Fountain Detail Parity (Web ↔ Mobile) — Design

**Status:** Draft (brainstormed 2026-07-07)
**Scope:** Bring the native mobile fountain-detail screen to parity with the web
fountain-detail overlay (Info / Details / Photos tabs), and add the single
top-of-Info hero photo that web is currently missing.

---

## 1. Problem

The web fountain detail already presents three tabs — **Info**, **Details**,
**Photos** — with content split across them (`web/components/fountain/FountainDetailTabs.tsx`,
`FountainDetail.tsx`, `ContributeSection.tsx`). The native mobile detail
(`mobile/app/fountains/[id].tsx`, `mobile/components/fountain/FountainDetail.tsx`)
instead stacks **everything on one scrolling page**: the full photo carousel at
the top, then rating, dimensions, attributes, community notes, and every
contribution form together, with a "More Details" button that only toggles the
attribute-entry form. The two clients therefore look and behave differently.

Two concrete gaps:

1. **Mobile has no tabs.** It should look nearly identical to web, with the same
   Info / Details / Photos tabs, rather than a single page plus a "More Details"
   toggle.
2. **Web's Info tab shows no photo.** Both clients should show a single photo
   (the newest, when one exists) at the top of the Info tab; the full set stays
   on the Photos tab. Mobile currently shows photos at the top (as a full
   carousel); web shows none until the Photos tab.

## 2. Goals

- The mobile detail screen uses the same **Info / Details / Photos** tab
  structure as web, with the same content-to-tab mapping.
- Both clients render a single **tappable hero photo** (newest photo) at the top
  of the Info tab that switches to the Photos tab on tap/click; the full photo
  set lives only on the Photos tab.
- Maximum reuse of existing components on both platforms; no new dependencies.

## 3. Non-Goals

- No backend/API changes. The photo list endpoint already returns photos ordered
  newest-first (`backend/app/routers/photos.py` `list_photos`, `created_at desc`),
  so `photos[0]` is the hero on both clients.
- No change to the contribution forms themselves, the rating/condition/note/photo
  flows, admin controls, or the reporting flow — only where they are grouped.
- No redesign of the tab visuals beyond what web already has; mobile mirrors it.
- No unrelated refactors.

## 4. Current State (reference)

**Web** (`FountainDetail.tsx` builds three `FountainDetailTabs` tab bodies):

| Tab (`id`) | Content | `ContributeSection variant` |
|---|---|---|
| Info (`primary`) | title, `StatusBlock`, average rating + `Stars`, per-dimension bars | `primary`: `RatingForm` + `PhotoUpload` |
| Details (`details`) | `AttributeList`, added-by context comment, `NotesList`, `adminControls`, Added/Last-rated dates, `ReportControl` (fountain) | `details`: `AttributeForm` + `ConditionForm` + `NoteForm` |
| Photos (`photos`) | `PhotoGallery` (full carousel) | `photos`: `PhotoUpload` |

`FountainDetailTabs` owns the active-tab `useState`; tab bodies are static
`ReactNode`s passed in. The Info tab has **no photo**.

**Mobile** (`FountainDetail.tsx`, single `View` in one `ScrollView`), top to
bottom: title + `StatusBlock` → **full `PhotoCarousel`** → rating hero →
dimensions → `AttributeList` → context comment → `NotesList` → `adminControls`
→ `contribution` (a `ContributePanel` containing `RatingContributionForm`,
`ConditionContributionForm`, `NoteContributionForm`, `PhotoUploadButton`, a
"More Details" `Pressable` that toggles `AttributeContributionForm`) → Added/
Last-rated → Directions/Share → "Report this fountain".

## 5. Target Design

### 5.1 Tab structure (both platforms)

Three tabs, `Info / Details / Photos`, with this mapping on **both** clients:

| Tab | Content | Contribute forms (auth-gated) |
|---|---|---|
| **Info** | **hero photo (newest, tappable → Photos)**, title, working status, average rating + dimension bars | Rate it, Add photo |
| **Details** | attributes list, added-by context comment, community notes, admin controls, Added/Last-rated dates, Report this fountain | Add-attributes, Condition report, Note |
| **Photos** | full photo carousel/gallery | Add photo |

The Photos tab label includes the count when > 0 (`Photos (N)`), matching web.

### 5.2 The hero photo + tab-switch wiring

- **Which photo:** `photos[0]` (newest). Rendered only when `photos.length > 0`.
- **Aspect / source:** reuse each platform's existing photo-URL resolution — do
  **not** use the raw `photo.url` on web (it is an API-relative path that would
  point the browser at the Next.js origin in split-origin deployments). Web
  `PhotoHero` resolves the URL with the **same helper web `PhotoCarousel` uses**
  (`resolveApiBaseUrl()`); mobile uses `resolvePhotoUrl(apiBaseUrl, photos[0].url)`,
  both at the carousel's 4:3 aspect.
- **Interaction:** the hero is a button/`Pressable` labeled to convey it opens
  all photos; activating it selects the Photos tab.
- **Wiring:** because tab bodies are built before the tabs component renders,
  `FountainDetailTabs` exposes its `setActive` through a small context
  (`FountainDetailTabsContext` on web, an equivalent on mobile). A new
  `PhotoHero` component consumes that context and calls `setActive("photos")`.
  This keeps the tabs component the single owner of active-tab state on both
  platforms and avoids threading callbacks through every tab body.
- **Placement:** the hero is the **topmost** element of the Info tab (above the
  title), matching the approved mockup and "top of the info tab".

### 5.3 Header / title placement

Web-exact: the fountain **title + working status render inside the Info tab
only**. The Details and Photos tabs show just their own content. On mobile the
native stack header stays the generic "Fountain". (No persistent cross-tab
header — matches the web screenshot.)

### 5.4 Per-platform changes

**Web** (small):
- Add `PhotoHero` (client component) at the top of the `primary` tab body in
  `FountainDetail.tsx`, shown when `photos.length > 0`.
- Add `FountainDetailTabsContext` to `FountainDetailTabs.tsx` exposing `setActive`;
  `PhotoHero` consumes it to switch to the Photos tab.
- No other web content moves.

**Mobile** (larger — adopt the tab structure):
- New `mobile/components/fountain/FountainDetailTabs.tsx`: a segmented control
  (three buttons) under the native header. **All three tab bodies stay mounted;
  only the inactive ones are visually hidden** (`display: "none"` via style,
  mirroring web's `hidden`), so in-progress form input, query state, and each
  tab's scroll position survive tab switches — never conditionally render only
  the active body. It owns the active-tab `useState` and exposes `setActive`
  through a context (`FountainDetailTabsContext`). Tab buttons use
  `accessibilityRole="button"` with `accessibilityState={{ selected }}` and clear
  labels — the app's existing segmented-choice pattern; RN `accessibilityRole="tab"`
  /`"tablist"` is deliberately **not** used (not established on the app's RN
  version / not portable here).
- New `mobile/components/fountain/PhotoHero.tsx`: newest-photo hero, tappable →
  Photos tab (via the tabs context). `accessibilityRole="button"`, label
  "See all N photos".
- Restructure `mobile/components/fountain/FountainDetail.tsx` into three tab
  bodies matching the table in §5.1, reusing all existing pieces (`StatusBlock`,
  `Stars`, dimension bars, `AttributeList`, `NotesList`, `PhotoCarousel`, and the
  contribution forms). Move the full `PhotoCarousel` into the Photos tab.
- **Split the single `contribution` prop into three.** Today `[id].tsx` builds
  one opaque `contribution` node (`ContributePanel` + every form) and passes it
  to `FountainDetail` as a single prop (`mobile/app/fountains/[id].tsx:492-571`,
  `mobile/components/fountain/FountainDetail.tsx:167`). That single-node boundary
  cannot feed three tabs, so replace it with **three separate nodes built in
  `[id].tsx` — `infoContribution`, `detailsContribution`, `photosContribution`**
  — each wrapped in its **own `ContributePanel`** (the auth gate), mirroring web's
  per-tab `ContributeSection`:
  - `infoContribution`: `RatingContributionForm` + `PhotoUploadButton`.
  - `detailsContribution`: `AttributeContributionForm` + `ConditionContributionForm` + `NoteContributionForm`.
  - `photosContribution`: `PhotoUploadButton`.

  The two `PhotoUploadButton` instances (Info + Photos) share the same
  `photoUploadMessage` state and `pickAndUploadPhoto` handler in `[id].tsx`
  (matching web, which renders `PhotoUpload` in both the `primary` and `photos`
  variants). A signed-out user sees each tab's own `ContributePanel` sign-in
  prompt, exactly like web's per-tab prompts. All existing mutations/handlers in
  `[id].tsx` are unchanged — only how the forms are grouped into the three nodes
  changes.
- **Retire the "More Details" toggle** in `[id].tsx`: the
  `AttributeContributionForm` now lives in `detailsContribution` (always
  available to signed-in users, like web). The `attributeTypesQuery` `enabled`
  gate changes from `... && showMoreDetails` to authenticated-only.
  **Tradeoff (intentional):** attribute types are then fetched eagerly on every
  signed-in detail view rather than on first expand; `GET /api/v1/attribute-types`
  is public and the payload is small, so this is acceptable. The
  `showMoreDetails` state and the toggle `Pressable` are removed.

### 5.5 Reused vs new components

- **Reused unchanged:** web `StatusBlock`, `Stars`, `AttributeList`, `NotesList`,
  `PhotoGallery`/`PhotoCarousel`, `ContributeSection`, `ReportControl`; mobile
  `StatusBlock`, `Stars`, `AttributeList`, `NotesList`, `PhotoCarousel`, and all
  contribution form components.
- **New:** `PhotoHero` (web + mobile), `FountainDetailTabs` (mobile only — web
  already has it), and the tabs context on both.

## 6. Testing

- **Web:** update `FountainDetail.test.tsx` for the hero on Info + the tab
  count/labels; add a test that activating the hero switches to the Photos panel;
  add a **zero-photo** case (no hero; "Photos" label without a count); keep
  `PhotoCarousel`/`PhotoGallery` tests. `format:check`, `lint`, `typecheck`,
  `vitest`, `build` via CI.
- **Mobile:** unit-test the new `FountainDetailTabs` (default is Info; switching
  shows the right body **while inactive bodies stay mounted — typed input in one
  tab survives switching away and back**) and `PhotoHero` (renders `photos[0]`;
  activating calls the context `setActive("photos")`). Add cases for: **zero
  photos / `photosQuery.data` undefined** (no hero, no crash); the **`Photos (N)`
  count label updating** after upload/delete; the **hero showing the new newest
  photo after `photos[0]` is deleted**; and the **unauthenticated** state showing
  each tab's own `ContributePanel` sign-in prompt. Keep existing detail/carousel
  tests. `tsc` + the render tests run in CI (hoisted-linker duplicate blocks them
  locally), plus a manual emulator pass (tabs switch, form input survives a
  switch, hero → Photos, upload still works).
- **Visual:** confirm on web (CI/preview) and the Android emulator that the three
  tabs render and the hero-to-Photos jump works.

## 7. Style Guide

Per the project UI rule, update `docs/style-guide.md` **in place**: extend the
existing fountain-detail **tabs** section (which already documents web
`FountainDetailTabs`) with the mobile segmented-control tab bar, and extend the
existing fountain-**photo/carousel** section with the new **photo hero** — rather
than adding disconnected component notes. Cover purpose, structure, states, a11y,
and an example for each new/changed component on both platforms.

## 8. Risks / Open Questions

- **Tab state preservation:** switching tabs must not remount/refetch queries
  (they live in `[id].tsx` above the tabs, so this holds) or drop in-progress form
  input. Both platforms keep **all** tab bodies mounted and hide the inactive ones
  (web `hidden`; mobile `display:"none"` — see §5.4), preserving form state and
  scroll position; a mobile test asserts typed input survives a tab switch (§6).
- **Accessibility:** mobile tab buttons use `accessibilityRole="button"` +
  `accessibilityState={{ selected }}` + clear labels (see §5.4 for why not
  `role="tab"`); the hero uses `accessibilityRole="button"` with a clear label
  ("See all N photos"). Web keeps its existing `tablist`/`tab` roles.
- **Scope / delivery:** one PR covering both web + mobile (one coherent parity
  feature; CI covers both workspaces). May be split into web-then-mobile PRs if
  review size warrants — decided at plan time.
