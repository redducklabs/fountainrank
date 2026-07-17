# Mobile live location — design (2026-07-17)

Issues: #243 (no continuous location watch) + the location-feedback subset of #215 (locate-button
pending/denied states, misleading below-zoom hint during first fix). Sibling designs:
`2026-07-17-mobile-add-flow-resilience-design.md` (#241/#244),
`2026-07-17-scoped-add-fountain-lock-design.md` (#242).

## Problem

Owner field report: "My location does not update quickly." Verified causes:

1. **The app takes exactly one GPS fix at mount and freezes it.** `useForegroundLocation`
   (`mobile/hooks/useForegroundLocation.ts:47-63`) runs one `getCurrentPositionAsync` in a
   mount-only effect; there is no `watchPositionAsync` anywhere in `mobile/`. Every app behavior —
   initial centering (`mobile/app/(tabs)/index.tsx:278-285`), add-mode placement target
   (`index.tsx:322-348`), "Use current location" (`index.tsx:608-622`), allowed-area bounds
   (`index.tsx:253-267`) — reads that frozen fix, while the native MapLibre blue dot tracks live,
   making the staleness visible.
2. **The locate button is one-shot and slow.** A press re-runs a `Balanced`-accuracy fetch raced
   against an 8 s timeout with a last-known fallback (`mobile/lib/location-request.ts:21-27`,
   `mobile/lib/location.ts:80-114`).
3. **Feedback gaps (#215 P0 subset).** The locate button is mounted only when `coords` exist
   (`index.tsx:560`) — absent during acquisition and permanently absent on denial. The `locating`
   status and the hook's `refreshing` flag have zero consumers. During the first fix the map shows
   "Zoom in to see fountains" while the app is silently about to fly to the user.
4. **Contribution submits block on a fresh fix.** The rating/condition proximity guard awaits
   `requestCurrentCoords()` — up to 8 s — before the mutation fires
   (`mobile/lib/contributions/submit-flow.ts`, `location-request.ts:37-40`).

## Decision

### 1. A race-safe, foreground-only watch controller

**Platform reality first**: `Location.watchPositionAsync` is itself asynchronous — it returns a
`Promise<LocationSubscription>`, and the subscription only becomes removable once that promise
resolves. Options are platform-specific best effort: `timeInterval` is Android-only; iOS honors
`distanceInterval` (distance filter) + accuracy, and neither platform promises a fixed callback
cadence. The design treats updates as *event streams to consume*, never as a guaranteed clock.

**The controller (pure, node-testable)**: a new watch-lifecycle state machine in
`mobile/lib/location.ts` (no expo imports, dependency-injected `startWatch`), owning the
subscription races explicitly:

- Desired-state input is a single boolean: `shouldWatch = focused && appActive &&
  status === "granted"`.
- **Starts are serialized — never more than one native start operation in flight.** The
  controller keeps `{ pendingStart, liveSubscription, desired }`. When `desired` becomes true and
  a start is already pending, the controller only records the latest desired state; it does NOT
  invoke another `startWatch` (this closes the false→true→pending race that would otherwise put
  two native watches in flight). When the pending start settles: if `desired` is now false, the
  resolved subscription is removed immediately and nothing is published; if `desired` is true, it
  is installed as the live subscription; if `desired` flapped false→true while pending, the
  settled subscription is removed and exactly one replacement start is issued. Start-promise
  rejections are consumed (no throw, no coordinate logging) — and enter a **bounded recovery
  path**, below, rather than leaving the session permanently unwatched.
- **Rejected-start recovery**: after a start rejection with `desired` still true, the controller
  enters a `retryable` state and schedules exactly one retry timer
  (`WATCH_RETRY_DELAY_MS = 30_000`) — a single timer, so repeated rejections retry at that
  cadence and can never tighten into a loop or accumulate timers. Additionally, any reconcile
  signal — a desired-state edge (refocus, AppState back to active) or a successful locate
  `refresh()` (which proves the platform can deliver a fix; a same-string `"granted"` status does
  not re-fire an effect keyed on `shouldWatch`, so the refresh path calls the controller's
  `reconcile()` explicitly) — retries immediately and cancels the pending timer. Stop/unmount
  cancels any scheduled retry. Recovery preserves the single-pending-start / single-live
  invariant.
- Stop removes the live subscription if installed and marks any pending start as unwanted (to be
  removed on settle, per above). Start/stop are idempotent.
- **Invariant (tested by counting native start/remove/live handles, not published fixes)**: at
  most one *pending start* and at most one *live subscription* exist at any time, and a
  subscription never remains live while `desired` is false beyond its own settle turn.
- Only the currently installed subscription's callbacks dispatch `positionResolved` / publish to
  the fix store.

**The hook**: `useForegroundLocation` derives `shouldWatch` from React-Compiler-safe sources —
**named mechanisms**: focus via the navigation library's render-state hook (`useIsFocused()` from
expo-router/react-navigation, which returns state, not an effect-set flag) and AppState via
`useSyncExternalStore` with an explicit adapter — `useSyncExternalStore` requires `subscribe` to
return a cleanup function while `AppState.addEventListener` returns a subscription object, so the
adapter is spelled out: `subscribe = (onStoreChange) => { const sub =
AppState.addEventListener("change", onStoreChange); return () => sub.remove(); }`, with
`subscribe`/`getSnapshot` (`AppState.currentState === "active"`) held stable at module scope, and
a server-snapshot argument supplied if the installed React types require one. No effect performs
an unconditional `setState` and no ref is read during render. The composed boolean feeds the
controller from an effect (the effect reacts to `shouldWatch` changes; it does not set React
state). **Stop vs. dispose are distinct**: the `shouldWatch` effect's dependency-change cleanup
calls `stop()`/`setDesired(false)` — the controller survives focus/AppState transitions so
retries and reconciliation keep working across them; permanent `dispose()` — idempotent, cancels
retry timers, invalidates pending starts, removes the live handle — runs only in the hook's
unmount cleanup. An implementation that disposed on every `shouldWatch` change would fail to
restart on refocus; the split is explicit to prevent that. The watch runs whenever `status === "granted"` — whether granted at the mount fix or
later via a locate-press retry. Watch callbacks dispatch the existing `positionResolved` event; a
watch error dispatches nothing (a transient failure never blanks a known-good fix). The public
surface stays `{ status, coords, refreshing, refresh }`, with `refresh`'s richer return in §3.

**Privacy**: foreground-only by construction — the controller's desired state is false the moment
the screen blurs or the app leaves `active`, and the generation protocol guarantees a
late-resolving subscription cannot outlive that. No background permission is ever requested.
Coordinates are never logged (existing rule; controller diagnostics may log lifecycle events —
started/stopped/rejected — with no coordinate payloads). Watch options:
`{ accuracy: Balanced, timeInterval: 3000 (Android-only), distanceInterval: 10 }`.

### 2. Freshness-aware fix store with a real contract

`mobile/lib/location.ts` gains a small store (pure; injectable clock):

- **Record**: `{ coords, sourceTimestampMs, receiptTimestampMs, effectiveTimestampMs }`.
  `sourceTimestampMs` is the native `LocationObject.timestamp` — `RawPosition`/`pickCoords` are
  extended to carry it (today it is discarded), so a last-known fallback with an old fix cannot
  masquerade as fresh via receipt time.
- **Normalization**: `effectiveTimestampMs = min(sourceTimestampMs, receiptTimestampMs)` — ANY
  future-skewed source timestamp (even 1 ms ahead) is bounded by receipt time, so a skewed fix
  can never outlive the freshness window (a +59 s source stamp no longer yields ~74 s of
  "freshness"). Non-finite or absent source timestamps make the fix unusable (not published).
- **Ordering**: newest `effectiveTimestampMs` wins (tie → newer `receiptTimestampMs`); an older
  fix never overwrites a newer one (covers watch vs. slow-refresh races in either resolution
  order, without letting a skew-clamped fix displace a genuinely newer one).
- **Freshness**: `latestFix(maxAgeMs)` computes `age = now - effectiveTimestampMs` with the
  injected clock; `FRESH_FIX_MAX_AGE_MS = 15_000`. A **negative** age (the injected clock moved
  backward past the record) means the clock is unreliable — the fix is treated as stale (fail
  safe: fall through to a real fetch), never as fresh.
- **Lifecycle/reset**: an exported `resetLatestFix()` clears the store — called on any **denied**
  permission outcome (see §3, permission-based clearing) and by tests for deterministic
  isolation. A transient `unavailable` GPS failure does **not** clear a permission-granted store
  entry — consistent with the hook's keep-known-good-coords semantics; the freshness window
  bounds its lifetime regardless.

**Consumption is permission-guarded.** `requestCurrentCoords()` changes to: (1) check the current
foreground permission **without prompting** (`Location.getForegroundPermissionsAsync`); if not
granted, clear the store and fall through to the existing prompting path (which will prompt or
resolve `null` as today); if the probe itself **rejects**, the cache is ignored (never served)
and the flow proceeds through the existing caught prompting path — `requestCurrentCoords`
retains its documented never-throw contract (unit-tested); (2) if granted and
`latestFix(FRESH_FIX_MAX_AGE_MS)` exists, resolve it immediately; (3) otherwise run the existing
bounded fetch. A revoked permission therefore can never be bypassed by a cached coordinate; this
is the explicit privacy contract for cross-screen reuse (the store may serve a submit on the
detail screen from a fix acquired on the map screen within the 15 s window, with permission
re-verified at consumption time).

### 3. Permission outcomes rich enough for the denied flow

The current API collapses everything to `Coords | null`, which cannot distinguish "OS will not
re-prompt" from a GPS timeout. Changes (all in the pure module + adapters):

- `PermissionResult` is extended to carry `canAskAgain` (expo already returns it; we currently
  throw it away).
- `fetchForegroundPosition` outcomes become `granted | denied (canAskAgain) | unavailable`.
  **`refresh()` itself returns the rich discriminated outcome**
  (`{ kind: "granted", coords } | { kind: "denied", canAskAgain } | { kind: "unavailable" }`) —
  the press handler branches on the **returned value of the same call**, never on separately
  scheduled React state (an async handler's closure would see the pre-press state; state cannot
  be the authoritative result channel for the in-flight gesture). The locate button is the only
  current `refresh()` caller (`index.tsx:578`), so the signature changes outright — no
  compatibility wrapper. The hook may additionally mirror the last outcome into state purely for
  rendering labels/hints. A test covers a press whose just-resolved outcome differs from the
  prior one and asserts the correct action is shown for the new outcome.
- Locate-press behavior by state:
  - `granted`: recenter immediately on the latest (live) fix, then upgrade if `refresh()`
    resolves fresher — current behavior, now warm because of the watch.
  - `locating`/`refreshing`: press is a no-op (single-flight already guarantees this); the button
    shows a spinner.
  - `denied`/`unavailable`: press re-runs the permission request via `refresh()` and branches on
    its returned outcome. If it returns `denied` with `canAskAgain === false`, show a toast with
    an explicit **"Open settings"** action (not an automatic redirect) that calls
    `Linking.openSettings()` with its promise rejection handled (plain replacement toast on
    failure; nothing logged beyond the event name). A `denied` retry dispatches
    `permissionDenied` (state stays honest); an `unavailable` fetch failure keeps the existing
    no-dispatch semantics when coords are already known, and dispatches `failed` when none are.
    **Actionable toast contract** (a new UI element under the style-guide rule, documented in
    `docs/style-guide.md`): `MobileToast` gains an optional action — label in `colors.brandBlue`
    bold on the toast surface, minimum 44 pt touch target, `accessibilityRole="button"`;
    presence of an action extends the auto-dismiss window (3.2 s → 6 s); tapping the action
    dismisses the toast and invokes it; a replacement toast follows the standard dismiss rules.
    Interaction tests cover action tap, auto-dismiss extension, and the settings-open failure
    replacement.

### 4. Locate button: always mounted, stateful, style-guide-specified

Replace the `location.coords ? <Pressable/> : null` mount gate (`index.tsx:560-587`). Exact
contract (to be added to `docs/style-guide.md`, which today documents only the granted-only
button):

- **granted**: current visual (white circle, `colors.brandBlue` `locate` icon).
- **locating / refreshing**: same container, `ActivityIndicator` (small, `colors.brandBlue`)
  replacing the icon; `accessibilityState={{ busy: true }}`; presses ignored (single-flight), the
  control is NOT marked `disabled` (it announces busy, not unavailable).
- **denied / unavailable**: same container, `locate` icon in the muted/secondary text color
  token; still actionable (it retries permission); `accessibilityLabel` "Location unavailable —
  tap to retry"; `accessibilityHint` mentions settings when `canAskAgain` is false.
- The button is rendered whenever the map screen is (no mount gate).

### 5. Honest first-fix overlay

While `status === "locating"`, `MapOverlay` shows a "Locating you…" state instead of the
misleading `belowZoom` "Zoom in to see fountains" hint. **`status` alone is the complete
condition**: `locating` is entered exactly once, by the mount fetch's `started` event —
`refresh()` never dispatches `started` (`location.ts:29-37` documents this deliberately), so the
state can never return to `locating` after the first resolution. No ref is read in render and no
new state is introduced (the earlier idea of also consulting the initial-center ref is dropped —
it was redundant and would have violated the React-Compiler rule). Overlay priority: the
`locating` state ranks above `belowZoom` and below the error/offline states. Documented in
`docs/style-guide.md`.

### 6. Camera and draft-pin policy

Watch updates move the blue dot and refresh `location.coords`; they do **not** move the camera.
Automatic camera moves remain: one-time initial center, locate press, "Use current location",
add-mode entry.

The add-mode allowed-area bound (`index.tsx:253-267`) now tracks the live fix. Explicit policy for
the moving-bound interaction: **a draft pin that was validly dropped stays valid** — the bound
constrains *new* placement actions at the moment they happen, and an already-dropped pin is never
invalidated or blocked from submission because the user subsequently walked away (the pin marks
the fountain, not the user; the server applies its own guards).

**This policy requires a state-model change, because the current code derives eligibility from
the live bound** (`pinInBound`/`placeable` recheck `state.bound` and disable Next when the moving
bound excludes the pin — `index.tsx:899-900, 1020-1024` — which is exactly what the policy
forbids). Design: the invariant **"a pin only enters state via a bound-validated action" is
enforced by the reducer against its OWN `state.bound`** — placement actions (drop/nudge/place)
carry only the placement intent/point (and nudge direction); the reducer validates the resulting
point against the current `state.bound`, with `state.bound === null` as the sole pre-bound
exception (today's semantics). Callers cannot supply, override, or null out the bound through the
action API, so a future or missed caller cannot install an unvalidated pin — the bound in state
is the single source of truth. `setBound` may move the bound without invalidating the existing
accepted pin; every *subsequent* placement/nudge is checked against the new current bound. Every
placement path (the add-mode entry seed pin, "Use current location", place-at-center, map tap,
nudge) flows through those actions. `Next`/submission eligibility derives from
`state.pin != null` — an accepted-pin fact — not from a live `inBound` recheck. The live bound continues to gate **new** actions: a
nudge/placement attempted after the bound moved away is rejected with the existing out-of-area
toast, while the already-accepted pin remains submittable. Tests cover each placement path
marking acceptance and the walked-away scenario (pin accepted → bound moves → Next/submit still
enabled → nudge out of the new bound rejected). This is a UI-policy decision local to this spec;
it has no dependency on the backend lock design.

## Scope and correctness

- No backend or api-client changes. Foreground-only; request-on-use; no new permission strings.
- `foregroundLocationReducer` and the controller stay pure and node-testable; expo adapters live
  in `location-request.ts`.
- Explicitly out of scope: splash gating, auth-chip pop-in, image placeholders (#215 P3), web
  changes, high-accuracy tracking modes, and #241/#244 concerns (sibling spec).

## Verification

> **Amendment (2026-07-17, from Slice A / PR #246)**: the "CI-gated render/interaction tests
> (jsdom)" categories below are impossible in this repo — the mobile Vitest toolchain
> (rolldown/oxc) cannot import `react-native` (`RolldownError: Flow is not supported`, in CI
> too) and no RN renderer is resolved; adding render infrastructure was previously rejected
> (`mobile/components/nav/ProfileTabIcon.cache.test.ts` header). The behaviors those items
> targeted are verified instead per the implementation plan's amended strategy: a pure
> dependency-injected session module + production-deps factory (hook = thin untested binder),
> pure camera-policy and placement-coordinator seams, pure UI-state descriptors with type-level
> wiring contracts, and an enumerated owner on-device checklist on #243/#215 for every binding
> the pure seams cannot prove (including the privacy-critical background-stop checks, gated
> before the next store release). Behavior decisions in this spec are unchanged.

**Node-safe unit tests (local + CI `workspace-js`):**

1. Controller races, with controlled deferred start promises in both resolution orders,
   asserting **counts of native start/remove/live handles** (not published fixes): start
   resolving after stop/blur/unmount → removed immediately, zero fixes published; desired
   true→false→true while a start is pending → no second concurrent native start, the settled
   subscription is removed, exactly one replacement started; start rejection consumed; idempotent
   stop; the single-pending-start + single-live-subscription invariant holds throughout.
   Rejected-start recovery: first start rejects while desired stays true → no unhandled
   rejection, no coordinate log, controller is retryable; the retry timer starts exactly one
   replacement; a reconcile signal (refocus / AppState edge / successful refresh) retries
   immediately and cancels the timer; blur/background before recovery cancels it; repeated
   rejections retry at the fixed cadence without spinning or accumulating timers/starts.
2. Fix store: newest-`effectiveTimestampMs` wins with out-of-order publishes (watch vs. refresh
   in both orders); last-known fallback with an old source timestamp is not "fresh"; future skew
   at **+1 ms, +59 s, and beyond** all bounded by receipt time; injected-clock rollback →
   negative age → treated stale (falls through to fetch); non-finite rejected; a skew-clamped fix
   does not displace a genuinely newer fix; `resetLatestFix` clears; every test resets
   deterministically.
3. `requestCurrentCoords`: not-granted current permission → store cleared, falls through (no
   cache served); permission-probe rejection → cache ignored, existing caught path, resolves
   without throwing; granted + fresh → cache served without a fetch; granted + stale → bounded
   fetch; denial still resolves `null`.
4. Permission outcomes: `canAskAgain` propagated; reducer transitions for retry-denied /
   retry-granted / unavailable-with-known-coords / unavailable-without. Add-reducer enforcement,
   tested at the reducer level against its own `state.bound`: a placement before any bound is
   accepted (pre-bound exception); after `setBound`, an out-of-bound drop/replacement/nudge is
   rejected with no caller-supplied bound anywhere in the action API (no stale/wider/null bound
   can be injected); an already-accepted pin survives a later `setBound`; an invalid nudge or
   replacement leaves the accepted pin unchanged.

**CI-gated render/interaction tests (jsdom; CI `workspace-js` is the truth per `local-dev.md` —
hook tests using `useIsFocused`/`useSyncExternalStore`-AppState need a render harness and are NOT
pure logic):**

5. Hook lifecycle: grant → watch started; blur/background → stopped (controller NOT disposed —
   refocus restarts it); refocus → restarted; unmount → `dispose()` cancels a pending retry
   timer (tested with a scheduled retry outstanding); deferred start resolution after blur does
   not leak; unmount during an in-flight `refresh()` does not set state after unmount.
6. Locate button: all four visual/a11y states; press during refresh ignored; denied press with
   `canAskAgain=false` surfaces the "Open settings" action; settings-open rejection tolerated.
7. Overlay: initial `locating` shows "Locating you…"; denial/failure returns the below-zoom hint;
   first fix resumes normal overlay logic; priority vs. error/offline states.
8. Draft-pin policy: pin dropped in-bound, bound moves away → pin still submittable; nudge out of
   the new bound rejected with the toast.

**On-device (owner, post-merge, tracked on #243/#215):** walking with the map open moves the
app's placement/recenter target without pressing locate; locate press is instant when the watch
is warm; deny-then-press shows the settings guidance; first launch shows "Locating you…";
**backgrounding the app verifiably stops location callbacks on both platforms** (instrumented via
the controller's lifecycle log events — the acceptance check for foreground-only, replacing any
unfalsifiable battery claim).

## Rollout

Normal PR gates (CI + Codex loop). Mobile-only; independent of the other two slices. Ships with
the next store release; emulator verification via `adb emu geo fix` per `local-dev.md`.
