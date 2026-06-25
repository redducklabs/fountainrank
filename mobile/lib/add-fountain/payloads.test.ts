import type { components } from "@fountainrank/api-client";
import { describe, expect, it } from "vitest";

import {
  attributeOptions,
  buildAddFountainPayload,
  buildAttributeGroups,
  buildObservationsFromValues,
  buildRatingsFromStars,
  legalAttributeValue,
  type AddFountainInput,
} from "./payloads";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];

const base: AddFountainInput = {
  location: { latitude: 47.6062, longitude: -122.3321 },
  is_working: true,
};

const ratingTypes: RatingTypeOut[] = [
  { id: 2, name: "Flow", description: "Water flow", sort_order: 2 },
  { id: 1, name: "Taste", description: "Taste", sort_order: 1 },
];

const boolAttr: AttributeTypeOut = {
  id: 1,
  key: "bottle_filler",
  place_type: "fountain",
  category: "physical",
  name: "Bottle filler",
  description: "Has a bottle filler",
  value_kind: "boolean",
  allowed_values: null,
  sort_order: 2,
};

const enumAttr: AttributeTypeOut = {
  id: 2,
  key: "access",
  place_type: "fountain",
  category: "access",
  name: "Access",
  description: "Public access",
  value_kind: "enum",
  allowed_values: ["public", "customers_only"],
  sort_order: 1,
};

describe("buildRatingsFromStars", () => {
  it("maps RatingTypeOut.id to rating_type_id and omits untouched dimensions", () => {
    expect(buildRatingsFromStars(ratingTypes, { 1: 5, 2: undefined, 99: 3 })).toEqual([
      { rating_type_id: 1, stars: 5 },
    ]);
  });
});

describe("attribute helpers", () => {
  it("returns legal options and labels unknown as selectable", () => {
    expect(attributeOptions(boolAttr)).toEqual(["yes", "no", "unknown"]);
    expect(attributeOptions(enumAttr)).toEqual(["public", "customers_only", "unknown"]);
  });

  it("validates boolean and enum values", () => {
    expect(legalAttributeValue(boolAttr, "yes")).toBe(true);
    expect(legalAttributeValue(boolAttr, "public")).toBe(false);
    expect(legalAttributeValue(enumAttr, "customers_only")).toBe(true);
    expect(legalAttributeValue(enumAttr, "yes")).toBe(false);
  });

  it("groups fountain attributes by category and sort order", () => {
    const hydrant = { ...boolAttr, id: 3, place_type: "hydrant", sort_order: 0 };
    expect(buildAttributeGroups([boolAttr, enumAttr, hydrant])).toEqual([
      { category: "access", items: [enumAttr] },
      { category: "physical", items: [boolAttr] },
    ]);
  });

  it("builds observations and omits unknown", () => {
    expect(
      buildObservationsFromValues([boolAttr, enumAttr], { 1: "unknown", 2: "public" }),
    ).toEqual([{ attribute_type_id: 2, value: "public" }]);
  });
});

describe("buildAddFountainPayload", () => {
  it("builds a minimal payload", () => {
    expect(buildAddFountainPayload(base)).toEqual({
      ok: true,
      value: {
        location: { latitude: 47.6062, longitude: -122.3321 },
        is_working: true,
      },
    });
  });

  it("trims text and includes non-empty arrays", () => {
    expect(
      buildAddFountainPayload({
        ...base,
        comments: "  near the gym  ",
        ratings: [{ rating_type_id: 1, stars: 4 }],
        observations: [{ attribute_type_id: 2, value: "public" }],
      }),
    ).toEqual({
      ok: true,
      value: {
        location: base.location,
        is_working: true,
        comments: "near the gym",
        ratings: [{ rating_type_id: 1, stars: 4 }],
        observations: [{ attribute_type_id: 2, value: "public" }],
      },
    });
  });

  it("rejects hostile coordinate and working-status shapes", () => {
    expect(buildAddFountainPayload({ ...base, location: { latitude: 91, longitude: 0 } })).toEqual({
      ok: false,
    });
    expect(buildAddFountainPayload({ ...base, is_working: "yes" as unknown as boolean })).toEqual({
      ok: false,
    });
  });

  it("does not send placement_note and does not invent a comment cap", () => {
    const legacyInput = { ...base, placement_note: "near gate" } as AddFountainInput & {
      placement_note: string;
    };
    const result = buildAddFountainPayload(legacyInput);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : null).not.toHaveProperty("placement_note");
    expect(buildAddFountainPayload({ ...base, comments: "x".repeat(2000) }).ok).toBe(true);
  });

  it("rejects invalid rating and observation entries", () => {
    expect(
      buildAddFountainPayload({ ...base, ratings: [{ rating_type_id: 0, stars: 3 }] }),
    ).toEqual({ ok: false });
    expect(
      buildAddFountainPayload({ ...base, ratings: [{ rating_type_id: 1, stars: 6 }] }),
    ).toEqual({ ok: false });
    expect(
      buildAddFountainPayload({ ...base, observations: [{ attribute_type_id: 1, value: "" }] }),
    ).toEqual({ ok: false });
  });
});
