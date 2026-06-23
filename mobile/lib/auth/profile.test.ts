import { describe, expect, it } from "vitest";

import { displayEmail, isDisplayableEmail, profileInitial } from "./profile";

describe("profile display helpers", () => {
  it("builds a stable profile initial", () => {
    expect(profileInitial("Aron")).toBe("A");
    expect(profileInitial("  sam")).toBe("S");
    expect(profileInitial("")).toBe("?");
  });

  it("hides synthetic noreply emails", () => {
    expect(isDisplayableEmail("u@example.com")).toBe(true);
    expect(displayEmail("u@example.com")).toBe("u@example.com");
    expect(displayEmail("sub@users.noreply.fountainrank.com")).toBeNull();
  });
});
