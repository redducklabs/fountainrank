import { describe, expect, it } from "vitest";

import { isNoteEdited } from "./notes";

describe("isNoteEdited", () => {
  it("is false when updated_at equals created_at", () => {
    expect(
      isNoteEdited({ created_at: "2026-06-22T10:00:00Z", updated_at: "2026-06-22T10:00:00Z" }),
    ).toBe(false);
  });
  it("is true when updated_at is strictly later", () => {
    expect(
      isNoteEdited({ created_at: "2026-06-22T10:00:00Z", updated_at: "2026-06-22T11:00:00Z" }),
    ).toBe(true);
  });
  it("is false when updated_at precedes created_at (clock skew)", () => {
    expect(
      isNoteEdited({ created_at: "2026-06-22T11:00:00Z", updated_at: "2026-06-22T10:00:00Z" }),
    ).toBe(false);
  });
});
