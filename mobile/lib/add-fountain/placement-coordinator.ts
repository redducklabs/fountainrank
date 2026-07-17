// Pure placement coordinator (spec §6). The add-fountain screen binds each placement callback
// DIRECTLY to one coordinator method (no inline logic), so the per-path behavior is node-testable at
// a real seam - standalone action-creator tests could not prove the unimportable screen actually
// uses them. Because a reducer `dispatch` returns nothing, the coordinator cannot learn acceptance
// from dispatching; instead it calls the SAME shared `evaluatePlacement` validator the reducer
// applies as its backstop, so their accept/reject decisions can never diverge.

import type { CameraEvent } from "../map/camera-policy";
import { canPlace, evaluatePlacement, nudgePoint, type Bound, type LngLat } from "./placement";
import type { AddFountainAction } from "./state";

export type PlacementCoordinatorDeps = {
  /** Dispatches a point/intent-only placement action to the reducer (the authoritative backstop). */
  dispatch: (action: AddFountainAction) => void;
  /** Clears the inline add-panel message on an accepted placement. */
  clearMessage: () => void;
  /** The camera effect (the screen's `runCamera`) - invoked only on paths that move the camera. */
  runCamera: (event: CameraEvent) => void;
  /** The out-of-area rejection toast. */
  toastOutOfArea: () => void;
  /** The below-placement-zoom rejection toast (map-tap only). */
  toastZoomIn: () => void;
};

export type PlacementCoordinator = {
  /** Add-mode entry seed pin: pre-bound acceptance (the bound is reset before entry). */
  enterSeed: (target: LngLat) => void;
  /** "Use current location": accept in-bound (drop + recenter framed above the sheet) or reject. */
  useCurrentLocation: (point: LngLat, bound: Bound | null) => void;
  /** "Place at map center": accept in-bound (drop, no camera move) or reject. */
  placeAtCenter: (point: LngLat, bound: Bound | null) => void;
  /** Map tap: reject below placement zoom, else accept in-bound (drop, no camera move) or reject. */
  mapTap: (point: LngLat, bound: Bound | null, zoom: number) => void;
  /** Nudge the accepted pin one step; reject when the computed result leaves the current bound. */
  nudge: (direction: "n" | "s" | "e" | "w", pin: LngLat | null, bound: Bound | null) => void;
};

export function createPlacementCoordinator(deps: PlacementCoordinatorDeps): PlacementCoordinator {
  return {
    enterSeed(target) {
      // Entry always follows a reducer reset (bound === null), so the seed is accepted unconditionally
      // - there is no reachable bound-before-entry state to reject.
      deps.clearMessage();
      deps.dispatch({ type: "dropPin", point: target });
      deps.runCamera({ type: "addModeEntry", target });
    },
    useCurrentLocation(point, bound) {
      if (!evaluatePlacement(bound, point)) {
        deps.toastOutOfArea();
        return;
      }
      deps.clearMessage();
      deps.dispatch({ type: "dropPin", point });
      deps.runCamera({ type: "useCurrentLocation", coords: point });
    },
    placeAtCenter(point, bound) {
      if (!evaluatePlacement(bound, point)) {
        deps.toastOutOfArea();
        return;
      }
      deps.clearMessage();
      deps.dispatch({ type: "dropPin", point });
    },
    mapTap(point, bound, zoom) {
      if (!canPlace(zoom, bound)) {
        deps.toastZoomIn();
        return;
      }
      if (!evaluatePlacement(bound, point)) {
        deps.toastOutOfArea();
        return;
      }
      deps.clearMessage();
      deps.dispatch({ type: "dropPin", point });
    },
    nudge(direction, pin, bound) {
      if (pin === null) return;
      // The coordinator validates its OWN computed result with the same helper the reducer's nudge
      // re-applies, so the immediate toast decision and the dispatched transition always agree.
      const next = nudgePoint(pin, direction);
      if (!evaluatePlacement(bound, next)) {
        deps.toastOutOfArea();
        return;
      }
      deps.dispatch({ type: "nudge", direction });
    },
  };
}
