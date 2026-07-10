# Fountain Detail UX, Rating Proximity Guard, and Mobile Sign-Out — Design

**Status:** Draft (pending Codex review)
**Date:** 2026-07-10
**Supersedes/extends:** `2026-06-22-contribution-data-and-gamification-design.md` (§10 proximity,
§11 privacy), `2026-07-07-fountain-detail-parity-design.md` (detail tabs)

---

## 1. Summary

Six reported issues, resolved on one branch (`feat/detail-ux-proximity-and-signout`) with **one
commit per issue** so each is independently reviewable inside a single PR.

| # | Reported issue | Surface |
|---|---|---|
| 1 | "Add photo" discards an unsaved rating | web + mobile |
| 2 | The rank celebration animation needs to be better | web + mobile |
| 3 | "All ranking of fountains needs to be done within a 50 mi perimeter of the user's location" | backend + web + mobile |
| 4 | Cannot scroll the detail screen while the keyboard is open | mobile |
| 5 | The celebration should use the FountainRank pin logo | web + mobile |
| 6 | Sign-out does not clear the session; sign-in silently re-logs-in the last Google user | mobile |

Issues 2 and 5 are the same component and ship as one work item.

### 1.1 What issue #3 actually delivers (read this before §4.5)

The reported issue asks that **all** ranking happen within 50 miles. **This design does not deliver
that, and does not claim to.** Coordinates are supplied by the client and are optional; a rating that
carries none is accepted. Therefore the delivered contract is:

> A rating **that reports a location** is rejected when that location is more than
> `rating_max_distance_m` from the fountain. A rating that reports no location is accepted and
> recorded as unverified.

Everything in §4.5 and §8 follows from that sentence. The Summary table above records the issue **as
reported**, not as satisfied.

## 2. Goals

- No contribution the user has expressed intent to make is silently discarded.
- The reward moment is on-brand (the pin logo) and identical in substance on both clients.
- The detail screen is usable with the soft keyboard open.
- Signing out ends the local session and, best-effort, the provider session — and a subsequent
  sign-in can never silently reuse the previous identity.
- Ratings carry a **server-computed** proximity signal, and ratings that *report* a remote location
  are refused.

### 2.1 Product decisions on record

These were put to the repository owner explicitly, with the trade-offs stated, and decided:

| Decision | Chosen | Consequence accepted |
|---|---|---|
| Enforcement point | Server-side, ratings only | Not client-side-only |
| No location available | **Accept**, mark unverified | The 50-mile rule is bypassable by omitting coordinates |
| Framing | **Best-effort quality guard**, documented | The spec must not claim to satisfy #3 as literally worded |
| Branch layout | One branch, one PR, six issues | Coupled CI/rollback risk; see §10 |

## 3. Non-goals

- **This is not an anti-abuse control.** See §8.
- **The ranking aggregate is unchanged.** Non-proximate and unknown-location ratings continue to
  count toward the Bayesian ranking exactly as they do today. *Considered and rejected:* excluding
  non-proximate ratings from the aggregate. Because coordinate-less ratings are accepted (§2.1), the
  overwhelming majority of existing and future ratings are `is_proximate = false`; excluding them
  would empty the rankings. Revisit only if coordinates ever become mandatory.
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

**Ordering.** On "Add photo", if the draft is dirty: **submit the rating first, then upload the
photo.** Rationale — the rating write is a cheap idempotent upsert
(`ON CONFLICT DO UPDATE`, `backend/app/routers/fountains.py:112`), so doing it first guarantees a
photo failure can never lose the rating, which is the entire point of the issue.

**Failure handling — a failed rating MUST NOT block the photo.** Photos are explicitly *not* distance-gated
(§3). An earlier draft of this design aborted the upload on any rating failure, which meant a user 60
miles away with dirty stars could not upload a photo at all — silently converting a ratings-only
policy into a photo-upload gate. That is a regression, not a feature.

The rule is therefore: **the two contributions are independent.** The rating is attempted first; its
outcome never gates the upload. The photo upload always proceeds.

- Rating succeeds → celebrate the rating points, upload the photo.
- Rating fails with `403 outside_rating_radius` → **upload the photo anyway**, retain the draft
  stars, and surface a non-blocking notice: "Photo added. Your rating wasn't saved — you're too far
  from this fountain to rate it."
- Rating fails for any other reason (network, `422`, `409 display_name_required`) → upload the photo
  anyway, retain the draft, surface the rating error. Note that a `409` name gate would fail the
  photo upload too (`require_named_user` guards both), so nothing is lost.
- Rating draft is clean → upload the photo, no rating call.

In every branch the draft stars and the picked asset survive, so the user can retry the rating
without re-tapping stars or re-picking a photo.

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
`ReportContentButton.tsx`) — but note that pattern lives inside a `Modal`, which is a separate
Android window. A full-screen tabbed layout is a different context, so the approach is specified
concretely and given an explicit fallback rather than assumed to transfer.

**Primary approach.**

- Wrap the **`panels` container** — *not* each panel — in a `KeyboardAvoidingView` carrying
  `style={styles.panels}` (i.e. it *takes over* the `flex: 1`, so the flex chain
  `wrap → panels → panelWrap → scroll` is preserved and depth is unchanged). Wrapping individual
  panels would interact badly with the `height: 0` inactive-panel collapse, a deliberate
  New-Architecture workaround documented at `FountainDetailTabs.tsx:57-63` (`display: "none"` did not
  collapse a `flex: 1` ScrollView; an absolute overlay swallowed touches).
- `behavior={Platform.OS === "ios" ? "padding" : "height"}`.
- `keyboardVerticalOffset` = the measured header + tab-bar height. It is **not** zero here: unlike
  the modal, this screen sits under a navigation header, and an offset of zero will leave the input
  under the keyboard by exactly that height.
- Add `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode` to the existing per-tab
  `ScrollView`s. `keyboardShouldPersistTaps` also fixes a latent second bug: today, tapping a submit
  button while the keyboard is open requires two taps (the first only dismisses the keyboard).
- `contentContainerStyle` is unchanged. Do **not** add a fourth `ScrollView`.

**Android edge-to-edge risk and fallback.** RN 0.85 / Expo 56 enable edge-to-edge by default, under
which `adjustResize` does not shrink the window and `behavior="height"` may fail to resize the active
`ScrollView`. If emulator verification shows the note field still occluded, apply in order:

1. Set `android.softwareKeyboardLayoutMode: "resize"` explicitly in `mobile/app.config.ts` (it is
   currently unset — the behavior is entirely implicit) and re-test.
2. Fall back to `automaticallyAdjustKeyboardInsets` on iOS plus, on Android, a `paddingBottom` on the
   active `ScrollView`'s `contentContainerStyle` driven by `Keyboard.addListener("keyboardDidShow")`
   height. This uses only RN built-ins.
3. **Only if both fail**, escalate to the user before adding `react-native-keyboard-controller` — a
   new dependency is subject to CI's 24h `minimumReleaseAge` gate and must not be introduced
   silently.

**Acceptance criteria (emulator, Android + iOS).** With the Details tab active and the "Your note"
field focused:
1. The note input is fully visible above the keyboard.
2. The panel scrolls while the keyboard is open, revealing the Submit control.
3. Submit responds to a **single** tap while the keyboard is open.
4. Switching tabs with the keyboard open does not strand a collapsed or clipped panel.
Evidence: a screenshot per criterion, attached to the PR.

**Verification.** Emulator-only. Mobile has no RN render harness (unit tests are Vitest over pure
modules), so this change **cannot be covered by CI** and must not be claimed working on the basis of
`tsc` or lint passing.

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
- `backend/app/geo.py`: add a helper `within_radius(location_col, latitude, longitude, radius_m)`
  wrapping `ST_DWithin(location_col, point_geography(latitude, longitude), radius_m)`.
  **No route handler may write a bare `ST_DWithin`.** `point_geography` already centralizes the
  `ST_MakePoint(longitude, latitude)` ordering (`geo.py:6-8`); routing all proximity SQL through one
  helper is what stops a lat/lon swap or a geometry/geography cast mismatch from reaching a handler.
- `backend/app/models.py`: `Rating.is_proximate` added in the same commit as the migration.
- Migration `0023_ratings_is_proximate.py` (chains onto `0022_account_deletion`): adds
  `ratings.is_proximate bool NOT NULL DEFAULT false`, mirroring the existing `condition_reports`
  column. Must be **reversible** (a real `downgrade()` dropping the column) and leave
  `alembic check` drift-free against `models.py`.
- `submit_ratings`:
  - coords present and within radius (`within_radius(...)`, inclusive at the boundary) → accept,
    `is_proximate = True`.
  - coords present and outside radius → **`403 Forbidden`**, `detail: "outside_rating_radius"`,
    **no row written** (the check runs before `_upsert_ratings`, inside the existing
    `Fountain … FOR UPDATE` lock).
  - coords absent → accept, `is_proximate = False`.

**`is_proximate` is monotonic — it never downgrades.** The naive `ON CONFLICT DO UPDATE` set clause
would overwrite the flag on every re-rate, so a user who once rated a fountain standing in front of
it, then later edited their stars from a desktop with location denied, would silently destroy the
trust signal. Absence of a coordinate is *unknown*, not *negative*, and must never overwrite a
verified *true*.

The upsert therefore sets:

```
is_proximate = ratings.is_proximate OR excluded.is_proximate
```

Because an out-of-radius rating is rejected outright (`403`), a `true` can never be written for a
remote submission, and a `false` can only ever originate from "no coordinates supplied". The column's
meaning is thus precise and stable:

> `ratings.is_proximate = true` ⟺ at least one submission of this rating was made with coordinates
> verified within `rating_max_distance_m` of the fountain.

This is documented on the column and covered by a dedicated test (§9).

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
  `is_proximate = within_radius(fountain.location, lat, lng, proximate_radius_m)` when coordinates
  are supplied, and `false` when they are not.

- **The request field becomes an explicit error, not a silent no-op.** The current server persists
  the client's `is_proximate` verbatim (`fountains.py:1002-1007`, `schemas.py:129-132`). Simply
  ignoring it would be a behavioral break hidden behind an unchanged response shape — unacceptable
  for a public API in a public repo. The transitional contract instead is:

  | Client sends | Server behavior |
  |---|---|
  | field omitted, or `null` | derive from coordinates (the new normal) |
  | `is_proximate: false` | accepted for backward compatibility; still derived from coordinates |
  | `is_proximate: true` | **`422`**, `detail: "is_proximate_is_server_computed"` |

  Rejecting only `true` is what matters: `true` is the value a caller could previously use to
  self-assert proximity it never had. `false` is what both first-party clients send today
  (`payloads.ts:60`, `contribute.ts:146`), so no existing client breaks. The field is marked
  `deprecated` in the OpenAPI schema, and both first-party clients stop sending it entirely.

- Condition reports remain **ungated** by distance. Nothing is rejected on account of distance; only
  the flag is populated. This is a strict improvement over the hardcoded `false` and finally
  delivers the trust signal the gamification design specified (§10, §11).

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
   `prompt=login` is the **load-bearing** fix and the safety net for step 2: even if the end-session
   navigation fails entirely, Logto is forced to re-authenticate rather than silently reuse a live
   session cookie. Step 2 makes sign-out correct; step 1 makes a *failed* sign-out non-catastrophic.

2. **Real RP-initiated logout.** New pure module `mobile/lib/auth/logout.ts` exporting
   `endSessionUrl({ endSessionEndpoint, clientId, postLogoutRedirectUri })`, unit-tested.

   **No `id_token_hint`.** The installed generator sends **only** `client_id` and an optional
   `post_logout_redirect_uri` (`node_modules/@logto/js/lib/core/sign-out.js:3-8`). An earlier draft of
   this design captured `getIdToken()` before `logto.signOut()` cleared it; that parameter is not part
   of Logto's contract, so the capture — and its ordering hazard — is dropped entirely.

   `auth-provider.tsx`'s `signOut` therefore:
   - calls `logto.signOut()` (revokes the refresh token, clears secure storage),
   - opens the end-session URL via `WebBrowser.openAuthSessionAsync(url, postLogoutRedirectUri)`.

   The endpoint is discovered from `{endpoint}/oidc/.well-known/openid-configuration`
   (`end_session_endpoint`), falling back to `{endpoint}/oidc/session/end`.

   **Partial failure is a real state and must be named.** Local tokens are cleared first, so if
   discovery or the browser step fails the user is locally signed out while the provider session may
   survive. This is not silently swallowed:
   - the UI still reports a successful sign-out (the local session *is* gone, and `prompt=login`
     prevents a silent re-login),
   - the failure is logged at `WARNING` as `end_session_failed` — distinct from the success event
     `end_session_completed` — so the "local sign-out completed; provider session may remain" state is
     diagnosable from logs alone, per `CLAUDE.md` → *Logging & Observability*.

   **`post_logout_redirect_uri` must be pre-registered** in the Logto Console — `@logto/client`'s own
   docstring states "The URI must be registered in the Logto Console"
   (`node_modules/@logto/client/lib/client.js:222-225`). An unregistered URI makes Logto reject the
   end-session request. This is a hard dependency on step 3, not a nicety.

3. **External configuration — cannot ship in this PR. This is a release gate.**
   Documented in `docs/setup/06-logto.md`:
   - Register the post-logout redirect URI on the Logto **native** application. **Without this,
     step 2 fails at runtime** (it degrades to the `end_session_failed` path above, leaving
     `prompt=login` as the only protection).
   - Set the Logto **Google connector → Prompts** to `select_account`. Per Logto's documentation this
     is what makes Google show the account chooser. Without it, even a fully-cleared Logto session
     bounces to Google, which silently returns the last account.

   **Close criteria for #6.** Merging this PR does **not** close issue #6. The PR delivers: no silent
   Logto re-login (via `prompt=login`), and a correct end-session call *once the redirect URI is
   registered*. Issue #6 may be closed only after both console changes are applied and a device
   sign-out → sign-in shows the Logto login screen **and** a Google account chooser.

---

## 5. Data model and API changes

| Change | Kind |
|---|---|
| `ratings.is_proximate bool NOT NULL DEFAULT false` | additive column, migration `0023` |
| `RateRequest.latitude`, `RateRequest.longitude` | additive, optional |
| `ConditionRequest.latitude`, `ConditionRequest.longitude` | additive, optional |
| `ConditionRequest.is_proximate` | **deprecated** — derived server-side; `true` now rejected with `422` |
| `403 outside_rating_radius` on `POST /fountains/{id}/ratings` | new failure mode |
| `422 is_proximate_is_server_computed` on `POST /fountains/{id}/condition` | new failure mode |
| `settings.rating_max_distance_m` | new config, default `80467.0` (50 mi) |
| `settings.proximate_radius_m` | new config, default `100.0` |
| `geo.within_radius(...)` | new shared helper; no bare `ST_DWithin` in handlers |
| `RequestValidationError` handler | new; logs field name + error type, never `input` |

No breaking response-shape change. No backfill (the default covers existing rows, and `false`
correctly means "no location asserted" for them).

The one behavioral break is `ConditionRequest.is_proximate` becoming server-derived, and it is a
**loud** break rather than a silent one (§4.5). Both first-party clients currently send a hardcoded
`false`, which remains accepted, so no existing client observes a change; only a caller sending
`true` — i.e. one self-asserting proximity it may not have — receives a `422`. That is the point.

## 6. Privacy

Ratings and condition reports may now transmit the submitter's coordinates. In both cases the
coordinates are **used for the distance comparison and discarded**. Only the resulting boolean is
persisted.

**The precise claim** (an earlier draft overclaimed "never logged", full stop):

- **Not persisted.** No table stores the submitter's coordinates. Only `is_proximate` is written.
- **Not logged by application code.** The request middleware logs method/path/status/duration/client
  only (`backend/app/middleware.py:61-70`); the centralized 500 handler logs no request body
  (`backend/app/main.py:56-63`). §7 forbids adding any coordinate to a log record.
- **Not returned by the API.** No response schema exposes them.

Three residual vectors are named rather than papered over:

1. **FastAPI's default `422` echoes the offending value.** There is no `RequestValidationError`
   handler in `backend/app/main.py`, so Pydantic's error payload includes an `input` field carrying
   the rejected value. For an out-of-range latitude this returns the coordinate to **the caller who
   just sent it** — no disclosure to a third party — but it must never reach a log. This design adds a
   `RequestValidationError` handler that logs the *field name and error type only*, never `input`.
2. **Body-logging middleware.** None exists. Adding request- or response-body logging to this service
   is prohibited by §7 for as long as coordinates are accepted on any endpoint.
3. **Upstream proxy/ingress logs.** Out of the application's control. Coordinates travel in the
   **request body over TLS**, never in a URL path or query string, so they do not appear in standard
   access logs.

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
- Add a `RequestValidationError` handler that logs the failing **field name and error type only**.
  Pydantic's default error payload carries the rejected `input` value; for `latitude`/`longitude`
  that value *is* the user's location and must never enter a log record.
- **Prohibited for as long as any endpoint accepts coordinates:** request-body or response-body
  logging middleware, at any log level, including `DEBUG`.
- Log the mobile sign-out lifecycle with no tokens, no id-token contents, and no subject claims
  beyond the existing correlation id. The events must distinguish the partial-failure state (§4.6):
  `signout_started` → `tokens_cleared` → (`end_session_completed` | `end_session_failed` at
  `WARNING`). A reader of the logs must be able to tell "fully signed out" from "locally signed out;
  provider session may remain" without a debugger.

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

Tests are grouped per issue so a failure names its issue.

- **Backend (pytest), ratings:** within radius → accepted, `is_proximate` true; outside radius →
  `403`, `detail == "outside_rating_radius"`, and **no rating row written**; no coords → accepted,
  `is_proximate` false; latitude-without-longitude → `422`; a rating exactly at the boundary is
  accepted (`ST_DWithin` is inclusive).
- **Backend (pytest), `is_proximate` monotonicity (§4.5):** rate with coords in-radius (`true`), then
  re-rate the same fountain **with no coords** → the flag stays `true` and the stars update. This is
  the regression test for the downgrade defect.
- **Backend (pytest), condition reports:** coords within `proximate_radius_m` → `is_proximate` true;
  coords outside it → stored with `is_proximate` false and **not rejected**; no coords → false;
  `is_proximate: false` supplied → accepted, still derived; `is_proximate: true` supplied → **`422`,
  `detail == "is_proximate_is_server_computed"`**.
- **Backend (pytest), privacy:** a `422` on an out-of-range latitude emits **no log record containing
  the submitted value**.
- **Backend (migrations):** `alembic upgrade head` then `alembic check` is drift-free;
  `0023` `downgrade()` drops the column cleanly.
- **Shared (Vitest, `packages/contributions`):** `isRatingDraftDirty` truth table.
- **Mobile (Vitest, pure modules only):** `endSessionUrl` emits exactly `client_id` +
  `post_logout_redirect_uri`, correctly URI-encoded, and **no `id_token_hint`**.
- **Client error classification (both clients):** `403` maps to the new `too_far` variant, **not** to
  the generic `"server"` fallback — the exact bug that `mapContributionError`
  (`mobile/lib/contributions/state.ts:32-44`) and `mapStatus` (`web/app/actions/contribute.ts:51-60`)
  would otherwise produce. Assert the user-facing copy names the 50-mile rule. Confirm no existing
  `403` path (admin, content reports) is re-classified by the change.
- **Web (Vitest + RTL):** draft survives a tab switch; `PhotoUpload` submits a dirty draft before
  uploading; **a rating rejected with `403` still uploads the photo** and retains the draft (§4.1);
  celebration renders `+N points` from `CustomEvent.detail`, and renders no number when `detail` is
  absent.
- **Emulator (not CI-coverable):** the four keyboard acceptance criteria in §4.4, with screenshots;
  celebration appearance; sign-out → sign-in shows the Logto login screen rather than an instant
  re-login.
- **CI is the source of truth** for the JS unit suites, component renders, and mobile's stricter
  React-Compiler lint — none of which run reliably on the Windows/WSL host (`claude_help/local-dev.md`).

## 10. Risks and accepted limitations

- **Single PR, six issues.** The repository owner explicitly chose this (§2.1). One commit per issue
  aids review history but does **not** isolate CI risk, rollback risk, or behavioral coupling — and
  there *is* coupling: #1 calls the endpoint that #3 changes. Mitigations, all required:
  1. **Commit order is dependency-ordered**, backend first: #3 backend + migration → #3 clients →
     #1 → #2/#5 → #4 → #6. Each commit leaves the tree green.
  2. **Test groups are labelled per issue** (§9) so a red check names its issue.
  3. **A manual QA checklist** in the PR body, one section per issue, with the §4.4 screenshots.
  4. **Explicit close criteria.** Merging closes #1, #2, #4, #5, and the code half of #3.
     **It does not close #6** — see §4.6.3. The PR body must say so, and #6 stays open pending the
     Logto console changes.
  5. **Rollback unit.** If one issue must be reverted post-merge, its commit is revertible in
     isolation *except* #3-clients (depends on #3-backend) and #1 (depends on #3-clients). Reverting
     #3-backend requires reverting all three.
- **#6 is not fully fixed by code.** The Google account-chooser half *and* the end-session redirect
  registration both require Logto console changes (§4.6.3). Shipping the PR alone delivers
  `prompt=login` — which stops the silent Logto re-login — but not the Google account chooser.
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

**Backend:** `app/config.py`, `app/schemas.py`, `app/models.py` (`Rating.is_proximate`),
`app/geo.py` (`within_radius`), `app/routers/fountains.py`, `app/main.py`
(`RequestValidationError` handler), `migrations/versions/0023_ratings_is_proximate.py`,
`tests/test_fountains.py`, `tests/test_contributions.py`

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
