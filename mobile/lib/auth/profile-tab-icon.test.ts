import { describe, expect, it } from "vitest";

import { profileTabIcon } from "./profile-tab-icon";

describe("profileTabIcon", () => {
  it("shows the image when a non-empty avatar URL is present", () => {
    expect(profileTabIcon("https://example.com/avatar.jpg", false)).toBe("image");
    expect(profileTabIcon("https://example.com/avatar.jpg", true)).toBe("image");
  });

  it("falls back to the glyph when there is no avatar URL", () => {
    expect(profileTabIcon(null, false)).toBe("glyph");
    expect(profileTabIcon(undefined, false)).toBe("glyph");
    expect(profileTabIcon("", false)).toBe("glyph");
  });

  it("does not change the decision based on focus", () => {
    expect(profileTabIcon("https://example.com/avatar.jpg", true)).toBe(
      profileTabIcon("https://example.com/avatar.jpg", false),
    );
    expect(profileTabIcon(null, true)).toBe(profileTabIcon(null, false));
  });
});
