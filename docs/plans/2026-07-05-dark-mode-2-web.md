# Dark Mode — Plan 2: Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an app-wide **web** dark theme — a semantic Tailwind-v4 token layer, a persisted 3-state System/Light/Dark toggle (`next-themes`), a full content re-tone of every surface, a runtime-swappable dark basemap (`setStyle` + overlay re-install), dark-tuned pins, and a deploy gate that fails if `style.dark.json` is not live.

**Architecture:** Introduce a real theming layer where there is none today. CSS semantic tokens live in `web/app/globals.css` (`:root` light values, `.dark` overrides, exposed as Tailwind utilities via `@theme inline`); the canonical hex values live in a single `web/lib/theme/palette.ts` that a test asserts `globals.css` matches. `next-themes` (`attribute="class"`) flips the `.dark` class on `<html>` before first paint (no FOUC) and is the source of `resolvedTheme`. The map is themed in JS (MapLibre paint is set in code, not CSS): a new `web/lib/map/colors.ts` holds theme-keyed paint constants; `MapBrowser` splits its one-time listener wiring from a per-style `installOverlay` and calls `map.setStyle(styleUrlFor(resolvedTheme))` on theme change, preserving the camera and re-installing pins/layers/selection from refs guarded by a `styleGenRef` generation counter.

**Tech Stack:** Next.js 16.2.10 (App Router, React 19.2.7), Tailwind CSS v4 (`tailwindcss` 4.3.2 + `@tailwindcss/postcss` 4.3.2), `next-themes@0.4.6`, `maplibre-gl` 5.24.0, TypeScript 6.0.3, Vitest 4.1.9, Pillow (via `uvx`) for pin generation, GitHub Actions for the deploy gate.

**Reference spec:** `docs/specs/2026-07-05-dark-mode-design.md` §3, §4, §5, §8, §9 (Codex-APPROVED). Plan 1 (`docs/plans/2026-07-05-dark-mode-1-basemap-flavor.md`, shipped as `3273d30`) already published `style.dark.json` + `sprites/v4/dark.*` to the CDN — this plan is the client that requests them.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Version floors (do not bump):** `next-themes@0.4.6` (React 19 compatible; the only new dependency), React 19.2.7, Next 16.2.10, Tailwind 4.3.2, maplibre-gl 5.24.0, TypeScript 6.0.3. This checkout has **no active `minimumReleaseAge` gate** (only vestigial `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`), so `0.4.6` (well-aged) is not age-blocked; it is protected by pinning + `pnpm-lock.yaml` review + Dependabot + the `pnpm audit` gate.
- **Local checks mirror CI — run before every commit that touches web code:** `./run.ps1 check -Web` (ESLint + Prettier + `tsc --noEmit` + `vitest run` + `next build`). **NEVER** run a bare `pnpm run …` or set `CI=true` on this Windows host — it triggers a destructive `node_modules` purge (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). `run.ps1 check` is the sanctioned path. If one *specific* invocation is genuinely host-blocked, fall back to that exact CI job only (never a blanket "verify via CI"), per `claude_help/testing-ci.md`.
- **This plan does NOT touch the backend or the api-client** — no schema, no API, no `pnpm run generate`. It is web-only (plus one web-deploy-workflow gate).
- **`docs/` is outside the Prettier gate** — never `prettier --write` docs; `docs/style-guide.md` is edited by hand.
- **Conventional Commits**, frequent commits, one task at a time. **No AI attribution** in commits/PRs. **No time estimates** anywhere.
- **Branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → `gh pr merge <N> --squash`.** Branch fresh from `main` (which has the spec + Plan 1).
- **Spec deviation to flag to Codex (a latent spec defect the owner already resolved):** spec §3.2 says re-tone "the white content surfaces and slate text," but §4.4/§11 describe the job as "migrate the hardcoded hex." Those are different jobs — the white cards/text/borders/status-chips use **named Tailwind neutrals** (`bg-white`, `text-slate-700`, `bg-slate-50`, `border-slate-200`, `bg-emerald-100`, …), NOT hex. Migrating only the hex would leave white cards floating on a dark page. **Owner decision: FULL RE-TONE of all surfaces** (brand hex → tokens **and** neutral utilities → tokens **and** status chips → dark variants). Task 3 implements the full re-tone; call this deviation out explicitly in the Codex plan-review.

### Semantic token set (CSS — `web/lib/theme/palette.ts` → `globals.css`)

Canonical hex live in `palette.ts`; `globals.css` mirrors them (Task 1 test enforces). Dark values marked *(proposed)* are starting points that **Task 12 tunes to WCAG AA** against real screenshots.

| Token | Light | Dark *(proposed)* | Role |
|---|---|---|---|
| `background` | `#FFFFFF` | `#0B1220` | Page/content base |
| `surface` | `#F8FAFC` | `#111A2E` | Cards, list rows, `slate-50` fills |
| `surface-raised` | `#FFFFFF` | `#16213A` | Elevated: detail drawer, menus, white reading shells |
| `foreground` | `#0F172A` | `#E6EDF7` | Primary text (`slate-700/800/900`) |
| `muted` | `#475569` | `#9FB0C7` | Secondary text (`slate-400/500/600`) |
| `border` | `#E2E8F0` | `#26324A` | Hairlines, dividers (`slate-100/200`) |
| `brand` | `#0A357E` | `#0A357E` | Navy; brand bands keep it |
| `brand-mid` | `#0C44A0` | `#2A5CC0` | Gradient middle / solid CTAs |
| `brand-royal` | `#0E4DA4` | `#2A5CC0` | Gradient bottom / primary blue |
| `accent-gold` | `#F2C200` | `#F2C200` | Gold accent (both themes) |
| `accent-gold-hover` | `#FFCE1F` | `#FFCE1F` | Gold hover (both themes) |
| `accent-subtle` | `#E7F0FF` | `#1E2E4A` *(proposed)* | Light-blue highlight (`#E7F0FF`/`#EAF1FF`/`blue-50`) |
| `water` | `#5FC5F0` | `#5FC5F0` | Decorative accents |
| `danger` | `#B91C1C` | `#F87171` | Errors (brightened on dark) |
| `on-brand` | `#FFFFFF` | `#FFFFFF` | Text on brand bands |
| `map-canvas` | `#E9EFE7` | `#0B1220` *(proposed)* | Map placeholder (`#e9efe7`) |
| `star-empty` | `#CBD5E1` | `#3A4A66` *(proposed)* | Empty-star fill (Stars.tsx) |

`map-canvas` and `star-empty` are additions beyond spec §3.1's named list (the spec anticipated "+ a map-placeholder value"); they exist so the map placeholder and empty stars re-tone without hardcoded hex.

### Map paint set (JS — `web/lib/map/colors.ts`, NOT CSS)

| Field | Light | Dark *(proposed)* | Consumer |
|---|---|---|---|
| `cluster` | `#0C44A0` | `#4C82F0` | `clusters` circle fill |
| `clusterStroke` | `#FFFFFF` | `#0B1220` | `clusters` circle stroke |
| `clusterCount` | `#FFFFFF` | `#FFFFFF` | `cluster-count` text |
| `pillText` | `#0A357E` | `#E7F0FF` | `pins-pill` text |
| `pillBg` | `pill-bg` | `pill-bg-dark` | `pins-pill` icon-image **name** |
| `halo` | `#0C44A0` | `#5FC5F0` | `selected-halo` circle |
| `selectedPin` | `pin-selected` | `pin-selected-dark` | `selected-pin` icon-image **name** |
| `ring` | `#0A357E` | `#4C82F0` *(proposed)* | placement-map add-bound ring |
| `marker` | `#0A357E` | `#4C82F0` *(proposed)* | placement-map draggable marker |

---

## File Structure

**Created:**
- `web/lib/theme/palette.ts` — canonical light/dark hex per token; single source of truth the CSS mirrors.
- `web/lib/theme/palette.test.ts` — asserts `globals.css` declares every token in `:root`, `.dark`, and `@theme inline` with the palette's hex (Task 1); WCAG-AA contrast assertions (Task 12).
- `web/app/providers.tsx` — `"use client"` `next-themes` `ThemeProvider` wrapper.
- `web/components/ThemeToggle.tsx` — `"use client"` 3-state hydration-safe toggle.
- `web/components/ThemeToggle.test.tsx` — provider resolution + hydration-safety + persistence.
- `web/lib/map/colors.ts` — `MapColors` type, `MAP_COLORS`, `mapColorsFor(theme)`.
- `web/lib/map/colors.test.ts` — map paint constants + `mapColorsFor`.
- `web/lib/map/style.test.ts` — `styleUrlFor` derivation + fallback + themed-asset helpers.

**Modified:**
- `web/app/globals.css` — token layer + `.water-drop` re-tone.
- `web/package.json` / `pnpm-lock.yaml` — add `next-themes@0.4.6`.
- `web/app/layout.tsx` — `suppressHydrationWarning` on `<html>`, wrap in `Providers`.
- `web/components/SiteHeader.tsx` + `web/app/account/page.tsx` — mount `ThemeToggle`.
- ~49 component/page files — full content re-tone (Task 3).
- `web/lib/map/style.ts` — `styleUrlFor` + themed pin/pill asset helpers.
- `web/lib/map/layers.ts` + `layers.test.ts` — theme-aware factories, suffixed icon names.
- `web/lib/map/pins.ts` + `pins.test.ts` — `theme` param → suffixed feature icon.
- `web/components/map/placement-map.ts` — themed ring/marker + `reinstall`.
- `web/components/map/MapBrowser.tsx` — one-time wiring vs `installOverlay`; `setStyle` swap; refs + `styleGenRef`.
- `web/components/map/MapStates.tsx`, `MapBrowserLoader.tsx` — re-tone (part of Task 3).
- `scripts/gen-pin-assets.py`, `scripts/assets/gen_unrated_pin.py` — emit dark variants (Task 4).
- `.github/workflows/deploy.yml` — dark-basemap availability gate (Task 11).
- `docs/style-guide.md` — ThemeToggle component + dark token table (Task 13).

**Task order (dependencies):** 1 token layer → 2 provider+toggle → 3 re-tone → 4 dark pins → 5 map colors → 6 style URL/assets → 7 layer factories → 8 pins theme → 9 placement map → 10 MapBrowser swap → 11 deploy gate → 12 a11y tune → 13 docs.

---

### Task 1: CSS token layer (`palette.ts` + `globals.css`)

Define the canonical palette once, render it into `globals.css` as `:root`/`.dark` CSS vars exposed via `@theme inline`, add the class-based `dark` variant, and convert `.water-drop` off its hardcoded hex. A test locks `globals.css` to `palette.ts` so a token can never be added to `:root` but forgotten in `.dark`.

**Files:**
- Create: `web/lib/theme/palette.ts`, `web/lib/theme/palette.test.ts`
- Modify: `web/app/globals.css`

**Interfaces:**
- Produces: `TOKENS` (readonly token-name tuple), `LIGHT`/`DARK` (`Record<Token, string>` hex), consumed by `palette.test.ts` (Task 1) and the contrast test (Task 12). `globals.css` generates the Tailwind utilities `bg-background`, `bg-surface`, `bg-surface-raised`, `text-foreground`, `text-muted`, `border-border`, `bg-brand`, `bg-brand-mid`, `bg-brand-royal`, `bg-accent-gold`, `bg-accent-gold-hover`, `bg-accent-subtle`, `bg-water`, `text-danger`, `text-on-brand`, `bg-map-canvas`, `fill-star-empty`, and their `text-`/`border-`/`from-`/`via-`/`to-`/`ring-`/`fill-`/`divide-` siblings — all flipping under `.dark`. Consumed by Tasks 3, and the `fill-*`/`var(--color-*)` refs in Stars/MapStates.

- [ ] **Step 1: Write the canonical palette**

Create `web/lib/theme/palette.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test (globals.css mirrors palette)**

Create `web/lib/theme/palette.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS, LIGHT, DARK } from "./palette";

const css = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `./run.ps1 check -Web` (or, if scoping to just this test is possible on-host, the web `vitest` for `palette.test.ts`).
Expected: FAIL — `globals.css` has no `@custom-variant`/`:root`/`.dark`/`@theme inline` blocks yet.

- [ ] **Step 4: Write the token layer into `globals.css`**

Replace the first line of `web/app/globals.css` (`@import "tailwindcss";`) with the import + token layer, and convert `.water-drop`'s `background: #5fc5f0;` to the token. The full head of the file becomes:

```css
@import "tailwindcss";

/* Class-based dark variant — overrides Tailwind v4's default prefers-color-scheme so
   `dark:` utilities key off the `.dark` class next-themes sets on <html>. */
@custom-variant dark (&:where(.dark, .dark *));

:root {
  --background: #ffffff;
  --surface: #f8fafc;
  --surface-raised: #ffffff;
  --foreground: #0f172a;
  --muted: #475569;
  --border: #e2e8f0;
  --brand: #0a357e;
  --brand-mid: #0c44a0;
  --brand-royal: #0e4da4;
  --accent-gold: #f2c200;
  --accent-gold-hover: #ffce1f;
  --accent-subtle: #e7f0ff;
  --water: #5fc5f0;
  --danger: #b91c1c;
  --on-brand: #ffffff;
  --map-canvas: #e9efe7;
  --star-empty: #cbd5e1;
}

.dark {
  --background: #0b1220;
  --surface: #111a2e;
  --surface-raised: #16213a;
  --foreground: #e6edf7;
  --muted: #9fb0c7;
  --border: #26324a;
  --brand: #0a357e;
  --brand-mid: #2a5cc0;
  --brand-royal: #2a5cc0;
  --accent-gold: #f2c200;
  --accent-gold-hover: #ffce1f;
  --accent-subtle: #1e2e4a;
  --water: #5fc5f0;
  --danger: #f87171;
  --on-brand: #ffffff;
  --map-canvas: #0b1220;
  --star-empty: #3a4a66;
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-border: var(--border);
  --color-brand: var(--brand);
  --color-brand-mid: var(--brand-mid);
  --color-brand-royal: var(--brand-royal);
  --color-accent-gold: var(--accent-gold);
  --color-accent-gold-hover: var(--accent-gold-hover);
  --color-accent-subtle: var(--accent-subtle);
  --color-water: var(--water);
  --color-danger: var(--danger);
  --color-on-brand: var(--on-brand);
  --color-map-canvas: var(--map-canvas);
  --color-star-empty: var(--star-empty);
}
```

Then change `.water-drop`'s background line from `background: #5fc5f0;` to:

```css
  background: var(--water);
```

Keep the `@keyframes` and the `.water-drop-*` offset rules exactly as they are.

> Note: `globals.css` values are written **lowercase** (CSS convention). The test lowercases both sides, so `#0A357E` in `palette.ts` and `#0a357e` in the CSS both pass.

- [ ] **Step 5: Run checks to verify pass**

Run: `./run.ps1 check -Web`
Expected: PASS — `palette.test.ts` green; `next build` compiles the new utilities; ESLint/Prettier/tsc clean. (No visual change yet: nothing sets `.dark`, and every utility's light value equals the prior hardcoded value.)

- [ ] **Step 6: Commit**

```bash
git add web/lib/theme/palette.ts web/lib/theme/palette.test.ts web/app/globals.css
git commit -m "feat(web): add dark-mode semantic token layer (#18)"
```

---

### Task 2: Theme provider + `ThemeToggle`

Add `next-themes`, wrap the app in a client provider (no-flash via its pre-hydration script), and build the hydration-safe 3-state toggle. Mount it in `SiteHeader` (always reachable, on the brand gradient) and on the account page's signed-in body. The toggle is the testable deliverable that exercises the provider; the server-side layout/header wiring is verified by `next build`.

**Files:**
- Create: `web/app/providers.tsx`, `web/components/ThemeToggle.tsx`, `web/components/ThemeToggle.test.tsx`
- Modify: `web/package.json`, `web/app/layout.tsx`, `web/components/SiteHeader.tsx`, `web/app/account/page.tsx`

**Interfaces:**
- Consumes: `next-themes` `ThemeProvider`, `useTheme` (`{ theme, setTheme, resolvedTheme }`).
- Produces: `<Providers>` (default export, client) wrapping children in `ThemeProvider attribute="class" defaultTheme="system" enableSystem`; `<ThemeToggle />` (default export, client). `resolvedTheme` (`"light" | "dark" | undefined`-until-mounted) becomes available to any client descendant — **consumed by `MapBrowser` in Task 10.**

- [ ] **Step 1: Add the dependency**

Run (from repo root — this updates `web/package.json` + `pnpm-lock.yaml`; does not trigger the destructive purge because it is `pnpm add`, not `pnpm run`):

```bash
pnpm --filter web add next-themes@0.4.6
```

Verify `web/package.json` `dependencies` now pins `"next-themes": "0.4.6"` (exact, no caret).

- [ ] **Step 2: Create the provider**

Create `web/app/providers.tsx`:

```tsx
"use client";

import { ThemeProvider } from "next-themes";

// next-themes injects a pre-hydration <script> that sets the `.dark` class on <html>
// before first paint, so there is no light→dark flash. `attribute="class"` matches the
// @custom-variant in globals.css; `system` (default) follows the OS until the user picks.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {children}
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Wire the provider into the root layout**

In `web/app/layout.tsx`: import `Providers`, add `suppressHydrationWarning` to `<html>` (required — next-themes mutates the class before React hydrates), and wrap the body content. The returned JSX becomes:

```tsx
import { Providers } from "./providers";
// ...existing imports (AnalyticsConsent, SITE_URL, "./globals.css")...

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          {modal}
          <AnalyticsConsent />
        </Providers>
      </body>
    </html>
  );
```

(`AnalyticsConsent` stays inside — it is the existing precedent for a client component mounted in the server root layout, and it must keep rendering.)

- [ ] **Step 4: Write the failing toggle test**

Create `web/components/ThemeToggle.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle from "./ThemeToggle";

function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    // jsdom has no matchMedia; next-themes reads it for `system`.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false, // system = light
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    );
  });

  it("renders the three theme options after mount", async () => {
    renderToggle();
    // Radiogroup of System/Light/Dark (see component below).
    expect(await screen.findByRole("radio", { name: /system/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
  });

  it("persists an explicit Dark choice to localStorage and sets .dark", async () => {
    renderToggle();
    fireEvent.click(await screen.findByRole("radio", { name: /dark/i }));
    await waitFor(() => expect(localStorage.getItem("theme")).toBe("dark"));
    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(true),
    );
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `./run.ps1 check -Web`
Expected: FAIL — `./ThemeToggle` does not exist.

- [ ] **Step 6: Implement the toggle**

Create `web/components/ThemeToggle.tsx`. It is hydration-safe (renders a stable, same-shape placeholder until mounted, per next-themes guidance) and uses **native `<input type="radio">`** grouped by a **per-instance** `name` (from `useId()`) — which gives real radiogroup semantics for free (arrow-key navigation, roving focus, single-selection) that plain `role="radio"` buttons do **not**. The per-instance name is essential: the account page renders **two** toggles (header + body), and a shared `name` would merge them into one radio group. Styled translucent-white for the brand gradient via Tailwind v4 `has-[:checked]` / `has-[:focus-visible]` label variants:

```tsx
"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";

type Choice = "system" | "light" | "dark";
const CHOICES: { value: Choice; label: string; glyph: string }[] = [
  { value: "system", label: "System", glyph: "🖥" },
  { value: "light", label: "Light", glyph: "☀" },
  { value: "dark", label: "Dark", glyph: "🌙" },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Unique radio-group name PER INSTANCE — the account page renders TWO toggles (header +
  // body); a shared `name` would merge them into one native radio group and break selection
  // + keyboard nav. useId() is SSR-stable, so no hydration mismatch.
  const groupName = useId();

  const base =
    "inline-flex items-center rounded-full border border-white/30 bg-white/10 p-0.5 text-white";

  // Until mounted, `theme` is not reliable (SSR) — render a same-size, non-interactive
  // placeholder so there is no layout shift and no hydration mismatch.
  if (!mounted) {
    return <div className={base} aria-hidden="true" style={{ height: 32, width: 96 }} />;
  }

  // Preflight resets <fieldset> margin/border/padding to 0, so `base` styles it cleanly.
  return (
    <fieldset className={base}>
      <legend className="sr-only">Theme</legend>
      {CHOICES.map((c) => (
        <label
          key={c.value}
          title={c.label}
          className="flex h-7 w-8 cursor-pointer items-center justify-center rounded-full text-sm transition hover:bg-white/10 has-[:checked]:bg-white/25 has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white/70"
        >
          <input
            type="radio"
            name={groupName}
            value={c.value}
            checked={theme === c.value}
            onChange={() => setTheme(c.value)}
            aria-label={c.label}
            className="sr-only"
          />
          <span aria-hidden="true">{c.glyph}</span>
        </label>
      ))}
    </fieldset>
  );
}
```

(The test in Step 4 queries `getByRole("radio", { name })` — native radios expose `role=radio` with the `aria-label` as the accessible name, so no test change is needed; arrow-key navigation is provided by the browser via the per-instance `name`.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `./run.ps1 check -Web`
Expected: PASS — both toggle tests green.

- [ ] **Step 8: Mount the toggle in `SiteHeader`**

In `web/components/SiteHeader.tsx`, import the toggle and add it to the right-hand cluster (before `AuthControl`, so the always-present control sits in the header on every page):

```tsx
import ThemeToggle from "./ThemeToggle";
```

Change the right cluster `<div>` to include it:

```tsx
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {totalPoints != null && <HeaderPoints initialTotalPoints={totalPoints} />}
          <ThemeToggle />
          <AuthControl viewer={viewer} initialPendingReportCount={pendingReportCount} />
        </div>
```

(`SiteHeader` is an async server component; `ThemeToggle` is a client child — valid. The header is the brand gradient on every route, so the translucent-white styling is always correct.)

- [ ] **Step 9: Mirror the toggle on the account signed-in body**

In `web/app/account/page.tsx`, import the toggle and add a labeled "Appearance" control to the signed-in `<main>` (the brand-gradient body), just above the "My rated water fountains" link:

```tsx
import ThemeToggle from "../../components/ThemeToggle";
```

Inside the final signed-in `return`'s `<main className={shell}>`, before the `<Link href="/account/fountains" …>`:

```tsx
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white/90">Appearance</span>
          <ThemeToggle />
        </div>
```

- [ ] **Step 10: Verify the full app builds with the provider wired**

Run: `./run.ps1 check -Web`
Expected: PASS — `next build` succeeds with the provider in the server layout and the toggle mounted; toggle tests still green.

- [ ] **Step 11: Commit**

```bash
git add web/package.json web/app/providers.tsx web/app/layout.tsx web/components/ThemeToggle.tsx web/components/ThemeToggle.test.tsx web/components/SiteHeader.tsx web/app/account/page.tsx
git add ../pnpm-lock.yaml 2>/dev/null || git add pnpm-lock.yaml
git commit -m "feat(web): next-themes provider + 3-state ThemeToggle (#18)"
```

---

### Task 3: Full content re-tone (brand hex + neutrals + status chips)

The FULL RE-TONE sweep (owner decision — see Global Constraints). Every surface migrates in three passes applied together, file-by-file, grouped by surface with a commit per group. **No behavior changes** — only class strings and a few inline hex. There are **0 tests asserting on hex** (verified), so no test updates; verification is a grep-clean + `./run.ps1 check -Web`.

**Files:** ~49 files (grouped below). Excludes the map-JS hex in `layers.ts`/`placement-map.ts` (Tasks 7/9) and `docs/` (Task 13).

**Interfaces:**
- Consumes: the token utilities from Task 1 and (for `dark:` chip variants) the `@custom-variant` from Task 1.
- Produces: no new exports; every re-toned surface reads on both the light and (Task-12-tuned) dark themes.

**The three mapping passes (apply all three to each file):**

**(a) Brand hex → token utility** (replace the arbitrary-value utility, keep the property prefix):

| Hex (any case) | Token | Example before → after |
|---|---|---|
| `#0A357E` | `brand` | `bg-[#0A357E]`→`bg-brand`; `text-[#0A357E]`→`text-brand`; `from-[#0A357E]`→`from-brand`; `border-[#0A357E]`→`border-brand` |
| `#0C44A0` | `brand-mid` | `bg-[#0C44A0]`→`bg-brand-mid`; `via-[#0C44A0]`→`via-brand-mid`; `text-[#0C44A0]`→`text-brand-mid` |
| `#0E4DA4` | `brand-royal` | `to-[#0E4DA4]`→`to-brand-royal`; `ring-[#0E4DA4]/20`→`ring-brand-royal/20` |
| `#F2C200` | `accent-gold` | `bg-[#F2C200]`→`bg-accent-gold`; `text-[#F2C200]`→`text-accent-gold`; `border-[#F2C200]/70`→`border-accent-gold/70`; `bg-[#F2C200]/10`→`bg-accent-gold/10` |
| `#ffce1f` | `accent-gold-hover` | `hover:bg-[#ffce1f]`→`hover:bg-accent-gold-hover` |
| `#5FC5F0` | `water` | `bg-[#5FC5F0]`→`bg-water` (the `page.tsx` glow) |
| `#E7F0FF`, `#EAF1FF` | `accent-subtle` | `bg-[#E7F0FF]`→`bg-accent-subtle`; `bg-[#EAF1FF]`→`bg-accent-subtle` |
| `#e9efe7` | `map-canvas` | `bg-[#e9efe7]`→`bg-map-canvas` |
| `#cdd6e6` | `border` | `border-[#cdd6e6]`→`border-border` |
| `#EFF6FF` / `bg-blue-50` | `accent-subtle` | `bg-blue-50`→`bg-accent-subtle` (possible-points preview) |

**(b) Named neutral utilities → tokens:**

| Before | After | Notes |
|---|---|---|
| `bg-white` | `bg-surface-raised` | cards, drawer, menus, white reading shells (`bg-white` light value = `#FFFFFF`, unchanged in light) |
| `bg-slate-50`, `hover:bg-slate-50`, `focus-visible:bg-slate-50` | `bg-surface`, `hover:bg-surface`, `focus-visible:bg-surface` | inset/hover fills |
| `bg-slate-100` (surfaces, e.g. close button) | `bg-surface` | |
| `bg-slate-100` (meter track `h-1.5`) | `bg-border` | thin track wants the divider tone |
| `text-slate-700`, `text-slate-800`, `text-slate-900`, `text-slate-950` | `text-foreground` | primary text |
| `text-slate-400`, `text-slate-500`, `text-slate-600` | `text-muted` | secondary/meta text |
| `border-slate-100`, `border-slate-200`, `border-slate-300` | `border-border` | |
| `divide-slate-100`, `divide-slate-200` | `divide-border` | |
| `ring-slate-200`, `ring-slate-300` | `ring-border` | attribute-chip rings |
| `bg-slate-200` | `bg-surface` (or `bg-border` for a divider/track) | |

**(c) Status/semantic chips → add `dark:` variants** (keep the light `bg-*-100 text-*-800` classes, append dark-tuned variants — Task 12 tunes the exact dark values):

| Light classes | Append |
|---|---|
| `bg-emerald-100 text-emerald-800` (working / "Verified working") | `dark:bg-emerald-500/15 dark:text-emerald-300` |
| `bg-amber-100 text-amber-800` (degraded) | `dark:bg-amber-500/15 dark:text-amber-300` |
| `bg-red-100 text-red-800` (not working / broken) | `dark:bg-red-500/15 dark:text-red-300` |
| `bg-amber-50 text-amber-700` (mixed attribute chip / advisory) | `dark:bg-amber-500/10 dark:text-amber-300` |
| `text-amber-700` (bare advisory line, error menu note) | `dark:text-amber-300` |
| `border-amber-300 bg-amber-50 text-amber-800` (condition-limit note) | `dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300` |
| `bg-slate-100 text-slate-500 ring-slate-200` (negative attr chip) | after (b): `bg-surface text-muted ring-border` (no extra `dark:` needed — tokens flip) |
| `bg-slate-50 text-slate-400 ring-slate-200` (muted attr chip) | after (b): `bg-surface text-muted ring-border` |
| `bg-red-600 text-white hover:bg-red-700` (solid destructive button — delete confirm) | append `dark:bg-red-500 dark:hover:bg-red-400` (keep a legible red on dark) |
| `text-red-600`, `text-red-700` (destructive text/link) | `text-danger` (the token flips on dark) |
| `border-red-300` (destructive outline) | `border-danger/40` |

**Surface groups (commit one per group). Apply passes (a)+(b)+(c) to each file.** The file lists in Steps 1–6 are the **known set** from the hex + neutral inventory; **Step 7's grep gates are authoritative for completeness** — if a gate flags a file not named below, re-tone it too (it is not an exhaustive census).

- [ ] **Step 1: Chrome & landing** — `web/components/SiteHeader.tsx`, `web/app/page.tsx`, `web/components/AuthControl.tsx`, `web/components/HeaderSearch.tsx`, `web/components/HeaderPoints.tsx`, `web/components/SignInButton.tsx`, `web/components/SignOutButton.tsx`, `web/components/analytics/ConsentBanner.tsx`, `web/components/MobileStoreLinks.tsx`. Then run `./run.ps1 check -Web`; commit `refactor(web): re-tone chrome + landing to theme tokens (#18)`.

- [ ] **Step 2: Map overlay chrome** — `web/components/map/MapStates.tsx` (all six components — brand hex, `bg-white`→`bg-surface-raised`, `text-slate-700`→`text-foreground`, `bg-[#e9efe7]`→`bg-map-canvas`), `web/components/map/MapBrowserLoader.tsx` (`bg-[#e9efe7]`→`bg-map-canvas`), `web/components/map/AddFountainFab.tsx`, `web/components/map/AddFountainPanel.tsx`, `web/components/map/FountainsInViewList.tsx`, `web/components/map/AttributeObservationFields.tsx`, `web/components/map/RatingFields.tsx`. Run `./run.ps1 check -Web`; commit `refactor(web): re-tone map overlays to theme tokens (#18)`.

- [ ] **Step 3: Fountain detail** — `web/components/fountain/DetailOverlay.tsx`, `FountainDetail.tsx`, `FountainDetailTabs.tsx`, `StatusBlock.tsx` (status chips → pass (c)), `AttributeChips.tsx` (the `positive`/`negative`/`neutral`/`mixed`/`muted` variant class map → passes (a)+(b)+(c): `bg-[#E7F0FF] text-[#0A357E] ring-[#0E4DA4]/20`→`bg-accent-subtle text-brand ring-brand-royal/20 dark:ring-brand-royal/30`), `AttributeList.tsx`, `NotesList.tsx`, `ContributeSection.tsx`, `RatingForm.tsx`, `ConditionForm.tsx` (condition-limit amber note → pass (c)), `NoteForm.tsx`, `AttributeForm.tsx`, `StarGroup.tsx`, `ShareButton.tsx`, `PhotoUpload.tsx`, `PhotoCarousel.tsx`, `PhotoGallery.tsx`, `ReportPhotoDialog.tsx`, `FountainListRow.tsx`, `FountainList.tsx`, and the intercepted modal route `web/app/@modal/(.)fountains/[id]/page.tsx`. Run `./run.ps1 check -Web`; commit `refactor(web): re-tone fountain detail to theme tokens (#18)`.

- [ ] **Step 4: `Stars.tsx` (inline SVG — special-cased)** — the empty/gold star colors are SVG `fill`/gradient `stop-color`, not Tailwind utilities. Replace the `GOLD = "#F2C200"` and `EMPTY = "#CBD5E1"` consts and their usages with CSS-var references so they flip with the theme:
  - Solid fills: set `fill="var(--color-accent-gold)"` (filled) and `fill="var(--color-star-empty)"` (empty).
  - Half-star `linearGradient` stops: `stopColor="var(--color-accent-gold)"` / `stopColor="var(--color-star-empty)"` (or `stop-color="…"` on the raw element — match the file's existing JSX form).
  - Keep `starFills()` / `data-fill` logic untouched (tests read `data-fill`, not color).
  Run `./run.ps1 check -Web`; commit `refactor(web): theme-aware Stars fills via CSS vars (#18)`.

- [ ] **Step 5: Leaderboard & contributions** — `web/components/leaderboard/LeaderboardRows.tsx` (the "you" highlight `#EAF1FF`→`bg-accent-subtle`), `LeaderboardControls.tsx`, `web/app/leaderboard/page.tsx`, `web/components/contributions/PointsPreview.tsx` (`blue-50`/`#EFF6FF`→`bg-accent-subtle`, brand-blue border/text → tokens). Run `./run.ps1 check -Web`; commit `refactor(web): re-tone leaderboard + contributions to theme tokens (#18)`.

- [ ] **Step 6: SEO / legal / admin / account static pages** — `web/app/privacy/page.tsx`, `web/app/terms/page.tsx`, `web/app/admin/page.tsx`, `web/app/admin/reports/page.tsx`, `web/components/admin/FountainAdminControls.tsx`, `web/components/admin/ReportedPhotoActions.tsx`, `web/components/admin/ReportBadge.tsx`, `web/components/AttributePage.tsx`, `web/app/drinking-fountains/[country]/page.tsx`, `web/app/drinking-fountains/[country]/[city]/page.tsx`, `web/app/drinking-fountains-near-me/page.tsx`, `web/app/fountains/[id]/page.tsx`, `web/app/account/page.tsx`, `web/app/account/fountains/page.tsx`, `web/components/account/DisplayNameForm.tsx`. **Note the white reading shells** here (`bg-white max-w-2xl` / `bg-white max-w-3xl`) → `bg-surface-raised` so long policy/list text sits on the elevated surface in dark. Run `./run.ps1 check -Web`; commit `refactor(web): re-tone SEO/legal/admin/account pages to theme tokens (#18)`.

- [ ] **Step 7: Verify the sweep is complete (two HARD grep gates)**

Both gates must return **no output** (grep exit 1 = clean) across `web/` — this is what enforces the owner-resolved FULL RE-TONE (a missed white/slate content surface fails the gate). Run from repo root in Git Bash. The map-JS files (Tasks 7/9) are excepted; `docs/` (Task 13) is not scanned here.

**Gate A — no brand-hex arbitrary utilities** (matches the `[#…]` token with ANY prefix, so it also catches `outline-[#…]`, `ring-offset-[#…]`, `shadow-[#…]`, `decoration-[#…]`, etc., not just `bg`/`text`/`border`):

```bash
grep -rniE '\[#(0a357e|0c44a0|0e4da4|f2c200|ffce1f|5fc5f0|e7f0ff|eaf1ff|e9efe7|cdd6e6|cbd5e1|eff6ff)\]' web/ \
  --include='*.tsx' --include='*.ts' \
  | grep -vE 'web/lib/map/(layers|colors)\.ts|web/components/map/placement-map\.ts'
```

**Gate B — no solid neutral content utilities** (slate is always content; **solid** `bg-white` is a content surface — both must become tokens). Translucent white on the brand gradient (`bg-white/10`, `text-white`, `border-white/40`) is correct and is **not** matched (the `[^/a-z-]` after `bg-white` skips `bg-white/…`):

```bash
grep -rnE '(bg-white([^/a-z-]|$)|bg-slate-|text-slate-|border-slate-|divide-slate-|ring-slate-)' web/ \
  --include='*.tsx' --include='*.ts' \
  | grep -vE 'web/lib/map/(layers|colors)\.ts|web/components/map/placement-map\.ts'
```

Expected: **no output from either gate.** Any line is a missed occurrence — re-tone it (per the tables) and re-run. If Gate B flags a file not named in Steps 1–6, re-tone it too.

**Status-chip review aid** (NOT grep-gateable — chips KEEP their light `*-100/*-800` classes and ADD `dark:` siblings, so the light class legitimately remains). List every status/semantic utility that lacks a `dark:` on its element and confirm each carries the matching `dark:` classes from pass (c):

```bash
grep -rnE 'bg-(emerald|amber|red)-(50|100)|text-(emerald|amber|red)-(600|700|800)|border-(amber|red)-300' web/ --include='*.tsx' \
  | grep -v 'dark:'
```

Review each hit; a legitimate one has its `dark:` variant on the same element (Tailwind can't require adjacency, so this is a human check, not a gate).

- [ ] **Step 8: Final check of the whole sweep**

Run: `./run.ps1 check -Web`
Expected: PASS — ESLint/Prettier/tsc/vitest/`next build` all green; no test changed (0 hex assertions).

(All commits already made per group in Steps 1–6; no extra commit needed unless Step 7 forced fixes — then `git commit -m "refactor(web): finish token re-tone sweep (#18)"`.)

---

### Task 4: Dark pin assets

Extend the Pillow generators to emit dark-tuned variants (brighter fills + stronger contrast outline so pins pop on dark land), regenerate hermetically, and commit the PNGs. **Web only** here — `pin-selected-dark` and `pill-bg-dark` are web-only; mobile dark pins are Plan 3.

**Files:**
- Modify: `scripts/gen-pin-assets.py`, `scripts/assets/gen_unrated_pin.py`
- Create (generated, committed): `web/public/pins/pin-standard-dark.png`, `pin-selected-dark.png`, `pin-gold-dark.png`, `pin-broken-dark.png`, `pin-unrated-dark.png`, `pill-bg-dark.png`

**Interfaces:**
- Produces: the six `*-dark.png` files under `web/public/pins/`, referenced by **name** (`pin-standard-dark`, `pill-bg-dark`, …) in Tasks 6–8/10. No code imports them; they are `addImage`'d at runtime.

- [ ] **Step 1: Extend `scripts/gen-pin-assets.py` to emit the dark set**

Add a dark-tuned outline + a dark pill next to the existing outputs. After the existing light saves in `main()`, add (reusing the existing `placed()`/`canvas()`/`_ring()` helpers and the `std`/`gold`/`sel`/`broken` composites — regenerate each with a dark-contrast ring, and write a dark pill that is a dark rounded-rect with a light border so the light pill text reads on it):

```python
    # ── Dark-tuned variants (spec §8): a stronger, lighter contrast ring so pins pop on
    #    dark land; a dark pill body with a light border for the light pill text. ─────────
    RING_DARK = (231, 240, 255)   # #E7F0FF — bright halo outline on dark basemap
    PILL_BG_DARK = (17, 26, 46)   # #111A2E — matches --surface (dark)
    PILL_BORDER_DARK = (159, 176, 199)  # #9FB0C7 — light edge so the pill reads

    std_d = canvas()
    std_d.alpha_composite(_ring(std, 2, RING_DARK))
    std_d.alpha_composite(std)
    std_d.save(os.path.join(OUT, "pin-standard-dark.png"))

    gold_d = canvas()
    gold_d.alpha_composite(_ring(std, 3, GOLD))
    gold_d.alpha_composite(_ring(std, 1, RING_DARK))
    gold_d.alpha_composite(std)
    gold_d.save(os.path.join(OUT, "pin-gold-dark.png"))

    sel_d = canvas()
    sel_d.alpha_composite(_ring(std, 2, RING_DARK))
    sel_d.alpha_composite(std)
    sel_d.save(os.path.join(OUT, "pin-selected-dark.png"))

    broken_d = broken.copy()
    broken_d.alpha_composite(_ring(std, 2, RING_DARK), (0, 0))
    broken_d.alpha_composite(broken)
    broken_d.save(os.path.join(OUT, "pin-broken-dark.png"))

    pill_d = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
    ImageDraw.Draw(pill_d).rounded_rectangle(
        [0, 0, 19, 19], radius=6, fill=PILL_BG_DARK + (255,),
        outline=PILL_BORDER_DARK + (255,), width=1,
    )
    pill_d.save(os.path.join(OUT, "pill-bg-dark.png"))
```

Add the dark names to the final summary loop so the print covers them:

```python
    for name in ("pin-standard", "pin-gold", "pin-selected", "pin-broken", "pill-bg",
                 "pin-standard-dark", "pin-gold-dark", "pin-selected-dark",
                 "pin-broken-dark", "pill-bg-dark"):
```

> `broken` is `std.copy()` composited with the slash **before** this block runs; recompositing the ring under it is fine — the ring is outside the silhouette. If the layering reads oddly at review time, drop the `_ring` line for broken (the red slash is the status cue).

- [ ] **Step 2: Extend `scripts/assets/gen_unrated_pin.py` to dual-write the dark unrated pin**

The unrated pin is a slate duotone of `pin-standard`. Add a **brighter** dark ramp and write `web/public/pins/pin-unrated-dark.png` (web only — do NOT add a mobile dark path; mobile is Plan 3). Change the tail of the script from a single ramp to two:

```python
DARK = (47, 63, 90)      # #2F3F5A — slate shadow (light theme)
LIGHT = (176, 190, 210)  # #B0BED2 — light slate highlight (light theme)
# Dark theme: a brighter slate ramp so the muted pin still reads on dark land.
DARK_DK = (120, 138, 168)   # brighter shadow
LIGHT_DK = (206, 217, 233)  # near-white highlight


def duotone(c_dark, c_light):
    return Image.merge(
        "RGB",
        (
            gray.point(ramp(c_dark[0], c_light[0])),
            gray.point(ramp(c_dark[1], c_light[1])),
            gray.point(ramp(c_dark[2], c_light[2])),
        ),
    )


# Light unrated → web + mobile (unchanged behavior).
out = Image.merge("RGBA", (*duotone(DARK, LIGHT).split(), a))
for path in ["web/public/pins/pin-unrated.png", "mobile/assets/pins/pin-unrated.png"]:
    out.save(path)
    print(f"wrote {path} ({out.size[0]}x{out.size[1]})")

# Dark unrated → web only (mobile dark pins are Plan 3).
out_dk = Image.merge("RGBA", (*duotone(DARK_DK, LIGHT_DK).split(), a))
out_dk.save("web/public/pins/pin-unrated-dark.png")
print(f"wrote web/public/pins/pin-unrated-dark.png ({out_dk.size[0]}x{out_dk.size[1]})")
```

(Remove the now-replaced `duo`/single-`out` block; keep `SRC`, `src`, `r,g,b,a`, `gray`, `ramp`.)

- [ ] **Step 3: Regenerate hermetically**

Run (Git Bash, from repo root — `uvx` gives a clean Pillow, no global install):

```bash
cd /d/repos/fountainrank
uvx --from pillow python scripts/gen-pin-assets.py
uvx --from pillow python scripts/assets/gen_unrated_pin.py
```

Expected: the print summary lists all light + the five new `*-dark.png` from the first script, and `pin-unrated-dark.png` from the second.

- [ ] **Step 4: Verify the dark PNGs exist and are non-empty**

Run:

```bash
cd /d/repos/fountainrank
for f in pin-standard-dark pin-selected-dark pin-gold-dark pin-broken-dark pin-unrated-dark pill-bg-dark; do
  p="web/public/pins/$f.png"; [ -s "$p" ] && echo "OK  $p ($(wc -c <"$p") bytes)" || { echo "MISSING $p"; exit 1; }
done
```

Expected: six `OK` lines, each with a non-zero byte count.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-pin-assets.py scripts/assets/gen_unrated_pin.py web/public/pins/*-dark.png
git commit -m "feat(web): generate dark-tuned map pin assets (#18)"
```

---

### Task 5: Map paint constants (`web/lib/map/colors.ts`)

A pure, theme-keyed record of the MapLibre paint values (map paint is set in JS, not CSS). Keeps the layer factories pure and unit-testable with no DOM/`getComputedStyle`.

**Files:**
- Create: `web/lib/map/colors.ts`, `web/lib/map/colors.test.ts`

**Interfaces:**
- Produces: `type MapColors`, `MAP_COLORS: Record<"light" | "dark", MapColors>`, `mapColorsFor(theme: "light" | "dark"): MapColors`. **Consumed by Tasks 7 (layers), 9 (placement), 10 (MapBrowser).**

- [ ] **Step 1: Write the failing test**

Create `web/lib/map/colors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAP_COLORS, mapColorsFor } from "./colors";

describe("MAP_COLORS", () => {
  it("light matches the current hardcoded paint", () => {
    expect(MAP_COLORS.light.cluster).toBe("#0C44A0");
    expect(MAP_COLORS.light.clusterStroke).toBe("#FFFFFF");
    expect(MAP_COLORS.light.pillText).toBe("#0A357E");
    expect(MAP_COLORS.light.pillBg).toBe("pill-bg");
    expect(MAP_COLORS.light.selectedPin).toBe("pin-selected");
    expect(MAP_COLORS.light.halo).toBe("#0C44A0");
  });
  it("dark brightens paint + uses -dark asset names", () => {
    expect(MAP_COLORS.dark.cluster).toBe("#4C82F0");
    expect(MAP_COLORS.dark.clusterStroke).toBe("#0B1220");
    expect(MAP_COLORS.dark.pillText).toBe("#E7F0FF");
    expect(MAP_COLORS.dark.pillBg).toBe("pill-bg-dark");
    expect(MAP_COLORS.dark.selectedPin).toBe("pin-selected-dark");
    expect(MAP_COLORS.dark.halo).toBe("#5FC5F0");
  });
  it("mapColorsFor selects by theme", () => {
    expect(mapColorsFor("light")).toBe(MAP_COLORS.light);
    expect(mapColorsFor("dark")).toBe(MAP_COLORS.dark);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./run.ps1 check -Web`
Expected: FAIL — `./colors` does not exist.

- [ ] **Step 3: Implement `colors.ts`**

```ts
// MapLibre paint is applied in JS, so map colors are TS constants keyed by resolved theme
// (NOT CSS @theme vars). `pillBg`/`selectedPin` are theme-suffixed icon-image NAMES that
// MapBrowser addImage's under the same name. Dark values are brightened so pins/labels
// hold contrast on the dark basemap land (spec §3.1 map-token table; tuned in the a11y task).
export type MapColors = {
  cluster: string; // clusters circle-color
  clusterStroke: string; // clusters circle-stroke-color
  clusterCount: string; // cluster-count text-color
  pillText: string; // pins-pill text-color
  pillBg: string; // pins-pill icon-image name
  halo: string; // selected-halo circle-color
  selectedPin: string; // selected-pin icon-image name
  ring: string; // placement-map add-bound ring line-color
  marker: string; // placement-map draggable marker color
};

export const MAP_COLORS: Record<"light" | "dark", MapColors> = {
  light: {
    cluster: "#0C44A0",
    clusterStroke: "#FFFFFF",
    clusterCount: "#FFFFFF",
    pillText: "#0A357E",
    pillBg: "pill-bg",
    halo: "#0C44A0",
    selectedPin: "pin-selected",
    ring: "#0A357E",
    marker: "#0A357E",
  },
  dark: {
    cluster: "#4C82F0",
    clusterStroke: "#0B1220",
    clusterCount: "#FFFFFF",
    pillText: "#E7F0FF",
    pillBg: "pill-bg-dark",
    halo: "#5FC5F0",
    selectedPin: "pin-selected-dark",
    ring: "#4C82F0",
    marker: "#4C82F0",
  },
};

export function mapColorsFor(theme: "light" | "dark"): MapColors {
  return MAP_COLORS[theme];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./run.ps1 check -Web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/map/colors.ts web/lib/map/colors.test.ts
git commit -m "feat(web): theme-keyed map paint constants (#18)"
```

---

### Task 6: Dark style URL derivation + themed asset helpers (`web/lib/map/style.ts`)

Add `styleUrlFor(theme)` (safe `new URL` basename swap with a logged fallback) and theme helpers that pair each pin/pill **file URL** with its theme-suffixed **image name**.

**Files:**
- Modify: `web/lib/map/style.ts`
- Create: `web/lib/map/style.test.ts`

**Interfaces:**
- Consumes: `BASEMAP.styleUrl`, `PIN_ASSETS` (existing), `logMapError` (existing).
- Produces: `styleUrlFor(theme: "light" | "dark"): string`; `themedPinAssets(theme): { name: string; url: string }[]`; `themedPillBg(theme): { name: string; url: string }`. **Consumed by Task 10 (MapBrowser).**

- [ ] **Step 1: Write the failing test**

Create `web/lib/map/style.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

// BASEMAP.styleUrl is read from env at import — set it before importing the module.
async function loadWith(styleUrl: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASEMAP_STYLE_URL", styleUrl);
  return import("./style");
}

afterEach(() => vi.unstubAllEnvs());

describe("styleUrlFor", () => {
  it("returns the light URL unchanged for light", async () => {
    const url = "https://cdn.example/style.light.json?v=2";
    const m = await loadWith(url);
    expect(m.styleUrlFor("light")).toBe(url);
  });
  it("swaps only the basename for dark, preserving ?v=", async () => {
    const m = await loadWith("https://cdn.example/style.light.json?v=2");
    expect(m.styleUrlFor("dark")).toBe("https://cdn.example/style.dark.json?v=2");
  });
  it("falls back to light + logs when the URL lacks the light marker", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const url = "https://cdn.example/custom-style.json";
    const m = await loadWith(url);
    expect(m.styleUrlFor("dark")).toBe(url);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("themed assets", () => {
  it("light uses base names/urls", async () => {
    const m = await loadWith("https://cdn.example/style.light.json?v=2");
    const std = m.themedPinAssets("light").find((a) => a.name === "pin-standard");
    expect(std).toEqual({ name: "pin-standard", url: "/pins/pin-standard.png" });
    expect(m.themedPillBg("light")).toEqual({ name: "pill-bg", url: "/pins/pill-bg.png" });
  });
  it("dark appends -dark to names and urls", async () => {
    const m = await loadWith("https://cdn.example/style.light.json?v=2");
    const std = m.themedPinAssets("dark").find((a) => a.name === "pin-standard-dark");
    expect(std).toEqual({ name: "pin-standard-dark", url: "/pins/pin-standard-dark.png" });
    expect(m.themedPillBg("dark")).toEqual({
      name: "pill-bg-dark",
      url: "/pins/pill-bg-dark.png",
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./run.ps1 check -Web`
Expected: FAIL — `styleUrlFor`/`themedPinAssets`/`themedPillBg` are not exported.

- [ ] **Step 3: Implement in `style.ts`**

Append to `web/lib/map/style.ts` (add the `logMapError` import at the top):

```ts
import { logMapError } from "./log";

export function styleUrlFor(theme: "light" | "dark"): string {
  if (theme === "light") return BASEMAP.styleUrl;
  try {
    const u = new URL(BASEMAP.styleUrl);
    if (u.pathname.endsWith("/style.light.json")) {
      u.pathname = u.pathname.replace(/style\.light\.json$/, "style.dark.json");
      return u.toString(); // query (?v=) preserved
    }
  } catch {
    /* fall through to fallback */
  }
  // Non-matching config (custom/local style): keep light AND surface a diagnostic so a
  // "dark requested but not derivable" state is visible, not a silent light basemap under
  // a dark UI. The deploy gate (Task 11) prevents relying on this in production.
  logMapError("dark-style-derivation-fallback", { styleUrl: BASEMAP.styleUrl });
  return BASEMAP.styleUrl;
}

// Pair each pin/pill file URL with its theme-suffixed image NAME. MapBrowser addImage's
// the light or dark asset under the matching suffixed name so the layer factories can
// reference `pin-standard` / `pin-standard-dark` etc. by name.
export function themedPinAssets(theme: "light" | "dark"): { name: string; url: string }[] {
  const suffix = theme === "dark" ? "-dark" : "";
  return (Object.keys(PIN_ASSETS) as (keyof typeof PIN_ASSETS)[]).map((base) => ({
    name: `${base}${suffix}`,
    url: `/pins/${base}${suffix}.png`,
  }));
}

export function themedPillBg(theme: "light" | "dark"): { name: string; url: string } {
  const suffix = theme === "dark" ? "-dark" : "";
  return { name: `pill-bg${suffix}`, url: `/pins/pill-bg${suffix}.png` };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./run.ps1 check -Web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/map/style.ts web/lib/map/style.test.ts
git commit -m "feat(web): dark style URL derivation + themed pin/pill helpers (#18)"
```

---

### Task 7: Theme-aware layer factories (`web/lib/map/layers.ts`)

Make the factories take a resolved `MapColors` and theme-suffixed icon-image names, so the same functions render light or dark paint. Update the layer test to pass colors and assert the dark values + suffixed names.

**Files:**
- Modify: `web/lib/map/layers.ts`, `web/lib/map/layers.test.ts`

**Interfaces:**
- Consumes: `MapColors` from `./colors`.
- Produces: `clusterCircleLayer(c)`, `clusterCountLayer(c)`, `pinLayer()` (unchanged — icon comes from the feature), `pillLayer(c)`, `selectedHaloLayer(id, c)`, `selectedIconExpr(selectedPinName)`, `selectedPinLayer(id, selectedPinName)`. **Consumed by Task 10.** (`SELECTED_ICON_EXPR` const is replaced by the `selectedIconExpr(name)` factory.)

- [ ] **Step 1: Update the failing test**

Rewrite the relevant parts of `web/lib/map/layers.test.ts`. Add a `MapColors` import and a `light`/`dark` fixture, thread colors through the factory calls, and assert dark specifics. Replace the `import { … SELECTED_ICON_EXPR } from "./layers"` with `selectedIconExpr`, and update the affected `describe`s:

```ts
import { mapColorsFor } from "./colors";
// ...replace SELECTED_ICON_EXPR in the import list with selectedIconExpr...

const light = mapColorsFor("light");
const dark = mapColorsFor("dark");

describe("cluster layers", () => {
  it("count uses point_count_abbreviated", () => {
    expect(clusterCountLayer(light).layout!["text-field"]).toEqual([
      "get",
      "point_count_abbreviated",
    ]);
    expect(JSON.stringify(clusterCircleLayer(light).filter)).toContain("point_count");
  });
  it("dark uses brightened circle paint", () => {
    expect(clusterCircleLayer(dark).paint!["circle-color"]).toBe("#4C82F0");
    expect(clusterCircleLayer(dark).paint!["circle-stroke-color"]).toBe("#0B1220");
  });
});

describe("pillLayer", () => {
  it("is a zoom-gated icon-text-fit pill excluding null pills + clusters", () => {
    const l = pillLayer(light);
    expect(l.minzoom).toBe(PILL_MIN_ZOOM);
    expect(l.layout!["icon-image"]).toBe("pill-bg");
    expect(l.layout!["icon-text-fit"]).toBe("both");
    expect(l.layout!["text-field"]).toEqual(["get", "pill"]);
    expect(JSON.stringify(l.filter)).toContain("pill");
  });
  it("dark uses the dark pill image + light pill text", () => {
    const l = pillLayer(dark);
    expect(l.layout!["icon-image"]).toBe("pill-bg-dark");
    expect(l.paint!["text-color"]).toBe("#E7F0FF");
  });
});

describe("selected layers", () => {
  it("halo + pin filter by id and swap icon for working non-gold", () => {
    expect(JSON.stringify(selectedHaloLayer("abc", light).filter)).toContain("abc");
    const sp = selectedPinLayer("abc", light.selectedPin);
    expect(JSON.stringify(sp.layout!["icon-image"])).toContain("pin-selected");
  });
  it("dark selected pin uses the -dark asset name + brightened halo", () => {
    expect(selectedHaloLayer("abc", dark).paint!["circle-color"]).toBe("#5FC5F0");
    const sp = selectedPinLayer("abc", dark.selectedPin);
    expect(JSON.stringify(sp.layout!["icon-image"])).toContain("pin-selected-dark");
  });
});
```

Also update the `SELECTED_ICON_EXPR behavioral matrix` block: build the expression from the factory — replace `createExpression(SELECTED_ICON_EXPR, null)` with `createExpression(selectedIconExpr("pin-selected"), null)` (the light-name variant preserves the existing assertions, which expect `"pin-selected"` for working non-gold).

- [ ] **Step 2: Run to verify it fails**

Run: `./run.ps1 check -Web`
Expected: FAIL — factories still take no args; `selectedIconExpr` not exported.

- [ ] **Step 3: Implement the theme-aware factories**

Rewrite `web/lib/map/layers.ts` factories (import `MapColors`; `fountainsSource`/`EMPTY_FC`/filters unchanged). The changed functions:

```ts
import type { MapColors } from "./colors";

export function clusterCircleLayer(c: MapColors): CircleLayerSpecification {
  return {
    id: "clusters",
    type: "circle",
    source: "fountains",
    filter: isCluster,
    paint: {
      "circle-color": c.cluster,
      "circle-stroke-color": c.clusterStroke,
      "circle-stroke-width": 3,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28],
    },
  };
}

export function clusterCountLayer(c: MapColors): SymbolLayerSpecification {
  return {
    id: "cluster-count",
    type: "symbol",
    source: "fountains",
    filter: isCluster,
    layout: {
      "text-field": ["get", "point_count_abbreviated"] as unknown as string,
      "text-size": 13,
      "text-font": ["Noto Sans Bold"],
    },
    paint: { "text-color": c.clusterCount },
  };
}

// pinLayer() is unchanged — icon-image comes from the feature's (theme-suffixed) `icon`.

export function pillLayer(c: MapColors): SymbolLayerSpecification {
  return {
    id: "pins-pill",
    type: "symbol",
    source: "fountains",
    minzoom: PILL_MIN_ZOOM,
    filter: [
      "all",
      notCluster,
      ["has", "pill"],
      ["!=", ["get", "pill"], null],
    ] as unknown as FilterSpecification,
    layout: {
      "icon-image": c.pillBg,
      "icon-text-fit": "both",
      "icon-text-fit-padding": [2, 6, 2, 6],
      "text-field": ["get", "pill"] as unknown as string,
      "text-size": 12,
      "text-font": ["Noto Sans Bold"],
      "text-anchor": "top",
      "icon-anchor": "top",
      "text-offset": [0, 1.4],
      "icon-allow-overlap": true,
      "text-allow-overlap": true,
      "text-optional": false,
    },
    paint: { "text-color": c.pillText },
  };
}

// Selection icon-swap, parameterized by the theme-suffixed selected-pin name.
export function selectedIconExpr(selectedPinName: string) {
  return [
    "case",
    [
      "all",
      ["get", "is_working"],
      [">=", ["coalesce", ["get", "ranking_score"], -1], 0],
      ["<=", ["coalesce", ["get", "ranking_score"], -1], GOLD_THRESHOLD],
    ],
    selectedPinName,
    ["get", "icon"],
  ] as const;
}

export function selectedHaloLayer(id: string, c: MapColors): CircleLayerSpecification {
  return {
    id: "selected-halo",
    type: "circle",
    source: "fountains",
    filter: byId(id),
    paint: {
      "circle-radius": 26,
      "circle-color": c.halo,
      "circle-opacity": 0.18,
      "circle-translate": [0, -18],
    },
  };
}

export function selectedPinLayer(id: string, selectedPinName: string): SymbolLayerSpecification {
  return {
    id: "selected-pin",
    type: "symbol",
    source: "fountains",
    filter: byId(id),
    layout: {
      "icon-image": selectedIconExpr(selectedPinName) as unknown as string,
      "icon-anchor": "bottom",
      "icon-size": 0.56,
      "icon-allow-overlap": true,
    },
  };
}
```

Delete the old `SELECTED_ICON_EXPR` const, the old no-arg `clusterCircleLayer`/`clusterCountLayer`/`pillLayer`/`selectedHaloLayer`/`selectedPinLayer`, and remove `#…` hex literals from this file (they now come from `MapColors`). Keep `pinLayer()` as-is.

- [ ] **Step 4: Run to verify it passes**

Run: `./run.ps1 check -Web`
Expected: PASS — `layers.test.ts` green (the behavioral matrix still passes via `selectedIconExpr("pin-selected")`).

- [ ] **Step 5: Commit**

```bash
git add web/lib/map/layers.ts web/lib/map/layers.test.ts
git commit -m "feat(web): theme-aware map layer factories (#18)"
```

---

### Task 8: Theme-suffixed feature icons (`web/lib/map/pins.ts`)

Give `pinsToFeatureCollection` a `theme` param so each feature's `icon` gets the `-dark` suffix in dark mode; `basePinIcon` stays pure (base status → name).

**Files:**
- Modify: `web/lib/map/pins.ts`, `web/lib/map/pins.test.ts`

**Interfaces:**
- Produces: `pinsToFeatureCollection(pins: PinInput[], theme?: "light" | "dark")` (defaults `"light"`). **Consumed by Task 10** (`load()` and `installOverlay` pass the resolved theme).

- [ ] **Step 1: Update the failing test**

Add to `web/lib/map/pins.test.ts` (inside the `pinsToFeatureCollection` describe):

```ts
  it("dark theme suffixes the feature icon", () => {
    const fc = pinsToFeatureCollection(
      [
        {
          id: "c",
          location: { latitude: 1, longitude: 2 },
          is_working: true,
          average_rating: null,
          rating_count: 0,
          ranking_score: null,
        },
      ],
      "dark",
    );
    expect(fc.features[0].properties.icon).toBe("pin-unrated-dark");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `./run.ps1 check -Web`
Expected: FAIL — `pinsToFeatureCollection` takes one arg; icon is `pin-unrated`.

- [ ] **Step 3: Implement the theme param**

In `web/lib/map/pins.ts`, change `pinsToFeatureCollection`:

```ts
export function pinsToFeatureCollection(
  pins: PinInput[],
  theme: "light" | "dark" = "light",
): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps> {
  const suffix = theme === "dark" ? "-dark" : "";
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.location.longitude, p.location.latitude] },
      properties: {
        id: String(p.id),
        is_working: p.is_working,
        ranking_score: p.ranking_score ?? null,
        average_rating: p.average_rating ?? null,
        icon: `${basePinIcon(p)}${suffix}`,
        pill: formatPill(p.average_rating ?? null),
      },
    })),
  };
}
```

(`basePinIcon` and `selectedSwapIcon` are unchanged — they stay pure status→base-name helpers.)

- [ ] **Step 4: Run to verify it passes**

Run: `./run.ps1 check -Web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/map/pins.ts web/lib/map/pins.test.ts
git commit -m "feat(web): theme-suffixed feature pin icons (#18)"
```

---

### Task 9: Theme the placement (add-fountain) map (`web/components/map/placement-map.ts`)

`createPlacementMap` overlays the add-bound **ring** (style-owned line source/layer, removed by `setStyle`) and a draggable **marker** (a DOM `Marker`, survives `setStyle`) on the SAME map — both currently hardcoded `#0A357E`. Make them theme-colored and add `reinstall(colors)` so a theme swap re-adds the ring and recolors the marker.

**Files:**
- Modify: `web/components/map/placement-map.ts`

**Interfaces:**
- Consumes: `MapColors` (only `.ring`/`.marker`) from `./colors` — typed as a structural subset.
- Produces: `createPlacementMap(map, colors: { ring: string; marker: string })`; the `PlacementMap` interface gains `reinstall(colors: { ring: string; marker: string }): void`. **Consumed by Task 10** (create once on first install; `reinstall` on each subsequent `style.load`).

No unit test (DOM/MapLibre-bound); verified by `next build` + the map visual check in Task 12.

- [ ] **Step 1: Add `reinstall` to the interface + retone the ring/marker**

Rewrite `web/components/map/placement-map.ts`. Add `reinstall` to `PlacementMap`, take a `colors` arg, remember last pin/bound/drag handler + a `ringActive` flag, and re-establish on `reinstall`:

```ts
import maplibregl from "maplibre-gl";
import { PLACE_MIN_ZOOM } from "../../lib/map/constants";
import {
  ringFeatureCollection,
  type Bound,
  type LngLat,
  type ViewportBounds,
} from "../../lib/map/placement";

const RING_SOURCE = "add-bound";
const RING_LAYER = "add-bound-line";

type PlacementColors = { ring: string; marker: string };

export interface PlacementMap {
  getZoom(): number;
  getCenter(): LngLat;
  getViewport(): ViewportBounds;
  flyToFix(center: LngLat): void;
  subscribe(h: { onClick: (p: LngLat) => void; onMoveEnd: () => void }): () => void;
  setPin(p: LngLat | null, onDragEnd: (p: LngLat) => void): void;
  setRing(bound: Bound | null): void;
  reinstall(colors: PlacementColors): void;
  teardown(): void;
}

export function createPlacementMap(map: maplibregl.Map, colors: PlacementColors): PlacementMap {
  let marker: maplibregl.Marker | null = null;
  let ringColor = colors.ring;
  let markerColor = colors.marker;
  let ringActive = false;
  let lastBound: Bound | null = null;
  let lastPin: LngLat | null = null;
  let lastDragEnd: ((p: LngLat) => void) | null = null;

  function ensureRing() {
    ringActive = true;
    // Ensure the source and layer INDEPENDENTLY — a partial state (source present but layer
    // gone, e.g. after a teardown error or a future edit) must still restore the layer.
    if (!map.getSource(RING_SOURCE)) {
      map.addSource(RING_SOURCE, { type: "geojson", data: ringFeatureCollection(lastBound) });
    }
    if (!map.getLayer(RING_LAYER)) {
      map.addLayer({
        id: RING_LAYER,
        type: "line",
        source: RING_SOURCE,
        paint: { "line-color": ringColor, "line-opacity": 0.4, "line-dasharray": [2, 2] },
      });
    }
  }

  function placeMarker(p: LngLat) {
    marker = new maplibregl.Marker({ draggable: true, color: markerColor });
    marker.on("dragend", () => {
      const ll = marker!.getLngLat();
      lastPin = { lng: ll.lng, lat: ll.lat };
      lastDragEnd?.({ lng: ll.lng, lat: ll.lat });
    });
    marker.setLngLat([p.lng, p.lat]).addTo(map);
  }

  return {
    getZoom: () => map.getZoom(),
    getCenter: () => {
      const c = map.getCenter();
      return { lng: c.lng, lat: c.lat };
    },
    getViewport: () => {
      const b = map.getBounds();
      return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
    },
    flyToFix: (center) =>
      map.easeTo({
        center: [center.lng, center.lat],
        zoom: Math.max(map.getZoom(), PLACE_MIN_ZOOM),
      }),
    subscribe: ({ onClick, onMoveEnd }) => {
      const click = (e: maplibregl.MapMouseEvent) =>
        onClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      const move = () => onMoveEnd();
      map.on("click", click);
      map.on("moveend", move);
      return () => {
        map.off("click", click);
        map.off("moveend", move);
      };
    },
    setPin: (p, onDragEnd) => {
      lastPin = p;
      lastDragEnd = onDragEnd;
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      if (!marker) {
        placeMarker(p);
      } else {
        marker.setLngLat([p.lng, p.lat]);
      }
    },
    setRing: (bound) => {
      lastBound = bound;
      ensureRing();
      const src = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(ringFeatureCollection(bound));
    },
    // Called by MapBrowser after a setStyle swap: setStyle drops the ring source/layer (and
    // requires the new theme's colors); the DOM marker survives but keeps its old color.
    reinstall: (next) => {
      ringColor = next.ring;
      markerColor = next.marker;
      if (ringActive) {
        if (map.getLayer(RING_LAYER)) {
          map.setPaintProperty(RING_LAYER, "line-color", ringColor);
        } else {
          ensureRing(); // source/layer were removed by setStyle — re-add with lastBound
        }
        const src = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
        src?.setData(ringFeatureCollection(lastBound));
      }
      if (marker && lastPin) {
        marker.remove();
        marker = null;
        placeMarker(lastPin); // recreate at the same spot with the new color
      }
    },
    teardown: () => {
      marker?.remove();
      marker = null;
      ringActive = false;
      if (map.getLayer(RING_LAYER)) map.removeLayer(RING_LAYER);
      if (map.getSource(RING_SOURCE)) map.removeSource(RING_SOURCE);
    },
  };
}
```

- [ ] **Step 2: Verify it compiles (consumer updated in Task 10)**

Run: `./run.ps1 check -Web`
Expected: **FAIL to build** at `MapBrowser.tsx:229` — `createPlacementMap(map)` now needs a second arg. That is expected; Task 10 fixes the call site. (If subagent-driven and tasks are isolated, note this cross-task dependency: Tasks 9 + 10 land together in one green commit.)

- [ ] **Step 3: Commit (with Task 10)**

Do **not** commit Task 9 alone — it leaves the build red. Commit together with Task 10.

---

### Task 10: MapBrowser runtime basemap swap (`web/components/map/MapBrowser.tsx`)

The delicate task (spec §5.2). Split the `map.on("load")` monolith into **one-time wiring** (listeners/controls attached once) and a per-style **`installOverlay`** (run on every `style.load` — initial + each `setStyle`). Add refs for the latest pins/activeId/theme and a `styleGenRef` generation counter so a rapid toggle or an in-flight bbox response can't install stale layers/data. A theme effect keyed on `resolvedTheme` calls `map.setStyle`.

**Files:**
- Modify: `web/components/map/MapBrowser.tsx`

**Interfaces:**
- Consumes: `useTheme` (`next-themes`), `mapColorsFor` (Task 5), `styleUrlFor`/`themedPinAssets`/`themedPillBg` (Task 6), theme-aware factories + `selectedPin` name (Task 7), `pinsToFeatureCollection(pins, theme)` (Task 8), `createPlacementMap(map, colors)` + `reinstall` (Task 9).

No unit test (MapLibre needs WebGL, unavailable in jsdom — spec §10 explicitly verifies MapBrowser via `next build` + visual). Verified by `./run.ps1 check -Web` (build) + Task 12 visual.

- [ ] **Step 1: Update imports + add the theme hook and new refs**

At the top of `MapBrowser.tsx`:
- Add `import { useTheme } from "next-themes";`
- Change the map imports: from `style` add `styleUrlFor, themedPinAssets, themedPillBg` (keep `BASEMAP`; drop `PIN_ASSETS, PILL_BG_ASSET` — they are replaced by the themed helpers); from `layers` swap `selectedHaloLayer, selectedPinLayer` calls to the new signatures and drop nothing else; add `import { mapColorsFor } from "../../lib/map/colors";`.
- Inside the component, after `const searchParams = …`, add:

```tsx
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const themeRef = useRef<"light" | "dark">("light");
  const pinsRef = useRef<import("../../lib/map/pins").PinInput[]>([]);
  const activeIdRef = useRef<string>("");
  const styleGenRef = useRef(0);
  const installedThemeRef = useRef<"light" | "dark" | null>(null);
  const placementRef = useRef<PlacementMap | null>(null);
```

(`resolveTheme` helper: define `const resolveTheme = (t?: string): "light" | "dark" => (t === "dark" ? "dark" : "light");` near the top of the module.)

- [ ] **Step 2: Gate map creation on `mounted` + read the resolved theme**

Change the main map-init `useEffect` so it (a) waits for `mounted` (so `resolvedTheme` is settled — no light→dark map flash for dark users), and (b) creates the map at the resolved theme. Change the guard and the `new Map` style:

```tsx
  useEffect(() => {
    if (!webglOk || !mounted) return; // wait for next-themes to resolve before building the map
    themeRef.current = resolveTheme(resolvedTheme);
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: ref.current!,
        style: styleUrlFor(themeRef.current),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        canvasContextAttributes: { powerPreference: "default" },
      });
    } catch (err) {
      logMapError("webgl-init-failed", { name: (err as Error)?.name });
      return;
    }
    mapRef.current = map;
```

Add `mounted` to the effect's dependency array (it flips once): `}, [router, webglOk, debug, mounted]);` — **do NOT add `resolvedTheme`** here (theme changes must swap style, never rebuild the map). `resolvedTheme` is read via `themeRef`; ESLint may want it in deps — silence with a scoped `// eslint-disable-next-line react-hooks/exhaustive-deps` above the dep array with a comment explaining the map must not rebuild on theme change (the separate effect in Step 6 handles it).

- [ ] **Step 3: Attach one-time wiring (replace the `map.on("load")` monolith)**

Keep the `map.on("error", …)` and the `if (debug) map.on("data", …)` blocks and the two `map.addControl(…)` calls as-is. Then **replace** the entire `map.on("load", async () => { … })` block (the images + `addSource` + `addLayer` + click/mouseenter/moveend/geolocate + `void load()`) with: (1) the one-time listeners bound to layer ids (they survive `setStyle`), (2) a one-time geolocate via `map.once("load")`, and (3) the `style.load` → `installOverlay` wiring:

```tsx
    let timer: ReturnType<typeof setTimeout>;
    const onMoveEnd = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), DEBOUNCE_MS);
    };

    // ── One-time wiring (layer-id–scoped listeners survive setStyle; attach exactly once) ──
    map.on("click", "clusters", (e) => {
      if (addActiveRef.current) return;
      const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      const cid = f?.properties?.cluster_id as number | undefined;
      const src = map.getSource("fountains") as GeoJSONSource;
      if (cid != null)
        src.getClusterExpansionZoom(cid).then((z) =>
          map.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom: z,
          }),
        );
    });
    const openPin = (e: MapLayerMouseEvent) => {
      if (addActiveRef.current) return;
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id) router.push(`/fountains/${id}`);
    };
    map.on("click", "pins", openPin);
    map.on("click", "selected-pin", openPin);
    ["clusters", "pins", "selected-pin"].forEach((ly) => {
      map.on("mouseenter", ly, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", ly, () => (map.getCanvas().style.cursor = ""));
    });
    map.on("moveend", onMoveEnd);

    // Geolocate ONCE at startup (not on style swaps): map.once("load") fires only on the
    // initial load; setStyle emits style.load, never load again.
    map.once("load", () => {
      navigator.geolocation?.getCurrentPosition(
        (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: NEIGHBORHOOD_ZOOM }),
        () => {
          /* denied/unavailable: stay at default view */
        },
        { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
      );
    });

    // Per-style install: fires on the initial style.load AND after every setStyle.
    map.on("style.load", () => {
      void installOverlay(map, styleGenRef.current);
    });
```

> **Why this is correct in maplibre-gl 5.24 (verified against the source):** `map.on(type, layerId, listener)` registers a **map-level delegated** listener that dynamically filters `layerId` through `map.getLayer(layerId)` on every event — so it can be registered **before** the overlay layers exist and **tolerates the layers being absent** (during a swap), and it is **not** a style-owned object, so `setStyle` does not remove it. That is why the `click`/`mouseenter`/`mouseleave`/`moveend` listeners are attached exactly once. `style.load` fires on the initial style load **and** after each diff-based `setStyle`; map `load` is the one-time "fully loaded" event — hence `installOverlay` on `style.load` (re-runs) and geolocation on `map.once("load")` (once). Do **not** move the delegated listeners into `installOverlay` — that would re-register them per swap and double-fire route pushes / cluster expansion / bbox loads.

- [ ] **Step 4: Add `installOverlay` (inside the effect, before `load`)**

```tsx
    async function installOverlay(m: maplibregl.Map, gen: number) {
      const theme = themeRef.current;
      const colors = mapColorsFor(theme);
      try {
        await Promise.all(
          themedPinAssets(theme).map(async ({ name, url }) => {
            const img = await m.loadImage(url);
            if (gen !== styleGenRef.current) return; // superseded by a newer setStyle
            if (!m.hasImage(name)) m.addImage(name, img.data);
          }),
        );
        const pill = themedPillBg(theme);
        const pillImg = await m.loadImage(pill.url);
        if (gen !== styleGenRef.current) return;
        if (!m.hasImage(pill.name))
          m.addImage(pill.name, pillImg.data, {
            stretchX: [[6, 14]],
            stretchY: [[6, 14]],
            content: [6, 6, 14, 14],
          });
      } catch (e) {
        logMapError("image-load-failed", { name: (e as Error).name });
      }
      if (gen !== styleGenRef.current) return;
      if (!m.getSource("fountains")) m.addSource("fountains", fountainsSource());
      const src = m.getSource("fountains") as GeoJSONSource | undefined;
      src?.setData(pinsToFeatureCollection(pinsRef.current, theme)); // seed from latest pins
      const c = colors;
      (
        [
          clusterCircleLayer(c),
          clusterCountLayer(c),
          pinLayer(),
          pillLayer(c),
          selectedHaloLayer(activeIdRef.current, c),
          selectedPinLayer(activeIdRef.current, c.selectedPin),
        ] as maplibregl.LayerSpecification[]
      ).forEach((l) => {
        if (!m.getLayer(l.id)) m.addLayer(l);
      });
      applyActiveFilter(m, activeIdRef.current);
      installedThemeRef.current = theme;

      // Placement map: create once (first install — matches the old "after load" timing that
      // useAddFountainMode/flyto depend on); re-establish its themed ring/marker on later swaps.
      if (!placementRef.current) {
        const pm = createPlacementMap(m, colors);
        placementRef.current = pm;
        setPlacementMap(pm);
      } else {
        placementRef.current.reinstall(colors);
      }
      void load(); // reconcile any pan/zoom that happened during the swap
    }

    function applyActiveFilter(m: maplibregl.Map, id: string) {
      if (!m.getLayer("selected-halo")) return;
      const flt: FilterSpecification = [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["get", "id"], id],
      ];
      m.setFilter("selected-halo", flt);
      m.setFilter("selected-pin", flt);
    }
```

- [ ] **Step 5: Rewrite `load()` — snapshot BOTH `seq` and `styleGenRef`, and re-read the source after the awaits**

The current `load()` captures `src = m.getSource("fountains")` **before** the async `fetchBbox` and guards only on `loadSeqRef`. After a `setStyle` swap (theme change) mid-fetch, that `src` points at the OLD (removed) source, so a stale response could `setData` a dead source or seed the new dark overlay with pre-swap pins. Snapshot `styleGenRef.current` too, re-check **both** guards after the fetch, and **re-read** `m.getSource("fountains")` after the guards before `setData`. Also clear `pinsRef` in the below-zoom path. Replace the whole `load()` function with:

```tsx
    async function load() {
      const m = mapRef.current;
      if (!m) return;
      const seq = ++loadSeqRef.current;
      const gen = styleGenRef.current;
      if (!shouldLoadPins(m.getZoom())) {
        (m.getSource("fountains") as GeoJSONSource | undefined)?.setData(EMPTY_FC);
        pinsRef.current = []; // a later swap re-seeds empty, not stale
        setPins([]);
        setStatus("belowZoom");
        return; // seq bump already invalidates in-flight fetches
      }
      const b = m.getBounds();
      const norm = normalizeBounds({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
      if (norm.skip) return; // antimeridian/degenerate: keep prior pins
      setStatus("loading");
      try {
        const reqId =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await fetchBbox(norm.params, reqId);
        // Stale if a newer load started OR a style swap superseded this generation.
        if (seq !== loadSeqRef.current || gen !== styleGenRef.current) return;
        const data = result.pins;
        setPins(data);
        const pinInputs = data.map((p) => ({ ...p, ranking_score: p.ranking_score ?? null }));
        pinsRef.current = pinInputs;
        // Re-read the source AFTER the guards — a setStyle during the fetch replaced it.
        const src = m.getSource("fountains") as GeoJSONSource | undefined;
        src?.setData(pinsToFeatureCollection(pinInputs, themeRef.current));
        setStatus(
          result.truncated || isAtCap(data.length)
            ? "capped"
            : data.length === 0
              ? "empty"
              : "idle",
        );
      } catch (e) {
        if (seq !== loadSeqRef.current || gen !== styleGenRef.current) return;
        const detail = `${(e as Error).name}: ${(e as Error).message}`;
        logMapError("bbox-fetch-failed", { detail });
        setDiag((d) => ({ ...d, errors: [...d.errors.slice(-9), `bbox-fetch: ${detail}`] }));
        setStatus("error");
      }
    }
```

- [ ] **Step 6: Add the theme-swap effect**

After the map-init effect (and before/after the celebration effect), add an effect keyed on `resolvedTheme` that swaps the style (never rebuilds the map). It bumps `styleGenRef` so `installOverlay`/in-flight `load()` abort if superseded:

```tsx
  // Theme change → swap the basemap style in place (camera preserved; no rebuild, no
  // geolocation re-trigger). The style.load handler re-installs pins/layers/selection.
  useEffect(() => {
    const theme = resolveTheme(resolvedTheme);
    themeRef.current = theme;
    const m = mapRef.current;
    if (!m || installedThemeRef.current === null) return; // map not built / first install pending
    if (installedThemeRef.current === theme) return; // already showing this theme
    styleGenRef.current += 1;
    m.setStyle(styleUrlFor(theme));
  }, [resolvedTheme]);
```

- [ ] **Step 7: Update the active-id effect to use the ref + shared helper**

Replace the existing `useEffect(() => { … selected-halo … }, [activeId, status])` body so it records the ref and reuses `applyActiveFilter`'s logic (inline it — `applyActiveFilter` is scoped to the map effect, so this effect keeps its own copy):

```tsx
  useEffect(() => {
    activeIdRef.current = activeId;
    const m = mapRef.current;
    if (!m || !m.getLayer?.("selected-halo")) return;
    const flt: FilterSpecification = [
      "all",
      ["!", ["has", "point_count"]],
      ["==", ["get", "id"], activeId],
    ];
    m.setFilter("selected-halo", flt);
    m.setFilter("selected-pin", flt);
  }, [activeId, status]);
```

- [ ] **Step 8: Update cleanup to tear down the placement map**

In the map-init effect's `return () => { … }`, add placement teardown + reset the generation/installed refs so a re-run starts clean:

```tsx
    return () => {
      clearTimeout(timer);
      placementRef.current?.teardown();
      placementRef.current = null;
      map.remove();
      mapRef.current = null;
      installedThemeRef.current = null;
      setPlacementMap(null);
    };
```

- [ ] **Step 9: Build + typecheck the whole thing**

Run: `./run.ps1 check -Web`
Expected: PASS — `next build` compiles MapBrowser + placement-map; all existing map unit tests (layers/pins/style/colors) green. This is the green commit that includes Task 9.

- [ ] **Step 10: Commit (Tasks 9 + 10 together)**

```bash
git add web/components/map/placement-map.ts web/components/map/MapBrowser.tsx
git commit -m "feat(web): runtime dark basemap swap via setStyle + overlay re-install (#18)"
```

---

### Task 11: Deploy-time dark-basemap availability gate (`.github/workflows/deploy.yml`)

Because the dark URL is derived at runtime (not baked), a web image shipping the toggle before `style.dark.json` is live would 404 the dark basemap — and `styleUrlFor`'s fallback covers a *misconfigured* URL, not a *missing* file. Add a `curl … → 200` gate in the `build-push` job **before** the web image is built, so a bundle that can request dark is never shipped before the file exists. `style.dark.json` already exists (Plan 1), so the gate is safe to add now.

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the same `BASEMAP_CDN` / `BASEMAP_STYLE_VER` values the web build already uses.
- Produces: a failing deploy when `…/style.dark.json?v=N` is not `200`.

- [ ] **Step 1: Insert the gate step before "Build + push web"**

In the `build-push` job, add this step **immediately before** the `- name: Build + push web` step (i.e. after `- name: Build + push backend`):

```yaml
      - name: Verify dark basemap style is live (rollout gate)
        env:
          # Must match the web build args below (spec §7): the client requests
          # style.dark.json?v=$BASEMAP_STYLE_VER; fail the deploy if it isn't published.
          BASEMAP_CDN: fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com
          BASEMAP_STYLE_VER: "2"
        run: |
          url="https://${BASEMAP_CDN}/style.dark.json?v=${BASEMAP_STYLE_VER}"
          st=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$url")
          if [ "$st" != "200" ]; then
            echo "::error::dark basemap not live: ${url} -> ${st} (run basemap-upload first)"; exit 1
          fi
          echo "dark basemap style live (${url})."
```

- [ ] **Step 2: Lint the workflow**

From the repo root, validate the YAML, then run actionlint pinned to **v1.7.12** via a hermetic path — do **not** depend on the gitignored `temp/actionlint` binary (`temp/` is ignored, so it is not portable to a fresh worker):

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('yaml ok')"
# actionlint v1.7.12, hermetic via Docker; on this Windows host the WSL binary is a fallback.
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.12 -color .github/workflows/deploy.yml \
  || wsl.exe -e ./temp/actionlint/actionlint .github/workflows/deploy.yml
```

Expected: `yaml ok` and no actionlint errors. (CI also lints workflows, so this is a fast local pre-check, not the only gate.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): gate web deploy on live dark basemap style (#18)"
```

---

### Task 12: Accessibility / contrast tune to WCAG AA

Turn "a11y pass" into a real regression guard: add contrast-ratio assertions for the token pairs (both themes), run them, and tune the *(proposed)* dark values in `palette.ts`/`MAP_COLORS` until they pass; then confirm against real light+dark screenshots.

**Files:**
- Modify: `web/lib/theme/palette.test.ts` (add contrast assertions), `web/lib/theme/palette.ts` + `web/app/globals.css` (tune dark values), `web/lib/map/colors.ts` (tune dark map paint if screenshots require).

**Interfaces:**
- Consumes: `LIGHT`/`DARK` from `palette.ts`.

- [ ] **Step 1: Add the failing contrast assertions**

Append to `web/lib/theme/palette.test.ts` (a local WCAG relative-luminance contrast helper — no dependency):

```ts
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
    it(`${name}: body text ≥ 4.5:1`, () => {
      expect(ratio(P.foreground, P.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P.foreground, P.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P.foreground, P["surface-raised"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P["on-brand"], P.brand)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: secondary/UI text ≥ 4.5:1 body / 3:1 large`, () => {
      expect(ratio(P.muted, P.background)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(P.danger, P.background)).toBeGreaterThanOrEqual(3);
    });
  }
});
```

- [ ] **Step 2: Run — expect some dark pairs to fail**

Run: `./run.ps1 check -Web`
Expected: FAIL on any dark pair below threshold (e.g. `muted #9FB0C7` on `background #0B1220`, or `danger`). Record which fail.

- [ ] **Step 3: Tune the failing dark values**

Adjust the failing tokens in `web/lib/theme/palette.ts` `DARK` (brighten `muted`, `danger`, `foreground` as needed) **and** mirror the exact hex into `web/app/globals.css` `.dark` (the Task-1 mirror test enforces they match). Re-run `./run.ps1 check -Web` until **both** the mirror test and the contrast test are green. Keep brand navy `#0A357E` fixed (brand constant); tune `on-brand`/text only if a pair fails.

- [ ] **Step 4: Visual confirmation against screenshots (spec §9, §10)**

With the dev server running (`./run.ps1 dev -Web` or the project's web dev task), capture light + dark of: `/` (map + hero band), the fountain detail drawer (status chip + stars + attribute chips), `/leaderboard` (the "you" highlight), an SEO/legal page (white reading shell → dark surface), and the map with **both** basemaps (pins, cluster bubbles, rating pill, selected halo, and the add-fountain ring/marker). Confirm: no white cards on the dark page; pins/pills/clusters read on dark land; status stays shape-encoded; the toggle has a visible focus ring; and no light→dark flash on load for a dark-preference OS. Tune `MAP_COLORS.dark` (cluster/halo/pill) or the dark pin ring brightness (Task 4) if any map element is low-contrast, and re-run checks.

- [ ] **Step 5: Commit**

```bash
git add web/lib/theme/palette.ts web/lib/theme/palette.test.ts web/app/globals.css web/lib/map/colors.ts
git commit -m "feat(web): tune dark palette + map paint to WCAG AA (#18)"
```

---

### Task 13: Documentation (`docs/style-guide.md`)

Document the theming layer + the new `ThemeToggle` component (house rule from `CLAUDE.md`), and correct the guide's "no token theme yet" preamble.

**Files:**
- Modify: `docs/style-guide.md` (outside the Prettier gate — edit by hand, do **not** `prettier --write`).

- [ ] **Step 1: Update the preamble + brand-token section**

Near the top ("There is no custom CSS layer yet — brand colors are applied as arbitrary-value utilities … until a token theme is introduced."), replace that sentence with a note that the semantic token layer now exists in `web/app/globals.css` (seeded from `web/lib/theme/palette.ts`), that surfaces use token utilities (`bg-surface`, `text-foreground`, `border-border`, `bg-brand`, …) which flip under `.dark`, and that arbitrary hex utilities are no longer used for brand/neutral colors.

- [ ] **Step 2: Add a "Dark mode & theme tokens" section**

Add a section documenting: the semantic token table (light + dark values, from the Global Constraints table above, post-Task-12 tuned values); the map paint set (`web/lib/map/colors.ts`); that dark values meet WCAG AA (enforced by `palette.test.ts`); and how the theme is selected (`next-themes`, `.dark` class, System default).

- [ ] **Step 3: Add the `ThemeToggle` component entry**

Under Components, document `ThemeToggle` (`web/components/ThemeToggle.tsx`): purpose (3-state System/Light/Dark, persisted); placement (`SiteHeader` right cluster + account signed-in body); structure (`role="radiogroup"` of three `role="radio"` buttons, translucent-white on the brand gradient); states (hydration-safe placeholder until mounted; active = `bg-white/25`); accessibility (keyboard-operable, `aria-checked`, visible `focus-visible` ring, `aria-label` per option); and an example snippet.

- [ ] **Step 4: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): document dark-mode tokens + ThemeToggle (#18)"
```

---

## Self-Review

**Spec coverage:**
- §3.1 semantic tokens + §4.1 token layer (`@custom-variant`, `:root`/`.dark`, `@theme inline`) → Task 1. ✅
- §3.1 map tokens as JS constants (`web/lib/map/colors.ts`) → Task 5. ✅
- §3.2 brand bands retained in dark (not re-toned) → Task 3 leaves `from-brand … to-brand-royal` gradients as brand tokens (kept navy). ✅
- §4.2 provider + no-flash (`next-themes@0.4.6`, `suppressHydrationWarning`) → Task 2. ✅
- §4.3 3-state hydration-safe `ThemeToggle` in header + account → Task 2; documented → Task 13. ✅
- §4.4 migration of hardcoded hex — **superseded by owner's FULL RE-TONE** (Global Constraints) → Task 3 (brand hex + neutrals + status chips), enforced by **two hard grep gates** (Gate A brand hex, Gate B solid neutrals) so a missed white/slate content surface fails; "update tests asserting `bg-[#…]`" is moot (0 such tests, verified). ✅
- §5.1 `styleUrlFor` (`new URL` swap + logged fallback) → Task 6. ✅
- §5.2 one-time wiring vs `installOverlay`, refs for pins/activeId, `styleGenRef`, `style.load` trigger, `setStyle` on `resolvedTheme` → Task 10. ✅
- §5.3 theme-aware layer factories + suffixed icon names → Tasks 7 (layers), 8 (feature icons). ✅
- §8 dark pin assets (web: `pin-*-dark.png` + `pill-bg-dark.png`, generator dual-write) → Task 4. ✅
- §7 rollout gate (deploy availability probe) → Task 11. ✅
- §9 WCAG AA contrast + shape-encoded status → Task 12 (contrast test + tuning + visual). ✅
- §10 verification via `./run.ps1 check -Web` (never `CI=true`) + `styleUrlFor`/factory/provider/toggle unit tests + MapBrowser via build/visual → every task. ✅
- **Placement (add-fountain) map themed** (handoff SESSION 2 emphasis — the overlay on the same map) → Task 9. ✅
- Not in this plan (correctly): mobile (Plan 3), the basemap workflow dark flavor (Plan 1, shipped), any backend/api-client change (none). ✅

**Placeholder scan:** none — every code step has concrete code; every command has expected output. The Task 3 sweep is intentionally table-driven (mechanical, 49 files, 0 hex-asserting tests) with an explicit grep-clean gate rather than per-file transcription.

**Type/name consistency:** `mapColorsFor`/`MapColors` (Task 5) consumed with identical shape in Tasks 7/9/10; `styleUrlFor`/`themedPinAssets`/`themedPillBg` (Task 6) consumed in Task 10; `selectedIconExpr`/`selectedPinLayer(id, name)` (Task 7) match Task 10's calls; `pinsToFeatureCollection(pins, theme)` (Task 8) matches `load()`/`installOverlay` calls; `createPlacementMap(map, colors)` + `reinstall(colors)` (Task 9) match Task 10's create/reinstall; `resolveTheme` normalizes `resolvedTheme` to `"light"|"dark"` everywhere. Token names in `palette.ts` ↔ `globals.css` ↔ `@theme inline` are locked by the Task 1 mirror test. **Cross-task build note:** Task 9 alone leaves the build red (call-site arity) — Tasks 9+10 commit together (called out in both tasks).

**Ordering safety:** token layer (1) precedes the re-tone (3) that uses its utilities; colors/style/layers/pins (5–8) precede MapBrowser (10) that consumes them; dark pins (4) exist before the map requests `-dark` names; the deploy gate (11) is safe because Plan 1 already published `style.dark.json`; a11y (12) tunes values the earlier tasks left as *(proposed)*.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-07-05-dark-mode-2-web.md`. Per `claude_help/codex-review-process.md`, this plan must pass a **Codex plan-review loop to `VERDICT: APPROVED`** before implementation — instruct Codex to be critical (security/correctness/best-practices/project-standards), point it at `CLAUDE.md`, `claude_help/`, `docs/design/`, the spec, and **explicitly flag the §3.2-vs-§4.4 spec defect + the owner's FULL RE-TONE decision** (Global Constraints). Address every finding, re-review on the same conversation, loop until APPROVED. Then branch fresh from `main`, implement task-by-task, and open the PR (CI green + Codex PR-review APPROVED + every PR comment addressed → squash-merge).

**Two execution options after plan approval:**
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Note the Task 9+10 pairing (they land in one green commit).
2. **Inline Execution** — batch with checkpoints (superpowers:executing-plans).
