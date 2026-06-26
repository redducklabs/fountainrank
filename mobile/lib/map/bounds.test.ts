import { describe, expect, it } from "vitest";

import { isAtCap, normalizeBounds, shouldLoadPins, wrapLng } from "./bounds";

describe("wrapLng", () => {
  it("leaves in-range longitudes unchanged", () => {
    expect(wrapLng(-98.5)).toBeCloseTo(-98.5);
    expect(wrapLng(179)).toBeCloseTo(179);
  });
  it("wraps longitudes past +/-180", () => {
    expect(wrapLng(181)).toBeCloseTo(-179);
    expect(wrapLng(-181)).toBeCloseTo(179);
  });
});

describe("normalizeBounds", () => {
  it("returns clamped/wrapped params for a normal viewport", () => {
    const r = normalizeBounds({ west: -98, south: 39, east: -97, north: 40 });
    expect(r).toEqual({
      skip: false,
      params: { min_lat: 39, min_lng: -98, max_lat: 40, max_lng: -97 },
    });
  });
  it("clamps latitude to [-90, 90]", () => {
    const r = normalizeBounds({ west: -10, south: -100, east: 10, north: 100 });
    expect(r).toEqual({
      skip: false,
      params: { min_lat: -90, min_lng: -10, max_lat: 90, max_lng: 10 },
    });
  });
  it("skips a degenerate/antimeridian viewport where min_lng > max_lng", () => {
    expect(normalizeBounds({ west: 179, south: 0, east: -179, north: 1 })).toEqual({ skip: true });
  });
});

describe("shouldLoadPins", () => {
  it("loads at neighborhood and city zooms while still avoiding continental queries", () => {
    expect(shouldLoadPins(3.5)).toBe(false);
    expect(shouldLoadPins(7.99)).toBe(false);
    expect(shouldLoadPins(8)).toBe(true);
    expect(shouldLoadPins(15)).toBe(true);
  });
});

describe("isAtCap", () => {
  it("is true only at/above MAX_BBOX_RESULTS", () => {
    expect(isAtCap(499)).toBe(false);
    expect(isAtCap(500)).toBe(true);
  });
});
