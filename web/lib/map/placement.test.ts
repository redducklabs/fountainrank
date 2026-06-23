import { describe, expect, it } from "vitest";
import {
  boundFromFix,
  canPlace,
  clampToBound,
  haversineMeters,
  inBound,
  ringFeatureCollection,
  type Bound,
} from "./placement";

const SEATTLE = { lng: -122.3321, lat: 47.6062 };

describe("haversineMeters", () => {
  it("is ~0 for the same point and ~111km per latitude degree", () => {
    expect(haversineMeters(SEATTLE, SEATTLE)).toBeCloseTo(0, 5);
    const d = haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("boundFromFix", () => {
  const vp = { west: -122.4, south: 47.5, east: -122.2, north: 47.7 };
  it("returns a circle for a usable fix, radius = max(150, accuracy)", () => {
    expect(boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 30 }, vp)).toEqual({
      kind: "circle",
      center: { lng: -122.3, lat: 47.6 },
      radiusM: 150,
    });
    expect(boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 400 }, vp)).toMatchObject({
      kind: "circle",
      radiusM: 400,
    });
  });
  it("falls back to viewport when no fix or accuracy is too poor", () => {
    expect(boundFromFix({ ok: false }, vp)).toEqual({ kind: "viewport", bounds: vp });
    expect(boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 2000 }, vp)).toEqual({
      kind: "viewport",
      bounds: vp,
    });
  });
});

describe("clampToBound", () => {
  it("leaves an in-bound point unchanged (circle)", () => {
    const b: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
    const p = { lng: SEATTLE.lng + 0.0005, lat: SEATTLE.lat };
    expect(clampToBound(p, b)).toEqual(p);
  });
  it("pulls an out-of-bound point onto the ring (circle)", () => {
    const b: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
    const clamped = clampToBound({ lng: SEATTLE.lng + 0.05, lat: SEATTLE.lat }, b);
    expect(haversineMeters(SEATTLE, clamped)).toBeLessThanOrEqual(151);
    expect(inBound(clamped, b)).toBe(true);
  });
  it("clamps into the rectangle (viewport)", () => {
    const b: Bound = {
      kind: "viewport",
      bounds: { west: -122.4, south: 47.5, east: -122.2, north: 47.7 },
    };
    expect(clampToBound({ lng: -123, lat: 48 }, b)).toEqual({ lng: -122.4, lat: 47.7 });
  });
});

describe("canPlace", () => {
  const circle: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
  const tightVp: Bound = {
    kind: "viewport",
    bounds: { west: -122.335, south: 47.604, east: -122.329, north: 47.608 },
  };
  const wideVp: Bound = {
    kind: "viewport",
    bounds: { west: -122.5, south: 47.5, east: -122.1, north: 47.7 },
  };
  it("requires zoom >= PLACE_MIN_ZOOM", () => {
    expect(canPlace(15.9, circle)).toBe(false);
    expect(canPlace(16, circle)).toBe(true);
  });
  it("rejects a fallback viewport wider than FALLBACK_MAX_SPAN_M even at high zoom", () => {
    expect(canPlace(17, wideVp)).toBe(false);
    expect(canPlace(17, tightVp)).toBe(true);
  });
});

describe("ringFeatureCollection", () => {
  it("returns an empty FC for a viewport bound and a closed ring for a circle", () => {
    expect(
      ringFeatureCollection({ kind: "viewport", bounds: { west: 0, south: 0, east: 1, north: 1 } })
        .features,
    ).toHaveLength(0);
    const fc = ringFeatureCollection({ kind: "circle", center: SEATTLE, radiusM: 150 });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("LineString");
  });
});
