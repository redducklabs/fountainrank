export type LocationFixSource = "startup" | "nearest" | "maplibre-geolocate";

export type LocationFixAttempt =
  { kind: "success"; source: LocationFixSource; atMs: number } | { kind: "failure" };

export type IntervalScheduler<Handle> = {
  setInterval(callback: () => void, delayMs: number): Handle;
  clearInterval(handle: Handle): void;
};

const defaultScheduler: IntervalScheduler<ReturnType<typeof setInterval>> = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
};

/** The copy is deliberately derived from a successful fix only; errors preserve it. */
export function nextSuccessfulFixTimestamp(
  previous: number | null,
  attempt: LocationFixAttempt,
): number | null {
  return attempt.kind === "success" ? attempt.atMs : previous;
}

export function formatLocationFreshness(
  lastSuccessfulFixAtMs: number | null,
  nowMs: number,
): string {
  if (lastSuccessfulFixAtMs === null) return "Location unavailable";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - lastSuccessfulFixAtMs) / 1_000));
  return `Location refreshed ${elapsedSeconds}s ago`;
}

/** Starts a display-only ticker. Location acquisition belongs to the map controls and callers. */
export function startLocationFreshnessTicker<Handle = ReturnType<typeof setInterval>>(
  onTick: () => void,
  scheduler: IntervalScheduler<Handle> = defaultScheduler as IntervalScheduler<Handle>,
): () => void {
  onTick();
  const handle = scheduler.setInterval(onTick, 1_000);
  return () => scheduler.clearInterval(handle);
}
