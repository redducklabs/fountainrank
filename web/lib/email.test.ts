import { describe, expect, it } from "vitest";

import { isDisplayableEmail } from "./email";

describe("isDisplayableEmail", () => {
  it("returns true for a real email address", () => {
    expect(isDisplayableEmail("user@example.com")).toBe(true);
  });

  it("returns true for a Gmail address", () => {
    expect(isDisplayableEmail("jane.doe@gmail.com")).toBe(true);
  });

  it("returns false for Apple private relay addresses", () => {
    expect(isDisplayableEmail("abc123@privaterelay.appleid.com")).toBe(false);
  });

  it("returns false for mixed-case Apple private relay addresses", () => {
    expect(isDisplayableEmail("Abc@PrivateRelay.AppleID.com")).toBe(false);
  });

  it("returns false for FountainRank synthetic noreply addresses", () => {
    expect(isDisplayableEmail("sub_abc123@users.noreply.fountainrank.com")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isDisplayableEmail(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isDisplayableEmail(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isDisplayableEmail("")).toBe(false);
  });

  it("returns false for a whitespace-only string", () => {
    expect(isDisplayableEmail("   ")).toBe(false);
  });

  it("returns false for a whitespace-padded Apple private relay address", () => {
    // The trim must happen before the suffix check, or the padded relay would leak.
    expect(isDisplayableEmail("abc123@privaterelay.appleid.com ")).toBe(false);
    expect(isDisplayableEmail("  sub_x@users.noreply.fountainrank.com")).toBe(false);
  });
});
