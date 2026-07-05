// Pure state + mapping helpers for foreground GPS location
// (mobile/hooks/useForegroundLocation.ts). Shared by both the mount-time initial
// fix and the locate-button refresh (spec 2026-07-01 §3.4) so the two flows
// can't drift. No React, no expo-location import - the hook injects the real
// permission/position functions (see `fetchForegroundPosition`) so this module
// is unit-testable without RN render infra. Coordinates only ever pass through
// as plain numbers - this module never logs.

export type LocationStatus = "idle" | "locating" | "granted" | "denied" | "unavailable";

export type Coords = { latitude: number; longitude: number; accuracy: number | null };

export type ForegroundLocationState = {
  status: LocationStatus;
  coords: Coords | null;
};

export const initialForegroundLocationState: ForegroundLocationState = {
  status: "idle",
  coords: null,
};

export type ForegroundLocationEvent =
  | { type: "started" }
  | { type: "permissionDenied" }
  | { type: "positionResolved"; coords: Coords }
  | { type: "failed" };

/**
 * Pure transition for the foreground-location state machine. The mount-time
 * fetch dispatches "started" first (clearing any stale coords while the first
 * fix resolves); the locate-button refresh (spec §3.4) dispatches only the
 * terminal "positionResolved" event on success and dispatches nothing on
 * failure/denial, so a transient refresh error can't blank out an
 * already-known-good position or hide the locate button that triggered it -
 * see `useForegroundLocation`.
 */
export function foregroundLocationReducer(
  state: ForegroundLocationState,
  event: ForegroundLocationEvent,
): ForegroundLocationState {
  switch (event.type) {
    case "started":
      return { status: "locating", coords: null };
    case "permissionDenied":
      return { status: "denied", coords: null };
    case "positionResolved":
      return { status: "granted", coords: event.coords };
    case "failed":
      return { status: "unavailable", coords: null };
  }
}

/** The minimal shape of an expo-location `LocationObject` this module depends on. */
export type RawPosition = {
  coords: { latitude: number; longitude: number; accuracy: number | null };
};

/** Maps an expo-location position into our `Coords` shape. */
export function pickCoords(pos: RawPosition): Coords {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  };
}

export type PermissionResult = { status: string };
export type RequestPermission = () => Promise<PermissionResult>;
export type GetCurrentPosition = () => Promise<RawPosition>;
/** Last-known fix lookup - resolves `null` when the platform has no cached fix. */
export type GetLastKnownPosition = () => Promise<RawPosition | null>;

/**
 * How long a single current-position fetch may run before we fall back to the
 * last-known fix (spec §3.4). expo-location's `getCurrentPositionAsync` has no
 * timeout option and can take several seconds - or never resolve - when a fresh
 * fix can't be acquired.
 */
export const CURRENT_POSITION_TIMEOUT_MS = 8000;

/**
 * Resolve a current position WITHOUT ever hanging. `getCurrentPositionAsync` can
 * stall indefinitely (no timeout option; see Expo's own docs), which is exactly
 * what left the locate button dead after the §3.4 change: its `onPress` awaited
 * that fetch and only recentered on success, so a slow/stalled fetch produced a
 * silent no-op (and, because the in-flight guard only clears once the promise
 * settles, bricked every later press too). Here we race the fetch against
 * `timeoutMs` and, if it is too slow or rejects, fall back to the last-known fix so
 * a press still yields a usable position. Throws only when neither a fresh nor a
 * last-known fix is available - `fetchForegroundPosition` maps that to
 * `{ kind: "failed" }`. Both inputs are swallowed on rejection so a late rejection
 * can't surface as an unhandled promise rejection. Never logs coordinates.
 */
export async function resolveCurrentPosition(
  getCurrentPosition: GetCurrentPosition,
  getLastKnownPosition: GetLastKnownPosition,
  timeoutMs: number,
): Promise<RawPosition> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = getCurrentPosition().catch(() => null);
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const fix = await Promise.race([current, timeout]);
    if (fix) return fix;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const lastKnown = await getLastKnownPosition().catch(() => null);
  if (lastKnown) return lastKnown;
  throw new Error("current position unavailable");
}

export type FetchOutcome =
  { kind: "granted"; coords: Coords } | { kind: "denied" } | { kind: "failed" };

/**
 * Requests foreground permission (if needed) and fetches the current position.
 * Dependency-injected so it's unit-testable without expo-location or React (see
 * location.test.ts) - `useForegroundLocation` wires in the real expo-location
 * calls. Used by BOTH the mount-time initial fix and the locate-button refresh
 * (spec §3.4), so they can never drift out of sync. Never throws: a
 * rejected/erroring dependency resolves to `{ kind: "failed" }`. Never logs
 * coordinates.
 */
export async function fetchForegroundPosition(
  requestPermission: RequestPermission,
  getCurrentPosition: GetCurrentPosition,
): Promise<FetchOutcome> {
  try {
    const { status } = await requestPermission();
    if (status !== "granted") return { kind: "denied" };
    const pos = await getCurrentPosition();
    return { kind: "granted", coords: pickCoords(pos) };
  } catch {
    return { kind: "failed" };
  }
}
