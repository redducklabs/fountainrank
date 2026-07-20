import { describe, expect, it } from "vitest";
import { contributionEventLabel, signedContributionPoints } from "./contributions";

describe("admin contribution presentation", () => {
  it("formats labels and signed statuses", () => {
    expect(contributionEventLabel("rate")).toBe("Rated fountain");
    expect(contributionEventLabel("future_event")).toBe("future event");
    expect(signedContributionPoints(2, "awarded")).toBe("+2");
    expect(signedContributionPoints(2, "reversed")).toBe("-2");
  });
});
