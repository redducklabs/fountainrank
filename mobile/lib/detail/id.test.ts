import { describe, expect, it } from "vitest";

import { normalizeFountainId } from "./id";

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("normalizeFountainId", () => {
  it("returns a canonical lowercase UUID unchanged", () => {
    expect(normalizeFountainId(UUID)).toBe(UUID);
  });
  it("accepts an uppercase UUID", () => {
    expect(normalizeFountainId(UUID.toUpperCase())).toBe(UUID.toUpperCase());
  });
  it("rejects a malformed non-UUID string", () => {
    expect(normalizeFountainId("not-a-uuid")).toBeNull();
  });
  it("rejects a UUID-length hex string without hyphens", () => {
    expect(normalizeFountainId("123e4567e89b12d3a456426614174000")).toBeNull();
  });
  it("rejects an empty string", () => {
    expect(normalizeFountainId("")).toBeNull();
  });
  it("rejects undefined and array params (unexpected route shape)", () => {
    expect(normalizeFountainId(undefined)).toBeNull();
    expect(normalizeFountainId([UUID, UUID])).toBeNull();
  });
});
