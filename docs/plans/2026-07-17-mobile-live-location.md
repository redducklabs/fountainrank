# Mobile live location — implementation plan (2026-07-17)

Spec (Codex-approved): `docs/specs/2026-07-17-mobile-live-location-design.md`. Issues: #243 +
the location-feedback subset of #215. TDD; branch `feat/mobile-live-location`; Conventional
Commits, one commit per task with the subject given below; never commit `temp/codex-reviews/`.
**Every task's commit leaves the workspace independently green** (typecheck + existing tests): a
task changing a shared API updates all existing consumers/tests in the same commit; a
not-yet-consumed module ships with its own tests.

**Test-strategy amendment (from Slice A / PR #246 implementation)**: this repo's mobile Vitest
toolchain (rolldown/oxc, no Babel/Flow pipeline) **cannot import `react-native` at all**
(`RolldownError: Flow is not supported`, in CI too), and no RN renderer is resolved anywhere;
adding render infrastructure was previously evaluated and rejected (see
`mobile/components/nav/ProfileTabIcon.cache.test.ts`'s header — the established precedent).
The original plan's "jsdom render harness" tests are therefore impossible. Strategy instead —
**maximize the pure surface, keep React bindings thin**:

- All lifecycle/permission/store/refresh orchestration lives in a pure, dependency-injected
  **foreground-location session module** (no React, no expo imports; adapters injected) that the
  hook merely binds to React state. The session module is node-tested exhaustively; the hook
  itself is a thin adapter verified by `tsc`, CI lint, and the on-device checklist.
- **Production dependency assembly is itself importable and tested**: a factory module
  (`mobile/lib/location-deps.ts`, importing expo adapters — mockable with `vi.mock`, unlike
  `react-native` — and the Slice-A `lib/log.ts` seam) exports the exact deps object the hook
  passes to the session. Node tests exercise that factory, so "the shipped app wires the real
  sink/adapters" is proven at the factory seam; only the hook's focus/AppState value delivery
  remains untestable.
- UI states (locate button, toast action, overlay priority) are pure **descriptor functions**
  whose props the components spread directly (Slice A's banner pattern) — descriptors are
  node-tested; visual/interaction confirmation is on-device.
- Camera policy and placement dispatch are pure decision functions, node-tested; the screen
  wires them.
- Interaction-level checks that genuinely need a running app move to the post-merge owner
  on-device checklist (tracked on #243/#215).

**Local completion rule (host-specific, per `local-dev.md`)** — exact commands, not vibes:
- Locally runnable: the named pure-logic Vitest files below (run by path, e.g.
  `pnpm --filter mobile exec vitest run lib/location.test.ts`), `pnpm --filter mobile exec tsc
  --noEmit`, `pnpm run format:check`, and baseline ESLint **if it runs in this environment** —
  otherwise record the limitation and defer mobile lint to CI `workspace-js`.
- CI-gated: the authoritative `workspace-js` (React-Compiler lint + full suite, isolated
  linker) and isolated-linker `expo-doctor` (`mobile-doctor`). An aggregate `./run.ps1 check`
  attempt is NOT evidence for those; record host-limited steps.
- **Before Task 1**: `gh auth status`; `git fetch origin main` FIRST (a stale remote-tracking
  ref silently omits Slice A); resolve PR #246's squash commit to its immutable SHA via
  `gh pr view 246 --json mergeCommit` (recorded at planning time: `2624ee8`) and verify with
  `git merge-base --is-ancestor 2624ee8 origin/main`; inspect the overlapping map-screen diff;
  then `git merge origin/main` into `feat/mobile-live-location`, resolving conflicts by
  preserving both intents, never by resetting; re-check this plan's source-line assumptions
  afterward (Slice A moved code in `index.tsx` and added `mobile/lib/log.ts` + descriptor
  modules this plan builds on).

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

- Files: `mobile/lib/location.ts` (+ test), `mobile/lib/location-request.ts`,
  `mobile/hooks/useForegroundLocation.ts`.
- Tests first: `PermissionResult` carries `canAskAgain`; `fetchForegroundPosition` returns
  `granted | denied(canAskAgain) | unavailable`; reducer transitions for retry-denied /
  retry-granted / unavailable-with-known-coords / unavailable-without.
- Compatibility boundary: `refresh()` keeps returning `Coords | null` until Task 6; the outcome
  type retains `canAskAgain` internally; reducer events unchanged except `failed` → the
  `unavailable` outcome mapping. All consumers updated in this commit; Task 6 changes only the
  return surface.

## Task 3 — watch controller (pure state machine) — `feat(mobile): watch lifecycle controller`

- Files: `mobile/lib/location-watch.ts` + `mobile/lib/location-watch.test.ts` (new; pure, no
  expo/react imports).
- Tests first (deferred promises, both resolution orders, asserting native start/remove/live
  handle **counts**): serialized starts (no second concurrent start while one pending;
  false→true flap → settled subscription removed + exactly one replacement); stale-resolution
  removal; rejection → retryable with a single `WATCH_RETRY_DELAY_MS = 30_000` timer; reconcile
  retries immediately + cancels the timer; blur/background cancels; repeated rejections don't
  spin/accumulate; `stop()` idempotent, distinct from `dispose()` (idempotent, cancels timers,
  invalidates pending, removes live); only the installed subscription publishes. Diagnostics:
  the injected sink receives `watch_started`/`watch_stopped`/`watch_start_rejected` and a
  coordinate-free `watch_fix_received` counter event (event name + static fields ONLY — the
  sink API cannot accept a position, so no coordinate can be captured even by mistake; this
  counter is what makes the background-stop check observable); payloads asserted
  coordinate-free.
- Implement with injected `startWatch`, clock/timer, diagnostic sink.

## Task 4 — expo adapters + guarded consumption — `feat(mobile): watch adapter + guarded coords`

- Files: `mobile/lib/location-request.ts`, new `mobile/lib/location-request.test.ts` (mocked
  expo-location boundary, separate from controller tests).
- Tests first:
  - watch adapter: calls `Location.watchPositionAsync` with exactly `{ accuracy: Balanced,
    timeInterval: 3000, distanceInterval: 10 }`; propagates the `Promise<LocationSubscription>`
    contract; forwards fixes with native timestamp intact; start rejection propagates; a runtime
    watch error mutates nothing, publishes nothing, logs no coordinate.
  - guarded consumption: `requestCurrentCoords` probes permission without prompting;
    not-granted → store cleared, falls through; probe rejection → cache ignored, never throws;
    granted + fresh → cache served (no fetch); granted + stale → bounded fetch; denial →
    `null`; store cleared only on `denied` here (transient `unavailable` keeps a granted
    entry).
- Implement adapter + probe + cache-first `requestCurrentCoords`; consumer arrives in Task 5.

## Task 5 — foreground-location session module + thin hook — `feat(mobile): session-driven watch lifecycle`

- Files: new `mobile/lib/location-session.ts` + `mobile/lib/location-session.test.ts` (pure,
  DI'd: controller, adapters, store, sink, dispatch); new `mobile/lib/location-deps.ts` +
  `mobile/lib/location-deps.test.ts` (the production dependency factory — imports the expo
  adapters and the Slice-A `mobile/lib/log.ts` seam; its test imports the exact exported
  production constructor with expo mocked via `vi.mock`, verifies the real adapter/sink
  identities and behavior, and proves the serialized diagnostic payload is coordinate-free);
  `mobile/hooks/useForegroundLocation.ts` becomes a thin binder.
- Session tests first (node-safe — this replaces the impossible hook render tests): given
  injected `(focused, appActive, status)` inputs, the session drives the controller's desired
  state; grant → started; blur/background → stopped NOT disposed; refocus → restarted;
  `dispose()` cancels an outstanding retry timer; a deferred start resolving after blur doesn't
  leak; an in-flight `refresh()` resolving after `dispose()` performs no further
  dispatch/publish (the unmount-safety property, tested at the session seam); a successful
  `refresh()` invokes controller `reconcile()`.
- **Diagnostics, stated honestly**: node tests prove (a) the controller/session event contract
  (`watch_started`/`watch_stopped`/`watch_start_rejected`, static fields only, no coordinates —
  asserted on the serialized `lib/log.ts` output, which exists after the Slice A merge and
  emits one JSON warn line per event in production per its documented contract) and (b) via the
  `location-deps.ts` factory tests, that the exact production deps object carries that sink.
  What they cannot prove — that the hook passes the factory's deps rather than others — is
  covered by `tsc` (the deps type), CI lint, and a **named on-device precondition** in Task 10:
  observe real `watch_started`/`watch_stopped` events on-device (and `watch_start_rejected` via
  an induced failure if practical) before trusting the background-stop check.
- Hook: binds session state via the reducer + `useSyncExternalStore` AppState adapter (the
  spelled-out wrapper returning a cleanup function; module-scope-stable subscribe/snapshot) +
  `useIsFocused`; consumes `createForegroundLocationSessionDeps()` from `location-deps.ts`;
  contains no orchestration logic of its own. Verified by `tsc`, CI React-Compiler lint, and
  the on-device checklist — stated honestly, not claimed as unit-tested.

## Task 6 — session permission/store integration + rich refresh — `feat(mobile): live coords publication and rich refresh`

- Files: `mobile/lib/location-session.ts` (+ test), `mobile/hooks/useForegroundLocation.ts`,
  `mobile/app/(tabs)/index.tsx` (the single `refresh()` call site).
- Session tests first (node-safe): **denied-clearing across ALL producers** — initial denial,
  refresh denial (both `canAskAgain` values), denial after a prior granted/published fix: state
  `denied`, `resetLatestFix()` called, controller desired false, no coordinate logged;
  unavailable-with-known-fix retains state + store. **Publish sources** — mount, refresh, watch
  all publish; watch/refresh completing in either order leaves the newest-effective fix.
  **Rich `refresh()`** returns the discriminated outcome; the locate call site branches on the
  returned value of the same call. **Settings-open effect lives in the session/effects module**
  (importable): the `Linking.openSettings()` call and its rejection → replacement-toast
  decision are session-owned and Node-tested (rejection injected), because that failure branch
  cannot be induced reliably on-device.
- Implement: publication from all three paths; `refresh()` return change + the one call site;
  the settings-open effect; in this commit.

## Task 7 — camera policy decision — `feat(mobile): one-time-center camera policy`
(if the tests force no source change, the commit is `test(mobile): pin one-time-center camera
policy` instead)

- Files: new `mobile/lib/map/camera-policy.ts` + `camera-policy.test.ts` (node-safe); minimal
  screen wiring in `mobile/app/(tabs)/index.tsx`.
- **Explicit contract**: `nextCameraPolicy(state, event) → { state, command | null }` where
  `state = { hasInitiallyCentered: boolean }` and events are fix arrivals (source: initial
  fetch | watch | refresh) and explicit actions (locate press, use-current-location, add-mode
  entry). The screen owns the state via its reducer/useState (never a `useRef.current` read in
  render) and executes returned commands.
- Tests first: exactly one initial-center command for the first resolved fix regardless of
  initial-fetch/watch/refresh arrival order; subsequent watch fixes never produce a command;
  denial/`unavailable` before any fix produces no command and leaves the one-shot unconsumed;
  explicit actions always produce their commands regardless of the one-shot state; **the
  combined gesture** — a locate press whose refresh yields the FIRST granted fix — emits
  exactly one effective camera command (not initial-center + locate) and consumes the
  one-shot; an explicit press resolving without coordinates emits no command. On-device
  confirms the felt behavior.

## Task 8 — add-reducer bound authority — `feat(mobile): reducer-owned placement bounds`

- Files: `mobile/lib/add-fountain/state.ts` + `state.test.ts`; `mobile/app/(tabs)/index.tsx`.
- Reducer tests first (node-safe): pre-bound placement accepted (sole exception); after
  `setBound`, out-of-bound drop/replacement/nudge rejected — no caller-supplied bound exists in
  the action API (no stale/wider/null bound injectable); accepted pin survives a later
  `setBound`; invalid nudge/replacement leaves the accepted pin unchanged.
- Per-path coverage at a REAL seam (standalone action-creator tests cannot prove the
  unimportable screen uses them): extract a pure **placement coordinator**
  (`mobile/lib/add-fountain/placement-coordinator.ts` + test) with injected `dispatch`, toast,
  and camera effects, exposing one method per path — `enterSeed`, `useCurrentLocation`,
  `placeAtCenter`, `mapTap`, `nudge`. The screen assigns each callback **directly to the
  coordinator method** (thin binding, no inline logic). **Single-validator rule**: a reducer
  `dispatch` returns nothing, so the coordinator cannot learn acceptance from dispatching —
  coordinator and reducer MUST share one exported pure placement-transition validator (the
  reducer applies it as the authoritative enforcement backstop; the coordinator calls the same
  function, given current state/bound, to decide immediate effects). No duplicated `inBound`
  logic; a test proves the coordinator's effect decision and the reducer's transition agree on
  the same inputs. Node tests call the same coordinator functions the screen binds: each
  path's in-bound acceptance (correct action dispatched, camera/toast effects), each path's
  rejection (no pin replacement, toast effect invoked), entry-before-bound exercising the sole
  pre-bound exception, nudge validating its computed result. The screen→coordinator binding
  itself is covered by the on-device checklist, which must exercise **all five paths for
  acceptance and rejection** (not only walked-away nudge).
- Implement: point/intent-only placement actions; reducer validates against `state.bound`;
  Next/submit from `state.pin != null` (`index.tsx:899-900, 1020-1024` rework); all call sites
  updated in this commit.

## Task 9 — locate button + toast action + overlay descriptors — `feat(mobile): stateful locate button and locating overlay`

- Files: pure descriptor functions + tests (node-safe; e.g. `mobile/lib/map/overlay-state.ts`
  pattern established by Slice A — extend/collocate as appropriate);
  `mobile/app/(tabs)/index.tsx` (components spread the descriptors); `docs/style-guide.md`
  (same commit).
- Descriptor tests first: locate-button descriptor for all four states (granted icon;
  locating/refreshing → spinner + `accessibilityState.busy`, presses ignored but not disabled;
  denied/unavailable → muted token, actionable, labels/hints incl. the `canAskAgain === false`
  settings hint); toast-action contract (brandBlue bold label, ≥44 pt target,
  `accessibilityRole: "button"`, auto-dismiss 3.2 s → 6 s with an action, tap
  dismisses+invokes, settings-open rejection → plain replacement toast descriptor); overlay
  priority (`locating` → "Locating you…" above `belowZoom`, below error/offline; below-zoom
  hint returns on denial/failure); the just-resolved-outcome-differs case maps to the new
  outcome's descriptor.
- **Type-level wiring contract**: descriptor return types are exhaustive discriminated unions
  whose fields use the relevant RN prop shapes via type-only imports (or local structural
  types if a type import trips the toolchain); screen bindings consume descriptor fields
  without reconstructing them, so `tsc` rejects missing/invalid required fields even though it
  cannot prove runtime spreading; descriptors return data, not callbacks capturing screen
  state (effect callbacks are owned/tested by the coordinator/session).
- Implement descriptors + wiring + style-guide documentation. Coverage stated honestly:
  descriptors pin the values; the component mapping is `tsc`-constrained and statically
  reviewed; announcement/interaction behavior is on-device (with an accessibility inspection
  method, not visual-only — see Task 10).

## Task 10 — verification + PR (no commit unless verification causes a documented file change;
then `docs(mobile): document live-location verification`)

- Local, exactly: the named node-safe Vitest files from Tasks 1–9 by path;
  `pnpm --filter mobile exec tsc --noEmit`; `pnpm run format:check`; baseline ESLint or the
  recorded limitation. CI authorities: `workspace-js` and `mobile-doctor`. An aggregate
  `./run.ps1 check` attempt is recorded but is not evidence for CI-gated steps.
- PR: `gh auth status` preflight; `gh pr create` linking #243/#215 + the spec; confirm
  `mergeable != CONFLICTING` before waiting on CI; CI green → Codex PR review loop → every PR
  comment (any commenter) addressed → **squash-merge only**. No AI attribution, no time
  estimates.
- **On-device checklist (posted to #243/#215 post-merge). RELEASE GATE: with render tests
  impossible, these checks are the SOLE behavioral verification of the binding layer — ALL
  applicable items must pass on BOTH platforms, with results recorded on the issues, before
  the next store release ships this code. The privacy-critical items (1)–(3) are additionally
  an early hard gate (exercise them first, on the emulator, before any other item is
  trusted).** Items, each with expected observations:
  (1) diagnostics precondition — real `watch_started`/`watch_stopped` events observed in the
  device log (and `watch_start_rejected` via an induced failure if practical) BEFORE trusting
  later checks; (2) background stop, made observable: while backgrounded, inject an emulator
  fix (`adb emu geo fix`) — no coordinate-free `watch_fix_received` event fires during the
  background interval, and on foregrounding neither the store-served coords nor the
  placement/recenter target reflect the background movement (combined with the observed
  `watch_stopped`); (3) blur to another tab then refocus restarts the watch (no disposal) —
  and, distinctly, leaving the map screen entirely (navigation unmount) disposes: no watch
  events until the screen is re-entered; (4) a locate press after a failed watch start
  recovers tracking (reconcile); (5) pressing locate while already `locating`/`refreshing` is
  ignored — no overlapping refresh, no second camera command; (6) first fix centers the camera
  exactly once — later movement never chases the camera — including the combined case where a
  locate press produces the first fix (exactly one camera move); (7) explicit locate,
  "Use current location", and add-mode entry each still command the camera; (8) all five
  placement paths accept in-bound and reject out-of-bound with the toast (entry seed,
  use-current-location, place-at-center, map tap, nudge); (9) walking/emulated movement with
  the map open moves the placement/recenter target without a locate press, at plausible
  cadence per platform; (10) permission matrix: deny with `canAskAgain` true → retry
  re-prompts; deny with `canAskAgain` false → the settings toast appears on the SAME press
  (not a stale prior outcome — flip the OS permission between presses to prove same-call
  freshness) and its action tap opens system settings; a transient GPS failure with a known
  fix preserves the button state and cached coords; (11) toast mechanics on-device: action tap
  dismisses+invokes, auto-dismiss extends with an action present (the `Linking.openSettings()`
  FAILURE replacement is NOT an on-device item — the OS cannot induce it reliably, so that
  branch lives in the importable session/effects coordinator and is Node-tested, per Task 6);
  (12) overlay priority checked against REAL offline/error states (airplane mode, forced fetch
  error) — not only the locating/below-zoom copy — plus "Locating you…" priority and
  below-zoom return on denial; (13) locate-button states visually + accessibility props
  verified by inspection (`uiautomator dump` per `local-dev.md` on Android / an equivalent
  inspector on iOS), not visual-only.
