import { describe, expect, it } from "vitest";
import {
  isUuid,
  isValidAddFountainInput,
  toAddFountainBody,
  type AddFountainInput,
} from "./add-fountain";

const base: AddFountainInput = {
  location: { latitude: 47.6, longitude: -122.3 },
  is_working: true,
};

describe("isUuid", () => {
  it("accepts a UUID, rejects junk", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("isValidAddFountainInput", () => {
  it("accepts a minimal valid input", () => {
    expect(isValidAddFountainInput(base)).toBe(true);
  });
  it("rejects hostile non-object / missing-location shapes", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { is_working: true }] as unknown[]) {
      expect(isValidAddFountainInput(bad as AddFountainInput)).toBe(false);
    }
    expect(
      isValidAddFountainInput({
        location: [1, 2] as unknown as AddFountainInput["location"],
        is_working: true,
      }),
    ).toBe(false);
  });
  it("rejects out-of-range / non-finite coordinates", () => {
    expect(isValidAddFountainInput({ ...base, location: { latitude: 91, longitude: 0 } })).toBe(
      false,
    );
    expect(isValidAddFountainInput({ ...base, location: { latitude: 0, longitude: 181 } })).toBe(
      false,
    );
    expect(isValidAddFountainInput({ ...base, location: { latitude: NaN, longitude: 0 } })).toBe(
      false,
    );
  });
  it("rejects a non-boolean is_working", () => {
    expect(isValidAddFountainInput({ ...base, is_working: "yes" as unknown as boolean })).toBe(
      false,
    );
  });
  it("rejects oversized comments / placement note", () => {
    expect(isValidAddFountainInput({ ...base, placement_note: "x".repeat(201) })).toBe(false);
    expect(isValidAddFountainInput({ ...base, placement_note: "x".repeat(200) })).toBe(true);
    expect(isValidAddFountainInput({ ...base, comments: "x".repeat(1001) })).toBe(false);
    expect(isValidAddFountainInput({ ...base, comments: "x".repeat(1000) })).toBe(true);
  });
  it("rejects bad ratings / observations (incl. hostile non-arrays and null entries)", () => {
    expect(isValidAddFountainInput({ ...base, ratings: "nope" as unknown as [] })).toBe(false);
    expect(
      isValidAddFountainInput({
        ...base,
        ratings: [null as unknown as { rating_type_id: number; stars: number }],
      }),
    ).toBe(false);
    expect(isValidAddFountainInput({ ...base, ratings: [{ rating_type_id: 0, stars: 3 }] })).toBe(
      false,
    );
    expect(isValidAddFountainInput({ ...base, ratings: [{ rating_type_id: 1, stars: 6 }] })).toBe(
      false,
    );
    expect(
      isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: "" }] }),
    ).toBe(false);
    expect(
      isValidAddFountainInput({
        ...base,
        observations: [{ attribute_type_id: 1, value: 9 as unknown as string }],
      }),
    ).toBe(false);
    expect(
      isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: "yes" }] }),
    ).toBe(true);
  });
});

describe("toAddFountainBody", () => {
  it("drops empty optionals and trims text", () => {
    expect(toAddFountainBody({ ...base, comments: "  ", placement_note: "  near gate " })).toEqual({
      location: { latitude: 47.6, longitude: -122.3 },
      is_working: true,
      placement_note: "near gate",
    });
  });
  it("includes non-empty rating/observation arrays and trimmed comments", () => {
    const body = toAddFountainBody({
      ...base,
      comments: " hi ",
      ratings: [{ rating_type_id: 1, stars: 4 }],
      observations: [{ attribute_type_id: 2, value: "yes" }],
    });
    expect(body.comments).toBe("hi");
    expect(body.ratings).toEqual([{ rating_type_id: 1, stars: 4 }]);
    expect(body.observations).toEqual([{ attribute_type_id: 2, value: "yes" }]);
  });
});
