import { describe, expect, it } from "vitest";

import { hideToggleLabel, isQueueEmpty, nextHiddenState } from "./reports";

describe("hideToggleLabel", () => {
  it("reads 'Hide' for a visible photo", () => {
    expect(hideToggleLabel({ is_hidden: false })).toBe("Hide");
  });
  it("reads 'Unhide' for a hidden photo", () => {
    expect(hideToggleLabel({ is_hidden: true })).toBe("Unhide");
  });
});

describe("nextHiddenState", () => {
  it("flips visible -> hidden", () => {
    expect(nextHiddenState({ is_hidden: false })).toBe(true);
  });
  it("flips hidden -> visible", () => {
    expect(nextHiddenState({ is_hidden: true })).toBe(false);
  });
});

describe("isQueueEmpty", () => {
  it("is true for undefined (not yet loaded)", () => {
    expect(isQueueEmpty(undefined)).toBe(true);
  });
  it("is true for an empty array", () => {
    expect(isQueueEmpty([])).toBe(true);
  });
  it("is false when there is at least one row", () => {
    expect(
      isQueueEmpty([
        {
          photo_id: "p1",
          fountain_id: "f1",
          url: "/u",
          thumbnail_url: "/t",
          is_hidden: false,
          report_count: 1,
          categories: ["spam"],
          notes: [],
          first_reported_at: "2026-06-22T10:00:00Z",
          uploaded_by: null,
        },
      ]),
    ).toBe(false);
  });
});
