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
  /**
   * Native `LocationObject.timestamp` (ms since epoch). Carried through so the fix store can
   * bound a future-skewed source stamp by receipt time and order watch-vs-refresh races - a
   * last-known fallback with an old fix can no longer masquerade as fresh (spec §2).
   */
  timestamp: number;
};

/** Maps an expo-location position into our `Coords` shape. */
export function pickCoords(pos: RawPosition): Coords {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
  };
}

/**
 * A foreground-permission request result. `canAskAgain` is `false` once the OS will not re-prompt
 * (the user must change it in Settings) - expo already returns it; we used to discard it, which is
 * why the denied flow could not distinguish "OS won't re-prompt" from a transient GPS timeout
 * (spec §3).
 */
export type PermissionResult = { status: string; canAskAgain: boolean };
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

/** How long a stored fix stays fresh enough to reuse across screens (spec §2). */
export const FRESH_FIX_MAX_AGE_MS = 15_000;

/**
 * A stored fix with the timestamps needed to reason about freshness and ordering (spec §2).
 * `sourceTimestampMs` is the native `LocationObject.timestamp`; `receiptTimestampMs` is when this
 * process received it; `effectiveTimestampMs = min(source, receipt)` bounds ANY future-skewed
 * source stamp by receipt time so a skewed fix can never appear fresher (or newer) than it is.
 */
export type StoredFix = {
  coords: Coords;
  sourceTimestampMs: number;
  receiptTimestampMs: number;
  effectiveTimestampMs: number;
};

/**
 * A freshness-aware, single-slot fix store (spec §2). Pure with an injected clock so ordering,
 * skew clamping, and clock-rollback handling are all unit-testable. Never logs coordinates.
 *
 * - `publishFix` stores a fix only when its `effectiveTimestampMs` is newer than the current one
 *   (tie broken by the newer `receiptTimestampMs`), so an out-of-order or skew-clamped fix can
 *   never displace a genuinely newer one. A non-finite/absent source timestamp is unusable and is
 *   not stored. Returns whether the fix became the stored one.
 * - `latestFix(maxAgeMs)` returns the stored coords only when `now - effectiveTimestampMs` is in
 *   `[0, maxAgeMs]`; a NEGATIVE age (the clock moved backward past the record) is treated as stale
 *   so an unreliable clock fails safe to a real fetch rather than serving a bogus "fresh" fix.
 */
export function createFixStore(now: () => number) {
  let latest: StoredFix | null = null;

  function publishFix(pos: RawPosition): boolean {
    const source = pos.timestamp;
    if (!Number.isFinite(source)) return false;
    const receipt = now();
    const effective = Math.min(source, receipt);
    if (latest) {
      const isNewer =
        effective > latest.effectiveTimestampMs ||
        (effective === latest.effectiveTimestampMs && receipt > latest.receiptTimestampMs);
      if (!isNewer) return false;
    }
    latest = {
      coords: pickCoords(pos),
      sourceTimestampMs: source,
      receiptTimestampMs: receipt,
      effectiveTimestampMs: effective,
    };
    return true;
  }

  function latestFix(maxAgeMs: number): Coords | null {
    if (!latest) return null;
    const age = now() - latest.effectiveTimestampMs;
    if (age < 0 || age > maxAgeMs) return null;
    return latest.coords;
  }

  function resetLatestFix(): void {
    latest = null;
  }

  return { publishFix, latestFix, resetLatestFix };
}

/**
 * The process-wide fix store shared by the live watch, the mount/locate fetches, and the
 * permission-guarded `requestCurrentCoords` consumer (spec §2). Cross-screen reuse is bounded by
 * `FRESH_FIX_MAX_AGE_MS` and re-verified against live permission at consumption time.
 */
const fixStore = createFixStore(() => Date.now());
export const publishFix = fixStore.publishFix;
export const latestFix = fixStore.latestFix;
export const resetLatestFix = fixStore.resetLatestFix;

/**
 * The rich outcome of a foreground position request (spec §3). `denied` carries `canAskAgain` so
 * the locate flow can offer an "Open settings" action only when the OS will not re-prompt;
 * `unavailable` is a transient GPS/system failure distinct from a denial (it must not clear a
 * known-good fix). `granted` carries the full `RawPosition` (with its native timestamp) so callers
 * can both `pickCoords` it and publish it to the freshness store.
 */
export type FetchOutcome =
  | { kind: "granted"; position: RawPosition }
  | { kind: "denied"; canAskAgain: boolean }
  | { kind: "unavailable" };

/**
 * Requests foreground permission (if needed) and fetches the current position.
 * Dependency-injected so it's unit-testable without expo-location or React (see
 * location.test.ts) - `useForegroundLocation` wires in the real expo-location
 * calls. Used by BOTH the mount-time initial fix and the locate-button refresh
 * (spec §3), so they can never drift out of sync. Never throws: a not-granted
 * permission resolves to `{ kind: "denied", canAskAgain }`, while any rejected/erroring
 * dependency (a permission-request error or a GPS failure) resolves to
 * `{ kind: "unavailable" }` - a system failure, NOT a user denial. Never logs coordinates.
 */
export async function fetchForegroundPosition(
  requestPermission: RequestPermission,
  getCurrentPosition: GetCurrentPosition,
): Promise<FetchOutcome> {
  let permission: PermissionResult;
  try {
    permission = await requestPermission();
  } catch {
    return { kind: "unavailable" };
  }
  if (permission.status !== "granted") {
    return { kind: "denied", canAskAgain: permission.canAskAgain };
  }
  try {
    const position = await getCurrentPosition();
    return { kind: "granted", position };
  } catch {
    return { kind: "unavailable" };
  }
}
