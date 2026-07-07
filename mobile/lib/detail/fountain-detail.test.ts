import { describe, expect, it } from "vitest";

import { heroPhoto, photosTabLabel, seeAllPhotosLabel } from "./fountain-detail";

const photo = (id: string) => ({
  id,
  url: `/api/v1/photos/${id}`,
  thumbnail_url: `/api/v1/photos/${id}/thumb`,
  width: 800,
  height: 600,
  uploaded_by: null,
  created_at: "2026-07-07T00:00:00Z",
  is_own: false,
});

describe("heroPhoto", () => {
  it("returns null for undefined or empty", () => {
    expect(heroPhoto(undefined)).toBeNull();
    expect(heroPhoto([])).toBeNull();
  });
  it("returns the newest (first) photo", () => {
    expect(heroPhoto([photo("a"), photo("b")])?.id).toBe("a");
  });
});

describe("photosTabLabel", () => {
  it("has no count when empty, a count otherwise", () => {
    expect(photosTabLabel(0)).toBe("Photos");
    expect(photosTabLabel(3)).toBe("Photos (3)");
  });
});

describe("seeAllPhotosLabel", () => {
  it("pluralizes correctly", () => {
    expect(seeAllPhotosLabel(1)).toBe("See all 1 photo");
    expect(seeAllPhotosLabel(2)).toBe("See all 2 photos");
  });
});
