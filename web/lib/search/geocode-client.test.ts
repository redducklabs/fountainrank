import { afterEach, describe, expect, it, vi } from "vitest";

// Deterministic base URL, independent of process.env in this test run.
vi.mock("../api", () => ({ resolveApiBaseUrl: () => "http://test-api" }));

import {
  DEFAULT_GEOCODE_LIMIT,
  GeocodeApiError,
  mapGeocodeError,
  mapGeocodeResults,
  searchGeocode,
} from "./geocode-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mapGeocodeResults", () => {
  it("maps label/latitude/longitude and bounding_box -> boundingBox", () => {
    const results = mapGeocodeResults([
      {
        label: "Main St, Springfield",
        latitude: 1.5,
        longitude: -2.5,
        bounding_box: { south: 1, west: -3, north: 2, east: -2 },
      },
    ]);
    expect(results).toEqual([
      {
        id: "1.5,-2.5,0",
        label: "Main St, Springfield",
        latitude: 1.5,
        longitude: -2.5,
        boundingBox: { south: 1, west: -3, north: 2, east: -2 },
      },
    ]);
  });

  it("omits boundingBox when bounding_box is null", () => {
    const [result] = mapGeocodeResults([
      { label: "A", latitude: 1, longitude: 2, bounding_box: null },
    ]);
    expect(result).not.toHaveProperty("boundingBox");
  });

  it("omits boundingBox when bounding_box is absent", () => {
    const [result] = mapGeocodeResults([{ label: "B", latitude: 1, longitude: 2 }]);
    expect(result).not.toHaveProperty("boundingBox");
  });

  it("derives distinct stable ids for two results sharing identical coordinates", () => {
    const results = mapGeocodeResults([
      { label: "A", latitude: 1, longitude: 2 },
      { label: "B", latitude: 1, longitude: 2 },
    ]);
    expect(results[0]?.id).not.toBe(results[1]?.id);
  });

  it("maps an empty result array to an empty list", () => {
    expect(mapGeocodeResults([])).toEqual([]);
  });
});

describe("searchGeocode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls GET /api/v1/geocode with q/limit/lat/lng and maps the response", async () => {
    let requestUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const req = input instanceof Request ? input : new Request(String(input));
        requestUrl = req.url;
        return jsonResponse({
          results: [{ label: "1600 Amphitheatre Pkwy", latitude: 37.4, longitude: -122.1 }],
        });
      }),
    );

    const results = await searchGeocode({ q: "amphitheatre", limit: 5, lat: 37, lng: -122 });

    expect(requestUrl).toContain("q=amphitheatre");
    expect(requestUrl).toContain("limit=5");
    expect(requestUrl).toContain("lat=37");
    expect(requestUrl).toContain("lng=-122");
    expect(results).toEqual([
      { id: "37.4,-122.1,0", label: "1600 Amphitheatre Pkwy", latitude: 37.4, longitude: -122.1 },
    ]);
  });

  it("applies the default limit when none is given", async () => {
    let requestUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const req = input instanceof Request ? input : new Request(String(input));
        requestUrl = req.url;
        return jsonResponse({ results: [] });
      }),
    );

    await searchGeocode({ q: "main st" });
    expect(requestUrl).toContain(`limit=${DEFAULT_GEOCODE_LIMIT}`);
    expect(requestUrl).not.toContain("lat=");
    expect(requestUrl).not.toContain("lng=");
  });

  it("sends NO Authorization header - the geocode endpoint is public, no token provider (spec §4.1)", async () => {
    let sentKeys: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const req = input instanceof Request ? input : new Request(String(input));
        sentKeys = [...req.headers.keys()].map((k) => k.toLowerCase());
        return jsonResponse({ results: [] });
      }),
    );

    await searchGeocode({ q: "main st" });
    expect(sentKeys).not.toContain("authorization");
  });

  it.each([503, 502, 429])("throws GeocodeApiError(%d) on that response status", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(searchGeocode({ q: "main st" })).rejects.toBeInstanceOf(GeocodeApiError);
  });

  it("propagates a network failure (no HTTP status) as a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Network request failed");
      }),
    );
    await expect(searchGeocode({ q: "main st" })).rejects.toThrow();
  });
});

describe("mapGeocodeError - maps every documented failure to the 'unavailable' view-state reason", () => {
  it("maps a 503 (geocoding_disabled / geocoding_unavailable)", () => {
    expect(mapGeocodeError(new GeocodeApiError(503))).toBe("unavailable");
  });

  it("maps a 502 (geocoding_upstream)", () => {
    expect(mapGeocodeError(new GeocodeApiError(502))).toBe("unavailable");
  });

  it("maps a 429 (throttled)", () => {
    expect(mapGeocodeError(new GeocodeApiError(429))).toBe("unavailable");
  });

  it("maps a network/offline failure (no HTTP status)", () => {
    expect(mapGeocodeError(new TypeError("Network request failed"))).toBe("unavailable");
  });
});
