import { describe, expect, it } from "vitest";
import { basePinIcon, selectedSwapIcon, pinsToFeatureCollection } from "./pins";
const mk = (is_working: boolean, ranking_score: number | null) => ({ is_working, ranking_score });

describe("basePinIcon", () => {
  it("broken beats gold", () => expect(basePinIcon(mk(false, 4.9))).toBe("pin-broken"));
  it("gold when working and score > 4", () => expect(basePinIcon(mk(true, 4.1))).toBe("pin-gold"));
  it("score exactly 4 not gold", () => expect(basePinIcon(mk(true, 4))).toBe("pin-standard"));
  it("null score not gold", () => expect(basePinIcon(mk(true, null))).toBe("pin-standard"));
});
describe("selectedSwapIcon (additive)", () => {
  it("working non-gold -> selected", () =>
    expect(selectedSwapIcon(mk(true, 3.2))).toBe("pin-selected"));
  it("broken -> null (halo only)", () => expect(selectedSwapIcon(mk(false, 2))).toBeNull());
  it("gold -> null (halo only)", () => expect(selectedSwapIcon(mk(true, 4.6))).toBeNull());
});
describe("pinsToFeatureCollection", () => {
  it("maps lat/lng -> [lng,lat], computes icon + pill", () => {
    const fc = pinsToFeatureCollection([
      {
        id: "a",
        location: { latitude: 10, longitude: 20 },
        is_working: true,
        average_rating: 4.6,
        rating_count: 9,
        ranking_score: 4.5,
      },
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([20, 10]);
    expect(fc.features[0].properties.icon).toBe("pin-gold");
    expect(fc.features[0].properties.pill).toBe("★ 4.6");
  });
  it("null average -> pill null", () => {
    const fc = pinsToFeatureCollection([
      {
        id: "b",
        location: { latitude: 1, longitude: 2 },
        is_working: true,
        average_rating: null,
        rating_count: 0,
        ranking_score: null,
      },
    ]);
    expect(fc.features[0].properties.pill).toBeNull();
  });
});
