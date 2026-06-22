import type { components } from "@fountainrank/api-client";
import { attributeDisplay, formatCategory, type AttrTone } from "../../lib/map/format";

type Attr = components["schemas"]["AttributeConsensusOut"];

const TONE: Record<AttrTone, string> = {
  normal: "text-slate-700",
  muted: "text-slate-400",
  mixed: "text-amber-700",
};

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
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatCategory(g.category)}
          </h3>
          <ul className="mt-1 space-y-1">
            {g.items.map((a) => {
              const d = attributeDisplay(a);
              return (
                <li
                  key={a.attribute_type_id}
                  className="flex items-baseline justify-between gap-2 text-sm"
                >
                  <span className="text-slate-600">{a.name}</span>
                  <span className={`text-right ${TONE[d.tone]}`}>
                    {d.text}
                    {d.hint && <span className="ml-1 text-xs text-slate-400">{d.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
