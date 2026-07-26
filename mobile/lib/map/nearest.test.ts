import { describe, expect, it } from "vitest";
import {
  FAR_NEAREST_THRESHOLD_M,
  formatNearestDistance,
  mergeNearestPin,
  requiresFarNearestConfirmation,
} from "./nearest";

describe("nearest fountain helpers", () => {
  it("formats distances and uses an inclusive 50 km immediate boundary", () => {
    expect(formatNearestDistance(750)).toBe("750 m");
    expect(formatNearestDistance(1_250)).toBe("1.3 km");
    expect(requiresFarNearestConfirmation(FAR_NEAREST_THRESHOLD_M)).toBe(false);
    expect(requiresFarNearestConfirmation(FAR_NEAREST_THRESHOLD_M + 1)).toBe(true);
  });
  it("places a selected nearest pin first without duplicates", () => {
    const a = { id: "a" } as never;
    const b = { id: "b" } as never;
    expect(mergeNearestPin([a, b], b).map((pin) => pin.id)).toEqual(["b", "a"]);
  });
});
