import { describe, expect, it } from "vitest";

import { INITIAL_USER_ZOOM, PLACE_MIN_ZOOM } from "./constants";
import {
  initialCameraState,
  nextCameraPolicy,
  type CameraEvent,
  type CameraState,
} from "./camera-policy";

const A = { lng: -122.33, lat: 47.6 };
const B = { lng: -122.34, lat: 47.61 };
const centered: CameraState = { hasInitiallyCentered: true };

describe("nextCameraPolicy — one-time initial center (spec §6)", () => {
  it("centers exactly once on the first fix, whatever the source", () => {
    for (const source of ["initial", "watch", "refresh"] as const) {
      const result = nextCameraPolicy(initialCameraState, { type: "fix", source, coords: A });
      expect(result.command).toEqual({ center: A, zoom: INITIAL_USER_ZOOM });
      expect(result.state).toEqual({ hasInitiallyCentered: true });
    }
  });

  it("never commands on a fix once the one-shot is consumed (live watch movement)", () => {
    const result = nextCameraPolicy(centered, { type: "fix", source: "watch", coords: B });
    expect(result.command).toBeNull();
    expect(result.state).toEqual(centered);
  });

  it("a denial before any fix produces no command and leaves the one-shot unconsumed", () => {
    const denied = nextCameraPolicy(initialCameraState, { type: "locatePress", coords: null });
    expect(denied.command).toBeNull();
    expect(denied.state).toEqual(initialCameraState);
    // A later genuine first fix still auto-centers.
    const fix = nextCameraPolicy(denied.state, { type: "fix", source: "initial", coords: A });
    expect(fix.command).toEqual({ center: A, zoom: INITIAL_USER_ZOOM });
  });
});

describe("nextCameraPolicy — explicit actions always command (spec §6)", () => {
  it("a locate press with coords recenters even after the one-shot is consumed", () => {
    const result = nextCameraPolicy(centered, { type: "locatePress", coords: B });
    expect(result.command).toEqual({ center: B, zoom: INITIAL_USER_ZOOM });
  });

  it("a locate press resolving WITHOUT coords commands nothing", () => {
    expect(nextCameraPolicy(centered, { type: "locatePress", coords: null }).command).toBeNull();
  });

  it("use-current-location and add-mode entry command at placement zoom, framed above the sheet", () => {
    const useCurrent = nextCameraPolicy(centered, { type: "useCurrentLocation", coords: A });
    expect(useCurrent.command).toEqual({
      center: A,
      zoom: PLACE_MIN_ZOOM,
      framedAboveSheet: true,
    });
    const entry = nextCameraPolicy(initialCameraState, { type: "addModeEntry", target: B });
    expect(entry.command).toEqual({ center: B, zoom: PLACE_MIN_ZOOM, framedAboveSheet: true });
    // Both consume the one-shot so a later first fix can't yank the camera off the placement.
    expect(entry.state).toEqual({ hasInitiallyCentered: true });
  });
});

describe("nextCameraPolicy — the combined locate-press-first-fix gesture (spec §6)", () => {
  it("emits exactly ONE effective command: the locate press, then the fix is a no-op", () => {
    // Feeding order matches the screen: the locate press (its granted coords) is applied first, then
    // the same fix arrives through the fix effect.
    const press = nextCameraPolicy(initialCameraState, { type: "locatePress", coords: A });
    expect(press.command).toEqual({ center: A, zoom: INITIAL_USER_ZOOM });
    expect(press.state).toEqual({ hasInitiallyCentered: true });

    const fix = nextCameraPolicy(press.state, { type: "fix", source: "refresh", coords: A });
    expect(fix.command).toBeNull(); // NOT a second initial-center
  });

  it("is a pure function (does not mutate the input state)", () => {
    const state = { ...initialCameraState };
    const event: CameraEvent = { type: "fix", source: "watch", coords: A };
    nextCameraPolicy(state, event);
    expect(state).toEqual({ hasInitiallyCentered: false });
  });
});
