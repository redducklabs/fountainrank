import { describe, expect, it } from "vitest";

import {
  addFountainPointsPreview,
  attributePointsPreview,
  conditionPointsBlocked,
  conditionPointsEligibleInText,
  conditionPointsPreview,
  notePointsPreview,
  ratingPointsPreview,
  totalPreviewPoints,
} from "./index";

describe("points previews", () => {
  it("previews add fountain base, conditional bonuses, ratings, details, and comment", () => {
    const lines = addFountainPointsPreview({
      ratingsCount: 2,
      observationsCount: 3,
      hasComment: true,
    });
    expect(lines).toEqual([
      { label: "Add fountain", points: 10 },
      { label: "First fountain bonus", points: 5, conditional: true },
      { label: "First nearby fountain bonus", points: 15, conditional: true },
      { label: "Ratings", points: 4 },
      { label: "Details", points: 6 },
      { label: "Comment", points: 2 },
    ]);
    expect(totalPreviewPoints(lines)).toBe(42);
  });

  it("omits empty optional contribution lines", () => {
    expect(ratingPointsPreview(0)).toEqual([]);
    expect(attributePointsPreview(0)).toEqual([]);
    expect(notePointsPreview(false)).toEqual([]);
  });

  it("previews condition points by status type", () => {
    expect(conditionPointsPreview("working")).toEqual([
      { label: "Working verification", points: 3 },
    ]);
    expect(conditionPointsPreview("problem")).toEqual([{ label: "Condition report", points: 2 }]);
  });
});

describe("conditionPointsBlocked", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("is false when eligibility is null/undefined (eligible now)", () => {
    expect(conditionPointsBlocked(null, now)).toBe(false);
    expect(conditionPointsBlocked(undefined, now)).toBe(false);
  });
  it("is true when eligibility is in the future", () => {
    expect(conditionPointsBlocked("2026-06-01T18:00:00Z", now)).toBe(true);
  });
  it("is false when eligibility is now or in the past", () => {
    expect(conditionPointsBlocked("2026-06-01T12:00:00Z", now)).toBe(false);
    expect(conditionPointsBlocked("2026-06-01T06:00:00Z", now)).toBe(false);
  });
});

describe("conditionPointsEligibleInText", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  it("returns null when already eligible (null/undefined/past)", () => {
    expect(conditionPointsEligibleInText(null, now)).toBeNull();
    expect(conditionPointsEligibleInText(undefined, now)).toBeNull();
    expect(conditionPointsEligibleInText("2026-06-01T11:00:00Z", now)).toBeNull();
  });
  it("formats a multi-hour wait", () => {
    expect(conditionPointsEligibleInText("2026-06-01T17:00:00Z", now)).toBe("about 5 hours");
  });
  it("uses singular 'hour' at ~1 hour", () => {
    expect(conditionPointsEligibleInText("2026-06-01T13:00:00Z", now)).toBe("about 1 hour");
  });
  it("falls back to minutes under an hour", () => {
    expect(conditionPointsEligibleInText("2026-06-01T12:20:00Z", now)).toBe("about 20 minutes");
  });
  it("never shows 'about 0 minutes' for a tiny remaining window", () => {
    expect(conditionPointsEligibleInText("2026-06-01T12:00:10Z", now)).toBe("about 1 minute");
  });
});
