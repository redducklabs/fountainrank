import { describe, expect, it, vi } from "vitest";

import {
  fetchForegroundPosition,
  foregroundLocationReducer,
  initialForegroundLocationState,
  pickCoords,
  type ForegroundLocationState,
} from "./location";

const COORDS = { latitude: 47.6062, longitude: -122.3321, accuracy: 5 };
const RAW_POSITION = { coords: COORDS };

describe("pickCoords", () => {
  it("maps a raw position into the Coords shape", () => {
    expect(pickCoords(RAW_POSITION)).toEqual(COORDS);
  });

  it("never logs (no console calls for a normal or nullish-accuracy fix)", () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    pickCoords(RAW_POSITION);
    pickCoords({ coords: { latitude: 1, longitude: 2, accuracy: null } });
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("foregroundLocationReducer", () => {
  it("started clears any prior coords while the fetch is pending", () => {
    const granted: ForegroundLocationState = { status: "granted", coords: COORDS };
    expect(foregroundLocationReducer(granted, { type: "started" })).toEqual({
      status: "locating",
      coords: null,
    });
  });

  it("permissionDenied clears coords", () => {
    const granted: ForegroundLocationState = { status: "granted", coords: COORDS };
    expect(foregroundLocationReducer(granted, { type: "permissionDenied" })).toEqual({
      status: "denied",
      coords: null,
    });
  });

  it("positionResolved sets granted + the fresh coords", () => {
    expect(
      foregroundLocationReducer(initialForegroundLocationState, {
        type: "positionResolved",
        coords: COORDS,
      }),
    ).toEqual({ status: "granted", coords: COORDS });
  });

  it("failed clears coords and marks unavailable", () => {
    const granted: ForegroundLocationState = { status: "granted", coords: COORDS };
    expect(foregroundLocationReducer(granted, { type: "failed" })).toEqual({
      status: "unavailable",
      coords: null,
    });
  });
});

describe("fetchForegroundPosition", () => {
  it("returns fresh coords when permission is granted (the locate-button refresh path, spec §3.4)", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted" });
    const getCurrentPosition = vi.fn().mockResolvedValue({
      coords: { latitude: 10, longitude: 20, accuracy: 3 },
    });

    const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);

    expect(outcome).toEqual({
      kind: "granted",
      coords: { latitude: 10, longitude: 20, accuracy: 3 },
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("returns denied and never fetches a position when permission is not granted", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "denied" });
    const getCurrentPosition = vi.fn();

    const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);

    expect(outcome).toEqual({ kind: "denied" });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("returns failed (never throws) when the permission request rejects", async () => {
    const requestPermission = vi.fn().mockRejectedValue(new Error("boom"));
    const getCurrentPosition = vi.fn();

    await expect(fetchForegroundPosition(requestPermission, getCurrentPosition)).resolves.toEqual({
      kind: "failed",
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("returns failed (never throws) when fetching the position rejects", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted" });
    const getCurrentPosition = vi.fn().mockRejectedValue(new Error("gps timeout"));

    await expect(fetchForegroundPosition(requestPermission, getCurrentPosition)).resolves.toEqual({
      kind: "failed",
    });
  });

  it("never logs coordinates while resolving a fresh fix", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted" });
    const getCurrentPosition = vi.fn().mockResolvedValue(RAW_POSITION);

    await fetchForegroundPosition(requestPermission, getCurrentPosition);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
