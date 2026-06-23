import { describe, expect, it } from "vitest";

import type { paths } from "@fountainrank/api-client";

import { buildBboxQuery, DEFAULT_FILTERS, fountainsQueryKey, hasActiveFilters } from "./filters";

const BOUNDS = { min_lat: 39, min_lng: -98, max_lat: 40, max_lng: -97 };

// Type-only contract guard (checked by `tsc`, not at runtime): the builder's
// output MUST be a valid query for GET /api/v1/fountains/bbox per the generated
// OpenAPI contract. If someone loosens buildBboxQuery to emit an unknown key,
// this line fails the typecheck.
const _bboxQueryContract: NonNullable<
  paths["/api/v1/fountains/bbox"]["get"]["parameters"]["query"]
> = buildBboxQuery(BOUNDS, DEFAULT_FILTERS);
void _bboxQueryContract;

describe("DEFAULT_FILTERS", () => {
  it("is all-off / no minimum rating", () => {
    expect(DEFAULT_FILTERS).toEqual({
      workingNow: false,
      bottleFiller: false,
      wheelchairReachable: false,
      minRating: null,
    });
  });
});

describe("buildBboxQuery", () => {
  it("returns only the bbox coords when no filter is active", () => {
    expect(buildBboxQuery(BOUNDS, DEFAULT_FILTERS)).toEqual(BOUNDS);
  });
  it("adds working_now only when workingNow is true", () => {
    expect(buildBboxQuery(BOUNDS, { ...DEFAULT_FILTERS, workingNow: true })).toEqual({
      ...BOUNDS,
      working_now: true,
    });
  });
  it("adds attribute filters when toggled on", () => {
    expect(
      buildBboxQuery(BOUNDS, {
        ...DEFAULT_FILTERS,
        bottleFiller: true,
        wheelchairReachable: true,
      }),
    ).toEqual({ ...BOUNDS, bottle_filler: true, wheelchair_reachable: true });
  });
  it("adds min_rating only when minRating is non-null", () => {
    expect(buildBboxQuery(BOUNDS, { ...DEFAULT_FILTERS, minRating: 3 })).toEqual({
      ...BOUNDS,
      min_rating: 3,
    });
    expect(buildBboxQuery(BOUNDS, { ...DEFAULT_FILTERS, minRating: null })).toEqual(BOUNDS);
  });
});

describe("fountainsQueryKey", () => {
  it("is stable for identical inputs and changes when bounds or filters change", () => {
    const k1 = fountainsQueryKey(BOUNDS, DEFAULT_FILTERS);
    const k2 = fountainsQueryKey(BOUNDS, DEFAULT_FILTERS);
    expect(k1).toEqual(k2);
    const k3 = fountainsQueryKey(BOUNDS, { ...DEFAULT_FILTERS, workingNow: true });
    expect(k3).not.toEqual(k1);
    const k4 = fountainsQueryKey({ ...BOUNDS, max_lat: 41 }, DEFAULT_FILTERS);
    expect(k4).not.toEqual(k1);
  });
  it("starts with the fountains/bbox namespace", () => {
    expect(fountainsQueryKey(BOUNDS, DEFAULT_FILTERS).slice(0, 2)).toEqual(["fountains", "bbox"]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for defaults and true when any filter is active", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, workingNow: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, minRating: 2 })).toBe(true);
  });
});
