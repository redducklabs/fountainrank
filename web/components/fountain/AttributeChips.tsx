import { type AttributeDisplay, type ChipVariant, attributeChipVariant } from "../../lib/map/format";

const STYLE: Record<ChipVariant, string> = {
  positive: "bg-[#E7F0FF] text-[#0A357E] ring-1 ring-[#0E4DA4]/20",
  neutral: "bg-[#E7F0FF] text-[#0A357E] ring-1 ring-[#0E4DA4]/20",
  negative: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  unknown: "bg-slate-100 text-slate-400 ring-1 ring-slate-200",
  mixed: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};
const GLYPH: Record<ChipVariant, string> = {
  positive: "✓",
  neutral: "•",
  negative: "✕",
  unknown: "?",
  mixed: "~",
};

export function AttributeChip({ name, display }: { name: string; display: AttributeDisplay }) {
  const variant = attributeChipVariant(display);
  const label = variant === "neutral" ? `${name}: ${display.text}` : name;
  return (
    <span
      data-variant={variant}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STYLE[variant]}`}
    >
      <span aria-hidden="true">{GLYPH[variant]}</span>
      <span>{label}</span>
      {display.hint && <span className="text-[10px] opacity-70">{display.hint}</span>}
    </span>
  );
}
