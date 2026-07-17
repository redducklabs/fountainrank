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

/** The result of the "Open settings" effect - `failed` drives a plain replacement toast (spec §3). */
export type SettingsOpenResult = { kind: "opened" } | { kind: "failed" };

/**
 * The pure settings-open effect decision (spec §3): run the injected platform `open()` and map its
 * promise rejection to a `failed` result (which the UI turns into a plain replacement toast) - never
 * throwing, never logging anything beyond the outcome. The platform `Linking.openSettings` adapter
 * is supplied by `location-deps.ts`; this failure branch cannot be induced reliably on-device, so it
 * lives here and is Node-tested.
 */
export async function openSettingsEffect(open: () => Promise<void>): Promise<SettingsOpenResult> {
  try {
    await open();
    return { kind: "opened" };
  } catch {
    return { kind: "failed" };
  }
}

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
  /**
   * Publishes a fix to the freshness store, returning whether it was ACCEPTED (newest-effective).
   * The boolean is load-bearing: an older-effective fix (e.g. a slow refresh settling after a newer
   * watch fix) is rejected, and the session must not then regress the reducer/UI to the stale fix.
   */
  publishFix: (pos: RawPosition) => boolean;
  resetStore: () => void;
  /** The platform "Open settings" adapter (`Linking.openSettings`); its rejection is handled. */
  openSettings: () => Promise<void>;
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
  /**
   * The mount fetch: dispatches `started`, then the resolved outcome (mount clears coords on
   * failure). Returns the rich outcome so the hook can mirror `canAskAgain` for the denied hint.
   */
  acquireInitialFix: () => Promise<RefreshOutcome>;
  /** The locate-button refresh: returns the rich outcome; publishes + reconciles the watch on success. */
  refresh: () => Promise<RefreshOutcome>;
  /** Runs the "Open settings" effect (spec §3); a rejection maps to `{ kind: "failed" }`. */
  openSettings: () => Promise<SettingsOpenResult>;
  /** Permanent teardown (hook unmount): disposes the controller; any in-flight fetch becomes a no-op. */
  dispose: () => void;
};

export function createLocationSession(
  platform: LocationSessionPlatformDeps,
  react: LocationSessionReactDeps,
): LocationSession {
  let disposed = false;
  // Single-flight across BOTH producers (spec §3): true while the mount acquisition OR a locate
  // refresh is fetching. A press while `status === "locating"` (acquisition in flight) or while
  // another refresh is pending is a no-op, never a second concurrent permission/position request.
  let fetchInFlight = false;
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

  // Publishes a fix and updates the reducer/knownCoords ONLY when the store accepts it. A rejected
  // (older-effective) fix leaves the store's — and thus the reducer's — newer fix intact: no
  // split-brain where the UI/placement bound regress behind the store. Returns acceptance.
  function publishAndDispatch(pos: RawPosition): boolean {
    if (disposed) return false;
    const accepted = platform.publishFix(pos);
    if (accepted) {
      const coords = pickCoords(pos);
      knownCoords = coords;
      react.dispatch({ type: "positionResolved", coords });
    }
    return accepted;
  }

  // Applies a fetched/mount outcome to state + store + controller (spec §3). Denial clears the store
  // and stops the watch across ALL producers; a transient unavailable keeps a known-good fix.
  function consumeOutcome(outcome: FetchOutcome, mountFallback: boolean): RefreshOutcome {
    if (disposed) return toRefreshOutcome(outcome);
    if (outcome.kind === "granted") {
      const accepted = publishAndDispatch(outcome.position);
      // A successful fetch proves the platform can deliver a fix; nudge the watch to (re)start even
      // when `status` did not string-change (so the shouldWatch effect would not re-fire).
      controller.reconcile();
      // Permission WAS granted, so the outcome is `granted`. But if the store rejected this fix (an
      // older refresh settling after a newer watch fix), it — and the reducer — already hold a newer
      // fix (`knownCoords`); return THAT so the caller recenters on the newest, never the stale fix.
      const coords = accepted
        ? pickCoords(outcome.position)
        : (knownCoords ?? pickCoords(outcome.position));
      return { kind: "granted", coords };
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

  async function acquireInitialFix(): Promise<RefreshOutcome> {
    if (disposed) return { kind: "unavailable" };
    react.dispatch({ type: "started" });
    fetchInFlight = true;
    try {
      const outcome = await platform.fetchOutcome();
      return consumeOutcome(outcome, true);
    } finally {
      fetchInFlight = false;
    }
  }

  async function refresh(): Promise<RefreshOutcome> {
    // Busy no-op: the mount acquisition (status "locating") or another refresh is already fetching,
    // so a locate press must not launch a second concurrent request (spec §3-§4).
    if (fetchInFlight) return { kind: "unavailable" };
    fetchInFlight = true;
    try {
      const outcome = await platform.fetchOutcome();
      return consumeOutcome(outcome, false);
    } finally {
      fetchInFlight = false;
    }
  }

  function openSettings(): Promise<SettingsOpenResult> {
    return openSettingsEffect(platform.openSettings);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    controller.dispose();
  }

  return { setInputs, acquireInitialFix, refresh, openSettings, dispose };
}
