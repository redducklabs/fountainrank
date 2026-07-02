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

export type FetchOutcome =
  | { kind: "granted"; coords: Coords }
  | { kind: "denied" }
  | { kind: "failed" };

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
