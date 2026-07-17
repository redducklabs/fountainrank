import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createFixStore,
  fetchForegroundPosition,
  foregroundLocationReducer,
  FRESH_FIX_MAX_AGE_MS,
  initialForegroundLocationState,
  latestFix,
  pickCoords,
  publishFix,
  resetLatestFix,
  resolveCurrentPosition,
  type ForegroundLocationState,
  type RawPosition,
} from "./location";

const COORDS = { latitude: 47.6062, longitude: -122.3321, accuracy: 5 };
const RAW_POSITION = { coords: COORDS, timestamp: 1_000 };
const LAST_KNOWN = { coords: { latitude: 1, longitude: 2, accuracy: 9 }, timestamp: 1_000 };

/** A mutable injected clock for deterministic fix-store tests. */
function makeClock(start = 0) {
  let t = start;
  const clock = () => t;
  clock.set = (value: number) => {
    t = value;
  };
  clock.advance = (delta: number) => {
    t += delta;
  };
  return clock;
}

function fixAt(source: number, coords = COORDS): RawPosition {
  return { coords, timestamp: source };
}

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
    pickCoords({ coords: { latitude: 1, longitude: 2, accuracy: null }, timestamp: 1_000 });
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

describe("fetchForegroundPosition (rich outcomes, spec §3)", () => {
  it("returns the granted RawPosition (with timestamp) when permission is granted", async () => {
    const position = { coords: { latitude: 10, longitude: 20, accuracy: 3 }, timestamp: 42 };
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted", canAskAgain: true });
    const getCurrentPosition = vi.fn().mockResolvedValue(position);

    const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);

    expect(outcome).toEqual({ kind: "granted", position });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("returns denied WITH canAskAgain (re-promptable) and never fetches a position", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "denied", canAskAgain: true });
    const getCurrentPosition = vi.fn();

    const outcome = await fetchForegroundPosition(requestPermission, getCurrentPosition);

    expect(outcome).toEqual({ kind: "denied", canAskAgain: true });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("propagates canAskAgain === false (OS will not re-prompt → the Settings path)", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "denied", canAskAgain: false });
    const getCurrentPosition = vi.fn();

    await expect(fetchForegroundPosition(requestPermission, getCurrentPosition)).resolves.toEqual({
      kind: "denied",
      canAskAgain: false,
    });
  });

  it("returns unavailable (never throws) when the permission request rejects — a system failure, not a denial", async () => {
    const requestPermission = vi.fn().mockRejectedValue(new Error("boom"));
    const getCurrentPosition = vi.fn();

    await expect(fetchForegroundPosition(requestPermission, getCurrentPosition)).resolves.toEqual({
      kind: "unavailable",
    });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("returns unavailable (never throws) when fetching the position rejects", async () => {
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted", canAskAgain: true });
    const getCurrentPosition = vi.fn().mockRejectedValue(new Error("gps timeout"));

    await expect(fetchForegroundPosition(requestPermission, getCurrentPosition)).resolves.toEqual({
      kind: "unavailable",
    });
  });

  it("never logs coordinates while resolving a fresh fix", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const requestPermission = vi.fn().mockResolvedValue({ status: "granted", canAskAgain: true });
    const getCurrentPosition = vi.fn().mockResolvedValue(RAW_POSITION);

    await fetchForegroundPosition(requestPermission, getCurrentPosition);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("foregroundLocationReducer — retry + unavailable transitions (spec §3)", () => {
  it("retry-denied: a denied retry from a granted state clears coords and marks denied", () => {
    const granted: ForegroundLocationState = { status: "granted", coords: COORDS };
    expect(foregroundLocationReducer(granted, { type: "permissionDenied" })).toEqual({
      status: "denied",
      coords: null,
    });
  });

  it("retry-granted: a granted retry from a denied state restores coords", () => {
    const denied: ForegroundLocationState = { status: "denied", coords: null };
    expect(foregroundLocationReducer(denied, { type: "positionResolved", coords: COORDS })).toEqual(
      { status: "granted", coords: COORDS },
    );
  });

  it("unavailable-without-known-coords: 'failed' clears coords and marks unavailable", () => {
    const granted: ForegroundLocationState = { status: "granted", coords: COORDS };
    expect(foregroundLocationReducer(granted, { type: "failed" })).toEqual({
      status: "unavailable",
      coords: null,
    });
    // The hook/session's keep-known-good policy (NOT dispatching 'failed' when coords are known)
    // is what preserves coords on a transient unavailable; that decision is verified at the
    // session seam (Task 6), since a no-dispatch is not itself a reducer transition.
  });
});

describe("resolveCurrentPosition", () => {
  it("returns the fresh fix when it resolves before the timeout", async () => {
    const getCurrentPosition = vi.fn().mockResolvedValue(RAW_POSITION);
    const getLastKnownPosition = vi.fn();

    await expect(
      resolveCurrentPosition(getCurrentPosition, getLastKnownPosition, 8000),
    ).resolves.toEqual(RAW_POSITION);
    // Fresh fix won the race, so the last-known fallback is never consulted.
    expect(getLastKnownPosition).not.toHaveBeenCalled();
  });

  it("falls back to the last-known fix when the current fetch stalls past the timeout", async () => {
    vi.useFakeTimers();
    try {
      // Simulates the regressed case: getCurrentPositionAsync never resolves.
      const getCurrentPosition = vi.fn(() => new Promise<typeof RAW_POSITION>(() => {}));
      const getLastKnownPosition = vi.fn().mockResolvedValue(LAST_KNOWN);

      const promise = resolveCurrentPosition(getCurrentPosition, getLastKnownPosition, 8000);
      await vi.advanceTimersByTimeAsync(8000);

      await expect(promise).resolves.toEqual(LAST_KNOWN);
      expect(getLastKnownPosition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the last-known fix when the current fetch rejects", async () => {
    const getCurrentPosition = vi.fn().mockRejectedValue(new Error("gps error"));
    const getLastKnownPosition = vi.fn().mockResolvedValue(LAST_KNOWN);

    await expect(
      resolveCurrentPosition(getCurrentPosition, getLastKnownPosition, 8000),
    ).resolves.toEqual(LAST_KNOWN);
  });

  it("throws (never hangs) when neither a fresh nor a last-known fix is available", async () => {
    const getCurrentPosition = vi.fn().mockRejectedValue(new Error("gps error"));
    const getLastKnownPosition = vi.fn().mockResolvedValue(null);

    await expect(
      resolveCurrentPosition(getCurrentPosition, getLastKnownPosition, 8000),
    ).rejects.toThrow();
  });

  it("never logs coordinates", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const getCurrentPosition = vi.fn().mockResolvedValue(RAW_POSITION);

    await resolveCurrentPosition(getCurrentPosition, vi.fn(), 8000);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("createFixStore — freshness + ordering (spec §2)", () => {
  it("stores a fix and serves it while within the freshness window", () => {
    const clock = makeClock(1_000);
    const store = createFixStore(clock);
    expect(store.publishFix(fixAt(1_000))).toBe(true);
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(COORDS);
    clock.set(1_000 + FRESH_FIX_MAX_AGE_MS); // exactly at the boundary → still fresh
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(COORDS);
    clock.advance(1); // one past the window → stale
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("bounds a future-skewed source stamp by receipt time (effective = min(source, receipt))", () => {
    const clock = makeClock(1_000);
    const store = createFixStore(clock);
    // +59 s future skew: a receipt-clamped effective of 1_000, NOT 60_000.
    store.publishFix(fixAt(1_000 + 59_000));
    // 10 s after receipt: still fresh (age 10 s). If effective were the skewed source, age would
    // be negative and this would be (wrongly) stale — this asserts the receipt clamp.
    clock.set(1_000 + 10_000);
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(COORDS);
    // 1 ms past the receipt-based window: stale (the +59 s skew bought no extra freshness).
    clock.set(1_000 + FRESH_FIX_MAX_AGE_MS + 1);
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("clamps even a +1 ms future skew by receipt time", () => {
    const clock = makeClock(5_000);
    const store = createFixStore(clock);
    store.publishFix(fixAt(5_001)); // 1 ms ahead of receipt (5_000)
    clock.set(5_000 + FRESH_FIX_MAX_AGE_MS + 1); // window measured from receipt 5_000
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("newest effective wins under out-of-order publishes (older effective never overwrites)", () => {
    const clock = makeClock();
    const store = createFixStore(clock);
    const NEW = { latitude: 10, longitude: 20, accuracy: 1 };
    const OLD = { latitude: 30, longitude: 40, accuracy: 1 };
    // Publish the newer-effective fix first, then an older one arrives late (slow refresh).
    clock.set(2_000);
    store.publishFix(fixAt(2_000, NEW));
    clock.set(3_000);
    expect(store.publishFix(fixAt(1_000, OLD))).toBe(false); // effective 1_000 < 2_000 → ignored
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(NEW);
  });

  it("applies the newer fix when the higher-effective one arrives second", () => {
    const clock = makeClock();
    const store = createFixStore(clock);
    const NEW = { latitude: 10, longitude: 20, accuracy: 1 };
    const OLD = { latitude: 30, longitude: 40, accuracy: 1 };
    clock.set(1_000);
    store.publishFix(fixAt(1_000, OLD));
    clock.set(2_000);
    expect(store.publishFix(fixAt(2_000, NEW))).toBe(true);
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(NEW);
  });

  it("breaks an effective-timestamp tie by the newer receipt timestamp", () => {
    const first = { latitude: 10, longitude: 20, accuracy: 1 };
    const second = { latitude: 30, longitude: 40, accuracy: 1 };
    // Both effective = 1_000 (source 1_000; the second clamped by a later receipt of 2_000).
    const a = makeClock();
    const store = createFixStore(a);
    a.set(1_000);
    store.publishFix(fixAt(1_000, first)); // eff 1_000, receipt 1_000
    a.set(2_000);
    expect(store.publishFix(fixAt(1_000, second))).toBe(true); // eff 1_000, receipt 2_000 → wins
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(second);
    // A fix with an IDENTICAL effective AND receipt (no newer edge on either) does not displace.
    const b = makeClock(2_000);
    const store2 = createFixStore(b);
    store2.publishFix(fixAt(1_000, second)); // eff 1_000, receipt 2_000
    expect(store2.publishFix({ coords: first, timestamp: 1_000 } as RawPosition)).toBe(false);
    expect(store2.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(second);
  });

  it("treats a clock rollback (negative age) as stale, not fresh", () => {
    const clock = makeClock(5_000);
    const store = createFixStore(clock);
    store.publishFix(fixAt(5_000));
    clock.set(4_000); // clock moved backward past the record
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("rejects non-finite or absent source timestamps (unusable, not stored)", () => {
    const clock = makeClock(1_000);
    const store = createFixStore(clock);
    expect(store.publishFix(fixAt(NaN))).toBe(false);
    expect(store.publishFix(fixAt(Infinity))).toBe(false);
    expect(store.publishFix({ coords: COORDS } as unknown as RawPosition)).toBe(false); // absent
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("does not let a skew-clamped fix displace a genuinely newer fix", () => {
    const clock = makeClock(10_000);
    const store = createFixStore(clock);
    const GENUINE = { latitude: 10, longitude: 20, accuracy: 1 };
    store.publishFix(fixAt(10_000, GENUINE)); // eff 10_000
    // A later-arriving fix with a wildly future source but an OLDER receipt clamps to eff 9_000.
    clock.set(9_000);
    expect(store.publishFix(fixAt(20_000))).toBe(false); // eff min(20_000, 9_000)=9_000 < 10_000
    clock.set(10_000);
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(GENUINE);
  });

  it("resetLatestFix clears the store", () => {
    const clock = makeClock(1_000);
    const store = createFixStore(clock);
    store.publishFix(fixAt(1_000));
    store.resetLatestFix();
    expect(store.latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("never logs coordinates", () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const store = createFixStore(makeClock(1_000));
    store.publishFix(fixAt(1_000));
    store.latestFix(FRESH_FIX_MAX_AGE_MS);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("fix-store singleton (Date.now-backed)", () => {
  afterEach(() => {
    resetLatestFix();
    vi.useRealTimers();
  });

  it("publishes and serves through the exported singleton, bounded by the real clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(100_000));
    expect(publishFix(fixAt(100_000))).toBe(true);
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(COORDS);
    vi.setSystemTime(new Date(100_000 + FRESH_FIX_MAX_AGE_MS + 1));
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
    resetLatestFix();
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });
});
