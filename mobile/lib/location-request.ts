import * as Location from "expo-location";

import {
  CURRENT_POSITION_TIMEOUT_MS,
  fetchForegroundPosition,
  resolveCurrentPosition,
  type Coords,
  type RawPosition,
} from "./location";

// The expo-location adapters live here (NOT in lib/location.ts) so that module stays free of an
// expo-location import and remains loadable under the node-based Vitest. The hook and the
// on-demand contribution submit path (proximity guard, #3) both consume `requestCurrentCoords`.

function requestPermission() {
  return Location.requestForegroundPermissionsAsync();
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
 * One-shot foreground location for a contribution submit (proximity guard, #3). Requests permission
 * (a no-op if already granted), fetches the current position, and resolves the coordinates — or
 * `null` on denial/failure. NEVER throws, never blocks the submit, never logs coordinates. Called on
 * the user's submit gesture, NOT on mount, so merely opening a fountain never prompts for location.
 */
export async function requestCurrentCoords(): Promise<Coords | null> {
  const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);
  return outcome.kind === "granted" ? outcome.coords : null;
}
