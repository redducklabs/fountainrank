"use client";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addFountain } from "../../app/actions/add-fountain";
import { addReducer, initialAddState } from "../../lib/add-fountain-machine";
import { ACCURACY_MAX_M, GEOLOCATE_TIMEOUT_MS } from "../../lib/map/constants";
import { boundFromFix, canPlace, type GpsFix } from "../../lib/map/placement";
import { AddFountainFab } from "./AddFountainFab";
import { AddFountainPanel } from "./AddFountainPanel";
import type { PlacementMap } from "./placement-map";

export function useAddFountainMode(
  placementMap: PlacementMap | null,
  opts: { isAuthenticated: boolean; webglOk: boolean; autoEnter: boolean; hadAddParam: boolean },
): { active: boolean; fab: ReactNode; panel: ReactNode } {
  const [state, dispatch] = useReducer(addReducer, initialAddState);
  const [fix, setFix] = useState<GpsFix>({ ok: false });
  const [zoom, setZoom] = useState(0);
  const router = useRouter();
  const active = state.phase !== "idle";

  const placeable = state.bound ? canPlace(zoom, state.bound) : false;
  // Refs so the imperative map handlers always read the latest values (no stale closure).
  const placeableRef = useRef(placeable);
  placeableRef.current = placeable;

  const recomputeBound = useCallback(() => {
    if (!placementMap) return;
    dispatch({ type: "SET_BOUND", bound: boundFromFix(fix, placementMap.getViewport()) });
    setZoom(placementMap.getZoom());
  }, [placementMap, fix]);

  const enter = useCallback(() => {
    if (!placementMap) return;
    dispatch({ type: "ENTER" });
    setFix({ ok: false }); // reset stale GPS before the new request
    setZoom(placementMap.getZoom());
    dispatch({ type: "SET_BOUND", bound: boundFromFix({ ok: false }, placementMap.getViewport()) });
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        // Poor accuracy is NOT a usable fix (spec §6): no recenter, fallback bound + copy.
        if (pos.coords.accuracy > ACCURACY_MAX_M) {
          setFix({ ok: false });
          return;
        }
        const f: GpsFix = {
          ok: true,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setFix(f);
        placementMap.flyToFix({ lng: f.lng, lat: f.lat });
      },
      () => setFix({ ok: false }),
      { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
    );
  }, [placementMap]);

  // Auto-enter (authed) + strip ?add=1 (spec §4). Anonymous/sign-in-abandoned strips immediately;
  // the authed auto-enter case DEFERS the strip until the map adapter exists so we don't lose the
  // signal before we can enter (a premature router.replace would drop hadAddParam).
  const autoEnterDoneRef = useRef(false);
  useEffect(() => {
    if (!opts.hadAddParam) return;
    if (opts.autoEnter && opts.isAuthenticated) {
      if (placementMap && !autoEnterDoneRef.current) {
        autoEnterDoneRef.current = true;
        enter();
        router.replace("/");
      }
      return; // still waiting for the map: keep the param until we can enter
    }
    router.replace("/"); // anonymous / not auto-enter: strip without entering
  }, [opts.hadAddParam, opts.autoEnter, opts.isAuthenticated, placementMap, enter, router]);

  // Subscribe map events while active; handlers read refs so they never go stale.
  useEffect(() => {
    if (!placementMap || !active) return;
    const unsub = placementMap.subscribe({
      onClick: (p) => {
        if (placeableRef.current) dispatch({ type: "DROP_PIN", point: p });
      },
      onMoveEnd: () => recomputeBound(),
    });
    return unsub;
  }, [placementMap, active, recomputeBound]);

  // Recompute the bound when the fix changes (after geolocation resolves).
  useEffect(() => {
    if (active) recomputeBound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  // Reflect pin + ring imperatively; tear everything down when leaving add-mode.
  useEffect(() => {
    if (!placementMap) return;
    if (!active) {
      placementMap.teardown();
      return;
    }
    placementMap.setPin(state.pin, (p) => dispatch({ type: "DROP_PIN", point: p }));
    placementMap.setRing(state.bound);
  }, [placementMap, active, state.pin, state.bound]);

  const placeAtCenter = useCallback(() => {
    if (!placementMap || !placeableRef.current) return;
    dispatch({ type: "DROP_PIN", point: placementMap.getCenter() });
  }, [placementMap]);

  const submit = useCallback(async () => {
    if (!state.pin) return;
    dispatch({ type: "SUBMIT_START" });
    const res = await addFountain({
      location: { latitude: state.pin.lat, longitude: state.pin.lng },
      is_working: state.working,
    });
    if (res.ok) {
      dispatch({ type: "SUBMIT_DONE", fountainId: res.fountainId });
      router.push(`/fountains/${res.fountainId}`);
    } else if (res.error === "duplicate") {
      dispatch({ type: "SUBMIT_DUPLICATE", fountainId: res.fountainId });
    } else {
      dispatch({ type: "SUBMIT_ERROR", errorKind: res.error });
    }
  }, [state.pin, state.working, router]);

  // Hide the FAB while add-mode is active so it can't re-enter and reset an in-progress flow.
  const fab: ReactNode = active ? null : (
    <AddFountainFab isAuthenticated={opts.isAuthenticated} webglOk={opts.webglOk} onEnter={enter} />
  );
  const panel: ReactNode = (
    <AddFountainPanel
      phase={state.phase}
      pin={state.pin}
      working={state.working}
      placeable={placeable}
      gpsUnavailable={!fix.ok}
      duplicateId={state.duplicateId}
      errorKind={state.errorKind}
      onCancel={() => dispatch({ type: "CANCEL" })}
      onPlaceAtCenter={placeAtCenter}
      onNudge={(dir) => dispatch({ type: "NUDGE", dir })}
      onNext={() => dispatch({ type: "NEXT" })}
      onBack={() => dispatch({ type: "BACK" })}
      onSetWorking={(working) => dispatch({ type: "SET_WORKING", working })}
      onSubmit={submit}
    />
  );

  return { active, fab, panel };
}
