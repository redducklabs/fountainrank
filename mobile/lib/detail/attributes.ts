import type { components } from "@fountainrank/api-client";

type Attr = components["schemas"]["AttributeConsensusOut"];

export type AttrGroup = { category: string; items: Attr[] };

/** Group attribute consensus rows by `category` in first-seen order, preserving
 *  each category's item order. Mirrors the inline grouping in web AttributeList. */
export function groupAttributes(attributes: Attr[]): AttrGroup[] {
  const groups: AttrGroup[] = [];
  for (const a of attributes) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return groups;
}
