import { describe, expect, it, vi } from "vitest";

import {
  createLocationFreshnessTicker,
  formatLocationFreshness,
  type LocationFreshnessTimer,
} from "./location-freshness";

function makeTimer() {
  let nextId = 1;
  const jobs = new Map<number, () => void>();
  const timer: LocationFreshnessTimer = {
    setInterval: (fn, ms) => {
      expect(ms).toBe(1_000);
      const id = nextId++;
      jobs.set(id, fn);
      return id as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (id) => {
      jobs.delete(id as unknown as number);
    },
  };
  return { timer, count: () => jobs.size, fire: () => [...jobs.values()].forEach((fn) => fn()) };
}

describe("formatLocationFreshness", () => {
  it("reports unavailable before any successful fix", () => {
    expect(formatLocationFreshness(null, 10_000)).toBe("Location unavailable");
  });

  it.each([
    { lastFixAtMs: 10_000, nowMs: 10_999, want: "Location refreshed 0s ago" },
    { lastFixAtMs: 10_000, nowMs: 12_999, want: "Location refreshed 2s ago" },
    { lastFixAtMs: 10_000, nowMs: 9_000, want: "Location refreshed 0s ago" },
  ])("floors elapsed seconds and clamps clock rollback", ({ lastFixAtMs, nowMs, want }) => {
    expect(formatLocationFreshness(lastFixAtMs, nowMs)).toBe(want);
  });
});

describe("createLocationFreshnessTicker", () => {
  it("ticks only the supplied display callback once per second", () => {
    const { timer, count, fire } = makeTimer();
    const updateDisplay = vi.fn();
    const ticker = createLocationFreshnessTicker(timer, updateDisplay);

    ticker.start();
    expect(count()).toBe(1);
    fire();

    expect(updateDisplay).toHaveBeenCalledTimes(1);
  });

  it("disposes its timer and remains inert after disposal", () => {
    const { timer, count, fire } = makeTimer();
    const onTick = vi.fn();
    const ticker = createLocationFreshnessTicker(timer, onTick);

    ticker.start();
    ticker.dispose();
    expect(count()).toBe(0);
    ticker.start();
    fire();

    expect(onTick).not.toHaveBeenCalled();
  });
});
