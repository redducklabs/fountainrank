import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import type { MobileApiClient } from "../api";
import { DEFAULT_GEOCODE_LIMIT, mapGeocodeError, mapGeocodeResults, searchGeocode } from "./query";

function fakeClient(get: MobileApiClient["GET"]): MobileApiClient {
  return {
    GET: get,
    POST: vi.fn(),
    PUT: vi.fn(),
    PATCH: vi.fn(),
    DELETE: vi.fn(),
  } as unknown as MobileApiClient;
}

describe("mapGeocodeResults", () => {
  it("maps the typed GeocodeResult[] to the { id, label, latitude, longitude } list model", () => {
    const results = mapGeocodeResults([
      { label: "Main St, Springfield", latitude: 1.5, longitude: -2.5 },
      { label: "Main St, Shelbyville", latitude: 1.5, longitude: -2.5 },
    ]);
    expect(results).toEqual([
      { id: "1.5,-2.5,0", label: "Main St, Springfield", latitude: 1.5, longitude: -2.5 },
      { id: "1.5,-2.5,1", label: "Main St, Shelbyville", latitude: 1.5, longitude: -2.5 },
    ]);
    // Two results sharing identical coordinates still get distinct, stable ids.
    expect(results[0]?.id).not.toBe(results[1]?.id);
  });

  it("maps an empty result array to an empty list", () => {
    expect(mapGeocodeResults([])).toEqual([]);
  });
});

describe("searchGeocode", () => {
  it("calls GET /api/v1/geocode with q/limit/lat/lng and maps the response", async () => {
    const get = vi.fn(async () => ({
      data: { results: [{ label: "1600 Amphitheatre Pkwy", latitude: 37.4, longitude: -122.1 }] },
      response: new Response(null, { status: 200 }),
    })) as unknown as MobileApiClient["GET"];
    const client = fakeClient(get);

    const results = await searchGeocode(client, { q: "amphitheatre", limit: 5, lat: 37, lng: -122 });

    expect(get).toHaveBeenCalledWith("/api/v1/geocode", {
      params: { query: { q: "amphitheatre", limit: 5, lat: 37, lng: -122 } },
    });
    expect(results).toEqual([
      { id: "37.4,-122.1,0", label: "1600 Amphitheatre Pkwy", latitude: 37.4, longitude: -122.1 },
    ]);
  });

  it("applies the default limit when none is given", async () => {
    const get = vi.fn(async () => ({
      data: { results: [] },
      response: new Response(null, { status: 200 }),
    })) as unknown as MobileApiClient["GET"];
    const client = fakeClient(get);

    await searchGeocode(client, { q: "main st" });

    expect(get).toHaveBeenCalledWith("/api/v1/geocode", {
      params: { query: { q: "main st", limit: DEFAULT_GEOCODE_LIMIT, lat: undefined, lng: undefined } },
    });
  });

  it("omits the viewport bias when lat/lng are not given", async () => {
    const get = vi.fn(async () => ({
      data: { results: [] },
      response: new Response(null, { status: 200 }),
    })) as unknown as MobileApiClient["GET"];
    const client = fakeClient(get);

    await searchGeocode(client, { q: "main st" });
    const call = (get as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      params: { query: { lat?: number; lng?: number } };
    };
    expect(call.params.query.lat).toBeUndefined();
    expect(call.params.query.lng).toBeUndefined();
  });

  it("propagates an ApiError for a non-2xx response (unwrap semantics)", async () => {
    const get = vi.fn(async () => ({
      response: new Response(null, { status: 503 }),
    })) as unknown as MobileApiClient["GET"];
    const client = fakeClient(get);

    await expect(searchGeocode(client, { q: "main st" })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("mapGeocodeError - maps every documented failure to the 'unavailable' view-state reason", () => {
  it("maps a 503 (geocoding_disabled / geocoding_unavailable)", () => {
    expect(mapGeocodeError(new ApiError(503))).toBe("unavailable");
  });

  it("maps a 502 (geocoding_upstream)", () => {
    expect(mapGeocodeError(new ApiError(502))).toBe("unavailable");
  });

  it("maps a 429 (throttled)", () => {
    expect(mapGeocodeError(new ApiError(429))).toBe("unavailable");
  });

  it("maps a network/offline failure (no HTTP status)", () => {
    expect(mapGeocodeError(new TypeError("Network request failed"))).toBe("unavailable");
  });
});
