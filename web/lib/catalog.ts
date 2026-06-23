import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { resolveApiBaseUrl } from "./api";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];

export type AttributeControl = {
  id: number;
  key: string;
  name: string;
  description: string;
  kind: "boolean" | "enum";
  options: string[];
};
export type AttributeGroup = { category: string; controls: AttributeControl[] };

export function buildAttributeGroups(types: AttributeTypeOut[]): AttributeGroup[] {
  const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);
  const order: string[] = [];
  const byCat = new Map<string, AttributeControl[]>();
  for (const t of sorted) {
    const kind: "boolean" | "enum" = t.value_kind === "enum" ? "enum" : "boolean";
    const options =
      kind === "enum" ? [...(t.allowed_values ?? []), "unknown"] : ["yes", "no", "unknown"];
    if (!byCat.has(t.category)) {
      byCat.set(t.category, []);
      order.push(t.category);
    }
    byCat
      .get(t.category)!
      .push({ id: t.id, key: t.key, name: t.name, description: t.description, kind, options });
  }
  return order.map((category) => ({ category, controls: byCat.get(category)! }));
}

// Module-level session cache: reuse a successful fetch; do NOT cache a rejection (so a later
// attempt retries). Public endpoints — no auth, no token.
let ratingTypes: RatingTypeOut[] | null = null;
let attributeTypes: AttributeTypeOut[] | null = null;

export async function fetchRatingTypes(): Promise<RatingTypeOut[]> {
  if (ratingTypes) return ratingTypes;
  const { data, error } = await makeClient(resolveApiBaseUrl()).GET("/api/v1/rating-types");
  if (error || !data) throw new Error("rating-types fetch failed");
  ratingTypes = data;
  return data;
}

export async function fetchAttributeTypes(): Promise<AttributeTypeOut[]> {
  if (attributeTypes) return attributeTypes;
  const { data, error } = await makeClient(resolveApiBaseUrl()).GET("/api/v1/attribute-types");
  if (error || !data) throw new Error("attribute-types fetch failed");
  attributeTypes = data;
  return data;
}
