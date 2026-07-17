import * as Location from "expo-location";

import {
  CURRENT_POSITION_TIMEOUT_MS,
  fetchForegroundPosition,
  FRESH_FIX_MAX_AGE_MS,
  latestFix,
  pickCoords,
  resetLatestFix,
  resolveCurrentPosition,
  type Coords,
  type PermissionResult,
  type RawPosition,
} from "./location";
import type { StartWatch, WatchHandle } from "./location-watch";

// The expo-location adapters live here (NOT in lib/location.ts) so that module stays free of an
// expo-location import and remains loadable under the node-based Vitest. The hook and the
// on-demand contribution submit path (proximity guard, #3) both consume `requestCurrentCoords`.

// Maps expo's permission response onto our minimal `PermissionResult`, keeping `canAskAgain` so the
// denied flow can distinguish "OS won't re-prompt" (offer Settings) from a re-promptable denial.
async function requestPermission(): Promise<PermissionResult> {
  const response = await Location.requestForegroundPermissionsAsync();
  return { status: response.status, canAskAgain: response.canAskAgain };
}

// `getCurrentPositionAsync` has no timeout and can stall (Expo docs); bound it and fall back to the
// last-known fix so it always settles. Shared by the hook and requestCurrentCoords.
export function getCurrentPosition(): Promise<RawPosition> {
  return resolveCurrentPosition(
    () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    () => Location.getLastKnownPositionAsync(),
    CURRENT_POSITION_TIMEOUT_MS,
  );
}

export { requestPermission };

/**
 * The live foreground watch adapter (spec §1). Options are platform-specific best effort:
 * `timeInterval` is Android-only, iOS honors `distanceInterval` + accuracy, and neither promises a
 * fixed cadence — the controller treats updates as an event stream, never a clock. Each fix is
 * forwarded with its native `timestamp` intact so the fix store can reason about freshness. A
 * runtime watch error is swallowed (no fix forwarded, nothing logged) so a transient failure never
 * blanks a known-good position; start rejection propagates to the controller's bounded recovery.
 */
export const watchForegroundPosition: StartWatch = (onFix): Promise<WatchHandle> => {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 10 },
    (location) => onFix({ coords: location.coords, timestamp: location.timestamp }),
    () => {
      // Runtime watch error: mutate nothing, publish nothing, log no coordinate.
    },
  );
};

/**
 * Checks the current foreground permission WITHOUT prompting (`getForegroundPermissionsAsync`).
 * Used to guard cross-screen cache reuse so a revoked permission can never be bypassed by a cached
 * coordinate (spec §2).
 */
export async function probeForegroundPermission(): Promise<boolean> {
  const response = await Location.getForegroundPermissionsAsync();
  return response.status === "granted";
}

/**
 * Permission-guarded, freshness-aware current location for a contribution submit (proximity guard,
 * #3), spec §2:
 * 1. Probe the current permission WITHOUT prompting. If not granted, clear the store and fall
 *    through to the prompting path (a revoked permission can never be served a cached coordinate);
 *    if the probe itself rejects, the cache is ignored (never served, not cleared) and the flow
 *    proceeds through the caught prompting path — this function never throws.
 * 2. If granted and a fresh stored fix exists, resolve it immediately (no fetch).
 * 3. Otherwise run the bounded prompting fetch. A `denied` outcome clears the store and resolves
 *    `null`; a transient `unavailable` keeps any granted entry and resolves `null`.
 * NEVER throws, never blocks the submit, never logs coordinates.
 */
export async function requestCurrentCoords(): Promise<Coords | null> {
  let probe: "granted" | "not_granted" | "error";
  try {
    probe = (await probeForegroundPermission()) ? "granted" : "not_granted";
  } catch {
    probe = "error";
  }
  if (probe === "granted") {
    const cached = latestFix(FRESH_FIX_MAX_AGE_MS);
    if (cached) return cached;
  } else if (probe === "not_granted") {
    resetLatestFix();
  }
  const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);
  if (outcome.kind === "granted") return pickCoords(outcome.position);
  if (outcome.kind === "denied") {
    resetLatestFix();
    return null;
  }
  return null; // unavailable: transient — keep any granted entry, bounded by the freshness window
}
