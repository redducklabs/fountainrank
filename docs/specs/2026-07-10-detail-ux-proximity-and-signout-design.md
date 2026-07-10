# Fountain Detail UX, Rating Proximity Guard, and Mobile Sign-Out — Design

**Status:** Draft (pending Codex review)
**Date:** 2026-07-10
**Supersedes/extends:** `2026-06-22-contribution-data-and-gamification-design.md` (§10 proximity,
§11 privacy), `2026-07-07-fountain-detail-parity-design.md` (detail tabs)

---

## 1. Summary

Six reported issues, resolved on one branch (`feat/detail-ux-proximity-and-signout`) with **one
commit per issue** so each is independently reviewable inside a single PR.

| # | Issue | Surface |
|---|---|---|
| 1 | "Add photo" discards an unsaved rating | web + mobile |
| 2 | The rank celebration animation needs to be better | web + mobile |
| 3 | Ratings must be submitted within 50 mi of the user | backend + web + mobile |
| 4 | Cannot scroll the detail screen while the keyboard is open | mobile |
| 5 | The celebration should use the FountainRank pin logo | web + mobile |
| 6 | Sign-out does not clear the session; sign-in silently re-logs-in the last Google user | mobile |

Issues 2 and 5 are the same component and ship as one work item.

## 2. Goals

- No contribution the user has expressed intent to make is silently discarded.
- The reward moment is on-brand (the pin logo) and identical in substance on both clients.
- The detail screen is usable with the soft keyboard open.
- Signing out actually ends the session, on every client.
- Ratings carry a proximity signal, and obviously-remote ratings are refused.

## 3. Non-goals

- **This is not an anti-abuse control.** See §8.
- Gating condition reports, photos, notes, or attribute observations by distance (#3 is
  ratings-only). Condition reports gain a *server-computed* `is_proximate` value but nothing is ever
  rejected on account of it.
- Fixing repeat-rating point farming (#204).
- Adding any animation dependency (Reanimated, Lottie, framer-motion, confetti).

---

## 4. Issue designs

### 4.1 Add photo submits the unsaved rating (#1)

**Problem.** The draft stars live in local state — `edits` in
`mobile/components/fountain/RatingContributionForm.tsx:35` and
`web/components/fountain/RatingForm.tsx:21`. The photo components
(`mobile/components/fountain/PhotoUploadButton.tsx:15`, `web/components/fountain/PhotoUpload.tsx:9`)
take no rating props and share no state.

The lossy path is worse than a same-tab omission: `web/components/fountain/ContributeSection.tsx:49-51`
renders `PhotoUpload` **alone** on the Photos tab, and mobile's `photosContribution`
(`mobile/app/fountains/[id].tsx:515-522`) does the same. Tapping stars on **Info**, switching to
**Photos**, and tapping **Add photo** therefore crosses a component boundary where no shared parent
exists at all.

**Design.** Lift the draft **above the tabs**, not merely into `ContributeSection`:

- Shared pure helper `isRatingDraftDirty(dimensions, edits)` in `packages/contributions` (alongside
  the existing pure points logic), unit-tested there.
- **Mobile:** the draft moves to `FountainDetailScreen` (`mobile/app/fountains/[id].tsx`).
  `RatingContributionForm` becomes controlled (`stars`, `onStarPress` props).
- **Web:** a `RatingDraftProvider` context in `web/components/fountain/FountainDetail.tsx` wraps the
  tabs, mirroring the existing `useFountainDetailTabs()` context pattern in
  `web/components/fountain/FountainDetailTabs.tsx`. `RatingForm` and `PhotoUpload` both consume it.

**Ordering.** On "Add photo", if the draft is dirty: **submit the rating first, await success, then
upload the photo.** Rationale — the rating write is a cheap idempotent upsert
(`ON CONFLICT DO UPDATE`, `backend/app/routers/fountains.py:112`), so doing it first guarantees a
photo failure can never lose the rating, which is the entire point of the issue.

**Failure handling.** If the rating submit fails (including a §4.5 `403 outside_rating_radius`), the
upload is aborted, the draft and the picked asset are retained, and the rating error is surfaced. The
user can correct and retry without re-picking the photo or re-tapping stars.

### 4.2 + 4.3 Celebration redesign (#2, #5)

**Problem.** `mobile/components/feedback/WaterCelebration.tsx` draws its fountain-drop glyph from
bare `View`s — `iconCircle` (:162-172), `dropStem` (:173-178), `dropBowl` (:179-186). This directly
violates `docs/style-guide.md:127-139`: *"do NOT recreate or redraw the logos in code — use these
raster assets."* The real asset already exists at `mobile/assets/logo-pin.png`.

The web counterpart (`web/components/map/MapStates.tsx:103-118`) renders five CSS droplets and **no
points number at all**, so the two clients already disagree.

**Design.**

- **Mobile:** replace the three drawn `View`s with `mobile/assets/logo-pin.png` rendered inside the
  existing `Animated.View`. Stay on React Native's built-in `Animated` — **no new dependency**, both
  because neither client has an animation library today and because CI's `minimumReleaseAge` gate
  blocks pnpm deps younger than 24h.
- **Motion:** *pop-and-settle* — the pin scales `0.7 → 1.08 → 0.96` and holds, matching the existing
  1200ms curve. Chosen over drop-in/rise-and-fade as the lowest-risk option on the New Architecture
  (it reuses the interpolation shape already proven in this component).
- **Backdrop:** soften from `rgba(10, 53, 126, 0.18)` so it reads as an overlay, not a page change.
- **Droplets:** retained but visually subordinate to the pin.
- **Reduce-motion:** the existing `AccessibilityInfo.isReduceMotionEnabled()` branch is preserved.
- **Web parity:** `WaterCelebration` in `MapStates.tsx` gains a `points?: number` prop and renders
  `/icon.png` (the pin-only mark). Keyframes in `web/app/globals.css:82-129` updated to match.

**Event-shape change (web).** The celebration is driven by a bare
`window.dispatchEvent(new Event("fountainrank:contribution"))` from six dispatchers
(`RatingForm.tsx:41`, `AttributeForm.tsx:55`, `ConditionForm.tsx:54`, `NoteForm.tsx:26`,
`PhotoUpload.tsx:25`, `useAddFountainMode.tsx:182`). To carry the points number these become a
`CustomEvent` with `detail: { points }`. The three listeners
(`ContributionStatusOverlay.tsx:12`, `MapBrowser.tsx:462`, `HeaderPoints.tsx:17`) are updated;
listeners must tolerate a missing/absent `detail.points` and render no number in that case.

`docs/style-guide.md` is updated to document the redesigned celebration element (mandatory per
`CLAUDE.md` → *Style Guide*).

### 4.4 Keyboard scrolling on the detail screen (#4)

**Problem.** `mobile/components/fountain/FountainDetailTabs.tsx:74-88` wraps each tab body in a plain
`ScrollView` that sets none of `keyboardShouldPersistTaps`, `keyboardDismissMode`, or
`automaticallyAdjustKeyboardInsets`. There is no `KeyboardAvoidingView` anywhere on the screen, and
no `softwareKeyboardLayoutMode` in `mobile/app.config.ts`. With the keyboard open over the "Your
note" input (`NoteContributionForm.tsx:47-56`), the content below is unreachable.

**Design.** Reuse the pattern proven by `da197f0` ("fix: allow report modal keyboard scrolling",
`ReportContentButton.tsx`):

- Wrap the **`panels` container** — *not* each panel — in a `KeyboardAvoidingView`
  (`behavior={Platform.OS === "ios" ? "padding" : "height"}`). Wrapping individual panels would
  interact badly with the `height: 0` inactive-panel collapse, which is a deliberate New-Architecture
  workaround documented at `FountainDetailTabs.tsx:57-63` (`display: "none"` did not collapse a
  `flex: 1` ScrollView; an absolute overlay swallowed touches).
- Add `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode` to the existing per-tab
  `ScrollView`s. `keyboardShouldPersistTaps` also fixes a latent second bug: today, tapping a submit
  button while the keyboard is open requires two taps (the first only dismisses the keyboard).
- Do **not** add a fourth `ScrollView`, and do not add `react-native-keyboard-controller`.

**Verification.** Emulator-only. Mobile has no RN render harness (unit tests are Vitest over pure
modules), so this change is verified on the Android emulator and cannot be covered by CI.

### 4.5 Rating proximity guard (#3)

**Today.** The user's GPS is never sent to the backend. `useForegroundLocation` exists only on the
map screen. `submit_ratings` (`backend/app/routers/fountains.py:870`) accepts only
`{ratings: [{rating_type_id, stars}]}`. `is_proximate` exists solely on `condition_reports` and is
hardcoded `false` by both clients (`mobile/lib/contributions/payloads.ts:60`,
`web/app/actions/contribute.ts:146`). The gamification spec (§10, §11) has always described
server-side proximity verification as future work.

**Backend.**

- `backend/app/config.py`: `rating_max_distance_m: float = 80_467.0` (50 statute miles). A setting,
  not a literal, so it can be tightened without a code change — mirroring the existing
  `nearby_max_radius_m` / `first_in_area_radius_m` guardrails.
- `backend/app/schemas.py`: `RateRequest` gains optional `latitude: float | None` (−90..90) and
  `longitude: float | None` (−180..180), validated **both-or-neither**.
- Migration `0023_ratings_is_proximate.py` (chains onto `0022_account_deletion`): adds
  `ratings.is_proximate bool NOT NULL DEFAULT false`, mirroring the existing `condition_reports`
  column. `_upsert_ratings` (`fountains.py:112`) sets it in the INSERT **and** in the
  `ON CONFLICT DO UPDATE` set clause, so re-rating refreshes the flag.
- `submit_ratings`:
  - coords present and within radius (`ST_DWithin(fountain.location, point_geography(lat, lng),
    settings.rating_max_distance_m)`) → accept, `is_proximate = True`.
  - coords present and outside radius → **`403 Forbidden`**, `detail: "outside_rating_radius"`.
  - coords absent → accept, `is_proximate = False`.

**Why 403.** `422` already means "validation" to the clients (`mapContributionError`,
`mobile/lib/contributions/state.ts:39`); the request here is well-formed and the server is refusing
it as policy. `409` is ruled out because `state.ts:40` documents an invariant that these writes have
exactly one 409 shape (the display-name gate). `403` is currently unused on this path and falls
through to a misleading "Couldn't save." — so a new `too_far` `ContributionError` variant is added
with copy naming the 50-mile rule.

**Stored value semantics.** Because out-of-radius ratings are *rejected*, a persisted
`is_proximate = false` can only ever mean "the client supplied no location". It never means "far
away". This is documented on the column.

**Clients.**

- **Mobile:** do **not** reuse `useForegroundLocation` — it requests permission on mount
  (`useForegroundLocation.ts:66-82`), which would fire a location prompt for every visitor who merely
  *opens* a fountain, including read-only ones.
  `mobile/lib/location.ts` cannot be called directly either: it is deliberately free of any
  `expo-location` import so it stays loadable under the node-based Vitest, and the expo adapters
  (`requestPermission`, `getCurrentPosition`) are private to the hook (`useForegroundLocation.ts:35-49`).
  Extract those adapters into a new `mobile/lib/location-request.ts` exporting
  `requestCurrentCoords(): Promise<Coords | null>`. Both `useForegroundLocation` and the detail
  screen's submit path consume it; `lib/location.ts` keeps its pure, node-loadable character.
- **Web:** `navigator.geolocation.getCurrentPosition` at submit time (a user gesture, which some
  browsers require), with a short timeout.
- **Both:** never block on the permission prompt. Denial, timeout, or failure → submit with no
  coordinates. The submit path must always settle.

**Condition reports (`is_proximate`, ungated).** Both clients currently hardcode
`is_proximate: false`. Rather than have the client assert proximity — which would require inventing a
client-side distance threshold, and would remain unverifiable — the **server computes it** from the
same optional coordinates:

- `backend/app/config.py` gains `proximate_radius_m: float = 100.0`. Rationale: consumer GPS is
  accurate to roughly 5–20 m in the open and considerably worse in urban canyons, so 100 m is a
  conservative "you are standing at this fountain" bubble. It is a setting, not a literal.
- `ConditionRequest` gains the same optional `latitude`/`longitude`. The server sets
  `is_proximate = ST_DWithin(fountain.location, point, proximate_radius_m)` when coordinates are
  supplied, and `false` when they are not.
- **Behavior change to document:** the existing client-supplied `ConditionRequest.is_proximate` field
  is now **ignored** by the server and derived instead. The field is retained in the schema for
  compatibility and marked deprecated. This strictly strengthens it — the flag stops being
  client-asserted and becomes server-computed.
- Condition reports remain **ungated** by distance. Nothing is rejected; only the flag is populated.
  This is a strict improvement over the hardcoded `false` and finally delivers the trust signal the
  gamification design specified (§10, §11).

**Generated artifacts.** `packages/api-client/openapi.json` and `packages/api-client/src/schema.d.ts`
are regenerated and committed (repo rule for any backend schema change).

### 4.6 Mobile sign-out (#6)

**Web is correct and is not changed.** `@logto/next`'s `signOut` revokes tokens, destroys the
encrypted `logto_<appId>` cookie, and `redirect()`s the browser to Logto's `end_session` endpoint
(verified in `node_modules/@logto/next/lib/server-actions/index.js:30-34`).

**Mobile has two independent defects**, both verified in the installed SDK:

1. `node_modules/@logto/rn/lib/client.js:34-36` — the browser `navigate` adapter's sign-out branch is
   a literal `case 'sign-out': { break; }` **no-op**. The end-session URL that `@logto/client` builds
   is never opened, so Logto's session cookie survives sign-out.
2. `node_modules/@logto/rn/lib/client.js:19` — `super({ prompt: [Prompt.Consent], ...config })`. The
   runtime default is `consent` only. The SDK's own `client.d.ts:10` *claims* the default is
   `[Prompt.Login, Prompt.Consent]`; **the typings are wrong**. Nothing forces re-authentication, so
   a surviving Logto session is silently reused.

Amplifier: `preferEphemeralSession` (`client.js:25-31`) is **iOS-only**. On Android, Chrome Custom
Tabs share the device browser's persistent cookie jar, so both the Logto and the Google session
survive — matching the reported symptom exactly ("immediately signs me in with the last user… with
Google").

**Design.**

1. **Force re-authentication.** `mobile/lib/auth/config.ts` adds `prompt: ["login", "consent"]`. This
   wins because `config` is spread *after* the SDK default. String literals are used deliberately
   (`Prompt.Login === "login"`, `Prompt.Consent === "consent"`, verified in
   `node_modules/@logto/js/lib/consts/index.js:45-59`) to keep the module free of a runtime
   `@logto/rn` import so it stays loadable under the node-based Vitest — the same reasoning already
   documented there for `scopes`.
2. **Real RP-initiated logout.** New pure module `mobile/lib/auth/logout.ts` exporting
   `endSessionUrl({ endSessionEndpoint, clientId, postLogoutRedirectUri, idTokenHint })`, unit-tested.
   `auth-provider.tsx`'s `signOut`:
   - captures `getIdToken()` **before** `logto.signOut()` (which clears it),
   - calls `logto.signOut()` (revokes the refresh token, clears secure storage),
   - opens the end-session URL via `WebBrowser.openAuthSessionAsync`.
   The endpoint is discovered from `{endpoint}/oidc/.well-known/openid-configuration`
   (`end_session_endpoint`), falling back to `{endpoint}/oidc/session/end`.
   The browser step is wrapped in try/catch: local tokens are already cleared, so a browser failure
   must **never** make sign-out appear to fail or leave the UI authenticated.

3. **External configuration — cannot ship in this PR.** Documented in `docs/setup/06-logto.md`:
   - Register the post-logout redirect URI on the Logto **native** application.
   - Set the Logto **Google connector → Prompts** to `select_account`. Per Logto's documentation this
     is what makes Google show the account chooser. Without it, even a fully-cleared Logto session
     bounces to Google, which silently returns the last account.

   **Issue #6 is not fully resolved until step 3 is applied in the Logto console.**

---

## 5. Data model and API changes

| Change | Kind |
|---|---|
| `ratings.is_proximate bool NOT NULL DEFAULT false` | additive column, migration `0023` |
| `RateRequest.latitude`, `RateRequest.longitude` | additive, optional |
| `ConditionRequest.latitude`, `ConditionRequest.longitude` | additive, optional |
| `ConditionRequest.is_proximate` | **deprecated** — now ignored, derived server-side |
| `403 outside_rating_radius` on `POST /fountains/{id}/ratings` | new failure mode |
| `settings.rating_max_distance_m` | new config, default `80467.0` (50 mi) |
| `settings.proximate_radius_m` | new config, default `100.0` |

No breaking response-shape change. No backfill (the default covers existing rows, and `false`
correctly means "no location asserted" for them).

The one behavioral break is `ConditionRequest.is_proximate` becoming server-derived. Both first-party
clients currently send a hardcoded `false`, so no client observes a change; a third-party caller that
sent `true` would lose the ability to self-assert — which is the point.

## 6. Privacy

Ratings and condition reports may now transmit the submitter's coordinates. In both cases the
coordinates are **used for the distance comparison and discarded**. Only the resulting boolean is
persisted. Coordinates are never logged, never stored, and never returned by the API — consistent
with the existing "never logs coordinates" rule in `mobile/lib/location.ts`.

Sending coordinates is always optional. Declining the permission prompt never blocks a rating or a
condition report.

`web/app/privacy/page.tsx:18` currently states location is used "to find nearby fountains or add a
fountain". It must be amended to include verifying proximity when submitting a rating or a condition
report, and to state that the coordinates are checked and then discarded rather than retained. This
amendment ships **in this PR**.

## 7. Logging and observability

Per `CLAUDE.md` → *Logging & Observability*:

- Log a rejected rating at `INFO` with the fountain id and the **outcome only**
  (`outside_rating_radius`). **Never log the submitted coordinates or the computed distance** —
  either would reconstruct the user's location in the log stream. The same applies to the
  `is_proximate` computation on condition reports: log the resulting boolean, never the distance.
- Log the mobile sign-out lifecycle (`signout_started`, `tokens_cleared`, `end_session_opened`,
  `end_session_failed`) with no tokens, no id-token contents, and no subject claims beyond the
  existing correlation id.

## 8. Security posture — stated plainly

**The proximity guard is a quality guard, not a security control.**

Coordinates are supplied by the client. A caller may send fabricated coordinates, or send none at all
— and because coordinate-less ratings are accepted (§4.5), omitting them bypasses the check entirely.
This is a deliberate, accepted trade-off: blocking coordinate-less ratings would hard-block every user
who declines the permission prompt, and "send no coords" is no weaker than "send fake coords", which
mock-location apps make trivial on Android regardless.

Accordingly, this design does **not** claim that all ratings originate within 50 miles of their
fountain. It claims that **honest clients which report a location are held to the rule**, that the
rule is enforced in exactly one server-side place, and that `is_proximate` becomes a real signal
available for later trust weighting and moderation. This is the same framing the gamification design
already uses for `is_proximate` (§10, §11, and the accepted-risks list).

One accepted risk in that design *is* retired: `is_proximate` was documented as "client-asserted,
explicitly not a security control". It is now **server-computed** from supplied coordinates. It
remains untrustworthy against a caller who fabricates coordinates, but it can no longer be set to
`true` by simply asserting it. The gamification spec's accepted-risk entry should be updated to say
so.

## 9. Testing

- **Backend (pytest), ratings:** within radius → accepted, `is_proximate` true; outside radius →
  `403`, `detail == "outside_rating_radius"`, and **no rating row written**; no coords → accepted,
  `is_proximate` false; latitude-without-longitude → `422`; re-rating from outside the radius does not
  mutate the stored row; `ON CONFLICT DO UPDATE` refreshes `is_proximate`; a rating exactly at the
  boundary is accepted (`ST_DWithin` is inclusive).
- **Backend (pytest), condition reports:** coords within `proximate_radius_m` → `is_proximate` true;
  coords outside it → stored with `is_proximate` false and **not rejected**; no coords → false; a
  client-sent `is_proximate: true` is **ignored** and overridden by the server's computation.
- **Shared (Vitest, `packages/contributions`):** `isRatingDraftDirty` truth table.
- **Mobile (Vitest, pure modules only):** `endSessionUrl` construction, including id-token-hint
  omission and URI encoding.
- **Web (Vitest + RTL):** draft survives a tab switch; `PhotoUpload` submits a dirty draft before
  uploading; a failed rating aborts the upload and retains the draft; celebration renders `+N points`
  from `CustomEvent.detail`, and renders no number when `detail` is absent.
- **Emulator (not CI-coverable):** keyboard scrolling with the note field focused; celebration
  appearance; sign-out → sign-in shows the Logto login screen rather than an instant re-login.
- **CI is the source of truth** for the JS unit suites, component renders, and mobile's stricter
  React-Compiler lint — none of which run reliably on the Windows/WSL host (`claude_help/local-dev.md`).

## 10. Risks and accepted limitations

- **Single PR, six issues.** The user explicitly chose this. Mitigated by one commit per issue.
  The risk remains that one Codex finding or one red check blocks all six.
- **#6 is not fully fixed by code.** The Google account-chooser half requires the Logto console
  change in §4.6.3. Shipping the PR alone will improve but not eliminate the symptom.
- **Lifting rating state** may trip mobile's CI-only React-Compiler lint rules (no `useRef().current`
  in render; no unconditional `setState` in `useEffect`). Local `tsc`/prettier will not catch this.
- **`KeyboardAvoidingView` + edge-to-edge** on Android is historically finicky. The `da197f0` pattern
  is proven in a modal; a full-screen tabbed layout is a different context and needs emulator
  verification before the PR is called done.
- **New location permission surface.** Rating now prompts for location on first use. iOS already
  declares `NSLocationWhenInUseUsageDescription`; Android already declares both location permissions.

## 11. Out of scope (follow-ups)

- **#204** — re-rating a fountain repeatedly to farm points.
- `photo_first` (5 pts) is absent from the client mirror in `packages/contributions/src/index.ts:1-10`,
  so photo uploads show no points preview.
- Photo upload never triggers the celebration at all (`photoUploadMutation.onSuccess`,
  `mobile/app/fountains/[id].tsx:324-328`).

## 12. File map

**Backend:** `app/config.py`, `app/schemas.py`, `app/models.py`, `app/routers/fountains.py`,
`migrations/versions/0023_ratings_is_proximate.py`, `tests/test_fountains.py`

**Generated:** `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`

**Shared:** `packages/contributions/src/index.ts` (+ tests)

**Web:** `components/fountain/FountainDetail.tsx`, `ContributeSection.tsx`, `RatingForm.tsx`,
`PhotoUpload.tsx`, `AttributeForm.tsx`, `ConditionForm.tsx`, `NoteForm.tsx`,
`components/map/MapStates.tsx`, `components/map/MapBrowser.tsx`, `components/map/useAddFountainMode.tsx`,
`components/contributions/ContributionStatusOverlay.tsx`, `components/HeaderPoints.tsx`,
`app/actions/contribute.ts`, `app/globals.css`, `app/privacy/page.tsx` (+ tests)

**Mobile:** `app/fountains/[id].tsx`, `components/fountain/RatingContributionForm.tsx`,
`components/fountain/PhotoUploadButton.tsx`, `components/fountain/FountainDetailTabs.tsx`,
`components/feedback/WaterCelebration.tsx`, `lib/contributions/payloads.ts`,
`lib/contributions/state.ts`, `lib/location-request.ts` (new, extracted from the hook),
`hooks/useForegroundLocation.ts` (consume the extracted adapters), `lib/auth/config.ts`,
`lib/auth/logout.ts` (new, + tests), `providers/auth-provider.tsx`

**Docs:** `docs/style-guide.md`, `docs/setup/06-logto.md`,
`docs/specs/2026-06-22-contribution-data-and-gamification-design.md` (retire the `is_proximate`
client-asserted accepted-risk entry), this spec
