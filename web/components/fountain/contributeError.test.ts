import { describe, expect, it } from "vitest";

import { errorText } from "./contributeError";

describe("errorText", () => {
  it("names the 50 mi rule for too_far (#3)", () => {
    expect(errorText("too_far")).toContain("50 mi");
  });
  it("has distinct copy for the common errors", () => {
    expect(errorText("needs_name")).toMatch(/display name/i);
    expect(errorText("not_found")).toMatch(/no longer available/i);
    expect(errorText("rate_limited")).toMatch(/wait/i);
  });
});
