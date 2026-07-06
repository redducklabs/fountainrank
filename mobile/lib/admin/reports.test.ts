import { describe, expect, it } from "vitest";

import {
  contentSupportsDelete,
  formatBadgeCount,
  hideToggleLabel,
  isQueueEmpty,
  nextHiddenState,
  shouldShowBadge,
} from "./reports";

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
          content_type: "photo",
          content_id: "p1",
          fountain_id: "f1",
          is_hidden: false,
          report_count: 1,
          categories: ["spam"],
          notes: [],
          first_reported_at: "2026-06-22T10:00:00Z",
          contributor: null,
          thumbnail_url: "/t",
          url: "/u",
          excerpt: null,
          fountain_label: null,
        },
      ]),
    ).toBe(false);
  });
});

describe("contentSupportsDelete", () => {
  it("is true for photo and fountain (hard delete available)", () => {
    expect(contentSupportsDelete("photo")).toBe(true);
    expect(contentSupportsDelete("fountain")).toBe(true);
  });
  it("is false for note (hide is the removal, no hard delete)", () => {
    expect(contentSupportsDelete("note")).toBe(false);
  });
});

describe("shouldShowBadge", () => {
  it("is false for undefined (query disabled/not yet resolved)", () => {
    expect(shouldShowBadge(undefined)).toBe(false);
  });
  it("is false for zero", () => {
    expect(shouldShowBadge(0)).toBe(false);
  });
  it("is true for any positive count", () => {
    expect(shouldShowBadge(1)).toBe(true);
    expect(shouldShowBadge(42)).toBe(true);
  });
});

describe("formatBadgeCount", () => {
  it("shows the raw count for 1-9", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(9)).toBe("9");
  });
  it("caps at '9+' above 9", () => {
    expect(formatBadgeCount(10)).toBe("9+");
    expect(formatBadgeCount(123)).toBe("9+");
  });
});
