import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The expo-location boundary is mocked (unlike react-native, expo modules are vi.mockable), so this
// suite exercises the real adapters + the guarded `requestCurrentCoords` decision without RN render
// infra. The fix store is the REAL singleton from location.ts — driven deterministically via
// `vi.setSystemTime` so freshness is exact.
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  watchPositionAsync: vi.fn(),
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
}));

import * as Location from "expo-location";

import { FRESH_FIX_MAX_AGE_MS, latestFix, publishFix, resetLatestFix } from "./location";
import {
  probeForegroundPermission,
  requestCurrentCoords,
  watchForegroundPosition,
} from "./location-request";

const mocked = {
  watch: vi.mocked(Location.watchPositionAsync),
  getPerm: vi.mocked(Location.getForegroundPermissionsAsync),
  reqPerm: vi.mocked(Location.requestForegroundPermissionsAsync),
  getPos: vi.mocked(Location.getCurrentPositionAsync),
  getLast: vi.mocked(Location.getLastKnownPositionAsync),
};

const CACHED = { latitude: 47.6, longitude: -122.3, accuracy: 5 };
const FETCHED = { latitude: 10, longitude: 20, accuracy: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  resetLatestFix();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1_000));
});

afterEach(() => {
  vi.useRealTimers();
  resetLatestFix();
});

describe("watchForegroundPosition — the live watch adapter (spec §1)", () => {
  it("calls watchPositionAsync with exactly { Balanced, timeInterval: 3000, distanceInterval: 10 }", async () => {
    const handle = { remove: vi.fn() };
    mocked.watch.mockResolvedValue(handle);

    await expect(watchForegroundPosition(vi.fn())).resolves.toBe(handle);
    expect(mocked.watch).toHaveBeenCalledTimes(1);
    expect(mocked.watch.mock.calls[0][0]).toEqual({
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 3000,
      distanceInterval: 10,
    });
  });

  it("forwards each fix with its native timestamp intact", async () => {
    mocked.watch.mockResolvedValue({ remove: vi.fn() });
    const onFix = vi.fn();
    await watchForegroundPosition(onFix);

    const callback = mocked.watch.mock.calls[0][1];
    callback({ coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 987 } as never);
    expect(onFix).toHaveBeenCalledWith({
      coords: { latitude: 1, longitude: 2, accuracy: 3 },
      timestamp: 987,
    });
  });

  it("propagates a start rejection (the controller consumes it into bounded recovery)", async () => {
    mocked.watch.mockRejectedValue(new Error("start failed"));
    await expect(watchForegroundPosition(vi.fn())).rejects.toThrow();
  });

  it("a runtime watch error mutates nothing, publishes nothing, and logs no coordinate", async () => {
    mocked.watch.mockResolvedValue({ remove: vi.fn() });
    const onFix = vi.fn();
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    await watchForegroundPosition(onFix);

    const errorHandler = mocked.watch.mock.calls[0][2]!;
    errorHandler({ message: "location error at 47.6,-122.3" } as never);
    expect(onFix).not.toHaveBeenCalled();
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("probeForegroundPermission — non-prompting check", () => {
  it("returns true only when the current permission is granted, never prompting", async () => {
    mocked.getPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    await expect(probeForegroundPermission()).resolves.toBe(true);
    mocked.getPerm.mockResolvedValue({ status: "denied", canAskAgain: false } as never);
    await expect(probeForegroundPermission()).resolves.toBe(false);
    // The prompting API is never called by a probe.
    expect(mocked.reqPerm).not.toHaveBeenCalled();
  });
});

describe("requestCurrentCoords — permission-guarded, freshness-aware (spec §2)", () => {
  it("granted + fresh cache → serves the cache without any fetch", async () => {
    publishFix({ coords: CACHED, timestamp: 1_000 });
    mocked.getPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);

    await expect(requestCurrentCoords()).resolves.toEqual(CACHED);
    expect(mocked.getPos).not.toHaveBeenCalled();
    expect(mocked.reqPerm).not.toHaveBeenCalled();
  });

  it("granted + stale cache → runs the bounded prompting fetch", async () => {
    publishFix({ coords: CACHED, timestamp: 1_000 });
    vi.setSystemTime(new Date(1_000 + FRESH_FIX_MAX_AGE_MS + 1)); // cache now stale
    mocked.getPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    mocked.reqPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    mocked.getPos.mockResolvedValue({ coords: FETCHED, timestamp: 2_000 } as never);

    await expect(requestCurrentCoords()).resolves.toEqual(FETCHED);
    expect(mocked.getPos).toHaveBeenCalledTimes(1);
  });

  it("not-granted probe → clears the store and falls through (no cache served)", async () => {
    publishFix({ coords: CACHED, timestamp: 1_000 });
    mocked.getPerm.mockResolvedValue({ status: "denied", canAskAgain: true } as never);
    mocked.reqPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    mocked.getPos.mockResolvedValue({ coords: FETCHED, timestamp: 1_000 } as never);

    await expect(requestCurrentCoords()).resolves.toEqual(FETCHED); // fetched, NOT the seeded cache
    // The seeded cache was cleared by the not-granted probe.
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("probe rejection → cache ignored (never served), still resolves via the caught prompting path", async () => {
    publishFix({ coords: CACHED, timestamp: 1_000 });
    mocked.getPerm.mockRejectedValue(new Error("probe blew up"));
    mocked.reqPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    mocked.getPos.mockResolvedValue({ coords: FETCHED, timestamp: 1_000 } as never);

    await expect(requestCurrentCoords()).resolves.toEqual(FETCHED); // fetched, not the cache
  });

  it("denial still resolves null", async () => {
    mocked.getPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    publishFix({ coords: CACHED, timestamp: 1_000 });
    vi.setSystemTime(new Date(1_000 + FRESH_FIX_MAX_AGE_MS + 1)); // force fetch
    mocked.reqPerm.mockResolvedValue({ status: "denied", canAskAgain: false } as never);

    await expect(requestCurrentCoords()).resolves.toBeNull();
    expect(mocked.getPos).not.toHaveBeenCalled(); // denied → no position fetch
  });

  it("clears the store on a denied fetch, but a transient unavailable keeps a granted entry", async () => {
    mocked.getPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);

    // Denied fetch CLEARS: seed fresh, make it stale so a fetch runs, then deny.
    publishFix({ coords: CACHED, timestamp: 1_000 });
    vi.setSystemTime(new Date(1_000 + FRESH_FIX_MAX_AGE_MS + 1));
    mocked.reqPerm.mockResolvedValue({ status: "denied", canAskAgain: false } as never);
    await requestCurrentCoords();
    vi.setSystemTime(new Date(1_000)); // rewind: the entry would be fresh again IF it still existed
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull(); // → denied cleared it

    // Transient unavailable KEEPS: re-seed, force a fetch, make the fetch fail (no fresh, no last-known).
    resetLatestFix();
    publishFix({ coords: CACHED, timestamp: 1_000 });
    vi.setSystemTime(new Date(1_000 + FRESH_FIX_MAX_AGE_MS + 1));
    mocked.reqPerm.mockResolvedValue({ status: "granted", canAskAgain: true } as never);
    mocked.getPos.mockRejectedValue(new Error("gps timeout"));
    mocked.getLast.mockResolvedValue(null);
    await requestCurrentCoords();
    vi.setSystemTime(new Date(1_000)); // rewind
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(CACHED); // → unavailable kept the entry
  });

  it("never throws even when every dependency rejects", async () => {
    mocked.getPerm.mockRejectedValue(new Error("x"));
    mocked.reqPerm.mockRejectedValue(new Error("y"));
    await expect(requestCurrentCoords()).resolves.toBeNull();
  });
});
