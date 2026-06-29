import { describe, expect, it } from "vitest";

import {
  attributeChipVariant,
  attributeDisplay,
  attributeValueLabel,
  formatAverage,
  formatCategory,
  formatDate,
  formatDateFull,
  formatDimension,
  formatPill,
  formatRelativeTime,
  formatVotes,
  starFills,
  statusDisplay,
} from "./format";

describe("starFills", () => {
  it("3.5 -> three full, one half, one empty", () =>
    expect(starFills(3.5)).toEqual(["full", "full", "full", "half", "empty"]));
  it("4 -> four full, one empty", () =>
    expect(starFills(4)).toEqual(["full", "full", "full", "full", "empty"]));
  it("3.2 rounds down to 3.0", () =>
    expect(starFills(3.2)).toEqual(["full", "full", "full", "empty", "empty"]));
  it("3.4 rounds up to 3.5 (half on the 4th)", () => expect(starFills(3.4)[3]).toBe("half"));
  it("clamps 0 and 5+", () => {
    expect(starFills(0)).toEqual(["empty", "empty", "empty", "empty", "empty"]);
    expect(starFills(7)).toEqual(["full", "full", "full", "full", "full"]);
  });
});

describe("attributeChipVariant", () => {
  it("Yes -> positive", () =>
    expect(attributeChipVariant({ text: "Yes", tone: "normal" })).toBe("positive"));
  it("low-confidence Yes is still positive", () =>
    expect(attributeChipVariant({ text: "Yes", tone: "muted" })).toBe("positive"));
  it("No -> negative", () =>
    expect(attributeChipVariant({ text: "No", tone: "normal" })).toBe("negative"));
  it("Unknown -> unknown", () =>
    expect(attributeChipVariant({ text: "Unknown", tone: "muted" })).toBe("unknown"));
  it("Mixed tone -> mixed", () =>
    expect(attributeChipVariant({ text: "Mixed", tone: "mixed" })).toBe("mixed"));
  it("specific value -> neutral", () =>
    expect(attributeChipVariant({ text: "Park", tone: "normal" })).toBe("neutral"));
});

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

describe("statusDisplay", () => {
  it("ok -> verified working", () =>
    expect(statusDisplay("ok", true)).toEqual({
      chipLabel: "Verified working",
      chipTone: "ok",
      advisory: null,
    }));
  it("degraded -> working, issues reported (warn)", () => {
    const r = statusDisplay("degraded", true);
    expect(r.chipLabel).toBe("Working — issues reported");
    expect(r.chipTone).toBe("warn");
    expect(r.advisory).toBeNull();
  });
  it("not_working -> bad", () =>
    expect(statusDisplay("not_working", true)).toEqual({
      chipLabel: "Not working",
      chipTone: "bad",
      advisory: null,
    }));
  it("reported_issue keeps working baseline + advisory", () => {
    const r = statusDisplay("reported_issue", true);
    expect(r.chipLabel).toBe("Working");
    expect(r.chipTone).toBe("ok");
    expect(r.advisory).toMatch(/issue reported/i);
  });
  it("reported_issue keeps out-of-order baseline + advisory", () => {
    const r = statusDisplay("reported_issue", false);
    expect(r.chipLabel).toBe("Out of order");
    expect(r.chipTone).toBe("bad");
    expect(r.advisory).toMatch(/issue reported/i);
  });
  it("null -> working baseline, no advisory", () =>
    expect(statusDisplay(null, true)).toEqual({
      chipLabel: "Working",
      chipTone: "ok",
      advisory: null,
    }));
  it("null -> out of order baseline", () =>
    expect(statusDisplay(null, false).chipLabel).toBe("Out of order"));
  it("unexpected status -> baseline, no crash", () =>
    expect(statusDisplay("weird_future", true)).toEqual({
      chipLabel: "Working",
      chipTone: "ok",
      advisory: null,
    }));
});

describe("formatDateFull", () => {
  it("day precision UTC", () =>
    expect(formatDateFull("2026-06-12T08:00:00Z")).toBe("Jun 12, 2026"));
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-22T12:00:00Z");
  it("just now (<60s)", () =>
    expect(formatRelativeTime("2026-06-22T11:59:30Z", now)).toBe("just now"));
  it("future clamps to just now", () =>
    expect(formatRelativeTime("2026-06-22T13:00:00Z", now)).toBe("just now"));
  it("1 minute singular", () =>
    expect(formatRelativeTime("2026-06-22T11:59:00Z", now)).toBe("1 minute ago"));
  it("minutes plural", () =>
    expect(formatRelativeTime("2026-06-22T11:45:00Z", now)).toBe("15 minutes ago"));
  it("hours", () => expect(formatRelativeTime("2026-06-22T09:00:00Z", now)).toBe("3 hours ago"));
  it("days", () => expect(formatRelativeTime("2026-06-19T12:00:00Z", now)).toBe("3 days ago"));
  it("weeks", () => expect(formatRelativeTime("2026-06-08T12:00:00Z", now)).toBe("2 weeks ago"));
  it(">=28d -> precise date", () =>
    expect(formatRelativeTime("2026-05-01T12:00:00Z", now)).toBe("May 1, 2026"));
});

describe("attributeValueLabel", () => {
  it("yes/no/unknown", () => {
    expect(attributeValueLabel("yes")).toBe("Yes");
    expect(attributeValueLabel("no")).toBe("No");
    expect(attributeValueLabel("unknown")).toBe("Unknown");
  });
  it("enum underscores -> spaces, first-cap", () =>
    expect(attributeValueLabel("customer_only")).toBe("Customer only"));
  it("single-word enum", () => expect(attributeValueLabel("park")).toBe("Park"));
});

describe("attributeDisplay", () => {
  const base = {
    consensus_value: "yes" as string | null,
    confidence: "high",
    observation_count: 4,
    latest_observation_value: "yes" as string | null,
  };
  it("high consensus -> normal, no hint", () =>
    expect(attributeDisplay(base)).toEqual({ text: "Yes", tone: "normal", hint: null }));
  it("medium consensus -> normal", () =>
    expect(attributeDisplay({ ...base, confidence: "medium" }).tone).toBe("normal"));
  it("low consensus -> muted + (1 report)", () =>
    expect(attributeDisplay({ ...base, confidence: "low", observation_count: 1 })).toEqual({
      text: "Yes",
      tone: "muted",
      hint: "(1 report)",
    }));
  it("low plural reports", () =>
    expect(attributeDisplay({ ...base, confidence: "low", observation_count: 3 }).hint).toBe(
      "(3 reports)",
    ));
  it("mixed boolean -> Mixed + latest", () =>
    expect(
      attributeDisplay({
        consensus_value: null,
        confidence: "mixed",
        observation_count: 2,
        latest_observation_value: "yes",
      }),
    ).toEqual({ text: "Mixed", tone: "mixed", hint: "latest: Yes" }));
  it("mixed enum -> Mixed + latest enum", () =>
    expect(
      attributeDisplay({
        consensus_value: null,
        confidence: "mixed",
        observation_count: 4,
        latest_observation_value: "customer_only",
      }).hint,
    ).toBe("latest: Customer only"));
  it("none -> Unknown, no hint", () =>
    expect(
      attributeDisplay({
        consensus_value: null,
        confidence: "none",
        observation_count: 1,
        latest_observation_value: null,
      }),
    ).toEqual({ text: "Unknown", tone: "muted", hint: null }));
});

describe("formatCategory", () => {
  it("physical -> Features", () => expect(formatCategory("physical")).toBe("Features"));
  it("accessibility", () => expect(formatCategory("accessibility")).toBe("Accessibility"));
  it("access", () => expect(formatCategory("access")).toBe("Access"));
  it("unknown key title-cased", () => expect(formatCategory("future_kind")).toBe("Future kind"));
});
