import { describe, expect, it } from "vitest";
import { contributorInitials } from "./leaderboard-avatar";

describe("contributorInitials", () => {
  it("uses up to two words and handles blank names", () => {
    expect(contributorInitials("Ada Lovelace")).toBe("AL");
    expect(contributorInitials("Prince")).toBe("P");
    expect(contributorInitials("   ")).toBe("?");
  });
});
