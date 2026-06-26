import { totalPreviewPoints, type PointsLine } from "@fountainrank/contributions";

export function PointsPreview({ lines }: { lines: PointsLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-lg border-2 border-[#0A357E] bg-blue-50 p-3">
      <p className="text-base font-black text-[#0A357E]">
        +{totalPreviewPoints(lines)} possible points
      </p>
      <ul className="mt-1 space-y-0.5 text-xs font-semibold text-slate-700">
        {lines.map((line) => (
          <li key={`${line.label}-${line.points}`}>
            +{line.points} {line.label}
            {line.conditional ? " (conditional)" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
