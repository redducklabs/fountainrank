import type { components } from "@fountainrank/api-client";
import { describe, expect, it } from "vitest";

import { DEFAULT_FILTERS, fountainsQueryKey, type FountainFilters } from "./filters";
import { fountainPinFromDetail, insertPinIntoBboxCaches, type BboxResult } from "./pin-cache";

type FountainPin = components["schemas"]["FountainPin"];
type FountainDetail = components["schemas"]["FountainDetail"];

const PARAMS = { min_lat: 47, min_lng: -123, max_lat: 48, max_lng: -122 };

function makePin(id: string, lat: number, lng: number, extra?: Partial<FountainPin>): FountainPin {
  return {
    id,
    location: { latitude: lat, longitude: lng },
    is_working: true,
    average_rating: null,
    rating_count: 0,
    ...extra,
  };
}

function bboxEntry(
  filters: FountainFilters,
  result: unknown,
  params = PARAMS,
): [readonly unknown[], unknown] {
  return [fountainsQueryKey(params, filters), result];
}

describe("fountainPinFromDetail", () => {
  it("maps the detail to a FountainPin field-for-field (distance_m omitted)", () => {
    const detail: FountainDetail = {
      id: "f-1",
      location: { latitude: 47.6, longitude: -122.4 },
      is_working: true,
      comments: "cold and clean",
      average_rating: 4.5,
      rating_count: 12,
      ranking_score: 88.5,
      created_at: "2026-07-17T00:00:00Z",
      last_rated_at: "2026-07-17T00:00:00Z",
      current_status: "working",
      last_verified_at: "2026-07-16T00:00:00Z",
      dimensions: [],
      attributes: [],
    };
    expect(fountainPinFromDetail(detail)).toEqual({
      id: "f-1",
      location: { latitude: 47.6, longitude: -122.4 },
      is_working: true,
      average_rating: 4.5,
      rating_count: 12,
      ranking_score: 88.5,
      current_status: "working",
      last_verified_at: "2026-07-16T00:00:00Z",
    });
    expect("distance_m" in fountainPinFromDetail(detail)).toBe(false);
  });
});

describe("insertPinIntoBboxCaches", () => {
  it("appends an in-bounds pin to a default-filter entry, preserving truncated", () => {
    const existing: BboxResult = { pins: [makePin("a", 47.5, -122.5)], truncated: false };
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    const updates = insertPinIntoBboxCaches([[key, existing]], makePin("new", 47.6, -122.4));
    expect(updates).toHaveLength(1);
    expect(updates[0][0]).toBe(key);
    expect(updates[0][1].pins.map((p) => p.id)).toEqual(["a", "new"]);
    expect(updates[0][1].truncated).toBe(false);
  });

  it("inserts on the INCLUSIVE min and max boundaries", () => {
    const entry = bboxEntry(DEFAULT_FILTERS, { pins: [], truncated: false });
    // Exactly on the SW corner and the NE corner.
    for (const [lat, lng] of [
      [47, -123],
      [48, -122],
    ] as const) {
      const updates = insertPinIntoBboxCaches([entry], makePin("edge", lat, lng));
      expect(updates).toHaveLength(1);
    }
  });

  it("skips a pin just outside the bounds (untouched)", () => {
    const entry = bboxEntry(DEFAULT_FILTERS, { pins: [], truncated: false });
    const updates = insertPinIntoBboxCaches([entry], makePin("far", 49, -122));
    expect(updates).toHaveLength(0);
  });

  it("skips an entry with active filters (only invalidated, never seeded)", () => {
    const activeFilters: FountainFilters = { ...DEFAULT_FILTERS, bottleFiller: true };
    const entry = bboxEntry(activeFilters, { pins: [], truncated: false });
    const updates = insertPinIntoBboxCaches([entry], makePin("new", 47.5, -122.5));
    expect(updates).toHaveLength(0);
  });

  it("leaves the idle placeholder key and any non-bbox / wrong-shape key untouched", () => {
    const data: BboxResult = { pins: [], truncated: false };
    const idle: [readonly unknown[], unknown] = [["fountains", "bbox", "idle"], data];
    const wrongPrefix: [readonly unknown[], unknown] = [
      ["other", "bbox", PARAMS, DEFAULT_FILTERS],
      data,
    ];
    const tooLong: [readonly unknown[], unknown] = [
      ["fountains", "bbox", PARAMS, DEFAULT_FILTERS, "extra"],
      data,
    ];
    const updates = insertPinIntoBboxCaches(
      [idle, wrongPrefix, tooLong],
      makePin("new", 47.5, -122.5),
    );
    expect(updates).toHaveLength(0);
  });

  it("leaves entries with malformed params, filters, or result untouched", () => {
    const good: BboxResult = { pins: [], truncated: false };
    const badParams: [readonly unknown[], unknown] = [
      [
        "fountains",
        "bbox",
        { min_lat: "x", min_lng: -123, max_lat: 48, max_lng: -122 },
        DEFAULT_FILTERS,
      ],
      good,
    ];
    const badFilters: [readonly unknown[], unknown] = [
      ["fountains", "bbox", PARAMS, { workingNow: "yes" }],
      good,
    ];
    const badData: [readonly unknown[], unknown] = [
      fountainsQueryKey(PARAMS, DEFAULT_FILTERS),
      { pins: "nope", truncated: false },
    ];
    const undefData: [readonly unknown[], unknown] = [
      fountainsQueryKey(PARAMS, DEFAULT_FILTERS),
      undefined,
    ];
    const updates = insertPinIntoBboxCaches(
      [badParams, badFilters, badData, undefData],
      makePin("new", 47.5, -122.5),
    );
    expect(updates).toHaveLength(0);
  });

  it("leaves an entry whose cached pins contain a malformed element untouched (never throws)", () => {
    // A corrupt cache entry must not crash the same-id lookup on the successful-create path.
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    const nullPin: [readonly unknown[], unknown] = [key, { pins: [null], truncated: false }];
    const badId: [readonly unknown[], unknown] = [
      key,
      { pins: [{ location: { latitude: 47.5, longitude: -122.5 }, id: 5 }], truncated: false },
    ];
    expect(() => insertPinIntoBboxCaches([nullPin], makePin("new", 47.5, -122.5))).not.toThrow();
    expect(insertPinIntoBboxCaches([nullPin], makePin("new", 47.5, -122.5))).toHaveLength(0);
    expect(insertPinIntoBboxCaches([badId], makePin("new", 47.5, -122.5))).toHaveLength(0);
  });

  it("is a global no-op for a non-finite pin coordinate", () => {
    const entry = bboxEntry(DEFAULT_FILTERS, { pins: [], truncated: false });
    expect(insertPinIntoBboxCaches([entry], makePin("nan", NaN, -122.5))).toHaveLength(0);
    expect(insertPinIntoBboxCaches([entry], makePin("inf", Infinity, -122.5))).toHaveLength(0);
    expect(insertPinIntoBboxCaches([entry], makePin("neg-inf", 47.5, -Infinity))).toHaveLength(0);
  });

  it("replaces a same-id pin in place (POST response is the freshest record), not duplicating it", () => {
    const stale = makePin("dup", 47.5, -122.5, { average_rating: 3 });
    const existing: BboxResult = { pins: [stale, makePin("b", 47.4, -122.6)], truncated: false };
    const key = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    const fresh = makePin("dup", 47.6, -122.4, { average_rating: 5 });
    const updates = insertPinIntoBboxCaches([[key, existing]], fresh);
    expect(updates[0][1].pins).toHaveLength(2);
    expect(updates[0][1].pins[0]).toBe(fresh); // replaced in place at index 0
    expect(updates[0][1].pins[0].average_rating).toBe(5);
    expect(updates[0][1].pins.filter((p) => p.id === "dup")).toHaveLength(1);
  });

  it("preserves truncated:true", () => {
    const entry = bboxEntry(DEFAULT_FILTERS, { pins: [], truncated: true });
    const updates = insertPinIntoBboxCaches([entry], makePin("new", 47.5, -122.5));
    expect(updates[0][1].truncated).toBe(true);
  });

  it("updates immutably (new array + object) and returns nothing for untouched entries", () => {
    const originalPins = [makePin("a", 47.5, -122.5)];
    const inData: BboxResult = { pins: originalPins, truncated: false };
    const inKey = fountainsQueryKey(PARAMS, DEFAULT_FILTERS);
    // A second entry whose viewport does NOT contain the pin — must be left untouched.
    const outParams = { min_lat: 10, min_lng: 10, max_lat: 11, max_lng: 11 };
    const outKey = fountainsQueryKey(outParams, DEFAULT_FILTERS);
    const outData: BboxResult = { pins: [makePin("x", 10.5, 10.5)], truncated: false };

    const updates = insertPinIntoBboxCaches(
      [
        [inKey, inData],
        [outKey, outData],
      ],
      makePin("new", 47.6, -122.4),
    );

    // Only the containing entry is returned (the other keeps its cache reference untouched).
    expect(updates.map((u) => u[0])).toEqual([inKey]);
    expect(updates[0][1]).not.toBe(inData);
    expect(updates[0][1].pins).not.toBe(originalPins);
    expect(originalPins).toHaveLength(1); // source array not mutated
  });
});
