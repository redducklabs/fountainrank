/**
 * Guarded submit orchestration for the geolocation-first contribution forms (#212).
 *
 * The rating and condition forms `await requestCurrentCoords()` before the owner's mutation flips to
 * pending, so `mutation.isPending` is NOT immediate — the spinner would only appear after the
 * (bounded) location step. This helper drives a local "busy" value **synchronously** the instant the
 * user taps, so the ActivityIndicator shows right away, and clears it only when the component is
 * still mounted. It is also a single-flight guard: a second tap while the first is in flight is
 * ignored (covering the window before the disabled re-render commits) — the same protection the
 * add-photo flow gets from `singleFlight`, generalized here to also own the busy state.
 *
 * `busyValue` is generic so a form with one submit button can pass a boolean, while the condition
 * form (two buttons sharing one in-flight guard) can pass which status is submitting so only the
 * tapped button spins.
 */
/** A guarded submit runner: `run(busyValue, action)` — single-flight, busy-state-driving. */
export type GuardedSubmit<T> = (busyValue: T, action: () => Promise<void>) => Promise<void>;

export function createGuardedSubmit<T>(deps: {
  setBusy: (value: T) => void;
  /** The value meaning "not busy" (e.g. `false`, or `null` for a status). */
  idle: T;
  /** Read at cleanup time so a submit that outlives the component doesn't setState after unmount. */
  isMounted: () => boolean;
}): GuardedSubmit<T> {
  let inFlight = false;
  return async function run(busyValue: T, action: () => Promise<void>): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    deps.setBusy(busyValue);
    try {
      await action();
    } finally {
      inFlight = false;
      if (deps.isMounted()) deps.setBusy(deps.idle);
    }
  };
}
