import { describe, expect, it } from "vitest";

import {
  addFountainPointsPreview,
  attributeEarnablePoints,
  conditionPointsBlocked,
  conditionPointsEligibleInText,
  conditionPointsPreview,
  isRatingDraftDirty,
  notePointsPreview,
  photoEarnablePoints,
  ratingEarnablePoints,
  totalPreviewPoints,
  type ViewerAwardStateT,
} from "./index";

/** The viewer has already been awarded for rating dim 1, observing attr 4, their note, and the
 *  fountain's first photo. Dims 2/3 and attr 5 are still earnable. */
const SPENT: ViewerAwardStateT = {
  unrated_rating_type_ids: [2, 3],
  unobserved_attribute_type_ids: [5],
  note_earnable: false,
  photo_first_earnable: false,
};

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
    expect(ratingEarnablePoints(null, [])).toEqual([]);
    expect(attributeEarnablePoints(null, [])).toEqual([]);
    expect(notePointsPreview(null, false)).toEqual([]);
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

describe("isRatingDraftDirty", () => {
  const dims = [
    { rating_type_id: 1, your_rating: 3 },
    { rating_type_id: 2, your_rating: null },
  ];
  it("no edits -> not dirty", () => {
    expect(isRatingDraftDirty(dims, {})).toBe(false);
  });
  it("edit equal to saved -> not dirty", () => {
    expect(isRatingDraftDirty(dims, { 1: 3 })).toBe(false);
  });
  it("edit differs from saved -> dirty", () => {
    expect(isRatingDraftDirty(dims, { 1: 5 })).toBe(true);
  });
  it("edit on a previously-unrated dimension -> dirty", () => {
    expect(isRatingDraftDirty(dims, { 2: 4 })).toBe(true);
  });
});

describe("earnable points (ledger-derived, #204)", () => {
  it("counts only dimensions the viewer has not already been awarded for", () => {
    // dim 1 is already awarded, dim 2 is not -> only dim 2 earns.
    expect(ratingEarnablePoints(SPENT, [1, 2])).toEqual([{ label: "Ratings", points: 2 }]);
  });

  it("shows NO preview when every chosen dimension is already earned", () => {
    // This is the #204 case: the old code promised "+2 possible points" here and then awarded 0.
    expect(ratingEarnablePoints(SPENT, [1])).toEqual([]);
  });

  it("counts only attributes the viewer has not already observed", () => {
    expect(attributeEarnablePoints(SPENT, [5])).toEqual([{ label: "Details", points: 2 }]);
    expect(attributeEarnablePoints(SPENT, [4])).toEqual([]);
  });

  it("is empty for a note/photo whose award is already spent", () => {
    expect(notePointsPreview(SPENT, true)).toEqual([]);
    expect(photoEarnablePoints(SPENT)).toEqual([]);
  });

  it("shows the full award to an anonymous viewer (null) — they have earned nothing yet", () => {
    expect(ratingEarnablePoints(null, [1, 2])).toEqual([{ label: "Ratings", points: 4 }]);
    expect(notePointsPreview(null, true)).toEqual([{ label: "Comment", points: 2 }]);
    expect(photoEarnablePoints(null)).toEqual([{ label: "First photo bonus", points: 5 }]);
  });

  it("previews the photo award when the fountain has no first photo yet", () => {
    expect(photoEarnablePoints({ ...SPENT, photo_first_earnable: true })).toEqual([
      { label: "First photo bonus", points: 5 },
    ]);
  });
});
