// The pure, dependency-injected foreground-location session (spec §1-3). No React, no expo imports:
// it owns the permission/store/refresh orchestration and drives the watch controller from
// (focused, appActive, status) inputs, while `useForegroundLocation` merely binds it to React
// state. This is the node-tested seam that replaces the impossible hook render tests. Never logs
// coordinates (the diagnostic sink API cannot even carry one).

import {
  pickCoords,
  type Coords,
  type FetchOutcome,
  type ForegroundLocationEvent,
  type LocationStatus,
  type RawPosition,
} from "./location";
import {
  createWatchController,
  type StartWatch,
  type WatchSink,
  type WatchTimer,
} from "./location-watch";

/** The React-derived inputs the hook feeds the session each render. */
export type LocationSessionInputs = {
  focused: boolean;
  appActive: boolean;
  status: LocationStatus;
};

/** The rich outcome of a locate `refresh()` - the press handler branches on the SAME call's value. */
export type RefreshOutcome =
  | { kind: "granted"; coords: Coords }
  | { kind: "denied"; canAskAgain: boolean }
  | { kind: "unavailable" };

/**
 * Diagnostics consumed by the session. `watchSink` is handed to the controller (watch lifecycle +
 * the coordinate-free fix counter); `onAppActiveChange` is called on every AppState active↔inactive
 * transition so the dev verification channel can bracket its background-fix counter interval. The
 * production channel ignores everything except `watch_start_rejected` (see `location-deps.ts`).
 */
export type LocationDiagnostics = {
  watchSink: WatchSink;
  onAppActiveChange: (active: boolean) => void;
};

/** Non-React platform dependencies, assembled by `createForegroundLocationSessionDeps`. */
export type LocationSessionPlatformDeps = {
  startWatch: StartWatch;
  fetchOutcome: () => Promise<FetchOutcome>;
  publishFix: (pos: RawPosition) => void;
  resetStore: () => void;
  diagnostics: LocationDiagnostics;
  timer: WatchTimer;
};

/** The React bindings the hook supplies. */
export type LocationSessionReactDeps = {
  dispatch: (event: ForegroundLocationEvent) => void;
};

export type LocationSession = {
  /** Called on every input change; recomputes desired watch state and notifies AppState transitions. */
  setInputs: (inputs: LocationSessionInputs) => void;
  /** The mount fetch: dispatches `started`, then the resolved outcome (mount clears coords on failure). */
  acquireInitialFix: () => Promise<void>;
  /** The locate-button refresh: returns the rich outcome; publishes + reconciles the watch on success. */
  refresh: () => Promise<RefreshOutcome>;
  /** Permanent teardown (hook unmount): disposes the controller; any in-flight fetch becomes a no-op. */
  dispose: () => void;
};

export function createLocationSession(
  platform: LocationSessionPlatformDeps,
  react: LocationSessionReactDeps,
): LocationSession {
  let disposed = false;
  // The session's own view of whether a usable fix is known (mirrors the reducer's coords). Used to
  // decide the unavailable branch (keep a known-good fix vs. mark unavailable) WITHOUT a React ref.
  let knownCoords: Coords | null = null;
  // Tracks the last AppState value so we notify diagnostics only on an actual transition (the app's
  // initial active baseline is not a transition and must not emit a spurious background summary).
  let lastAppActive: boolean | null = null;

  const controller = createWatchController({
    startWatch: platform.startWatch,
    onFix: (pos) => publishAndDispatch(pos),
    sink: platform.diagnostics.watchSink,
    timer: platform.timer,
  });

  function publishAndDispatch(pos: RawPosition): void {
    if (disposed) return;
    platform.publishFix(pos);
    const coords = pickCoords(pos);
    knownCoords = coords;
    react.dispatch({ type: "positionResolved", coords });
  }

  // Applies a fetched/mount outcome to state + store + controller (spec §3). Denial clears the store
  // and stops the watch across ALL producers; a transient unavailable keeps a known-good fix.
  function consumeOutcome(outcome: FetchOutcome, mountFallback: boolean): RefreshOutcome {
    if (disposed) return toRefreshOutcome(outcome);
    if (outcome.kind === "granted") {
      publishAndDispatch(outcome.position);
      // A successful fetch proves the platform can deliver a fix; nudge the watch to (re)start even
      // when `status` did not string-change (so the shouldWatch effect would not re-fire).
      controller.reconcile();
      return { kind: "granted", coords: pickCoords(outcome.position) };
    }
    if (outcome.kind === "denied") {
      react.dispatch({ type: "permissionDenied" });
      platform.resetStore();
      knownCoords = null;
      controller.setDesired(false);
      return { kind: "denied", canAskAgain: outcome.canAskAgain };
    }
    // unavailable: a transient GPS/system failure. Mark unavailable only when no fix is known
    // (mount, or a prior denial cleared it); never blank out a known-good position.
    if (mountFallback || knownCoords === null) {
      react.dispatch({ type: "failed" });
      knownCoords = null;
    }
    return { kind: "unavailable" };
  }

  function toRefreshOutcome(outcome: FetchOutcome): RefreshOutcome {
    if (outcome.kind === "granted")
      return { kind: "granted", coords: pickCoords(outcome.position) };
    if (outcome.kind === "denied") return { kind: "denied", canAskAgain: outcome.canAskAgain };
    return { kind: "unavailable" };
  }

  function setInputs(inputs: LocationSessionInputs): void {
    if (disposed) return;
    if (lastAppActive !== inputs.appActive) {
      const isTransition = lastAppActive !== null;
      lastAppActive = inputs.appActive;
      if (isTransition) platform.diagnostics.onAppActiveChange(inputs.appActive);
    }
    const desired = inputs.focused && inputs.appActive && inputs.status === "granted";
    controller.setDesired(desired);
  }

  async function acquireInitialFix(): Promise<void> {
    if (disposed) return;
    react.dispatch({ type: "started" });
    const outcome = await platform.fetchOutcome();
    consumeOutcome(outcome, true);
  }

  async function refresh(): Promise<RefreshOutcome> {
    const outcome = await platform.fetchOutcome();
    return consumeOutcome(outcome, false);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    controller.dispose();
  }

  return { setInputs, acquireInitialFix, refresh, dispose };
}
