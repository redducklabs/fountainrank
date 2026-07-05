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
