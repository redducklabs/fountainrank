import { describe, expect, it, vi } from "vitest";

// Mock ./api (used by fetchBbox + getFountainDetailServer for resolveApiBaseUrl/getApiClient)
vi.mock("./api", () => ({
  resolveApiBaseUrl: () => "http://x",
  getApiClient: () => ({
    GET: vi.fn(async (path: string, opts: any) => {
      expect(path).toBe("/api/v1/fountains/bbox");
      expect(opts.params.query).toEqual({ min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 });
      return { data: [{ id: "a" }], error: undefined, response: { status: 200 } };
    }),
  }),
}));

// Mock @fountainrank/api-client — makeClient is used by getFountainDetailServer
const mockGet = vi.fn();
vi.mock("@fountainrank/api-client", () => ({
  makeClient: () => ({ GET: mockGet }),
}));

import { fetchBbox, getFountainDetailServer } from "./fountains";

describe("fetchBbox", () => {
  it("queries bbox + returns data", async () => {
    expect(await fetchBbox({ min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 })).toEqual([
      { id: "a" },
    ]);
  });
});

describe("getFountainDetailServer", () => {
  it("returns { data: undefined, status: 0 } when client.GET throws (network error)", async () => {
    mockGet.mockRejectedValueOnce(new Error("network error"));
    const result = await getFountainDetailServer("x", "rid");
    expect(result).toEqual({ data: undefined, status: 0 });
  });
});
