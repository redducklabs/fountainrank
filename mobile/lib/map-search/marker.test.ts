import { describe, expect, it } from "vitest";

import { searchMarkerFeatureCollection, shouldClearSearchMarker } from "./marker";

describe("shouldClearSearchMarker", () => {
  it("does NOT clear for a programmatic region change (our own setFlyTo landing)", () => {
    expect(shouldClearSearchMarker({ userInteraction: false, cause: "region" })).toBe(false);
  });

  it("clears for a user-gesture region change (pan/zoom)", () => {
    expect(shouldClearSearchMarker({ userInteraction: true, cause: "region" })).toBe(true);
  });

  it("clears on a map press regardless of userInteraction", () => {
    expect(shouldClearSearchMarker({ userInteraction: false, cause: "press" })).toBe(true);
    expect(shouldClearSearchMarker({ userInteraction: true, cause: "press" })).toBe(true);
  });

  it("clears when starting a new search regardless of userInteraction", () => {
    expect(shouldClearSearchMarker({ userInteraction: false, cause: "newSearch" })).toBe(true);
    expect(shouldClearSearchMarker({ userInteraction: true, cause: "newSearch" })).toBe(true);
  });

  it("clears when a fountain pin is selected regardless of userInteraction", () => {
    expect(shouldClearSearchMarker({ userInteraction: false, cause: "pinSelect" })).toBe(true);
    expect(shouldClearSearchMarker({ userInteraction: true, cause: "pinSelect" })).toBe(true);
  });
});

describe("searchMarkerFeatureCollection", () => {
  it("returns an empty collection when there is no marker", () => {
    expect(searchMarkerFeatureCollection(null)).toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  it("builds a single Point feature at [longitude, latitude]", () => {
    expect(searchMarkerFeatureCollection({ latitude: 47.6062, longitude: -122.3321 })).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [-122.3321, 47.6062] },
        },
      ],
    });
  });
});
