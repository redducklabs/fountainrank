import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { GET } = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("@fountainrank/api-client", () => ({ makeClient: () => ({ GET }) }));
vi.mock("./api", () => ({ resolveApiBaseUrl: () => "http://api" }));

import { buildAttributeGroups } from "./catalog";
import type { components } from "@fountainrank/api-client";

type A = components["schemas"]["AttributeTypeOut"];
const t = (o: Partial<A>): A => ({
  id: 1,
  key: "k",
  place_type: "fountain",
  category: "physical",
  name: "N",
  description: "",
  value_kind: "boolean",
  allowed_values: null,
  sort_order: 0,
  ...o,
});

describe("buildAttributeGroups", () => {
  it("groups by category and orders by sort_order", () => {
    const groups = buildAttributeGroups([
      t({ id: 2, category: "access", name: "Indoor", sort_order: 1 }),
      t({ id: 1, category: "physical", name: "Bottle filler", sort_order: 0 }),
      t({ id: 3, category: "physical", name: "Dog bowl", sort_order: 2 }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["physical", "access"]);
    expect(groups[0].controls.map((c) => c.name)).toEqual(["Bottle filler", "Dog bowl"]);
  });
  it("boolean -> yes/no/unknown; enum -> allowed_values + unknown", () => {
    const [g] = buildAttributeGroups([
      t({ id: 1, value_kind: "boolean" }),
      t({ id: 2, value_kind: "enum", allowed_values: ["cold", "ambient"], sort_order: 1 }),
    ]);
    expect(g.controls[0]).toMatchObject({ kind: "boolean", options: ["yes", "no", "unknown"] });
    expect(g.controls[1]).toMatchObject({ kind: "enum", options: ["cold", "ambient", "unknown"] });
  });
});

describe("fetch caching (module-level)", () => {
  beforeEach(() => {
    vi.resetModules(); // fresh module instance -> cleared cache per test
    GET.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("caches a successful rating-types fetch (network hit once)", async () => {
    GET.mockResolvedValue({
      data: [{ id: 1, name: "X", description: "", sort_order: 0 }],
      error: undefined,
    });
    const mod = await import("./catalog");
    await mod.fetchRatingTypes();
    await mod.fetchRatingTypes();
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failure (a later call retries)", async () => {
    GET.mockResolvedValueOnce({ data: undefined, error: { detail: "boom" } });
    const mod = await import("./catalog");
    await expect(mod.fetchAttributeTypes()).rejects.toThrow();
    GET.mockResolvedValueOnce({ data: [], error: undefined });
    await expect(mod.fetchAttributeTypes()).resolves.toEqual([]);
    expect(GET).toHaveBeenCalledTimes(2);
  });
});
