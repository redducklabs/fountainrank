import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS, LIGHT, DARK } from "./palette";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

// Extract a rule block's body by an ANCHORED selector regex. A plain indexOf(".dark")
// would match the ".dark" inside `@custom-variant dark (&:where(.dark, .dark *))`; a
// line-anchored `{`-terminated regex only matches the real `.dark { … }` rule. Our blocks
// have no nested braces, so the first `}` after the open brace closes the block.
function block(selectorRe: RegExp): string {
  const m = css.match(selectorRe);
  expect(m, `missing block ${selectorRe}`).not.toBeNull();
  const open = css.indexOf("{", m!.index!);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("globals.css token layer", () => {
  it("enables the class-based dark variant", () => {
    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *))");
  });

  it("declares every token in :root with the LIGHT hex", () => {
    const root = block(/(^|\n)\s*:root\s*\{/);
    for (const t of TOKENS) {
      expect(root.toLowerCase()).toContain(`--${t}: ${LIGHT[t].toLowerCase()};`);
    }
  });

  it("overrides every token in .dark with the DARK hex", () => {
    const dark = block(/(^|\n)\s*\.dark\s*\{/);
    for (const t of TOKENS) {
      expect(dark.toLowerCase()).toContain(`--${t}: ${DARK[t].toLowerCase()};`);
    }
  });

  it("maps every token to a --color-* utility via @theme inline", () => {
    const theme = block(/@theme inline\s*\{/);
    for (const t of TOKENS) {
      expect(theme).toContain(`--color-${t}: var(--${t});`);
    }
  });
});

// WCAG 2.x relative-luminance contrast ratio (no dependency) — see
// https://www.w3.org/TR/WCAG21/#contrast-minimum. Returns the larger:smaller luminance ratio,
// always >= 1, so callers assert a lower bound regardless of which color is lighter.
function ratio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const n = hex.replace("#", "");
    const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
    const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const [l1, l2] = [lum(hexA), lum(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("WCAG AA contrast (both themes)", () => {
  for (const [name, P] of [
    ["light", LIGHT],
    ["dark", DARK],
  ] as const) {
    it(`${name}: body text >= 4.5:1`, () => {
      expect(ratio(P.foreground, P.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P.foreground, P.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P.foreground, P["surface-raised"])).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: on-brand (white) >= 4.5:1 on every brand band`, () => {
      // Brand bands (bg-brand/from-brand/etc.) keep white text legible — this constrains how
      // brand/brand-mid/brand-royal may be tuned; they stay navy-ish in both themes.
      expect(ratio(P["on-brand"], P.brand)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P["on-brand"], P["brand-mid"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P["on-brand"], P["brand-royal"])).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: secondary/UI text >= 4.5:1 body / 3:1 large`, () => {
      expect(ratio(P.muted, P.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P.danger, P.background)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: brand-ink (heading/link text) >= 4.5:1 on every content surface`, () => {
      // brand-ink is the TEXT-only counterpart to brand/brand-mid/brand-royal (which stay
      // background bands) — it must read on every surface content is actually laid over.
      expect(ratio(P["brand-ink"], P.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P["brand-ink"], P["surface-raised"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P["brand-ink"], P["accent-subtle"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P["brand-ink"], P.background)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
