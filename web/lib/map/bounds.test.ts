import { describe, expect, it } from "vitest";
import { wrapLng, normalizeBounds, shouldLoadPins, isAtCap } from "./bounds";
import { MAX_BBOX_RESULTS } from "./constants";
describe("wrapLng", () => {
  it("in-range", () => expect(wrapLng(20)).toBe(20));
  it("200 -> -160", () => expect(wrapLng(200)).toBe(-160));
  it("-200 -> 160", () => expect(wrapLng(-200)).toBe(160));
});
describe("normalizeBounds", () => {
  it("normal viewport", () =>
    expect(normalizeBounds({ west: 10, south: 40, east: 12, north: 42 })).toEqual({
      skip: false,
      params: { min_lat: 40, min_lng: 10, max_lat: 42, max_lng: 12 },
    }));
  it("clamps latitude", () =>
    expect(normalizeBounds({ west: 0, south: -120, east: 1, north: 95 })).toEqual({
      skip: false,
      params: { min_lat: -90, min_lng: 0, max_lat: 90, max_lng: 1 },
    }));
  it("wraps world-copy lng", () =>
    expect(normalizeBounds({ west: 190, south: 0, east: 200, north: 1 })).toEqual({
      skip: false,
      params: { min_lat: 0, min_lng: -170, max_lat: 1, max_lng: -160 },
    }));
  it("skips antimeridian crossing", () =>
    expect(normalizeBounds({ west: 170, south: 0, east: 190, north: 1 })).toEqual({ skip: true }));
});
describe("shouldLoadPins", () => {
  it("below", () => expect(shouldLoadPins(9.9)).toBe(false));
  it("at", () => expect(shouldLoadPins(10)).toBe(true));
});
describe("isAtCap", () => {
  it("at", () => expect(isAtCap(MAX_BBOX_RESULTS)).toBe(true));
  it("below", () => expect(isAtCap(MAX_BBOX_RESULTS - 1)).toBe(false));
});
