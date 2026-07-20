import { describe, expect, it } from "vitest";

import {
  buildLeaderboardQuery,
  contributorHistoryUserId,
  parseCenterParam,
  rowMetricCaption,
  rowPrimaryValue,
} from "./query";

describe("parseCenterParam", () => {
  it("parses a valid center", () => {
    expect(parseCenterParam("40.5", "-74.1")).toEqual({ lat: 40.5, lng: -74.1 });
  });
  it("returns null when params are missing", () => {
    expect(parseCenterParam(undefined, undefined)).toBeNull();
    expect(parseCenterParam("40.5", undefined)).toBeNull();
  });
  it("returns null for non-numeric or out-of-range values", () => {
    expect(parseCenterParam("abc", "0")).toBeNull();
    expect(parseCenterParam("200", "0")).toBeNull();
    expect(parseCenterParam("0", "999")).toBeNull();
  });
  it("takes the first value when a param is an array", () => {
    expect(parseCenterParam(["1.5", "9"], ["2.5"])).toEqual({ lat: 1.5, lng: 2.5 });
  });
});

describe("buildLeaderboardQuery", () => {
  const center = { lat: 1.5, lng: 2.5 };
  it("sends only sort on the global board", () => {
    expect(buildLeaderboardQuery("global", "fountains", center)).toEqual({ sort: "fountains" });
  });
  it("sends near params when scope=near with a center", () => {
    expect(buildLeaderboardQuery("near", "total", center)).toEqual({
      sort: "total",
      near_lat: 1.5,
      near_lng: 2.5,
    });
  });
  it("falls back to global when scope=near but no center is available", () => {
    expect(buildLeaderboardQuery("near", "ratings", null)).toEqual({ sort: "ratings" });
  });
});

describe("row metric selection", () => {
  it("uses points on the total board", () => {
    expect(rowPrimaryValue(1234, 7, "total")).toBe(1234);
    expect(rowMetricCaption(1234, "total")).toBe("pts");
  });
  it("uses the category count with total points as caption on a category board", () => {
    expect(rowPrimaryValue(1234, 7, "fountains")).toBe(7);
    expect(rowMetricCaption(1234, "fountains")).toBe("fountains added · 1,234 pts");
  });
  it("treats a missing category count as zero", () => {
    expect(rowPrimaryValue(10, null, "notes")).toBe(0);
    expect(rowPrimaryValue(10, undefined, "notes")).toBe(0);
  });
});

describe("contributor history visibility", () => {
  const publicRow = {
    rank: 1,
    display_name: "Same Name",
    avatar_url: null,
    points: 10,
    category_count: null,
    is_you: false,
  };
  const adminRow = {
    ...publicRow,
    user_id: "11111111-1111-1111-1111-111111111111",
  };

  it("returns a stable id only for confirmed admins with admin rows", () => {
    expect(contributorHistoryUserId(adminRow, true)).toBe(adminRow.user_id);
    expect(contributorHistoryUserId(adminRow, false)).toBeNull();
    expect(contributorHistoryUserId(publicRow, true)).toBeNull();
  });
});
