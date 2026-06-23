import { describe, expect, it } from "vitest";

import type { components } from "@fountainrank/api-client";

import { groupAttributes } from "./attributes";

type Attr = components["schemas"]["AttributeConsensusOut"];

const make = (attribute_type_id: number, category: string, name: string): Attr => ({
  attribute_type_id,
  key: `k${attribute_type_id}`,
  name,
  category,
  consensus_value: "yes",
  confidence: "high",
  yes_count: 1,
  no_count: 0,
  unknown_count: 0,
  value_counts: null,
  observation_count: 1,
  latest_observation_value: "yes",
});

describe("groupAttributes", () => {
  it("returns [] for no attributes", () => {
    expect(groupAttributes([])).toEqual([]);
  });

  it("groups by category in first-seen order, preserving item order", () => {
    const groups = groupAttributes([
      make(1, "physical", "Bottle filler"),
      make(2, "access", "Public"),
      make(3, "physical", "Pet bowl"),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["physical", "access"]);
    expect(groups[0].items.map((a) => a.name)).toEqual(["Bottle filler", "Pet bowl"]);
    expect(groups[1].items.map((a) => a.name)).toEqual(["Public"]);
  });
});
