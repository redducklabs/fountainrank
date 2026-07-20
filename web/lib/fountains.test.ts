import { describe, expect, it, vi } from "vitest";

// Mutable GET stub so individual tests can override it.
const bboxGet = vi.fn();

// Mock ./api (used by fetchBbox + getFountainDetailServer for resolveApiBaseUrl/getApiClient)
vi.mock("./api", () => ({
  resolveApiBaseUrl: () => "http://x",
  getApiClient: () => ({ GET: bboxGet }),
}));

// Mock @fountainrank/api-client — makeClient is used by getFountainDetailServer
const mockGet = vi.fn();
vi.mock("@fountainrank/api-client", () => ({
  makeClient: () => ({ GET: mockGet }),
}));

import {
  fetchBbox,
  fetchPublicFountain,
  getFountainDetailServer,
  getFountainNotesServer,
} from "./fountains";

const PARAMS = { min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 };

describe("fetchBbox", () => {
  it("queries bbox + returns data on success", async () => {
    bboxGet.mockResolvedValueOnce({
      data: [{ id: "a" }],
      error: undefined,
      response: { ok: true, status: 200, headers: new Headers({}) },
    });
    expect(await fetchBbox(PARAMS)).toEqual({ pins: [{ id: "a" }], truncated: false });
  });

  it("returns the authoritative truncation header", async () => {
    bboxGet.mockResolvedValueOnce({
      data: [{ id: "a" }],
      error: undefined,
      response: {
        ok: true,
        status: 200,
        headers: new Headers({ "x-fountainrank-truncated": "true" }),
      },
    });
    expect(await fetchBbox(PARAMS)).toEqual({ pins: [{ id: "a" }], truncated: true });
  });

  it("throws with status context when the API returns a non-2xx error", async () => {
    bboxGet.mockResolvedValueOnce({
      data: undefined,
      error: { detail: "bad" },
      response: { ok: false, status: 422 },
    });
    await expect(fetchBbox(PARAMS)).rejects.toThrow("422");
  });
});

describe("getFountainDetailServer", () => {
  it("returns { data: undefined, status: 0 } when client.GET throws (network error)", async () => {
    mockGet.mockRejectedValueOnce(new Error("network error"));
    const result = await getFountainDetailServer("x", "rid");
    expect(result).toEqual({ data: undefined, status: 0 });
  });
});

describe("fetchPublicFountain", () => {
  it("returns exact public detail", async () => {
    const fountain = { id: "f1" };
    bboxGet.mockResolvedValueOnce({ data: fountain, response: { ok: true, status: 200 } });
    expect(await fetchPublicFountain("f1")).toEqual({ kind: "found", fountain });
  });
  it("classifies hidden/deleted public 404 without data", async () => {
    bboxGet.mockResolvedValueOnce({ data: undefined, response: { ok: false, status: 404 } });
    expect(await fetchPublicFountain("hidden")).toEqual({ kind: "not-found" });
  });
  it("classifies transport failure", async () => {
    bboxGet.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchPublicFountain("f1")).toEqual({ kind: "error", status: 0 });
  });
});

describe("getFountainNotesServer", () => {
  it("returns data + status on success", async () => {
    mockGet.mockResolvedValueOnce({ data: [{ id: "n1" }], response: { ok: true, status: 200 } });
    expect(await getFountainNotesServer("x", "rid")).toEqual({ data: [{ id: "n1" }], status: 200 });
  });
  it("returns status without data on non-2xx", async () => {
    mockGet.mockResolvedValueOnce({ data: undefined, response: { ok: false, status: 503 } });
    expect(await getFountainNotesServer("x", "rid")).toEqual({ data: undefined, status: 503 });
  });
  it("returns { data: undefined, status: 0 } on network error", async () => {
    mockGet.mockRejectedValueOnce(new Error("network error"));
    expect(await getFountainNotesServer("x", "rid")).toEqual({ data: undefined, status: 0 });
  });
});
