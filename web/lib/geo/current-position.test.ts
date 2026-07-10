// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentPositionSafe } from "./current-position";

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { geolocation?: unknown }).geolocation;
});

function stubGeolocation(impl: Geolocation["getCurrentPosition"]) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: impl },
  });
}

describe("getCurrentPositionSafe", () => {
  it("resolves coordinates on success", async () => {
    stubGeolocation((success) => {
      success({ coords: { latitude: 40, longitude: -73 } } as GeolocationPosition);
    });
    await expect(getCurrentPositionSafe()).resolves.toEqual({ latitude: 40, longitude: -73 });
  });

  it("resolves null on permission denial", async () => {
    stubGeolocation((_success, error) => {
      error?.({ code: 1, message: "denied" } as GeolocationPositionError);
    });
    await expect(getCurrentPositionSafe()).resolves.toBeNull();
  });

  it("resolves null on timeout when the browser never calls back", async () => {
    vi.useFakeTimers();
    stubGeolocation(() => {
      /* never calls back */
    });
    const promise = getCurrentPositionSafe(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("resolves null when geolocation is unavailable", async () => {
    await expect(getCurrentPositionSafe()).resolves.toBeNull();
  });
});
