import { describe, expect, it } from "vitest";

import {
  addFountainPointsPreview,
  attributePointsPreview,
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
