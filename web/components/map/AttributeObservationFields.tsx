"use client";
import type { AttributeGroup } from "../../lib/catalog";

export function AttributeObservationFields({
  groups,
  value,
  onChange,
}: {
  groups: AttributeGroup[];
  value: Record<number, string>;
  onChange: (attributeTypeId: number, v: string) => void;
}) {
  if (!groups.length) return null;
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm font-semibold text-slate-700">Details (optional)</p>
      {groups.map((g) => (
        <fieldset key={g.category}>
          <legend className="text-xs font-semibold uppercase text-slate-500">{g.category}</legend>
          {g.controls.map((c) => {
            const v = value[c.id] ?? "unknown";
            return (
              <div key={c.id} className="mt-1 flex items-center justify-between gap-2">
                <span className="text-sm text-slate-700">{c.name}</span>
                {c.kind === "boolean" ? (
                  <span className="flex gap-2 text-xs">
                    {c.options.map((opt) => (
                      <label key={opt} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`attr-${c.id}`}
                          aria-label={`${c.name}: ${opt}`}
                          checked={v === opt}
                          onChange={() => onChange(c.id, opt)}
                        />
                        {opt}
                      </label>
                    ))}
                  </span>
                ) : (
                  <select
                    aria-label={c.name}
                    value={v}
                    onChange={(e) => onChange(c.id, e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    {c.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
