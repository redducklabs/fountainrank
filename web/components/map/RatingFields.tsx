"use client";
import type { components } from "@fountainrank/api-client";
import { StarGroup } from "../fountain/StarGroup";

export function RatingFields({
  types,
  value,
  onChange,
}: {
  types: components["schemas"]["RatingTypeOut"][];
  value: Record<number, number>;
  onChange: (id: number, stars: number) => void;
}) {
  if (!types.length) return null;
  return (
    <div className="mt-3 space-y-1">
      <p className="text-sm font-semibold text-slate-700">Rate it (optional)</p>
      {types.map((t) => (
        <StarGroup
          key={t.id}
          id={t.id}
          name={t.name}
          value={value[t.id] ?? 0}
          onChange={(s) => onChange(t.id, s)}
        />
      ))}
    </div>
  );
}
