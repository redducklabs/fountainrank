import { describe, expect, it, vi } from "vitest";
import {
  formatLocationFreshness,
  nextSuccessfulFixTimestamp,
  startLocationFreshnessTicker,
  type LocationFixAttempt,
} from "./location-freshness";

describe("location freshness presentation", () => {
  it("reports unavailable before any successful location fix", () => {
    expect(formatLocationFreshness(null, 10_000)).toBe("Location unavailable");
  });

  it("ticks in whole elapsed seconds from the last successful fix", () => {
    expect(formatLocationFreshness(10_000, 12_999)).toBe("Location refreshed 2s ago");
    expect(formatLocationFreshness(10_000, 13_000)).toBe("Location refreshed 3s ago");
  });

  it("clamps clock skew instead of showing a negative age", () => {
    expect(formatLocationFreshness(10_000, 9_999)).toBe("Location refreshed 0s ago");
  });
});

describe("successful location fix state", () => {
  const successes: Extract<LocationFixAttempt, { kind: "success" }>[] = [
    { kind: "success", source: "startup", atMs: 20_000 },
    { kind: "success", source: "nearest", atMs: 30_000 },
    { kind: "success", source: "maplibre-geolocate", atMs: 40_000 },
  ];

  it.each(successes)("resets freshness from a $source success", (attempt) => {
    expect(nextSuccessfulFixTimestamp(10_000, attempt)).toBe(attempt.atMs);
  });

  it("preserves a known successful fix after an error, denial, or unavailable attempt", () => {
    expect(nextSuccessfulFixTimestamp(10_000, { kind: "failure" })).toBe(10_000);
    expect(nextSuccessfulFixTimestamp(null, { kind: "failure" })).toBeNull();
  });
});

describe("location freshness ticker", () => {
  it("updates display state immediately, on its interval, and clears it during cleanup", () => {
    let tick: (() => void) | undefined;
    const clearInterval = vi.fn();
    const handle = { id: "location-freshness" };
    const scheduler = {
      setInterval: vi.fn((callback: () => void, delayMs: number) => {
        tick = callback;
        expect(delayMs).toBe(1_000);
        return handle;
      }),
      clearInterval,
    };
    const onTick = vi.fn();

    const stop = startLocationFreshnessTicker(onTick, scheduler);
    expect(onTick).toHaveBeenCalledOnce();
    tick?.();
    stop();

    expect(onTick).toHaveBeenCalledTimes(2);
    expect(clearInterval).toHaveBeenCalledWith(handle);
  });

  it("updates display state without requesting another geolocation fix", () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    try {
      let tick: (() => void) | undefined;
      const stop = startLocationFreshnessTicker(() => undefined, {
        setInterval: (callback) => {
          tick = callback;
          return 1;
        },
        clearInterval: () => undefined,
      });
      tick?.();
      stop();

      expect(getCurrentPosition).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
