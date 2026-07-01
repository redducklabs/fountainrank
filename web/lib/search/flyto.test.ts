import { describe, expect, it } from "vitest";

import { NEIGHBORHOOD_ZOOM, PLACE_MIN_ZOOM } from "../map/constants";
import { buildFlyToQuery, deriveCameraAction, parseFlyToParam } from "./flyto";

describe("parseFlyToParam - center (flyto=lng,lat)", () => {
  it("parses a valid center with no bbox", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4" })).toEqual({ center: [-122.1, 37.4] });
  });

  it("parses via a real URLSearchParams instance", () => {
    const params = new URLSearchParams("flyto=-122.1,37.4");
    expect(parseFlyToParam(params)).toEqual({ center: [-122.1, 37.4] });
  });

  it("returns null when flyto is missing", () => {
    expect(parseFlyToParam({})).toBeNull();
    expect(parseFlyToParam(new URLSearchParams())).toBeNull();
  });

  it("returns null when flyto is an empty string", () => {
    expect(parseFlyToParam({ flyto: "" })).toBeNull();
  });

  it("returns null on a partial center (only one coordinate)", () => {
    expect(parseFlyToParam({ flyto: "-122.1" })).toBeNull();
  });

  it("returns null on too many components", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4,10" })).toBeNull();
  });

  it("returns null on a non-finite component (NaN)", () => {
    expect(parseFlyToParam({ flyto: "abc,37.4" })).toBeNull();
  });

  it("returns null on a non-finite component (Infinity)", () => {
    expect(parseFlyToParam({ flyto: "Infinity,37.4" })).toBeNull();
  });

  it("returns null when lng is out of range", () => {
    expect(parseFlyToParam({ flyto: "-181,37.4" })).toBeNull();
    expect(parseFlyToParam({ flyto: "181,37.4" })).toBeNull();
  });

  it("returns null when lat is out of range", () => {
    expect(parseFlyToParam({ flyto: "-122.1,-91" })).toBeNull();
    expect(parseFlyToParam({ flyto: "-122.1,91" })).toBeNull();
  });

  it("accepts boundary values (lng=±180, lat=±90)", () => {
    expect(parseFlyToParam({ flyto: "-180,-90" })).toEqual({ center: [-180, -90] });
    expect(parseFlyToParam({ flyto: "180,90" })).toEqual({ center: [180, 90] });
  });
});

describe("parseFlyToParam - bbox (bbox=west,south,east,north)", () => {
  it("parses a valid center + bbox", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,37,-122,38" })).toEqual({
      center: [-122.1, 37.4],
      bbox: [-123, 37, -122, 38],
    });
  });

  it("drops an invalid bbox (wrong component count) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,37,-122" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops a non-numeric bbox and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "a,b,c,d" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops an inverted bbox (south >= north) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,38,-122,37" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops an inverted bbox (west >= east) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-122,37,-123,38" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops a zero-area bbox (south === north) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,37,-122,37" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops a zero-area bbox (west === east) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,37,-123,38" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops an out-of-range bbox (west/east outside [-180,180]) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-181,37,-122,38" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops an out-of-range bbox (south/north outside [-90,90]) and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,-91,-122,38" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("drops a non-finite bbox component and keeps the center", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "-123,NaN,-122,38" })).toEqual({
      center: [-122.1, 37.4],
    });
  });

  it("ignores an empty bbox string (treated as absent)", () => {
    expect(parseFlyToParam({ flyto: "-122.1,37.4", bbox: "" })).toEqual({
      center: [-122.1, 37.4],
    });
  });
});

describe("buildFlyToQuery", () => {
  it("builds the flyto-only query string", () => {
    expect(buildFlyToQuery({ lng: -122.1, lat: 37.4 })).toBe("flyto=-122.1,37.4");
  });

  it("builds the flyto+bbox query string", () => {
    expect(
      buildFlyToQuery({
        lng: -122.1,
        lat: 37.4,
        bbox: { west: -123, south: 37, east: -122, north: 38 },
      }),
    ).toBe("flyto=-122.1,37.4&bbox=-123,37,-122,38");
  });

  it("round-trips through parseFlyToParam", () => {
    const query = buildFlyToQuery({
      lng: -122.1,
      lat: 37.4,
      bbox: { west: -123, south: 37, east: -122, north: 38 },
    });
    const params = new URLSearchParams(query);
    expect(parseFlyToParam(params)).toEqual({
      center: [-122.1, 37.4],
      bbox: [-123, 37, -122, 38],
    });
  });
});

describe("deriveCameraAction", () => {
  it("derives a fit action when bbox is present, capped at PLACE_MIN_ZOOM with padding 48", () => {
    const action = deriveCameraAction({ center: [-122.1, 37.4], bbox: [-123, 37, -122, 38] });
    expect(action).toEqual({
      kind: "fit",
      bounds: [
        [-123, 37],
        [-122, 38],
      ],
      maxZoom: PLACE_MIN_ZOOM,
      padding: 48,
    });
  });

  it("derives a fly action when bbox is absent, at NEIGHBORHOOD_ZOOM", () => {
    const action = deriveCameraAction({ center: [-122.1, 37.4] });
    expect(action).toEqual({ kind: "fly", center: [-122.1, 37.4], zoom: NEIGHBORHOOD_ZOOM });
  });
});
