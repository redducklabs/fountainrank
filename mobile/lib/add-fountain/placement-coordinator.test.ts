import { describe, expect, it, vi } from "vitest";

import { PLACE_MIN_ZOOM } from "../map/constants";
import { createPlacementCoordinator } from "./placement-coordinator";
import type { Bound, LngLat } from "./placement";
import { addFountainReducer, initialAddFountainState } from "./state";

const CENTER: LngLat = { lng: -122.3321, lat: 47.6062 };
const IN_BOUND: LngLat = { lng: -122.3321, lat: 47.6062 };
const OUT_OF_BOUND: LngLat = { lng: -122.3, lat: 47.6062 }; // ~2.4 km east
const circle: Bound = { kind: "circle", center: CENTER, radiusM: 150 };
const tinyCircle: Bound = { kind: "circle", center: CENTER, radiusM: 1 };
const OK_ZOOM = PLACE_MIN_ZOOM;
const LOW_ZOOM = PLACE_MIN_ZOOM - 6;

function makeCoordinator() {
  const dispatch = vi.fn();
  const clearMessage = vi.fn();
  const runCamera = vi.fn();
  const toastOutOfArea = vi.fn();
  const toastZoomIn = vi.fn();
  const coordinator = createPlacementCoordinator({
    dispatch,
    clearMessage,
    runCamera,
    toastOutOfArea,
    toastZoomIn,
  });
  return { coordinator, dispatch, clearMessage, runCamera, toastOutOfArea, toastZoomIn };
}

describe("placementCoordinator — enterSeed (pre-bound acceptance only)", () => {
  it("drops the seed pin and recenters framed above the sheet", () => {
    const c = makeCoordinator();
    c.coordinator.enterSeed(CENTER);
    expect(c.dispatch).toHaveBeenCalledWith({ type: "dropPin", point: CENTER });
    expect(c.runCamera).toHaveBeenCalledWith({ type: "addModeEntry", target: CENTER });
    expect(c.clearMessage).toHaveBeenCalledTimes(1);
    expect(c.toastOutOfArea).not.toHaveBeenCalled();
  });
});

describe("placementCoordinator — useCurrentLocation (accept + reject)", () => {
  it("in-bound: drops the pin, recenters, clears the message, no toast", () => {
    const c = makeCoordinator();
    c.coordinator.useCurrentLocation(IN_BOUND, circle);
    expect(c.dispatch).toHaveBeenCalledWith({ type: "dropPin", point: IN_BOUND });
    expect(c.runCamera).toHaveBeenCalledWith({ type: "useCurrentLocation", coords: IN_BOUND });
    expect(c.clearMessage).toHaveBeenCalledTimes(1);
    expect(c.toastOutOfArea).not.toHaveBeenCalled();
  });

  it("out-of-bound: toasts, dispatches nothing, moves no camera", () => {
    const c = makeCoordinator();
    c.coordinator.useCurrentLocation(OUT_OF_BOUND, circle);
    expect(c.toastOutOfArea).toHaveBeenCalledTimes(1);
    expect(c.dispatch).not.toHaveBeenCalled();
    expect(c.runCamera).not.toHaveBeenCalled();
  });
});

describe("placementCoordinator — placeAtCenter (accept + reject)", () => {
  it("in-bound: drops the pin (no camera move), clears the message", () => {
    const c = makeCoordinator();
    c.coordinator.placeAtCenter(IN_BOUND, circle);
    expect(c.dispatch).toHaveBeenCalledWith({ type: "dropPin", point: IN_BOUND });
    expect(c.runCamera).not.toHaveBeenCalled();
    expect(c.clearMessage).toHaveBeenCalledTimes(1);
  });

  it("out-of-bound: toasts, dispatches nothing", () => {
    const c = makeCoordinator();
    c.coordinator.placeAtCenter(OUT_OF_BOUND, circle);
    expect(c.toastOutOfArea).toHaveBeenCalledTimes(1);
    expect(c.dispatch).not.toHaveBeenCalled();
  });
});

describe("placementCoordinator — mapTap (zoom + accept + reject)", () => {
  it("below placement zoom: the zoom-in toast, dispatches nothing", () => {
    const c = makeCoordinator();
    c.coordinator.mapTap(IN_BOUND, circle, LOW_ZOOM);
    expect(c.toastZoomIn).toHaveBeenCalledTimes(1);
    expect(c.toastOutOfArea).not.toHaveBeenCalled();
    expect(c.dispatch).not.toHaveBeenCalled();
  });

  it("in-bound at placement zoom: drops the pin, clears the message", () => {
    const c = makeCoordinator();
    c.coordinator.mapTap(IN_BOUND, circle, OK_ZOOM);
    expect(c.dispatch).toHaveBeenCalledWith({ type: "dropPin", point: IN_BOUND });
    expect(c.clearMessage).toHaveBeenCalledTimes(1);
  });

  it("out-of-bound at placement zoom: the out-of-area toast, dispatches nothing", () => {
    const c = makeCoordinator();
    c.coordinator.mapTap(OUT_OF_BOUND, circle, OK_ZOOM);
    expect(c.toastOutOfArea).toHaveBeenCalledTimes(1);
    expect(c.dispatch).not.toHaveBeenCalled();
  });
});

describe("placementCoordinator — nudge (accept + reject + no pin)", () => {
  it("accepts a nudge that stays inside the bound", () => {
    const c = makeCoordinator();
    c.coordinator.nudge("n", CENTER, circle);
    expect(c.dispatch).toHaveBeenCalledWith({ type: "nudge", direction: "n" });
    expect(c.toastOutOfArea).not.toHaveBeenCalled();
  });

  it("rejects a nudge whose computed result leaves the bound (prior pin preserved)", () => {
    const c = makeCoordinator();
    c.coordinator.nudge("n", CENTER, tinyCircle); // 5 m step out of a 1 m circle
    expect(c.toastOutOfArea).toHaveBeenCalledTimes(1);
    expect(c.dispatch).not.toHaveBeenCalled();
  });

  it("is a no-op with no accepted pin", () => {
    const c = makeCoordinator();
    c.coordinator.nudge("n", null, circle);
    expect(c.dispatch).not.toHaveBeenCalled();
    expect(c.toastOutOfArea).not.toHaveBeenCalled();
  });
});

describe("placementCoordinator — pre-bound (bound === null)", () => {
  it("useCurrentLocation and placeAtCenter accept against a null bound", () => {
    const c = makeCoordinator();
    c.coordinator.useCurrentLocation(OUT_OF_BOUND, null);
    c.coordinator.placeAtCenter(OUT_OF_BOUND, null);
    expect(c.dispatch).toHaveBeenCalledTimes(2);
    expect(c.toastOutOfArea).not.toHaveBeenCalled();
  });

  it("mapTap still requires a bound (canPlace) — a null bound is not placeable", () => {
    // In the real flow add-mode entry always sets a bound before any tap, so a null-bound tap is
    // unreachable; canPlace rejects it with the zoom-in toast rather than dropping an unbounded pin.
    const c = makeCoordinator();
    c.coordinator.mapTap(OUT_OF_BOUND, null, OK_ZOOM);
    expect(c.toastZoomIn).toHaveBeenCalledTimes(1);
    expect(c.dispatch).not.toHaveBeenCalled();
  });
});

describe("placementCoordinator + reducer agree via the single shared validator (spec §6)", () => {
  it("the coordinator dispatches iff the reducer would accept the same (bound, point)", () => {
    const cases: { bound: Bound | null; point: LngLat }[] = [
      { bound: null, point: OUT_OF_BOUND },
      { bound: circle, point: IN_BOUND },
      { bound: circle, point: OUT_OF_BOUND },
      { bound: tinyCircle, point: CENTER },
      { bound: tinyCircle, point: OUT_OF_BOUND },
    ];
    for (const { bound, point } of cases) {
      const c = makeCoordinator();
      c.coordinator.placeAtCenter(point, bound);
      const coordinatorAccepted = c.dispatch.mock.calls.length === 1;

      const base = bound
        ? addFountainReducer(initialAddFountainState, { type: "setBound", bound })
        : initialAddFountainState;
      const after = addFountainReducer(base, { type: "dropPin", point });
      const reducerAccepted = after.pin === point;

      expect(coordinatorAccepted).toBe(reducerAccepted);
    }
  });
});
