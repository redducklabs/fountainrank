import * as Location from "expo-location";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  CURRENT_POSITION_TIMEOUT_MS,
  fetchForegroundPosition,
  foregroundLocationReducer,
  initialForegroundLocationState,
  resolveCurrentPosition,
  type Coords,
  type LocationStatus,
  type RawPosition,
} from "../lib/location";

export type { LocationStatus } from "../lib/location";

export type ForegroundLocation = {
  status: LocationStatus;
  coords: Coords | null;
  /** True while a `refresh()` call is in flight (spec §3.4 - guards overlapping presses). */
  refreshing: boolean;
  /**
   * Re-fetches the CURRENT position on demand (the locate button, spec §3.4) -
   * instead of reusing the frozen mount-time fix, every call re-runs
   * `getCurrentPositionAsync` and resolves the fresh coords. Requests
   * permission again first (a no-op if already granted). Resolves `null` on
   * denial/unavailability/error - never throws, never logs coordinates, stays
   * non-blocking (spec §20). A refresh already in flight makes any concurrent
   * call a no-op that resolves `null` immediately (state/the in-flight fetch
   * are left untouched) so presses can't stack overlapping GPS fetches.
   */
  refresh: () => Promise<Coords | null>;
};

function requestPermission() {
  return Location.requestForegroundPermissionsAsync();
}

// `getCurrentPositionAsync` has no timeout and can stall (Expo docs), which
// bricked the locate button (#144 / spec §3.4). Bound it and fall back to the
// last-known fix so this always settles - the hook's in-flight guard then always
// clears and a press can't hang. Shared by the mount-time fix and the refresh.
function getCurrentPosition(): Promise<RawPosition> {
  return resolveCurrentPosition(
    () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    () => Location.getLastKnownPositionAsync(),
    CURRENT_POSITION_TIMEOUT_MS,
  );
}

/**
 * Request foreground (when-in-use) location once on mount and, if granted, fetch
 * a single current position. NON-BLOCKING: denial or failure leaves the map fully
 * usable (status reflects it; coords stay null). No background location, ever
 * (spec section 20). Never logs coordinates.
 *
 * The locate button (spec §3.4) must show the CURRENT position on every press,
 * not the frozen mount-time fix, so `refresh()` re-runs the same fetch on
 * demand and updates this hook's state on success.
 */
export function useForegroundLocation(): ForegroundLocation {
  const [state, dispatch] = useReducer(foregroundLocationReducer, initialForegroundLocationState);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "started" });
    fetchForegroundPosition(requestPermission, getCurrentPosition).then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === "granted") {
        dispatch({ type: "positionResolved", coords: outcome.coords });
      } else if (outcome.kind === "denied") {
        dispatch({ type: "permissionDenied" });
      } else {
        dispatch({ type: "failed" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (): Promise<Coords | null> => {
    if (refreshingRef.current) return null;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);
      if (outcome.kind !== "granted") return null;
      dispatch({ type: "positionResolved", coords: outcome.coords });
      return outcome.coords;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  return { status: state.status, coords: state.coords, refreshing, refresh };
}
