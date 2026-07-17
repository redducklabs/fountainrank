// Pure, race-safe foreground watch-lifecycle controller (spec §1). No expo, no React imports -
// `startWatch`, the diagnostic sink, and the retry timer are all dependency-injected so the
// subscription races are node-testable by counting native start/remove/live handles. Coordinates
// only ever pass through `onFix` as plain data; this module never logs and the diagnostic sink API
// cannot carry a coordinate.

import type { RawPosition } from "./location";

/**
 * A rejected start enters a bounded recovery path: exactly one retry timer at this cadence, so
 * repeated rejections retry at a fixed rate and can never tighten into a loop or accumulate timers.
 */
export const WATCH_RETRY_DELAY_MS = 30_000;

/**
 * Coordinate-free watch diagnostics (spec §1). The event carries an event name and static fields
 * ONLY - the sink API cannot accept a position, so no coordinate can be captured even by mistake.
 * `watch_fix_received` is a pure counter signal (what makes the background-stop check observable).
 */
export type WatchDiagnosticEvent =
  | { type: "watch_started" }
  | { type: "watch_stopped" }
  | { type: "watch_start_rejected" }
  | { type: "watch_fix_received" };

export type WatchSink = (event: WatchDiagnosticEvent) => void;

/** The native watch subscription (expo `LocationSubscription`), reduced to what the controller uses. */
export type WatchHandle = { remove: () => void };

/**
 * Starts a native watch, forwarding each fix to `onFix`. `watchPositionAsync` is itself async - it
 * resolves the removable subscription only once the promise settles - so this returns a Promise and
 * the controller owns the settle races explicitly.
 */
export type StartWatch = (onFix: (pos: RawPosition) => void) => Promise<WatchHandle>;

export type TimerId = ReturnType<typeof setTimeout>;

/** Injected timer so the retry cadence is deterministic in tests. */
export type WatchTimer = {
  set: (fn: () => void, ms: number) => TimerId;
  clear: (id: TimerId) => void;
};

export type WatchController = {
  /** Desired = focused && appActive && granted. Drives start/stop, honoring the serialize rules. */
  setDesired: (desired: boolean) => void;
  /**
   * A reconcile signal - a desired-state edge or a successful locate `refresh()` (proof the platform
   * can deliver a fix). Retries immediately and cancels any pending retry timer.
   */
  reconcile: () => void;
  /** Stop watching but stay alive (survives focus/AppState transitions so retries keep working). */
  stop: () => void;
  /** Permanent teardown: cancels timers, invalidates pending starts, removes the live handle. */
  dispose: () => void;
};

export type WatchControllerDeps = {
  startWatch: StartWatch;
  /** Publishes an installed-subscription fix (store + dispatch). Only the live subscription calls it. */
  onFix: (pos: RawPosition) => void;
  sink: WatchSink;
  timer: WatchTimer;
};

/**
 * Builds the watch-lifecycle controller. Invariants (each tested by counting handles, not fixes):
 * at most one *pending start* and at most one *live subscription* exist at any time, and a
 * subscription never stays live while `desired` is false beyond its own settle turn.
 */
export function createWatchController(deps: WatchControllerDeps): WatchController {
  let desired = false;
  let disposed = false;
  let liveHandle: WatchHandle | null = null;
  let liveGeneration = 0;
  // The generation of the single in-flight start (0 = none). Serializes starts: while non-zero, a
  // desired→true edge only records intent, it never issues a second concurrent `startWatch`.
  let pendingGeneration = 0;
  // The current pending start became unwanted at some point (desired flipped false while it was in
  // flight). On settle we discard the resolved subscription and issue exactly one replacement.
  let pendingStale = false;
  let generationCounter = 0;
  let retryTimer: TimerId | null = null;

  function cancelRetry(): void {
    if (retryTimer !== null) {
      deps.timer.clear(retryTimer);
      retryTimer = null;
    }
  }

  // Only the currently installed subscription's callbacks may publish; fixes from a not-yet-installed
  // or already-removed (stale-generation) subscription are dropped, and cannot increment the counter.
  function makeFixCallback(generation: number): (pos: RawPosition) => void {
    return (pos: RawPosition) => {
      if (disposed) return;
      if (liveHandle === null || liveGeneration !== generation) return;
      deps.sink({ type: "watch_fix_received" });
      deps.onFix(pos);
    };
  }

  function startOne(): void {
    const generation = ++generationCounter;
    pendingGeneration = generation;
    pendingStale = false;
    deps.startWatch(makeFixCallback(generation)).then(
      (handle) => onStartResolved(generation, handle),
      () => onStartRejected(generation),
    );
  }

  function onStartResolved(generation: number, handle: WatchHandle): void {
    if (generation !== pendingGeneration) {
      // Superseded (defensive - starts are serialized, so this should not normally occur).
      handle.remove();
      return;
    }
    pendingGeneration = 0;
    if (disposed || !desired) {
      // Unwanted at settle time → remove immediately; nothing is installed and nothing publishes.
      handle.remove();
      return;
    }
    if (pendingStale) {
      // desired flapped false→true while pending → the settled subscription is stale. Remove it and
      // issue exactly one replacement start.
      pendingStale = false;
      handle.remove();
      startOne();
      return;
    }
    liveHandle = handle;
    liveGeneration = generation;
    deps.sink({ type: "watch_started" });
  }

  function onStartRejected(generation: number): void {
    if (generation !== pendingGeneration) return;
    pendingGeneration = 0;
    pendingStale = false;
    deps.sink({ type: "watch_start_rejected" });
    if (disposed || !desired) return;
    scheduleRetry();
  }

  function scheduleRetry(): void {
    if (retryTimer !== null) return; // single timer - never accumulate
    retryTimer = deps.timer.set(() => {
      retryTimer = null;
      if (disposed || !desired) return;
      if (liveHandle !== null || pendingGeneration !== 0) return;
      startOne();
    }, WATCH_RETRY_DELAY_MS);
  }

  function reconcileInternal(): void {
    if (disposed || !desired) return;
    if (liveHandle !== null) return; // already watching
    if (pendingGeneration !== 0) return; // a start is in flight; it installs on settle
    startOne();
  }

  function setDesired(next: boolean): void {
    if (disposed) return;
    desired = next;
    if (next) {
      reconcileInternal();
      return;
    }
    // Becoming unwanted: cancel recovery, mark any pending start for removal on settle, and remove
    // the live subscription (emitting watch_stopped only when one was actually installed).
    cancelRetry();
    if (pendingGeneration !== 0) pendingStale = true;
    if (liveHandle !== null) {
      liveHandle.remove();
      liveHandle = null;
      deps.sink({ type: "watch_stopped" });
    }
  }

  function reconcile(): void {
    if (disposed) return;
    cancelRetry();
    reconcileInternal();
  }

  function stop(): void {
    setDesired(false);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelRetry();
    if (pendingGeneration !== 0) pendingStale = true; // a late-resolving start will be removed on settle
    if (liveHandle !== null) {
      liveHandle.remove();
      liveHandle = null;
    }
  }

  return { setDesired, reconcile, stop, dispose };
}
