import { describe, expect, it } from "vitest";

import { clampPhotoIndex, resolvePhotoUrl, shouldShowDeleteControl } from "./photo-carousel";

describe("resolvePhotoUrl", () => {
  it("prefixes the API-relative photo path with the API base url", () => {
    expect(resolvePhotoUrl("https://api.example.com", "/api/v1/photos/p1")).toBe(
      "https://api.example.com/api/v1/photos/p1",
    );
  });
});

describe("clampPhotoIndex", () => {
  it("returns the index unchanged when in range", () => {
    expect(clampPhotoIndex(1, 3)).toBe(1);
  });
  it("clamps to the last index when the index is past the end", () => {
    expect(clampPhotoIndex(5, 3)).toBe(2);
  });
  it("clamps a negative index to 0", () => {
    expect(clampPhotoIndex(-1, 3)).toBe(0);
  });
  it("returns 0 when the list is empty", () => {
    expect(clampPhotoIndex(2, 0)).toBe(0);
  });
});

describe("shouldShowDeleteControl", () => {
  it("is true when the photo is own and a delete handler is supplied", () => {
    expect(shouldShowDeleteControl({ is_own: true }, true)).toBe(true);
  });
  it("is false when the photo is not own, even with a delete handler", () => {
    expect(shouldShowDeleteControl({ is_own: false }, true)).toBe(false);
  });
  it("is false when no delete handler is supplied, even for an own photo", () => {
    expect(shouldShowDeleteControl({ is_own: true }, false)).toBe(false);
  });
});
