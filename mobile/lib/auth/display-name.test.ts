import { describe, expect, it } from "vitest";

import { shouldRouteToNameGate, validateDisplayName } from "./display-name";

describe("validateDisplayName", () => {
  it("trims and accepts", () => {
    expect(validateDisplayName("  Aron  ")).toEqual({ ok: true, value: "Aron" });
  });
  it("rejects blank / whitespace-only / empty", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: false });
    expect(validateDisplayName("")).toEqual({ ok: false });
  });
  it("rejects > 80 chars, accepts exactly 80", () => {
    expect(validateDisplayName("x".repeat(81))).toEqual({ ok: false });
    expect(validateDisplayName("x".repeat(80))).toEqual({ ok: true, value: "x".repeat(80) });
  });
});

describe("shouldRouteToNameGate", () => {
  it("routes only when authenticated AND needsName AND not already on account", () => {
    expect(shouldRouteToNameGate("authenticated", true, false)).toBe(true);
  });
  it("does not route when already on the account route", () => {
    expect(shouldRouteToNameGate("authenticated", true, true)).toBe(false);
  });
  it("does not route when the name is already set", () => {
    expect(shouldRouteToNameGate("authenticated", false, false)).toBe(false);
  });
  it("does not route when not authenticated", () => {
    expect(shouldRouteToNameGate("signedOut", true, false)).toBe(false);
    expect(shouldRouteToNameGate("initializing", true, false)).toBe(false);
  });
});
