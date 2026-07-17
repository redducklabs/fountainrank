import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { createForegroundLocationSessionDeps } from "../lib/location-deps";
import { createLocationSession } from "../lib/location-session";
import {
  foregroundLocationReducer,
  initialForegroundLocationState,
  type Coords,
  type LocationStatus,
} from "../lib/location";

export type { LocationStatus } from "../lib/location";

export type ForegroundLocation = {
  status: LocationStatus;
  coords: Coords | null;
  /** True while a `refresh()` call is in flight (spec §3 - guards overlapping presses). */
  refreshing: boolean;
  /**
   * Re-fetches the CURRENT position on demand (the locate button, spec §3). Requests permission
   * again first (a no-op if already granted). Resolves the fresh coords, or `null` on
   * denial/unavailability/error - never throws, never logs coordinates, stays non-blocking. A
   * refresh already in flight makes any concurrent call a no-op that resolves `null` immediately.
   */
  refresh: () => Promise<Coords | null>;
};

// The AppState → useSyncExternalStore adapter (spec §1). `useSyncExternalStore` requires `subscribe`
// to return a cleanup function, while `AppState.addEventListener` returns a subscription object -
// so the wrapper is spelled out. Held at module scope so the subscribe/snapshot identities are
// stable across renders (no unnecessary re-subscribes).
function subscribeAppState(onStoreChange: () => void): () => void {
  const subscription = AppState.addEventListener("change", onStoreChange);
  return () => subscription.remove();
}

function getAppActiveSnapshot(): boolean {
  return AppState.currentState === "active";
}

/**
 * A THIN binder around the pure `location-session` (spec §1-3). It owns no orchestration: it derives
 * `shouldWatch` inputs from React-Compiler-safe sources (`useIsFocused()` render state + AppState via
 * `useSyncExternalStore`, never an effect-set flag or a ref read in render) and feeds them to the
 * session, which drives the watch controller. NON-BLOCKING: denial/failure leaves the map usable. No
 * background location, ever. Never logs coordinates. The session is created once; the hook is
 * verified by `tsc`, CI React-Compiler lint, and the on-device checklist - not unit-tested (the
 * mobile toolchain cannot render RN).
 */
export function useForegroundLocation(): ForegroundLocation {
  const [state, dispatch] = useReducer(foregroundLocationReducer, initialForegroundLocationState);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const focused = useIsFocused();
  const appActive = useSyncExternalStore(
    subscribeAppState,
    getAppActiveSnapshot,
    getAppActiveSnapshot,
  );

  const [session] = useState(() =>
    createLocationSession(createForegroundLocationSessionDeps(), { dispatch }),
  );

  // Mount fetch once; dispose the session (and any live watch/retry) on unmount.
  useEffect(() => {
    void session.acquireInitialFix();
    return () => session.dispose();
  }, [session]);

  // Feed the session the derived inputs; it (re)computes the desired watch state and drives the
  // controller. This effect reacts to shouldWatch sources changing - it never sets React state.
  useEffect(() => {
    session.setInputs({ focused, appActive, status: state.status });
  }, [session, focused, appActive, state.status]);

  const refresh = useCallback(async (): Promise<Coords | null> => {
    if (refreshingRef.current) return null;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const outcome = await session.refresh();
      return outcome.kind === "granted" ? outcome.coords : null;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [session]);

  return { status: state.status, coords: state.coords, refreshing, refresh };
}
