import { useId } from "react";
import { starFills, type StarFill } from "../../lib/map/format";

const GOLD = "#F2C200";
const EMPTY = "#CBD5E1";
const STAR_PATH = "M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 15l-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z";

function StarIcon({ fill, size, gid }: { fill: StarFill; size: number; gid: string }) {
  const color = fill === "full" ? GOLD : fill === "empty" ? EMPTY : `url(#${gid})`;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" data-fill={fill} aria-hidden="true">
      {fill === "half" && (
        <defs>
          <linearGradient id={gid}>
            <stop offset="50%" stopColor={GOLD} />
            <stop offset="50%" stopColor={EMPTY} />
          </linearGradient>
        </defs>
      )}
      <path d={STAR_PATH} fill={color} />
    </svg>
  );
}

export function Stars({
  value,
  size = 16,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) {
  const baseId = useId();
  const fills = starFills(value);
  return (
    <span
      role="img"
      aria-label={label ?? `Rated ${value.toFixed(1)} out of 5`}
      className="inline-flex items-center gap-0.5 align-middle"
    >
      {fills.map((f, i) => (
        <StarIcon key={i} fill={f} size={size} gid={`${baseId}-${i}`} />
      ))}
    </span>
  );
}
