import { describe, expect, it } from "vitest";
import {
  FAR_NEAREST_THRESHOLD_M,
  formatNearestDistance,
  requiresFarNearestConfirmation,
} from "./nearest";

describe("nearest fountain presentation", () => {
  it("formats metres and kilometres", () => {
    expect(formatNearestDistance(420)).toBe("420 m");
    expect(formatNearestDistance(1_250)).toBe("1.3 km");
    expect(formatNearestDistance(1_842_000)).toBe("1,842 km");
  });
  it("confirms only beyond the inclusive 50 km boundary", () => {
    expect(requiresFarNearestConfirmation(FAR_NEAREST_THRESHOLD_M)).toBe(false);
    expect(requiresFarNearestConfirmation(FAR_NEAREST_THRESHOLD_M + 1)).toBe(true);
  });
});
