import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { createForegroundLocationSessionDeps } from "../lib/location-deps";
import {
  createLocationSession,
  type RefreshOutcome,
  type SettingsOpenResult,
} from "../lib/location-session";
import { isLocateBusy } from "../lib/map/locate-button";
import {
  foregroundLocationReducer,
  initialForegroundLocationState,
  type Coords,
  type LocationStatus,
} from "../lib/location";

export type { LocationStatus } from "../lib/location";
export type { RefreshOutcome, SettingsOpenResult } from "../lib/location-session";

const REFRESH_IN_FLIGHT: RefreshOutcome = { kind: "unavailable" };

export type ForegroundLocation = {
  status: LocationStatus;
  coords: Coords | null;
  /** True while a `refresh()` call is in flight (spec §3 - guards overlapping presses). */
  refreshing: boolean;
  /**
   * `false` once the OS will not re-prompt for foreground location (mirrored from the last denied
   * outcome). Drives the locate button's Settings hint and the denied toast's action (spec §3).
   */
  canAskAgain: boolean;
  /**
   * Re-fetches the CURRENT position on demand (the locate button, spec §3), returning the RICH
   * outcome so the press handler branches on THIS call's result (never separately-scheduled React
   * state). Requests permission again first (a no-op if already granted). Never throws, never logs
   * coordinates, stays non-blocking. A refresh already in flight makes any concurrent call a no-op
   * that resolves `unavailable` immediately.
   */
  refresh: () => Promise<RefreshOutcome>;
  /** Opens the OS settings for this app (the denied-permanently path); rejection maps to `failed`. */
  openSettings: () => Promise<SettingsOpenResult>;
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
  const [canAskAgain, setCanAskAgain] = useState(true);
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

  // Derive the denied hint from a resolved outcome: a denial mirrors its re-promptability; a grant
  // resets it (permission is moot); a transient unavailable leaves the prior hint unchanged. Stable
  // (setState is stable), so the effects/callbacks that use it stay dependency-exhaustive.
  const mirrorCanAskAgain = useCallback((outcome: RefreshOutcome): void => {
    if (outcome.kind === "denied") setCanAskAgain(outcome.canAskAgain);
    else if (outcome.kind === "granted") setCanAskAgain(true);
  }, []);

  // Mount fetch once; dispose the session (and any live watch/retry) on unmount. The mount outcome's
  // `canAskAgain` is mirrored in an async callback (not synchronously in the effect body - the
  // established `PointsChip` pattern, React-Compiler-safe).
  useEffect(() => {
    void session.acquireInitialFix().then(mirrorCanAskAgain);
    return () => session.dispose();
  }, [session, mirrorCanAskAgain]);

  // Feed the session the derived inputs; it (re)computes the desired watch state and drives the
  // controller. This effect reacts to shouldWatch sources changing - it never sets React state.
  useEffect(() => {
    session.setInputs({ focused, appActive, status: state.status });
  }, [session, focused, appActive, state.status]);

  const refresh = useCallback(async (): Promise<RefreshOutcome> => {
    // Busy no-op (spec §4): the shared predicate covers BOTH a refresh already in flight and the
    // mount acquisition (`status === "locating"`), so a locating-state press never starts a second
    // request. The session single-flights the same guard authoritatively as a backstop.
    if (isLocateBusy(state.status, refreshingRef.current)) return REFRESH_IN_FLIGHT;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      const outcome = await session.refresh();
      mirrorCanAskAgain(outcome);
      return outcome;
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [session, mirrorCanAskAgain, state.status]);

  const openSettings = useCallback(() => session.openSettings(), [session]);

  return {
    status: state.status,
    coords: state.coords,
    refreshing,
    canAskAgain,
    refresh,
    openSettings,
  };
}
