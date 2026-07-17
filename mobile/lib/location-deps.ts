// The production dependency factory the hook consumes (spec §1). It assembles the exact deps object
// `createLocationSession` needs from the real expo adapters (mockable via `vi.mock`), the Slice-A
// `log.ts` seam, and the process-wide fix store - and it decides, by build, which diagnostics
// channel the watch controller gets. This module is importable and node-tested (unlike the hook),
// so the production/verification diagnostics split is proven, not merely asserted by review.

import { fetchForegroundPosition, publishFix, resetLatestFix } from "./location";
import { getCurrentPosition, requestPermission, watchForegroundPosition } from "./location-request";
import type { LocationDiagnostics, LocationSessionPlatformDeps } from "./location-session";
import type { WatchSink, WatchTimer } from "./location-watch";
import { logEvent } from "./log";

/** True in dev builds; the verification instrumentation is compiled out of store builds. */
function isDevBuild(): boolean {
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

const realTimer: WatchTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
};

/**
 * Production diagnostics: the ONLY watch event that reaches the wire is `watch_start_rejected`, via
 * the `log.ts` rare-failure logger (one JSON warn line). Success + lifecycle events are dropped -
 * no per-fix output, no coordinates, no movement cadence reconstructable from production logs.
 */
function createProductionDiagnostics(): LocationDiagnostics {
  const watchSink: WatchSink = (event) => {
    if (event.type === "watch_start_rejected") logEvent({ event: "watch_start_rejected" });
  };
  return { watchSink, onAppActiveChange: () => {} };
}

/**
 * Dev verification diagnostics (`__DEV__` only): `watch_started`/`watch_stopped` print a lifecycle
 * line; `watch_start_rejected` still goes through the rare-failure logger; `watch_fix_received`
 * ONLY increments an in-memory counter (no per-fix output, no coordinate). The counter brackets the
 * inactive (backgrounded) interval: going inactive snapshots-and-resets it and counts callbacks
 * until the next active transition, which emits exactly one coordinate- and timestamp-free summary
 * line and resets. Foreground fixes before backgrounding therefore can never make the background
 * summary nonzero - the observable background-stop check.
 */
function createDevDiagnostics(): LocationDiagnostics {
  let countingBackground = false;
  let backgroundFixCount = 0;
  const watchSink: WatchSink = (event) => {
    switch (event.type) {
      case "watch_started":
        console.log("[location] watch_started");
        break;
      case "watch_stopped":
        console.log("[location] watch_stopped");
        break;
      case "watch_start_rejected":
        logEvent({ event: "watch_start_rejected" });
        break;
      case "watch_fix_received":
        if (countingBackground) backgroundFixCount += 1;
        break;
    }
  };
  const onAppActiveChange = (active: boolean): void => {
    if (active) {
      if (countingBackground) {
        console.log(
          `[location] watch_fix_received during inactive interval: ${backgroundFixCount}`,
        );
        countingBackground = false;
        backgroundFixCount = 0;
      }
    } else {
      countingBackground = true;
      backgroundFixCount = 0;
    }
  };
  return { watchSink, onAppActiveChange };
}

/**
 * Assembles the exact platform deps the foreground-location hook passes to `createLocationSession`.
 * The diagnostics channel is chosen by build: production gets the no-op-for-success sink WITHOUT
 * allocating the fix counter or dev serializer.
 */
export function createForegroundLocationSessionDeps(): LocationSessionPlatformDeps {
  return {
    startWatch: watchForegroundPosition,
    fetchOutcome: () => fetchForegroundPosition(requestPermission, getCurrentPosition),
    publishFix,
    resetStore: resetLatestFix,
    diagnostics: isDevBuild() ? createDevDiagnostics() : createProductionDiagnostics(),
    timer: realTimer,
  };
}
