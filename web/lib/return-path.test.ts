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

  it("rejects malformed percent-encoding and overly long values", () => {
    expect(safeReturnPath("/%zz")).toBeNull();
    expect(safeReturnPath("/" + "a".repeat(600))).toBeNull();
  });
});
