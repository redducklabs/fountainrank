import {
  type AttributeDisplay,
  type ChipVariant,
  attributeChipVariant,
} from "../../lib/map/format";

const STYLE: Record<ChipVariant, string> = {
  positive: "bg-accent-subtle text-brand ring-1 ring-brand-royal/20 dark:ring-brand-royal/30",
  neutral: "bg-accent-subtle text-brand ring-1 ring-brand-royal/20 dark:ring-brand-royal/30",
  negative: "bg-surface text-muted ring-1 ring-border",
  mixed: "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300",
  muted: "bg-surface text-muted ring-1 ring-border",
};
const GLYPH: Record<ChipVariant, string> = {
  positive: "✓",
  neutral: "•",
  negative: "✕",
  mixed: "~",
  muted: "•",
};

export function AttributeChip({ name, display }: { name: string; display: AttributeDisplay }) {
  const variant = attributeChipVariant(display);
  // Show the explicit value for neutral (a specific value) and muted (low-confidence /
  // unknown) chips so the de-emphasized value stays legible; confident booleans use the glyph.
  const showValue = variant === "neutral" || variant === "muted";
  const label = showValue ? `${name}: ${display.text}` : name;
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
