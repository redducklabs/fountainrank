import { describe, expect, it } from "vitest";
import { contributionEventLabel, signedContributionPoints } from "./contributions";

describe("admin contribution presentation", () => {
  it("labels known and future event types", () => {
    expect(contributionEventLabel("add_fountain")).toBe("Added fountain");
    expect(contributionEventLabel("future_event")).toBe("future event");
  });

  it("shows reversed points as negative", () => {
    expect(signedContributionPoints(5, "awarded")).toBe("+5");
    expect(signedContributionPoints(5, "reversed")).toBe("-5");
  });
});
