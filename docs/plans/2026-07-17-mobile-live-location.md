# Mobile live location — implementation plan (2026-07-17)

Spec (Codex-approved): `docs/specs/2026-07-17-mobile-live-location-design.md`. Issues: #243 +
the location-feedback subset of #215. TDD; branch `feat/mobile-live-location`; Conventional
Commits, one commit per task with the subject given below; never commit `temp/codex-reviews/`.
**Every task's commit leaves the workspace independently green** (typecheck + existing tests): a
task changing a shared API updates all existing consumers/tests in the same commit; a
not-yet-consumed module ships with its own tests.

**Local completion rule (host-specific, per `local-dev.md`)** — exact commands, not vibes:
- Locally runnable: the named pure-logic Vitest files below (run them by path, e.g.
  `pnpm --filter mobile exec vitest run lib/location.test.ts`), `pnpm --filter mobile exec tsc
  --noEmit`, `pnpm run format:check`, and baseline ESLint **if it runs in this environment** —
  if it does not (known host limitation), record that exact limitation and defer mobile lint to
  CI `workspace-js`.
- CI-gated on this host: all jsdom render/interaction suites, the full mobile Vitest suite, the
  React-Compiler mobile lint (`workspace-js`), and isolated-linker `expo-doctor`
  (`mobile-doctor`). An aggregate `./run.ps1 check` attempt is NOT evidence for any of those;
  record which steps were host-limited.
- Every render test file has `// @vitest-environment jsdom` as line 1; pure files stay in the
  Node environment.
- **Before Task 1**: create/update `feat/mobile-live-location` from current `main`; resolve any
  dirty-worktree/branch conflict by preserving user changes, never by resetting them.

## Task 1 — fix store + timestamps — `feat(mobile): freshness-aware fix store`

- Files: `mobile/lib/location.ts`, tests in `mobile/lib/location.test.ts` (extend).
- Tests first: `RawPosition`/`pickCoords` carry the native timestamp;
  `effectiveTimestampMs = min(source, receipt)`; newest-effective-wins (tie → receipt) under
  out-of-order publishes; +1 ms / +59 s / beyond-clamp future skew bounded; clock rollback →
  negative age → stale; non-finite rejected; skew-clamped fix cannot displace a newer one;
  `resetLatestFix()`; injected clock; deterministic resets.
- Implement `publishFix`/`latestFix`/`resetLatestFix`, `FRESH_FIX_MAX_AGE_MS`; update existing
  `pickCoords` consumers/tests in this commit.

## Task 2 — permission outcomes — `feat(mobile): rich permission outcomes`

- Files: `mobile/lib/location.ts` (+ its test), `mobile/lib/location-request.ts`,
  `mobile/hooks/useForegroundLocation.ts`.
- Tests first: `PermissionResult` carries `canAskAgain`; `fetchForegroundPosition` returns
  `granted | denied(canAskAgain) | unavailable`; reducer transitions for retry-denied /
  retry-granted / unavailable-with-known-coords / unavailable-without.
- **Compatibility boundary, explicit**: in this task `refresh()` continues to return
  `Coords | null` (the rich return arrives in Task 6); the outcome type retains `canAskAgain`
  internally (the hook consumes outcomes but does not yet expose them); reducer events
  dispatched by the hook are unchanged except `failed` → the `unavailable` outcome mapping. All
  existing consumers/tests updated in this commit; nothing is implemented twice later — Task 6
  only changes the hook's return surface, not the outcome model.

## Task 3 — watch controller (pure state machine) — `feat(mobile): watch lifecycle controller`

- Files: controller + tests in `mobile/lib/location.ts` / `mobile/lib/location.test.ts` (or a
  sibling `mobile/lib/location-watch.ts` + `.test.ts` if size warrants — one module, no expo
  imports).
- Tests first (deferred promises, both resolution orders, asserting native start/remove/live
  handle **counts**): serialized starts (no second concurrent start while one is pending;
  false→true flap → settled subscription removed + exactly one replacement); stale-resolution
  removal; rejection → retryable with a single `WATCH_RETRY_DELAY_MS = 30_000` timer; reconcile
  signals retry immediately + cancel the timer; blur/background cancels; repeated rejections
  don't spin/accumulate; `stop()` idempotent and distinct from `dispose()` (idempotent, cancels
  timers, invalidates pending, removes live — unmount only); only the installed subscription
  publishes. Diagnostics: an injected sink receives `watch_started` / `watch_stopped` /
  `watch_start_rejected`; payloads asserted to contain **no latitude/longitude/accuracy/raw
  position** (no position captured in a closure either — the sink API accepts event name +
  static fields only).
- Implement the controller with injected `startWatch`, clock/timer, diagnostic sink.

## Task 4 — expo adapters + guarded consumption — `feat(mobile): watch adapter + guarded coords`

- Files: `mobile/lib/location-request.ts`, new tests `mobile/lib/location-request.test.ts`
  (mocked expo-location boundary, separate from controller tests so failures identify the
  layer).
- Tests first:
  - watch adapter: calls `Location.watchPositionAsync` with exactly `{ accuracy: Balanced,
    timeInterval: 3000, distanceInterval: 10 }`; returns/propagates the
    `Promise<LocationSubscription>` contract the serialized controller consumes; forwards fixes
    with native timestamp intact; start rejection propagates; a runtime watch error mutates
    nothing, publishes nothing, logs no coordinate.
  - guarded consumption: `requestCurrentCoords` probes permission without prompting;
    not-granted → store cleared, falls through; probe rejection → cache ignored, never throws;
    granted + fresh → cache served (no fetch); granted + stale → bounded fetch; denial →
    `null`; store cleared only on `denied` in this path (transient `unavailable` keeps a
    granted entry).
- Implement adapter + probe + cache-first `requestCurrentCoords`. The adapter ships here with
  its tests; its consumer arrives in Task 5.

## Task 5 — hook lifecycle/controller ownership — `feat(mobile): hook-owned watch lifecycle`

- Files: `mobile/hooks/useForegroundLocation.ts`; new render-harness tests
  `mobile/hooks/useForegroundLocation.test.tsx` (jsdom line-1 directive; CI-gated).
- Tests first: grant → watch started; blur/background → stopped, NOT disposed; refocus →
  restarted; unmount → `dispose()` with an outstanding retry timer; deferred start after blur
  doesn't leak; unmount during in-flight `refresh()` sets no state; **the hook supplies the
  production diagnostic sink** — a stable event-only function emitting through the app's
  logging convention (`console.warn` structured line, event name + static fields, never
  coordinates), asserted by test so the Task-10/on-device background-stop instrument actually
  exists in the shipped app.
- Implement: `useIsFocused` + the spelled-out `useSyncExternalStore` AppState adapter;
  stop-vs-dispose split; controller wiring with the real `startWatch` adapter and the production
  sink. `refresh()` surface unchanged in this task.

## Task 6 — hook permission/store integration + rich refresh — `feat(mobile): live coords publication and rich refresh`

- Files: `mobile/hooks/useForegroundLocation.ts` (+ its test), `mobile/app/(tabs)/index.tsx`
  (the single `refresh()` call site).
- Tests first (same render harness): **denied-clearing across ALL producers** — initial
  denial, refresh denial (both `canAskAgain` values), denial after a prior granted/published
  fix: hook state `denied`, `resetLatestFix()` called, controller desired false (stop), no
  coordinate logged; unavailable-with-known-fix retains state + store. **Publish sources** —
  mount, refresh, and watch all publish; watch/refresh completing in either order leaves the
  newest-effective fix (hook-level race complement to Task 1). **Rich `refresh()`** returns the
  discriminated outcome; the locate call site branches on the returned value (prior-outcome ≠
  new-outcome case covered in Task 8's UI tests).
- Implement: publication from all three paths; `refresh()` return change + the one call site in
  the same commit.

## Task 7 — map-screen camera policy — `test(mobile): camera policy under continuous location`
(use that subject only if the commit is genuinely test-only; if the tests force a source/behavior
change, use a `fix(mobile):`/`feat(mobile):` subject describing that change)

- Files: new `mobile/app/(tabs)/index.camera.test.tsx` (jsdom, CI-gated) + any minimal screen
  change the tests force.
- Tests first: the first resolved fix issues exactly one initial center; subsequent watch fixes
  update exposed coords/bounds but never issue a camera command (no `setFlyTo`); a watch fix
  arriving before/after the initial fetch keeps the one-time-center rule deterministic; explicit
  locate / "Use current location" / add-mode entry still command the camera.

## Task 8 — add-reducer bound authority — `feat(mobile): reducer-owned placement bounds`

- Files: `mobile/lib/add-fountain/state.ts` + `state.test.ts`; `mobile/app/(tabs)/index.tsx`;
  screen tests in the map-screen test file (jsdom, CI-gated).
- Reducer tests first (node-safe): pre-bound placement accepted; after `setBound`, out-of-bound
  drop/replacement/nudge rejected — no caller-supplied bound exists anywhere in the action API;
  accepted pin survives a later `setBound`; invalid nudge/replacement leaves the accepted pin
  unchanged.
- **Per-placement-path matrix (CI-gated screen tests — the reducer being correct does not prove
  the paths dispatch correctly)**, with the entry rows split to match reachable states (do not
  manufacture an unreachable screen state to satisfy the table, and do not turn the entry
  exception into a general bypass): normal add-mode entry seeds with `state.bound === null` and
  is accepted under the documented sole pre-bound exception; only if implementation introduces
  an atomic set-bound-then-seed (or another reachable entry-with-bound state) does entry get
  in-bound-accept + excluding-bound-reject rows; every post-entry path ("Use current location",
  place-at-center, map tap, nudge) is tested both for current-state-bound acceptance and for
  rejection without replacing the accepted pin, surfacing the expected toast where the UI owns
  that feedback; nudge validates its computed result; plus the walked-away scenario (pin
  accepted → bound moves → Next/submit still enabled → out-of-bound nudge rejected).
- Implement: point/intent-only placement actions; reducer validates against `state.bound`;
  Next/submit from `state.pin != null` (`index.tsx:899-900, 1020-1024` rework); all placement
  call sites updated in this commit.

## Task 9 — locate button + toast action + overlay — `feat(mobile): stateful locate button and locating overlay`

- Files: `mobile/app/(tabs)/index.tsx`; `MobileToast`/`MapOverlay` are currently local
  functions inside that file — this task tests them through a named map-screen test file,
  `mobile/app/(tabs)/index.location-ui.test.tsx` (jsdom line-1 directive, CI-gated), unless
  extraction into named component modules (with exact `.test.tsx` siblings) proves necessary,
  in which case the extraction is part of this task's single commit; `docs/style-guide.md`
  (same commit).
- Tests first: four button states + a11y contract; press during refresh ignored; denied press
  with `canAskAgain=false` → toast with "Open settings" action; settings-open rejection → plain
  replacement toast; toast action tap dismisses+invokes; auto-dismiss extends to 6 s with an
  action; overlay `locating` shows "Locating you…", priority vs error/offline, below-zoom hint
  returns on denial/failure; a press whose just-resolved outcome differs from the prior one
  shows the new outcome's action.

## Task 10 — verification + PR (no commit unless verification causes a documented file change;
then `docs(mobile): document live-location verification`)

- Local, exactly: the named node-safe Vitest files from Tasks 1–4 and 8 by path;
  `pnpm --filter mobile exec tsc --noEmit`; `pnpm run format:check`; baseline ESLint or the
  recorded limitation. CI authorities: `workspace-js` (render suites + React-Compiler lint) and
  `mobile-doctor`. An aggregate `./run.ps1 check` attempt is recorded but is not evidence for
  the CI-gated steps.
- PR: `gh auth status` preflight; `gh pr create` linking #243/#215 + the spec; confirm
  `mergeable != CONFLICTING` before waiting on CI; CI green → Codex PR review loop → every PR
  comment (any commenter) addressed → **squash-merge only**. On-device follow-ups noted on
  #243/#215: walking cadence per platform; background-stop verified via the Task 3/5 lifecycle
  events. No AI attribution, no time estimates.
