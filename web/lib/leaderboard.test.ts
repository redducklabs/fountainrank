import { describe, expect, it } from "vitest";
import {
  leaderboardControlHref,
  leaderboardHref,
  parseLeaderboardParams,
  rowMetricCaption,
  rowPrimaryValue,
  toApiQuery,
} from "./leaderboard";

describe("parseLeaderboardParams", () => {
  it("defaults to the global total board", () => {
    const p = parseLeaderboardParams({});
    expect(p).toEqual({
      query: { sort: "total", near: null },
      scope: "global",
      center: null,
      sort: "total",
    });
  });

  it("reads a valid category sort and ignores an unknown one", () => {
    expect(parseLeaderboardParams({ sort: "ratings" }).sort).toBe("ratings");
    expect(parseLeaderboardParams({ sort: "bogus" }).sort).toBe("total");
  });

  it("parses a center and exposes it regardless of scope", () => {
    const p = parseLeaderboardParams({ lat: "40.5", lng: "-74.1" });
    expect(p.center).toEqual({ lat: 40.5, lng: -74.1 });
    expect(p.scope).toBe("global"); // center present but scope not requested
    expect(p.query.near).toBeNull();
  });

  it("honours scope=near only when a valid center is present", () => {
    const near = parseLeaderboardParams({ scope: "near", lat: "40.5", lng: "-74.1" });
    expect(near.scope).toBe("near");
    expect(near.query.near).toEqual({ lat: 40.5, lng: -74.1 });
    // scope=near without coordinates falls back to global
    const stale = parseLeaderboardParams({ scope: "near" });
    expect(stale.scope).toBe("global");
    expect(stale.center).toBeNull();
  });

  it("rejects out-of-range / non-numeric coordinates", () => {
    expect(parseLeaderboardParams({ lat: "200", lng: "0" }).center).toBeNull();
    expect(parseLeaderboardParams({ lat: "abc", lng: "0" }).center).toBeNull();
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseLeaderboardParams({ sort: ["notes", "ratings"] }).sort).toBe("notes");
  });
});

describe("toApiQuery", () => {
  it("sends only sort for a global board", () => {
    expect(toApiQuery({ sort: "fountains", near: null })).toEqual({ sort: "fountains" });
  });
  it("sends near_lat/near_lng for a regional board", () => {
    expect(toApiQuery({ sort: "total", near: { lat: 1.5, lng: 2.5 } })).toEqual({
      sort: "total",
      near_lat: 1.5,
      near_lng: 2.5,
    });
  });
});

describe("leaderboardHref", () => {
  it("falls back to the global board when no center is known", () => {
    expect(leaderboardHref(null)).toBe("/leaderboard");
  });
  it("encodes the center as query params", () => {
    expect(leaderboardHref({ lat: 40.5, lng: -74.1 })).toBe("/leaderboard?lat=40.5&lng=-74.1");
  });
});

describe("row metric selection", () => {
  it("uses points on the total board", () => {
    expect(rowPrimaryValue(1234, 7, "total")).toBe(1234);
    expect(rowMetricCaption(1234, "total")).toBe("pts");
  });

  it("uses the category count (with total points as caption) on a category board", () => {
    expect(rowPrimaryValue(1234, 7, "fountains")).toBe(7);
    expect(rowMetricCaption(1234, "fountains")).toBe("fountains added · 1,234 pts");
  });

  it("treats a missing category count as zero", () => {
    expect(rowPrimaryValue(10, null, "notes")).toBe(0);
    expect(rowPrimaryValue(10, undefined, "notes")).toBe(0);
  });
});

describe("leaderboardControlHref", () => {
  const base = parseLeaderboardParams({ lat: "40.5", lng: "-74.1" });

  it("preserves the center and omits default total/global params", () => {
    expect(leaderboardControlHref(base, {})).toBe("/leaderboard?lat=40.5&lng=-74.1");
  });

  it("sets a category sort", () => {
    expect(leaderboardControlHref(base, { sort: "notes" })).toBe(
      "/leaderboard?sort=notes&lat=40.5&lng=-74.1",
    );
  });

  it("adds scope=near only when a center exists", () => {
    expect(leaderboardControlHref(base, { scope: "near" })).toBe(
      "/leaderboard?lat=40.5&lng=-74.1&scope=near",
    );
    const noCenter = parseLeaderboardParams({});
    expect(leaderboardControlHref(noCenter, { scope: "near" })).toBe("/leaderboard");
  });
});
