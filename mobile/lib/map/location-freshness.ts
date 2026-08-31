/** Copy for the non-live location-freshness label shown below Locate me. */
export function formatLocationFreshness(lastFixAtMs: number | null, nowMs: number): string {
  if (lastFixAtMs === null) return "Location unavailable";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - lastFixAtMs) / 1000));
  return `Location refreshed ${elapsedSeconds}s ago`;
}

export const LOCATION_FRESHNESS_TICK_MS = 1_000;

/** Injected display timer boundary; this module deliberately has no location/GPS dependency. */
export type LocationFreshnessTimer = {
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
};

export type LocationFreshnessTicker = {
  start: () => void;
  stop: () => void;
  dispose: () => void;
};

/**
 * Owns only a display-update interval. The caller decides when it is active (screen focus + app
 * lifecycle); ticks invoke an injected render callback and never acquire or inspect location.
 */
export function createLocationFreshnessTicker(
  timer: LocationFreshnessTimer,
  onTick: () => void,
): LocationFreshnessTicker {
  let interval: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function stop(): void {
    if (interval !== null) {
      timer.clearInterval(interval);
      interval = null;
    }
  }

  function start(): void {
    if (disposed || interval !== null) return;
    interval = timer.setInterval(onTick, LOCATION_FRESHNESS_TICK_MS);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stop();
  }

  return { start, stop, dispose };
}
