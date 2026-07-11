# Plan — Immediate visual feedback (spinner) on server-touching actions (web + mobile)

**Issue:** #212
**Spec source:** the issue body itself (detailed root cause + acceptance criteria). No new `docs/specs/` entry is warranted — this is a UX affordance change, not an architecture change; this plan is the implementable breakdown.
**Date:** 2026-07-11

---

## Problem

Actions that hit the server give no immediate visual feedback on either client. On a rating
submit the button only dims (`disabled:opacity-50` web / `opacity:0.5` mobile) and the UI
appears to hang for several seconds — through best-effort geolocation and the network
round-trip — before the water-celebration finally plays. There is no spinner. The same
"dim-only, no spinner" pattern repeats across nearly every server-touching surface on both
platforms.

## Goal

A reusable, documented **loading/spinner** primitive on each platform, applied so that
**tapping/clicking anything that hits the server or otherwise delays the UI produces
immediate (< ~100 ms perceived) visual feedback that persists until the action resolves**,
then hands off to the existing success (celebration/message) or error state. Buttons stay
disabled while pending; the state is accessible.

## Key mechanics discovered (drive the design)

- **Web pending is already immediate.** Every web contribution form runs its async work
  inside `useTransition`'s `start(async () => …)`; `pending` flips `true` **synchronously**
  when `start()` is called, *before* `await getCurrentPositionSafe()` (bounded 8 s). So a
  spinner rendered from the existing `pending` appears the instant the user clicks. The issue's
  own note ("the `pending` flag … is available but unused for a spinner") is exactly the fix.
  Scope of the claim: this is **only** about spinner timing — we drive the spinner from
  `pending` and change nothing else about the transition. (React 19 caveat, noted so no one
  over-relies on it: state updates issued *after* an `await` inside the async action are not
  automatically marked as transition updates; that is irrelevant here because the spinner keys
  off `pending`, not off any post-await state.)
- **Mobile pending is NOT immediate.** Forms are controlled: the owning screen
  (`mobile/app/fountains/[id].tsx`) passes `pending = <mutation>.isPending`. That flips
  `true` only **after** `await requestCurrentCoords()` inside `submit()`. So the
  rating/condition forms (the two that call geolocation before submitting) need a **local
  synchronous `submitting` state** set at the top of `submit()` so the spinner shows during
  geolocation too. Forms without geolocation (attribute/note/photo/report/add) get instant
  feedback from `isPending` alone.
- **Server-action `<form>` buttons** (Sign in / Sign out and the anonymous sign-in CTAs)
  have no `useTransition` — their pending is obtained with **`useFormStatus()`** from a child
  submit-button component rendered inside the `<form>`.
- **Celebration hand-off is independent.** Web `WaterCelebration` fires on a
  `CONTRIBUTION_EVENT`; mobile celebration on the mutation success. The spinner simply stops
  when `pending` clears — no coordination needed.

## Non-goals (deliberate, with rationale)

- **Do NOT make geolocation non-blocking / fire-and-forget.** The issue asks us to *consider*
  whether geolocation should gate the response. It must stay awaited: the coordinates feed the
  proximity guard (#3) that marks a rating **verified**; dropping the await would silently
  downgrade every rating to "unverified" — a product/data-semantics change out of scope here.
  The spinner now covers that wait, which resolves the "feels broken" complaint without
  changing behavior. (Both geolocation calls are already timeout-bounded, so the wait is
  finite.)
- **OS-handoff actions are out of scope:** `ShareButton` (web/mobile) and mobile
  Directions open the native share sheet / maps app — no server round-trip and they already
  give feedback (web Share flashes "Link copied!"). No spinner.
- **Search result rows** (web `HeaderSearch` result rows, mobile `SearchOverlay` `ResultRow`)
  recenter the map synchronously — no server wait on the row tap itself. The search **fetch**
  that populates them already shows loading feedback (web `HeaderSearch` `role="status"`
  "Searching…"; mobile `SearchOverlay` full-screen `LoadingState`), so the fetch surface named
  in the issue is already covered.
- **Deferred with a filed follow-up (see Follow-ups — filing them is a blocking task):**
  soft-navigation pending for the exact surfaces `web/components/HeaderSearch.tsx`
  `select()` → `router.push("/…")`, the leaderboard scope/category `<Link>`s in
  `web/components/leaderboard/LeaderboardControls.tsx`, and the `<Link>` list rows in
  `web/components/fountain/FountainListRow.tsx` / detail-open in
  `web/components/map/FountainsInViewList.tsx`. These are server-rendered soft navigations
  (`/leaderboard` is `force-dynamic`; detail pages fetch) with **no** per-control pending
  mechanism today; a correct affordance needs a route-pending pattern
  (`next/navigation` `useLinkStatus` / a `router` transition) that is its own task. Deferring
  them is allowed by AC #5 **only** because a concrete GitHub issue is filed before merge.
- The dead/unused `mobile/components/add-fountain/AddFountainForm.tsx` (not imported anywhere;
  the live flow is `MapAddPanel` in `mobile/app/(tabs)/index.tsx`) is **left untouched** — no
  point spinner-ing dead code. Its removal is a separate cleanup.

---

## Deliverables

### A. Web shared primitives (new)

1. **`web/components/ui/Spinner.tsx`** — a decorative, theme-agnostic spinner.
   - Inline `<svg>` with Tailwind `animate-spin` (Tailwind v4 ships this utility;
     `animate-spin` currently has **zero** uses in `web/` — this introduces it), `text-current`
     so it inherits the button's text color, size via a `className` prop (default `h-4 w-4`).
   - `aria-hidden="true"`, and **no `<title>`/accessible name of any kind** — it is
     **decorative**; the accessible "busy" signal comes from the button's `aria-busy` (below),
     matching the existing "animation must not be the only signal" house rule. (Adding a title
     would make SRs announce the decorative spinner on top of the button busy state.)
   - `motion-reduce:animate-none` (respect reduced motion; the SVG still renders statically).

2. **`web/components/ui/SpinnerButton.tsx`** — a `<button>` wrapper standardizing the pending
   affordance for the `useTransition`-driven controls.
   - Props: everything on a native button, plus `pending: boolean` and optional
     `pendingLabel?: string`.
   - Behavior: merges `inline-flex items-center justify-center gap-2` into the caller's
     `className` (all target buttons are single-line pills, so this is safe); sets
     `aria-busy={pending}`; forces `disabled` while pending (`disabled={disabled || pending}`)
     so the double-submit guard can never be forgotten; renders `<Spinner />` when pending,
     followed by `{pending && pendingLabel ? pendingLabel : children}`.
   - Callers keep their existing Tailwind classes (brand / gold / emerald / admin variants) —
     the wrapper only adds layout + spinner + a11y.

3. **`web/components/ui/FormSubmitButton.tsx`** — a submit button for server-action `<form>`s.
   - Client component using `useFormStatus()`; renders like `SpinnerButton` but drives
     `pending` from `status.pending`. Rendered as a child **inside** the `<form action={…}>`.

### B. Web application (edit existing)

Apply the spinner to every `useTransition`/phase/form-action server-touching control. Group:

| Surface (file) | Change |
|---|---|
| `fountain/RatingForm.tsx` (**primary AC**) | swap the `<button>` → `SpinnerButton pending={pending}`; spinner shows instantly on click. |
| `fountain/AttributeForm.tsx` | `SpinnerButton pending={pending}`. |
| `fountain/NoteForm.tsx` | `SpinnerButton pending={pending}`. |
| `fountain/ConditionForm.tsx` | both buttons ("it's working" + "Submit") → `SpinnerButton pending={pending}`. |
| `fountain/ReportContentDialog.tsx` | submit → `SpinnerButton pending={pending} pendingLabel="Submitting…"` (keep existing label swap semantics). |
| `fountain/PhotoUpload.tsx` | the trigger is a file `<input>` (no button); add a `<Spinner />` to the existing `role="status"` "Uploading…" line so the wait shows an icon; input stays `disabled={pending}`. |
| `fountain/PhotoGallery.tsx` **+ `fountain/PhotoCarousel.tsx`** | **bug fix + spinner:** `PhotoGallery` currently discards the transition pending (`const [, startDelete]`), so the delete button (which lives in the child `PhotoCarousel.tsx`) has no disabled/guard. Capture `pending` and the **deleting photo id** in `PhotoGallery`, extend the `PhotoCarousel` prop API to receive `deletingPhotoId` (or a `pending` + `deletingId`), and render the `<Spinner />` + `disabled` **only on the tapped photo's delete control** so unrelated photo actions aren't disabled/spinning. |
| `map/AddFountainPanel.tsx` | derive `pending = phase === "submitting"` **inside the panel** (the controller `map/useAddFountainMode.tsx` already passes `phase` in — no controller edit needed); the "Add fountain" gold button → `SpinnerButton pending` (also fixes its missing `disabled`). |
| `account/DisplayNameForm.tsx` | `SpinnerButton pending={pending} pendingLabel="Saving…"`. |
| `account/DeleteAccountButton.tsx` | `SpinnerButton pending={pending} pendingLabel="Deleting account…"`. |
| `admin/FountainAdminControls.tsx` | each action button → `SpinnerButton pending={pending}` (keep `disabled:opacity-60` class). |
| `admin/ReportedContentActions.tsx` | each action button → `SpinnerButton pending={pending}`. |
| `SignInButton.tsx`, `SignOutButton.tsx`, `map/AddFountainFab.tsx` (anon), `fountain/ContributeSection.tsx` (anon sign-in), `AddFountainPanel.tsx` (anon retry form) | replace the raw submit `<button>` with `FormSubmitButton` so the redirect-to-Logto wait shows a spinner. |

### C. Mobile shared primitive (edit existing) + local instant-feedback state

1. **`mobile/components/fountain/RatingContributionForm.tsx` → `SubmitButton`** (the de-facto
   shared button, imported by rating/photo/attribute/condition/note): add a `pending?: boolean`
   prop distinct from `disabled`. When `pending`, render a small
   `<ActivityIndicator size="small" color={colors.onBrand} />` in place of the label text (or
   left of it) and set `accessibilityState={{ disabled, busy: pending }}`. Keep it exported
   from the same module (existing shared-import site) — no file move, to avoid import churn on
   a host where mobile render can't be locally tested.
2. **Immediate feedback for geolocation-first forms:** in `RatingContributionForm.submit()`
   and `ConditionContributionForm.submit(status)`, add a local `submitting` state set `true`
   **before** `await requestCurrentCoords()` and cleared in a `finally`; pass
   `pending={pending || submitting}` to the button(s). (Setting state in an event handler is
   fine — the `react-hooks/set-state-in-effect` lint rule only forbids it in effects.) Two
   robustness requirements, mirroring the app's existing add-photo single-flight pattern
   (`singleFlight` in `mobile/lib/contributions/*` used from `mobile/app/fountains/[id].tsx`):
   - **Ref-backed single-flight guard:** an `inFlightRef` checked/set at the very top of
     `submit()` so a second tap *before the disabled render commits* is ignored (state alone
     re-disables only on the next render).
   - **Mounted guard:** guard the `finally` `setSubmitting(false)` with a mounted ref so a
     screen navigation away during the location/mutation path can't `setState` on an unmounted
     component. Prefer extracting the guard/mounted logic into a small pure helper in
     `mobile/lib/` so it is unit-testable (see Tests).
   - ConditionContributionForm has two submit buttons sharing one pending — track **which
     status** is in flight (`submittingStatus`) so only the tapped button spins.

### D. Mobile application (edit existing)

| Surface (file) | Change |
|---|---|
| `fountain/RatingContributionForm.tsx` (**primary AC**) | `SubmitButton pending`; local `submitting` for instant spinner during geolocation. |
| `fountain/PhotoUploadButton.tsx` | `SubmitButton pending` (keep "Uploading…" label swap). |
| `fountain/AttributeContributionForm.tsx` | `SubmitButton pending`. |
| `fountain/ConditionContributionForm.tsx` | `SubmitButton pending` on both buttons + per-status `submitting`. |
| `fountain/NoteContributionForm.tsx` | `SubmitButton pending`. |
| `fountain/ReportContentButton.tsx` | inline modal primary → `ActivityIndicator` when pending + `accessibilityState.busy` (keep "Submitting…"). |
| `app/(tabs)/account.tsx` | `PrimaryButton` (sign-in), `DestructiveButton` (delete) → `ActivityIndicator` + `busy`; `SecondaryButton` (sign-out) currently has **no** disabled/pending — add a local `signingOut` state, disable + spinner + `busy`. |
| `app/(tabs)/index.tsx` → `MapAddPanel` `PrimaryAction` ("Add fountain") | `ActivityIndicator` + `busy` (pending already available). |
| `account/DisplayNameForm.tsx` | inline save button → `ActivityIndicator` + `busy` (keep "Saving…"). |
| `app/fountains/[id].tsx` → `AdminControls`, `app/admin/reports.tsx` | inline action buttons → `ActivityIndicator` + `busy` while their combined `pending`. |
| `components/map/MapFilters.tsx` + `app/(tabs)/index.tsx` / `MapOverlay` (**named in the issue**) | A filter chip tap already flips its selected fill instantly, but the pins **refetch** it triggers has no feedback: `index.tsx` derives `viewState`'s `isLoading` from `pinsQuery.isLoading`, which (per its own comment) is `true` only on the *first* load — a filter-change **background refetch** (`pinsQuery.isFetching`) does not flash `MapOverlay`'s spinner. Add a **subtle, non-blocking "updating pins" indicator** (a small `ActivityIndicator` in a corner / near the filter bar) shown while `pinsQuery.isFetching && !isLoading`, so a filter tap that refetches shows the map is updating. It must **not** replace the initial full-screen `LoadingState`, and (because a map pan also refetches) it is intentionally a quiet corner indicator, not a modal overlay. Accessible via `accessibilityRole="progressbar"` / an `accessibilityLabel`. |

All mobile controls keep `disabled` while pending (double-submit guard) and gain
`accessibilityState={{ disabled, busy }}`.

### E. Accessibility contract (both platforms)

- **Web:** button carries `aria-busy={pending}` and stays `disabled` while pending; the
  spinner SVG is `aria-hidden`; existing `role="status" aria-live="polite"` result lines are
  unchanged (spinner complements them, never replaces the success/error text).
- **Mobile:** control carries `accessibilityState={{ disabled, busy }}`; existing
  `ContributionMessage` live-region announcement of the result is unchanged.

### F. Tests

- **Web (vitest + @testing-library/react, jsdom per-file):**
  - New `web/components/ui/Spinner.test.tsx` / `SpinnerButton.test.tsx`: renders spinner only
    when `pending`, sets `aria-busy`, forces `disabled` while pending, shows `pendingLabel`.
  - Extend `RatingForm.test.tsx`: on click, the button is immediately `aria-busy` + `disabled`
    and a spinner is present (before the mocked action resolves); after resolve, spinner gone
    and success `role="status"` shown.
  - Note: a subset of web render tests are **CI-only on this Windows host** (hoisted linker
    duplicates React → `Invalid hook call`); these run green in CI `workspace-js`. Verify there,
    not locally, and say so.
- **Mobile:** the vitest config collects **`.test.ts` only** (pure logic; zero render tests,
  no RTL) — spinner *rendering* can't be unit-tested. Two required mitigations for the primary
  mobile AC, since it is timing/state behavior, not visuals:
  1. **Extract the pending/single-flight/mounted-guard logic into a pure helper** in
     `mobile/lib/` (e.g. a small `submitGuard`/`useInFlight` reducer or the existing
     `singleFlight` composed with the mounted check) and cover it with a `lib/**.test.ts`:
     a second call while in-flight is ignored; `submitting` is `true` synchronously before the
     awaited coords resolve; it clears after resolve; a "cleared after unmount" call is a no-op.
  2. **Required (not optional) emulator verification** with concrete steps + expected
     observations, recorded in the PR description: (a) open a fountain, set stars, tap Submit →
     the `ActivityIndicator` appears **immediately** (before any location prompt/permission),
     button disabled, then the celebration plays and the spinner is gone; (b) repeat with
     location permission denied → spinner still shows during the (bounded) location attempt,
     then the rating still saves; (c) double-tap Submit fast → exactly one submission.
  Also verify `tsc --noEmit` + mobile ESLint (React-Compiler rules) + `expo-doctor` in CI.
  State honestly what was and wasn't rendered/observed.

### G. Style guide (`docs/style-guide.md`)

Add a **"Loading & spinners"** component section under *Components* documenting: the web
`Spinner` + `SpinnerButton` + `FormSubmitButton`, the mobile `ActivityIndicator`-based
`SubmitButton pending` pattern, the accessibility contract (`aria-busy` / `accessibilityState.busy`
+ disabled-while-pending), reduced-motion handling, and **when to use it** (any tap/click that
hits the server, requests geolocation, or otherwise delays the UI). Cross-reference the
existing "Contribution celebration" section (spinner precedes it; never the only success signal).

---

## Task breakdown (commit-sized, in order)

1. `feat(web): add Spinner + SpinnerButton + FormSubmitButton primitives` (+ their tests).
2. `feat(web): show spinner on rating submit` (primary AC) + extend RatingForm test.
3. `feat(web): apply spinner to remaining contribution/account/admin surfaces` (attribute,
   note, condition, report, photo-upload, photo-gallery delete fix, add-fountain, display-name,
   delete-account, admin ×2).
4. `feat(web): spinner on server-action sign-in/out buttons` (FormSubmitButton wiring).
5. `feat(mobile): ActivityIndicator + busy in shared SubmitButton` + rating/condition instant
   `submitting` state (primary AC) + the extracted pure guard helper & its `lib/**.test.ts`.
6. `feat(mobile): apply spinner to remaining surfaces` (photo/attribute/note/report/account/
   add-fountain/display-name/admin ×2).
7. `feat(mobile): non-blocking "updating pins" indicator for filter-change refetch`
   (`MapFilters`/`MapOverlay`, `isFetching && !isLoading`).
8. `docs(style-guide): document the loading/spinner pattern (web + mobile)`.
9. **File the deferred-surface follow-up issue(s)** (blocking — must exist before merge; see
   Follow-ups) and reference them in the PR body so AC #5 is satisfied by a durable artifact.

Each task: run the relevant local check (`./run.ps1 check -Web` / `-Mobile` — knowing the
CI-only caveats), commit. Run the **full** `./run.ps1 check` before opening the PR.

## Follow-ups

**Blocking for this PR (must be filed as GitHub issues before merge, referenced in the PR body):**

- Route-pending / soft-navigation affordance for the **named** deferred surfaces:
  `HeaderSearch.select()` → `router.push`, `LeaderboardControls` scope/category `<Link>`s, and
  `FountainListRow` / `FountainsInViewList` detail-open navigations. Needs a route-pending
  mechanism (`next/navigation` `useLinkStatus` or a `router` transition wrapper). This exists so
  the two named-but-deferred issue surfaces have a durable tracking artifact, per AC #5.

**Non-blocking cleanup (optional, separate PR):**

- Remove the dead `mobile/components/add-fountain/AddFountainForm.tsx` (not imported anywhere).

## Verification / definition of done

- AC #1/#2: web & mobile rating submit show a spinner immediately (before geolocation + network
  resolve) — verified by the web test and mobile emulator/CI.
- AC #3: spinner persists until resolve, then hands to celebration/success or error.
- AC #4: reusable spinner primitive on both platforms, documented in `docs/style-guide.md`.
- AC #5: applied to the listed surfaces; deferred ones have filed follow-ups.
- AC #6: `aria-busy`/`accessibilityState.busy` + disabled-while-pending everywhere touched.
- Full `./run.ps1 check` green (mind CI-only suites), PR CI green, Codex `VERDICT: APPROVED`,
  every PR comment addressed → squash-merge → deploy web.
