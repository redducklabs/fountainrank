import { describe, expect, it } from "vitest";

import {
  addFountainPointsPreview,
  attributePointsPreview,
  conditionPointsBlocked,
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
