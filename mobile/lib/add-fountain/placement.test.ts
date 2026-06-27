import { describe, expect, it } from "vitest";

import {
  boundFromFix,
  canPlace,
  centerOfViewport,
  clampToBound,
  haversineMeters,
  inBound,
  pinFeatureCollection,
  placementEntryTarget,
  ringFeatureCollection,
  type Bound,
} from "./placement";

const SEATTLE = { lng: -122.3321, lat: 47.6062 };

describe("haversineMeters", () => {
  it("is zero for same point and roughly 111km per latitude degree", () => {
    expect(haversineMeters(SEATTLE, SEATTLE)).toBeCloseTo(0, 5);
    const distance = haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
    expect(distance).toBeGreaterThan(110000);
    expect(distance).toBeLessThan(112000);
  });
});

describe("boundFromFix", () => {
  const viewport = { west: -122.4, south: 47.5, east: -122.2, north: 47.7 };

  it("uses a minimum-radius circle for a usable GPS fix", () => {
    expect(
      boundFromFix({ ok: true, latitude: 47.6, longitude: -122.3, accuracy: 25 }, viewport),
    ).toEqual({
      kind: "circle",
      center: { lng: -122.3, lat: 47.6 },
      radiusM: 150,
    });
  });

  it("uses reported accuracy when it is larger than the minimum", () => {
    expect(
      boundFromFix({ ok: true, latitude: 47.6, longitude: -122.3, accuracy: 350 }, viewport),
    ).toMatchObject({ kind: "circle", radiusM: 350 });
  });

  it("falls back to viewport without a fix or with poor accuracy", () => {
    expect(boundFromFix({ ok: false }, viewport)).toEqual({ kind: "viewport", bounds: viewport });
    expect(
      boundFromFix({ ok: true, latitude: 47.6, longitude: -122.3, accuracy: null }, viewport),
    ).toEqual({ kind: "viewport", bounds: viewport });
    expect(
      boundFromFix({ ok: true, latitude: 47.6, longitude: -122.3, accuracy: 2000 }, viewport),
    ).toEqual({ kind: "viewport", bounds: viewport });
  });
});

describe("clampToBound", () => {
  it("leaves in-bound circle points unchanged", () => {
    const bound: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
    const point = { lng: SEATTLE.lng + 0.0005, lat: SEATTLE.lat };
    expect(clampToBound(point, bound)).toEqual(point);
  });

  it("pulls out-of-bound circle points onto the ring", () => {
    const bound: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
    const clamped = clampToBound({ lng: SEATTLE.lng + 0.05, lat: SEATTLE.lat }, bound);
    expect(haversineMeters(SEATTLE, clamped)).toBeLessThanOrEqual(151);
    expect(inBound(clamped, bound)).toBe(true);
  });

  it("clamps viewport points into the rectangle", () => {
    const bound: Bound = {
      kind: "viewport",
      bounds: { west: -122.4, south: 47.5, east: -122.2, north: 47.7 },
    };
    expect(clampToBound({ lng: -123, lat: 48 }, bound)).toEqual({ lng: -122.4, lat: 47.7 });
  });
});

describe("canPlace", () => {
  const circle: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
  const tightViewport: Bound = {
    kind: "viewport",
    bounds: { west: -122.335, south: 47.604, east: -122.329, north: 47.608 },
  };
  const wideViewport: Bound = {
    kind: "viewport",
    bounds: { west: -122.5, south: 47.5, east: -122.1, north: 47.7 },
  };

  it("requires a bound and street-level zoom", () => {
    expect(canPlace(16, null)).toBe(false);
    expect(canPlace(15.9, circle)).toBe(false);
    expect(canPlace(16, circle)).toBe(true);
  });

  it("rejects a too-wide fallback viewport", () => {
    expect(canPlace(17, wideViewport)).toBe(false);
    expect(canPlace(17, tightViewport)).toBe(true);
  });
});

describe("centerOfViewport", () => {
  it("returns the midpoint of the bounds", () => {
    const center = centerOfViewport({ west: -122.4, south: 47.5, east: -122.2, north: 47.7 });
    expect(center.lng).toBeCloseTo(-122.3, 10);
    expect(center.lat).toBeCloseTo(47.6, 10);
  });
});

describe("placementEntryTarget", () => {
  const viewport = { west: -122.4, south: 47.5, east: -122.2, north: 47.7 };

  it("centers on the user whenever a fix exists, even when accuracy is poor (#97)", () => {
    // The bound (boundFromFix) still falls back to the viewport for poor accuracy;
    // the entry TARGET only needs a sensible place to seed the pin + camera.
    expect(
      placementEntryTarget(
        { ok: true, latitude: 47.61, longitude: -122.33, accuracy: 5000 },
        viewport,
      ),
    ).toEqual({ lng: -122.33, lat: 47.61 });
  });

  it("falls back to the viewport center when there is no fix (#97/#98)", () => {
    const target = placementEntryTarget({ ok: false }, viewport);
    expect(target.lng).toBeCloseTo(-122.3, 10);
    expect(target.lat).toBeCloseTo(47.6, 10);
  });
});

describe("feature builders", () => {
  it("builds empty collections when no ring or pin is present", () => {
    expect(ringFeatureCollection(null).features).toHaveLength(0);
    expect(pinFeatureCollection(null).features).toHaveLength(0);
  });

  it("builds a circle ring and point pin", () => {
    const ring = ringFeatureCollection({ kind: "circle", center: SEATTLE, radiusM: 150 });
    expect(ring.features).toHaveLength(1);
    expect(ring.features[0].geometry.type).toBe("LineString");

    const pin = pinFeatureCollection(SEATTLE);
    expect(pin.features).toHaveLength(1);
    expect(pin.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [SEATTLE.lng, SEATTLE.lat],
    });
  });
});
