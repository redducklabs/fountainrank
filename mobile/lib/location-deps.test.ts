import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as Linking from "expo-linking";
import * as Location from "expo-location";

import { FRESH_FIX_MAX_AGE_MS, latestFix, resetLatestFix } from "./location";
import { createForegroundLocationSessionDeps } from "./location-deps";

// location-deps.ts imports the expo adapters (via location-request.ts) + expo-linking; mock those
// boundaries so the factory is importable and node-testable in BOTH __DEV__ configurations. `vi.mock`
// is hoisted above the imports by vitest, so both modules are mocked before location-deps loads them.
vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  watchPositionAsync: vi.fn(),
  getForegroundPermissionsAsync: vi.fn(),
  requestForegroundPermissionsAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
}));
vi.mock("expo-linking", () => ({
  openSettings: vi.fn().mockResolvedValue(undefined),
}));

const POS = { coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 1_000 };

function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLatestFix();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createForegroundLocationSessionDeps — real adapter assembly", () => {
  it("assembles the live watch adapter (calls watchPositionAsync with the pinned options)", () => {
    vi.mocked(Location.watchPositionAsync).mockResolvedValue({ remove: vi.fn() });
    const deps = createForegroundLocationSessionDeps();
    void deps.startWatch(vi.fn());
    expect(Location.watchPositionAsync).toHaveBeenCalledWith(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 3000, distanceInterval: 10 },
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("assembles the prompting fetch (permission + position) and the store publish/reset", async () => {
    vi.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue({
      status: "granted",
      canAskAgain: true,
    } as never);
    vi.mocked(Location.getCurrentPositionAsync).mockResolvedValue(POS as never);
    const deps = createForegroundLocationSessionDeps();

    await expect(deps.fetchOutcome()).resolves.toEqual({ kind: "granted", position: POS });

    // Publish with a current source timestamp so the real-clock singleton considers it fresh.
    deps.publishFix({ coords: POS.coords, timestamp: Date.now() });
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toEqual(POS.coords);
    deps.resetStore();
    expect(latestFix(FRESH_FIX_MAX_AGE_MS)).toBeNull();
  });

  it("assembles the real Linking.openSettings adapter", async () => {
    const deps = createForegroundLocationSessionDeps();
    await deps.openSettings();
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });
});

describe("production diagnostics (__DEV__ false) — only watch_start_rejected is logged", () => {
  it("logs watch_start_rejected via the rare-failure logger (one warn line)", () => {
    vi.stubGlobal("__DEV__", false);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    diagnostics.watchSink({ type: "watch_start_rejected" });
    expect(c.warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(c.warn.mock.calls[0][0] as string)).toEqual({
      level: "warn",
      area: "location",
      event: "watch_start_rejected",
    });
  });

  it("emits ZERO console output for watch_started / watch_stopped / watch_fix_received and app-active transitions", () => {
    vi.stubGlobal("__DEV__", false);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    diagnostics.watchSink({ type: "watch_started" });
    diagnostics.watchSink({ type: "watch_stopped" });
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.onAppActiveChange(false);
    diagnostics.onAppActiveChange(true);

    expect(c.log).not.toHaveBeenCalled();
    expect(c.warn).not.toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
  });
});

describe("dev verification diagnostics (__DEV__ true)", () => {
  it("prints a lifecycle line for watch_started / watch_stopped and still logs watch_start_rejected", () => {
    vi.stubGlobal("__DEV__", true);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    diagnostics.watchSink({ type: "watch_started" });
    diagnostics.watchSink({ type: "watch_stopped" });
    expect(c.log.mock.calls.map(([m]) => m)).toEqual([
      "[location] watch_started",
      "[location] watch_stopped",
    ]);

    diagnostics.watchSink({ type: "watch_start_rejected" });
    expect(c.warn).toHaveBeenCalledTimes(1);
  });

  it("counts background fixes in memory with NO per-fix output, reporting one summary per inactive interval", () => {
    vi.stubGlobal("__DEV__", true);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    diagnostics.onAppActiveChange(false); // → start counting the inactive interval
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.watchSink({ type: "watch_fix_received" });
    expect(c.log).not.toHaveBeenCalled(); // no per-fix line while inactive

    diagnostics.onAppActiveChange(true); // → exactly one summary for the interval
    expect(c.log.mock.calls.map(([m]) => m)).toEqual([
      "[location] watch_fix_received during inactive interval: 3",
    ]);
  });

  it("resets between consecutive inactive cycles", () => {
    vi.stubGlobal("__DEV__", true);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    diagnostics.onAppActiveChange(false);
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.onAppActiveChange(true); // summary: 1

    diagnostics.onAppActiveChange(false);
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.onAppActiveChange(true); // summary: 2

    expect(c.log.mock.calls.map(([m]) => m)).toEqual([
      "[location] watch_fix_received during inactive interval: 1",
      "[location] watch_fix_received during inactive interval: 2",
    ]);
  });

  it("foreground fixes before backgrounding can never make the background summary nonzero", () => {
    vi.stubGlobal("__DEV__", true);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    // Fixes while active (no inactive interval open) are NOT counted.
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.onAppActiveChange(false); // resets to 0 and starts counting
    diagnostics.watchSink({ type: "watch_fix_received" });
    diagnostics.onAppActiveChange(true);

    expect(c.log.mock.calls.map(([m]) => m)).toEqual([
      "[location] watch_fix_received during inactive interval: 1",
    ]);
  });

  it("disposal mid-interval emits no summary (only the return-to-active transition reports)", () => {
    vi.stubGlobal("__DEV__", true);
    const c = spyConsole();
    const { diagnostics } = createForegroundLocationSessionDeps();

    diagnostics.onAppActiveChange(false);
    diagnostics.watchSink({ type: "watch_fix_received" });
    // No return-to-active transition (the session was disposed mid-interval) → no summary line.
    expect(c.log).not.toHaveBeenCalled();
  });
});
