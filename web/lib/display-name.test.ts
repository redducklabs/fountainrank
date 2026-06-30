import { describe, expect, it } from "vitest";

import { validateDisplayName } from "./display-name";

describe("validateDisplayName", () => {
  it("trims and accepts", () => {
    expect(validateDisplayName("  Aron  ")).toEqual({ ok: true, value: "Aron" });
  });
  it("rejects blank / whitespace-only", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: false });
    expect(validateDisplayName("")).toEqual({ ok: false });
  });
  it("rejects > 80 chars", () => {
    expect(validateDisplayName("x".repeat(81))).toEqual({ ok: false });
  });
  it("accepts exactly 80 chars", () => {
    expect(validateDisplayName("x".repeat(80))).toEqual({ ok: true, value: "x".repeat(80) });
  });
});
