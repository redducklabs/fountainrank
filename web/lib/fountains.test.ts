import { describe, expect, it, vi } from "vitest";
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
import { fetchBbox } from "./fountains";
describe("fetchBbox", () => {
  it("queries bbox + returns data", async () => {
    expect(await fetchBbox({ min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 })).toEqual([
      { id: "a" },
    ]);
  });
});
