"use client";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@fountainrank/api-client";
import { addFountain } from "../../app/actions/add-fountain";
import { addReducer, initialAddState } from "../../lib/add-fountain-machine";
import {
  buildAttributeGroups,
  fetchAttributeTypes,
  fetchRatingTypes,
  type AttributeGroup,
} from "../../lib/catalog";
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

  // PR-2 optional fields
  const [ratingTypes, setRatingTypes] = useState<components["schemas"]["RatingTypeOut"][]>([]);
  const [attributeGroups, setAttributeGroups] = useState<AttributeGroup[]>([]);
  const [ratingValue, setRatingValue] = useState<Record<number, number>>({});
  const [obsValue, setObsValue] = useState<Record<number, string>>({});
  const [comments, setComments] = useState("");
  const [placementNote, setPlacementNote] = useState("");
  // Clear user-entered optional fields so a prior add's values can never be submitted for a
  // later fountain (the map stays mounted across adds). Catalogs persist (they're cached).
  const resetOptional = useCallback(() => {
    setRatingValue({});
    setObsValue({});
    setComments("");
    setPlacementNote("");
  }, []);

  const placeable = state.bound ? canPlace(zoom, state.bound) : false;
  // Refs so the imperative map handlers always read the latest values (no stale closure).
  const placeableRef = useRef(placeable);
  // eslint-disable-next-line react-hooks/refs
  placeableRef.current = placeable;
  // Freeze bound recomputation once a pin exists so panning/zooming can NEVER silently rewrite a
  // placed coordinate (the bound only gates the initial drop). Read via a ref in imperative handlers.
  const hasPinRef = useRef(false);
  // eslint-disable-next-line react-hooks/refs
  hasPinRef.current = state.pin !== null;

  const recomputeBound = useCallback(() => {
    if (!placementMap) return;
    if (hasPinRef.current) return; // bound frozen after a pin is placed
    dispatch({ type: "SET_BOUND", bound: boundFromFix(fix, placementMap.getViewport()) });
    setZoom(placementMap.getZoom());
  }, [placementMap, fix]);

  const enter = useCallback(() => {
    if (!placementMap) return;
    dispatch({ type: "ENTER" });
    resetOptional(); // never carry a prior add's optional fields into a new one
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
  }, [placementMap, resetOptional]);

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

  // Fetch catalog data (best-effort) on each entry to the details phase. The module-level fetchers
  // cache a successful result but do NOT cache failures — so a failed catalog load retries on the
  // next details entry. No hook-level failure caching.
  useEffect(() => {
    if (state.phase !== "details") return;
    let cancelled = false;
    fetchRatingTypes()
      .then((t) => {
        if (!cancelled) setRatingTypes(t);
      })
      .catch(() => {});
    fetchAttributeTypes()
      .then((t) => {
        if (!cancelled) setAttributeGroups(buildAttributeGroups(t));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [state.phase]);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    const ratings = Object.entries(ratingValue)
      .filter(([, stars]) => stars >= 1)
      .map(([id, stars]) => ({ rating_type_id: Number(id), stars }));
    const observations = Object.entries(obsValue)
      .filter(([, v]) => v && v !== "unknown")
      .map(([id, v]) => ({ attribute_type_id: Number(id), value: v }));
    const res = await addFountain({
      location: { latitude: state.pin.lat, longitude: state.pin.lng },
      is_working: state.working,
      comments: comments.trim() || undefined,
      placement_note: placementNote.trim() || undefined,
      ratings: ratings.length ? ratings : undefined,
      observations: observations.length ? observations : undefined,
    });
    if (res.ok) {
      // Navigate to the new fountain AND reset add-mode: the home map stays mounted beneath the
      // intercepted detail modal, so leaving it active would strand it (suppressed browse, hidden
      // FAB, lingering pin) once the modal closes.
      router.push(`/fountains/${res.fountainId}`);
      dispatch({ type: "CANCEL" });
      resetOptional();
    } else if (res.error === "duplicate") {
      dispatch({ type: "SUBMIT_DUPLICATE", fountainId: res.fountainId });
    } else {
      dispatch({ type: "SUBMIT_ERROR", errorKind: res.error });
    }
  }, [
    state.pin,
    state.working,
    ratingValue,
    obsValue,
    comments,
    placementNote,
    router,
    resetOptional,
  ]);

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
      onCancel={() => {
        dispatch({ type: "CANCEL" });
        resetOptional();
      }}
      onViewDuplicate={() => {
        dispatch({ type: "CANCEL" });
        resetOptional();
      }}
      onPlaceAtCenter={placeAtCenter}
      onNudge={(dir) => dispatch({ type: "NUDGE", dir })}
      onNext={() => dispatch({ type: "NEXT" })}
      onBack={() => dispatch({ type: "BACK" })}
      onSetWorking={(working) => dispatch({ type: "SET_WORKING", working })}
      onSubmit={submit}
      ratingTypes={ratingTypes}
      attributeGroups={attributeGroups}
      ratingValue={ratingValue}
      obsValue={obsValue}
      comments={comments}
      placementNote={placementNote}
      onRate={(id, stars) => setRatingValue((prev) => ({ ...prev, [id]: stars }))}
      onObserve={(id, v) => setObsValue((prev) => ({ ...prev, [id]: v }))}
      onComments={setComments}
      onPlacementNote={setPlacementNote}
    />
  );

  return { active, fab, panel };
}
