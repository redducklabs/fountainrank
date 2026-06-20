import { describe, expect, it } from "vitest";
import { formatPill, formatAverage, formatVotes, formatDimension, formatDate } from "./format";
describe("formatPill", () => {
  it("rounds 1dp", () => expect(formatPill(4.26)).toBe("★ 4.3"));
  it("null -> null", () => expect(formatPill(null)).toBeNull());
});
describe("formatAverage", () => {
  it("formats", () => expect(formatAverage(3.95)).toBe("4.0"));
  it("null", () => expect(formatAverage(null)).toBe("Not yet rated"));
});
describe("formatVotes", () => {
  it("singular", () => expect(formatVotes(1)).toBe("1 rating"));
  it("plural", () => expect(formatVotes(12)).toBe("12 ratings"));
  it("zero", () => expect(formatVotes(0)).toBe("0 ratings"));
});
describe("formatDimension", () => {
  it("with votes", () => expect(formatDimension(4.4, 72)).toBe("★ 4.4 (72)"));
  it("no votes", () => expect(formatDimension(null, 0)).toBe("Not yet rated"));
});
describe("formatDate", () => {
  it("month + year (UTC)", () => expect(formatDate("2026-06-01T00:00:00Z")).toBe("Jun 2026"));
});
