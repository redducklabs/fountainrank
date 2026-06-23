import { describe, expect, it } from "vitest";

import { basePinIcon, pinsToFeatureCollection } from "./pins";

describe("basePinIcon", () => {
  it("is pin-broken when not working", () => {
    expect(basePinIcon({ is_working: false, ranking_score: 5 })).toBe("pin-broken");
  });
  it("is pin-broken when current_status is not_working even if is_working is true", () => {
    expect(basePinIcon({ is_working: true, ranking_score: 5, current_status: "not_working" })).toBe(
      "pin-broken",
    );
  });
  it("is pin-gold when working and ranking_score strictly exceeds the threshold", () => {
    expect(basePinIcon({ is_working: true, ranking_score: 4.1 })).toBe("pin-gold");
  });
  it("is pin-standard at exactly the gold threshold (strictly-greater rule)", () => {
    expect(basePinIcon({ is_working: true, ranking_score: 4 })).toBe("pin-standard");
  });
  it("is pin-standard when working with a null ranking_score", () => {
    expect(basePinIcon({ is_working: true, ranking_score: null })).toBe("pin-standard");
  });
});

describe("pinsToFeatureCollection", () => {
  it("maps location to [lng, lat] GeoJSON points with derived icon + pill", () => {
    const fc = pinsToFeatureCollection([
      {
        id: "a1",
        location: { latitude: 39.5, longitude: -98.2 },
        is_working: true,
        average_rating: 4.2,
        ranking_score: 4.5,
        rating_count: 7,
      },
    ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-98.2, 39.5] });
    expect(f.properties.id).toBe("a1");
    expect(f.properties.icon).toBe("pin-gold");
    expect(f.properties.pill).toBe("★ 4.2");
  });

  it("emits a null pill for an unrated fountain and pin-standard icon", () => {
    const fc = pinsToFeatureCollection([
      {
        id: "b2",
        location: { latitude: 1, longitude: 2 },
        is_working: true,
        average_rating: null,
        ranking_score: null,
      },
    ]);
    expect(fc.features[0].properties.pill).toBeNull();
    expect(fc.features[0].properties.icon).toBe("pin-standard");
  });
});
