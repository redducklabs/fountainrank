// Single source of truth for the web semantic color tokens. globals.css mirrors these
// exact hex (palette.test.ts enforces the mirror). Dark values marked "proposed" in the
// plan are tuned to WCAG AA in the a11y task (spec §9) — tune HERE, the CSS follows.
//
// `brand-ink` vs `brand`: `brand`/`brand-mid`/`brand-royal` are BACKGROUND tones for the
// brand band (`bg-brand`/`from-brand`/etc.) — navy in both themes so white `on-brand` text
// reads. `brand-ink` is the paired TEXT tone for brand-colored headings/links on a content
// surface (`text-brand-ink`) — same navy in light mode, but a light blue in dark mode so it
// reads on the dark `surface`/`background`, which navy text cannot (palette.test.ts asserts
// this). Gold CTA buttons (`bg-accent-gold` + `text-brand`) intentionally keep the fixed
// navy `text-brand` — accent-gold's brightness doesn't change with theme, so navy stays the
// correct (AA) choice there; retoning those to `brand-ink` would collapse to ~1.2:1.
export const TOKENS = [
  "background",
  "surface",
  "surface-raised",
  "foreground",
  "muted",
  "border",
  "brand",
  "brand-mid",
  "brand-royal",
  "brand-ink",
  "accent-gold",
  "accent-gold-hover",
  "accent-subtle",
  "water",
  "danger",
  "on-brand",
  "map-canvas",
  "star-empty",
] as const;

export type Token = (typeof TOKENS)[number];

export const LIGHT: Record<Token, string> = {
  background: "#FFFFFF",
  surface: "#F8FAFC",
  "surface-raised": "#FFFFFF",
  foreground: "#0F172A",
  muted: "#475569",
  border: "#E2E8F0",
  brand: "#0A357E",
  "brand-mid": "#0C44A0",
  "brand-royal": "#0E4DA4",
  "brand-ink": "#0A357E",
  "accent-gold": "#F2C200",
  "accent-gold-hover": "#FFCE1F",
  "accent-subtle": "#E7F0FF",
  water: "#5FC5F0",
  danger: "#B91C1C",
  "on-brand": "#FFFFFF",
  "map-canvas": "#E9EFE7",
  "star-empty": "#CBD5E1",
};

export const DARK: Record<Token, string> = {
  background: "#0B1220",
  surface: "#111A2E",
  "surface-raised": "#16213A",
  foreground: "#E6EDF7",
  muted: "#9FB0C7",
  border: "#26324A",
  brand: "#0A357E",
  "brand-mid": "#2A5CC0",
  "brand-royal": "#2A5CC0",
  "brand-ink": "#8AB4F8",
  "accent-gold": "#F2C200",
  "accent-gold-hover": "#FFCE1F",
  "accent-subtle": "#1E2E4A",
  water: "#5FC5F0",
  danger: "#F87171",
  "on-brand": "#FFFFFF",
  "map-canvas": "#0B1220",
  "star-empty": "#3A4A66",
};
