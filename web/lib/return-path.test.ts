import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("accepts safe internal paths", () => {
    expect(safeReturnPath("/")).toBe("/");
    expect(safeReturnPath("/fountains/123e4567-e89b-12d3-a456-426614174000")).toBe(
      "/fountains/123e4567-e89b-12d3-a456-426614174000",
    );
    expect(safeReturnPath("/account?x=1#h")).toBe("/account?x=1#h");
  });

  it("rejects empty / nullish", () => {
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });

  it("rejects protocol-relative, absolute, and scheme URLs", () => {
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("https://evil.com")).toBeNull();
    expect(safeReturnPath("http:/evil")).toBeNull();
    expect(safeReturnPath("not-a-path")).toBeNull();
  });

  it("rejects backslashes and encoded hostile forms", () => {
    expect(safeReturnPath("/\\evil")).toBeNull();
    expect(safeReturnPath("/%5c%5cevil")).toBeNull();
    expect(safeReturnPath("/%2f%2fevil")).toBeNull();
    expect(safeReturnPath("/%00null")).toBeNull();
  });

  it("rejects control chars and unicode line/paragraph separators", () => {
    expect(safeReturnPath("/a" + String.fromCharCode(0x01) + "b")).toBeNull();
    expect(safeReturnPath("/a" + String.fromCharCode(0x2028) + "b")).toBeNull();
    expect(safeReturnPath("/a" + String.fromCharCode(0x2029) + "b")).toBeNull();
  });

  it("rejects bidi/directional control code points (raw)", () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE (RLO) — inside a path
    expect(safeReturnPath("/a" + String.fromCharCode(0x202e) + "b")).toBeNull();
    // U+2066 LEFT-TO-RIGHT ISOLATE (LRI) — inside a path
    expect(safeReturnPath("/a" + String.fromCharCode(0x2066) + "b")).toBeNull();
    // U+200E LEFT-TO-RIGHT MARK (LRM)
    expect(safeReturnPath("/a" + String.fromCharCode(0x200e) + "b")).toBeNull();
    // U+200F RIGHT-TO-LEFT MARK (RLM)
    expect(safeReturnPath("/a" + String.fromCharCode(0x200f) + "b")).toBeNull();
    // U+061C ARABIC LETTER MARK (ALM)
    expect(safeReturnPath("/a" + String.fromCharCode(0x061c) + "b")).toBeNull();
  });

  it("rejects percent-encoded bidi code points (decoded form must also be checked)", () => {
    // U+202E encoded as UTF-8 %E2%80%AE — decodeURIComponent yields the char
    expect(safeReturnPath("/a%E2%80%AEb")).toBeNull();
    // U+2066 encoded as UTF-8 %E2%81%A6
    expect(safeReturnPath("/a%E2%81%A6b")).toBeNull();
  });

  it("rejects malformed percent-encoding and overly long values", () => {
    expect(safeReturnPath("/%zz")).toBeNull();
    expect(safeReturnPath("/" + "a".repeat(600))).toBeNull();
  });
});
