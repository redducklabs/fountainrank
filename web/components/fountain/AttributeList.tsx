import type { components } from "@fountainrank/api-client";
import { attributeDisplay, formatCategory } from "../../lib/map/format";
import { AttributeChip } from "./AttributeChips";

type Attr = components["schemas"]["AttributeConsensusOut"];

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  if (attributes.length === 0) return null;
  const groups: { category: string; items: Attr[] }[] = [];
  for (const a of attributes) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.category}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {formatCategory(g.category)}
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {g.items.map((a) => (
              <AttributeChip
                key={a.attribute_type_id}
                name={a.name}
                display={attributeDisplay(a)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
