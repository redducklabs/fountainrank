import type { components } from "@fountainrank/api-client";
import { describe, expect, it } from "vitest";

import {
  attributeOptions,
  buildAttributePayload,
  buildConditionPayload,
  buildNotePayload,
  buildRatingPayload,
  legalAttributeValue,
} from "./payloads";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];

const FID = "11111111-1111-4111-8111-111111111111";

const boolAttr: AttributeTypeOut = {
  id: 1,
  key: "bottle_filler",
  place_type: "fountain",
  category: "features",
  name: "Bottle filler",
  description: "Has a bottle filler",
  value_kind: "boolean",
  allowed_values: null,
  sort_order: 1,
};

const enumAttr: AttributeTypeOut = {
  id: 2,
  key: "indoor_outdoor",
  place_type: "fountain",
  category: "access",
  name: "Indoor/outdoor",
  description: "Placement context",
  value_kind: "enum",
  allowed_values: ["indoor", "outdoor"],
  sort_order: 2,
};

describe("buildRatingPayload", () => {
  it("builds ratings from selected stars", () => {
    expect(
      buildRatingPayload(FID, {
        1: 5,
        2: 0,
        3: undefined,
        4: 2,
      }),
    ).toEqual({
      ok: true,
      value: {
        ratings: [
          { rating_type_id: 1, stars: 5 },
          { rating_type_id: 4, stars: 2 },
        ],
      },
    });
  });

  it("rejects invalid ids, empty ratings, and out-of-range stars", () => {
    expect(buildRatingPayload("not-a-uuid", { 1: 4 })).toEqual({ ok: false });
    expect(buildRatingPayload(FID, {})).toEqual({ ok: false });
    expect(buildRatingPayload(FID, { 0: 4 })).toEqual({ ok: false });
    expect(buildRatingPayload(FID, { 1: 6 })).toEqual({ ok: false });
    expect(buildRatingPayload(FID, { 1: 1.5 })).toEqual({ ok: false });
  });

  it("includes latitude/longitude when coords are supplied, and omits accuracy (#3)", () => {
    expect(buildRatingPayload(FID, { 1: 5 }, { latitude: 40, longitude: -73 })).toEqual({
      ok: true,
      value: { ratings: [{ rating_type_id: 1, stars: 5 }], latitude: 40, longitude: -73 },
    });
  });

  it("omits coords entirely when none are supplied (#3)", () => {
    const result = buildRatingPayload(FID, { 1: 5 });
    expect(result).toEqual({ ok: true, value: { ratings: [{ rating_type_id: 1, stars: 5 }] } });
    if (result.ok) {
      expect("latitude" in result.value).toBe(false);
      expect("longitude" in result.value).toBe(false);
    }
  });
});

describe("buildConditionPayload", () => {
  it("builds a condition report with no is_proximate (server-derived, #3)", () => {
    const result = buildConditionPayload(FID, "working");
    expect(result).toEqual({ ok: true, value: { status: "working" } });
    if (result.ok) {
      expect("is_proximate" in result.value).toBe(false);
    }
  });

  it("includes coords when supplied (#3)", () => {
    expect(buildConditionPayload(FID, "working", { latitude: 5, longitude: 6 })).toEqual({
      ok: true,
      value: { status: "working", latitude: 5, longitude: 6 },
    });
  });

  it("rejects invalid ids and unknown statuses", () => {
    expect(buildConditionPayload("not-a-uuid", "working")).toEqual({ ok: false });
    expect(buildConditionPayload(FID, "new_status")).toEqual({ ok: false });
  });
});

describe("attributeOptions", () => {
  it("returns boolean and enum options", () => {
    expect(attributeOptions(boolAttr)).toEqual(["yes", "no", "unknown"]);
    expect(attributeOptions(enumAttr)).toEqual(["indoor", "outdoor", "unknown"]);
  });
});

describe("legalAttributeValue", () => {
  it("allows boolean yes/no/unknown only", () => {
    expect(legalAttributeValue(boolAttr, "yes")).toBe(true);
    expect(legalAttributeValue(boolAttr, "no")).toBe(true);
    expect(legalAttributeValue(boolAttr, "unknown")).toBe(true);
    expect(legalAttributeValue(boolAttr, "indoor")).toBe(false);
  });

  it("allows enum allowed values plus unknown", () => {
    expect(legalAttributeValue(enumAttr, "indoor")).toBe(true);
    expect(legalAttributeValue(enumAttr, "outdoor")).toBe(true);
    expect(legalAttributeValue(enumAttr, "unknown")).toBe(true);
    expect(legalAttributeValue(enumAttr, "yes")).toBe(false);
  });
});

describe("buildAttributePayload", () => {
  it("builds observations from catalog-driven selections", () => {
    expect(
      buildAttributePayload(FID, [boolAttr, enumAttr], {
        1: "yes",
        2: "indoor",
      }),
    ).toEqual({
      ok: true,
      value: {
        observations: [
          { attribute_type_id: 1, value: "yes" },
          { attribute_type_id: 2, value: "indoor" },
        ],
      },
    });
  });

  it("rejects empty, unknown, and illegal observations", () => {
    expect(buildAttributePayload("not-a-uuid", [boolAttr], { 1: "yes" })).toEqual({ ok: false });
    expect(buildAttributePayload(FID, [boolAttr], {})).toEqual({ ok: false });
    expect(buildAttributePayload(FID, [boolAttr], { 99: "yes" })).toEqual({ ok: false });
    expect(buildAttributePayload(FID, [enumAttr], { 2: "yes" })).toEqual({ ok: false });
  });
});

describe("buildNotePayload", () => {
  it("trims note body", () => {
    expect(buildNotePayload(FID, "  good fountain  ")).toEqual({
      ok: true,
      value: { body: "good fountain" },
    });
  });

  it("rejects invalid ids and empty/too-long bodies", () => {
    expect(buildNotePayload("not-a-uuid", "note")).toEqual({ ok: false });
    expect(buildNotePayload(FID, "   ")).toEqual({ ok: false });
    expect(buildNotePayload(FID, "x".repeat(1001))).toEqual({ ok: false });
  });
});
