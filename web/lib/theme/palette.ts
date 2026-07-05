// Single source of truth for the web semantic color tokens. globals.css mirrors these
// exact hex (palette.test.ts enforces the mirror). Dark values marked "proposed" in the
// plan are tuned to WCAG AA in the a11y task (spec §9) — tune HERE, the CSS follows.
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
  "accent-gold": "#F2C200",
  "accent-gold-hover": "#FFCE1F",
  "accent-subtle": "#1E2E4A",
  water: "#5FC5F0",
  danger: "#F87171",
  "on-brand": "#FFFFFF",
  "map-canvas": "#0B1220",
  "star-empty": "#3A4A66",
};
