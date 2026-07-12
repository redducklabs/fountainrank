import { describe, expect, it } from "vitest";
import type { components } from "@fountainrank/api-client";

import { awardedPoints } from "./awarded-points";

type FountainDetailT = components["schemas"]["FountainDetail"];

/** A complete generated FountainDetail; override only the field under test. */
function detail(over: Partial<FountainDetailT> = {}): FountainDetailT {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    location: { latitude: 0, longitude: 0 },
    is_working: true,
    comments: null,
    average_rating: null,
    rating_count: 0,
    ranking_score: null,
    created_at: "2026-07-12T00:00:00Z",
    last_rated_at: null,
    dimensions: [],
    attributes: [],
    ...over,
  } as FountainDetailT;
}

describe("awardedPoints (#204)", () => {
  it("reads the canonical points_awarded", () => {
    expect(awardedPoints(detail({ points_awarded: 9 }))).toBe(9);
  });

  it("reports 0 when the write deduped — the case that used to fake a full award", () => {
    expect(awardedPoints(detail({ points_awarded: 0 }))).toBe(0);
  });

  it("a NULL canonical field means 0 — it does NOT fall through to the legacy field", () => {
    // The case a `??` implementation gets wrong; it passes every other test here. Keep it.
    expect(awardedPoints(detail({ points_awarded: null, condition_points_awarded: 3 }))).toBe(0);
  });

  it("falls back to the deprecated condition field only when the canonical key is ABSENT", () => {
    // An older server: the canonical KEY is missing entirely, not null.
    const oldServer = detail();
    delete (oldServer as { points_awarded?: unknown }).points_awarded;
    (oldServer as { condition_points_awarded?: number }).condition_points_awarded = 3;
    expect(awardedPoints(oldServer)).toBe(3);
  });

  it("treats absent/undefined as zero — never celebrate what we cannot verify", () => {
    expect(awardedPoints(detail())).toBe(0);
    expect(awardedPoints(undefined)).toBe(0);
  });

  it("REJECTS an ad-hoc award object at compile time (this IS the barrier)", () => {
    // If someone loosens awardedPoints' parameter back to a structural `{ points_awarded?: number }`,
    // this @ts-expect-error stops erroring and THIS TEST FAILS. That is the enforcement — a client
    // -computed number must never be mintable as a server award.
    // @ts-expect-error an ad-hoc points object is not a generated API response
    awardedPoints({ points_awarded: 999 });
  });
});
