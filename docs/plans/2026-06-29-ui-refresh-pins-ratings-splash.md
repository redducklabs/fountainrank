# UI Refresh: Unrated Pins, Ratings/Detail Redesign, Mobile Splash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unrated fountains visually distinct (muted slate-blue pin) on web + mobile, redesign the read-only fountain detail into a graphical hero + star/meter rows + attribute chips on web + mobile, and fix the mobile splash so it shows the pin on white (no black box).

**Architecture:** Three independent PRs off `main` branch `feat/ui-refresh-pins-ratings-splash` (already created; spec already committed on it). Each PR is independently testable and merges via CI-green + Codex `VERDICT: APPROVED` + every comment addressed → squash-merge. Pure helpers (`basePinIcon`, `starFills`, `attributeChipVariant`) carry the unit tests; web uses `@testing-library/react`; mobile has no RN render-test harness so mobile components are verified by type-check/lint + on-device (project norm).

**Tech Stack:** Next.js + MapLibre GL JS (web), Expo/React Native + maplibre-react-native (mobile), Vitest (both), Python+Pillow 11.3.0 for asset generation (verified available), brand palette per `docs/style-guide.md`.

**Spec:** `docs/specs/2026-06-29-ui-refresh-pins-ratings-splash-design.md`. **Leaderboard (spec Item 4) is already filed as issue #117 and is NOT in this plan.**

## Global Constraints

- Brand palette (verbatim): Navy `#0A357E`, Royal blue `#0E4DA4`, Crown gold `#F2C200`, Water cyan `#5FC5F0`. Empty-star slate `#CBD5E1`. Mixed-tone amber text `#92400E` (mobile) / Tailwind `amber-700` (web). Mobile tokens live in `mobile/theme.ts` (`colors`, `spacing`, `typography`).
- `GOLD_THRESHOLD = 4` (do not change). "Unrated" = working fountain with `ranking_score == null`.
- No AI attribution in commits/PRs. Conventional Commits. Squash-merge only. No time estimates anywhere.
- No new runtime dependencies. Mobile already has `@expo/vector-icons` if richer icons are wanted; this plan uses Unicode glyphs (dependency-free, consistent across platforms).
- Windows host: use **backslash paths** with Read/Write/Edit; the Bash tool is Git Bash (forward slashes, `python` works).
- Local checks mirror CI before each PR: web `pnpm --filter web lint && pnpm --filter web test && pnpm --filter web build`; mobile `pnpm --filter mobile typecheck && pnpm --filter mobile lint && pnpm --filter mobile test`. (Confirm exact script names from each `package.json`; `test` is `vitest run` on both.)
- Mobile UI changes are verified on the Android emulator (per memory: run from `mobile/`, restart Metro per native/asset change). Asset PNGs are reviewed visually before commit.

---

# PR A — Mobile splash: pin on white (mobile only)

**Files:**
- Create: `scripts\assets\gen_splash_icon.py`
- Modify (regenerate): `mobile\assets\splash-icon.png`
- Reference (unchanged): `mobile\app.config.ts` (splash `backgroundColor` is already `#ffffff`), `mobile\assets\icon.png` (clean transparent pin — the source art)

**Root cause (verified):** `mobile/assets/splash-icon.png` is a baked **white box** (pin inside a smaller white square) on a transparent 1024×1024 canvas. On the Android-12 masked splash, the transparent region renders black → "pin in a white box on a black rounded square." `icon.png` and `adaptive-icon.png` are already clean transparent pins and are left unchanged.

### Task A1: Regenerate `splash-icon.png` as pin-on-opaque-white

**Interfaces:**
- Produces: a 1024×1024 **opaque** (no alpha) `mobile/assets/splash-icon.png` — the pin from `icon.png`, trimmed, scaled into a safe box, centered on solid white. With splash `backgroundColor:#ffffff`, the white icon background is invisible against the white screen → "just the pin."

- [ ] **Step 1: Write the generation script**

Create `scripts\assets\gen_splash_icon.py`:

```python
"""Regenerate mobile/assets/splash-icon.png as the pin on opaque white.

The old asset baked a white box on a transparent canvas; the transparent area
rendered black on the Android-12 masked splash. An opaque-white canvas (no
alpha) removes the black entirely, and on the white splash background it reads
as the pin alone. Run from repo root: `python scripts/assets/gen_splash_icon.py`
"""

from PIL import Image

SRC = "mobile/assets/icon.png"  # clean transparent pin, 1024x1024
OUT = "mobile/assets/splash-icon.png"
CANVAS = 1024
SAFE_BOX = 620  # keeps the pin inside the Android-12 circular splash mask

pin = Image.open(SRC).convert("RGBA")
pin = pin.crop(pin.getbbox())  # trim transparent margins
scale = SAFE_BOX / max(pin.size)
pin = pin.resize((round(pin.width * scale), round(pin.height * scale)), Image.LANCZOS)

canvas = Image.new("RGB", (CANVAS, CANVAS), (255, 255, 255))  # opaque white, no alpha
x = (CANVAS - pin.width) // 2
y = (CANVAS - pin.height) // 2
canvas.paste(pin, (x, y), pin)  # use the pin's alpha as the paste mask
canvas.save(OUT)
print(f"wrote {OUT} ({canvas.size[0]}x{canvas.size[1]}, mode={canvas.mode})")
```

- [ ] **Step 2: Run it**

Run: `python scripts/assets/gen_splash_icon.py`
Expected: `wrote mobile/assets/splash-icon.png (1024x1024, mode=RGB)`

- [ ] **Step 3: Verify the asset visually**

Open `mobile\assets\splash-icon.png` with the Read tool. Expected: the pin centered on solid white, **no inner box**, **no transparency** (no black). If the pin looks too large/small, adjust `SAFE_BOX` and re-run.

- [ ] **Step 4: On-device verification (the gate for this PR)**

From `mobile\`, rebuild and launch on the Android emulator (clean reinstall so the new splash asset is bundled — see memory `fountainrank-mobile-clean-reinstall-before-eas-prebuild` / `fountainrank-local-android-build-windows`). Expected: the splash shows the pin on a white background — no black border, no inner white box. Note the result explicitly (do not claim success without seeing it).

- [ ] **Step 5: Commit**

```bash
git add scripts/assets/gen_splash_icon.py mobile/assets/splash-icon.png
git commit -m "fix(mobile): splash shows the pin on white, not a boxed logo on black"
```

- [ ] **Step 6: Open PR A, drive to green + Codex APPROVED**

```bash
git push -u origin feat/ui-refresh-pins-ratings-splash
gh pr create --title "fix(mobile): splash pin on white" --body "Regenerates splash-icon.png as the pin on opaque white (removes the baked white box / black surround). Spec: docs/specs/2026-06-29-ui-refresh-pins-ratings-splash-design.md (Item 1)."
```
Then run the Codex review loop (see `claude_help/codex-review-process.md`), address every finding and PR comment, and squash-merge once CI is green AND Codex returns `VERDICT: APPROVED`.

> **Note (out of scope, flag to owner):** `mobile/assets/icon.png` is a *transparent* pin; iOS flattens icon transparency to black, so the iOS **app icon** may show the pin on black. Not requested here (only the splash). Recommend a follow-up issue to regenerate `icon.png` on opaque white. Do **not** change it in this PR.

---

# PR B — Unrated pin variant (web + mobile)

**Files:**
- Create: `scripts\assets\gen_unrated_pin.py`, `web\public\pins\pin-unrated.png`, `mobile\assets\pins\pin-unrated.png`
- Modify: `web\lib\map\pins.ts`, `web\lib\map\style.ts`, `web\lib\map\layers.ts`, `mobile\lib\map\pins.ts`, `mobile\components\map\FountainMap.tsx`
- Test: `web\lib\map\pins.test.ts`, `web\lib\map\layers.test.ts`, `mobile\lib\map\pins.test.ts`

### Task B1: Generate `pin-unrated.png` (both platforms)

**Interfaces:**
- Produces: a 77×94 RGBA `pin-unrated.png` (identical bytes for web + mobile), the existing pin silhouette recolored to a muted slate-blue duotone with a greyed crown (luminance mapped onto a slate ramp; original alpha preserved).

- [ ] **Step 1: Write the generation script**

Create `scripts\assets\gen_unrated_pin.py`:

```python
"""Generate pin-unrated.png from pin-standard.png: a muted slate-blue duotone.

Desaturates the pin (so the gold crown becomes grey) and maps luminance onto a
slate-blue ramp, preserving the original alpha (the pin silhouette). Output is
written to both web and mobile (the two pin-standard.png are identical 77x94).
Run from repo root: `python scripts/assets/gen_unrated_pin.py`
"""

from PIL import Image

SRC = "web/public/pins/pin-standard.png"
OUTS = ["web/public/pins/pin-unrated.png", "mobile/assets/pins/pin-unrated.png"]
DARK = (47, 63, 90)     # #2F3F5A — slate shadow
LIGHT = (176, 190, 210)  # #B0BED2 — light slate (crown/highlights become grey-blue)

src = Image.open(SRC).convert("RGBA")
r, g, b, a = src.split()
gray = Image.merge("RGB", (r, g, b)).convert("L")  # luminance → desaturates the crown

def ramp(c0, c1):
    return [round(c0 + (c1 - c0) * i / 255) for i in range(256)]

duo = Image.merge("RGB", (
    gray.point(ramp(DARK[0], LIGHT[0])),
    gray.point(ramp(DARK[1], LIGHT[1])),
    gray.point(ramp(DARK[2], LIGHT[2])),
))
out = Image.merge("RGBA", (*duo.split(), a))  # keep original alpha
for path in OUTS:
    out.save(path)
    print(f"wrote {path} ({out.size[0]}x{out.size[1]})")
```

- [ ] **Step 2: Run it**

Run: `python scripts/assets/gen_unrated_pin.py`
Expected: two `wrote ... (77x94)` lines.

- [ ] **Step 3: Verify the asset visually**

Open both PNGs with the Read tool. Expected: a desaturated slate-blue pin with a **grey** (not gold) crown, clearly muted vs. `pin-standard.png`. If the crown still reads gold or the body is too dark/light, tune `DARK`/`LIGHT` and re-run.

- [ ] **Step 4: Commit the asset + script**

```bash
git add scripts/assets/gen_unrated_pin.py web/public/pins/pin-unrated.png mobile/assets/pins/pin-unrated.png
git commit -m "feat(map): add muted slate-blue pin-unrated asset (web + mobile)"
```

### Task B2: Web — `basePinIcon` unrated branch + register + exclude from selected swap

**Interfaces:**
- Consumes: `pin-unrated` asset, `GOLD_THRESHOLD`.
- Produces: `basePinIcon(p)` returns `"pin-unrated"` for working `ranking_score == null`; `selectedSwapIcon(p)` returns `null` for unrated; `SELECTED_ICON_EXPR` does not swap unrated; `PIN_ASSETS` includes `pin-unrated`.

- [ ] **Step 1: Update web pin tests (write failing)**

In `web\lib\map\pins.test.ts`, add to the existing `basePinIcon` describe block and `selectedSwapIcon` describe block:

```ts
it("working + null score -> pin-unrated", () =>
  expect(basePinIcon({ is_working: true, ranking_score: null })).toBe("pin-unrated"));
it("working + rated low score -> pin-standard", () =>
  expect(basePinIcon({ is_working: true, ranking_score: 3.2 })).toBe("pin-standard"));
it("broken + null score -> pin-broken (broken wins)", () =>
  expect(basePinIcon({ is_working: false, ranking_score: null })).toBe("pin-broken"));

it("unrated -> null (halo only, not the rated selected art)", () =>
  expect(selectedSwapIcon(mk(true, null))).toBeNull());
```
(`mk` is the existing helper at the top of the file; confirm its signature accepts a `null` score — it builds `{ is_working, ranking_score }`. If it's typed `number`, widen its param to `number | null`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web test -- pins`
Expected: FAIL — `basePinIcon` returns `"pin-standard"` for null score; `selectedSwapIcon` returns `"pin-selected"` for unrated.

- [ ] **Step 3: Implement in `web\lib\map\pins.ts`**

Widen the return type and add the unrated branch; exclude unrated from the selected swap:

```ts
export function basePinIcon(
  p: PinLike,
): "pin-broken" | "pin-gold" | "pin-unrated" | "pin-standard" {
  if (!p.is_working) return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  if (p.ranking_score == null) return "pin-unrated";
  return "pin-standard";
}
export function selectedSwapIcon(p: PinLike): "pin-selected" | null {
  // Only rated, working, non-gold pins swap to the "selected" art. Unrated keeps
  // its muted icon (halo still applies via selected-halo layer).
  return p.is_working && p.ranking_score != null && p.ranking_score <= GOLD_THRESHOLD
    ? "pin-selected"
    : null;
}
```

- [ ] **Step 4: Register the asset in `web\lib\map\style.ts`**

```ts
export const PIN_ASSETS: Record<
  "pin-standard" | "pin-selected" | "pin-gold" | "pin-broken" | "pin-unrated",
  string
> = {
  "pin-standard": "/pins/pin-standard.png",
  "pin-selected": "/pins/pin-selected.png",
  "pin-gold": "/pins/pin-gold.png",
  "pin-broken": "/pins/pin-broken.png",
  "pin-unrated": "/pins/pin-unrated.png",
};
```
(`MapBrowser.tsx` loads every `PIN_ASSETS` entry via `Object.entries` — no further wiring needed.)

- [ ] **Step 5: Update `SELECTED_ICON_EXPR` in `web\lib\map\layers.ts`**

Require a real (non-null) score so unrated is not swapped. The current expr coalesces a missing score to `-1`; add a lower bound `>= 0`:

```ts
// Mirrors selectedSwapIcon: working & RATED & not-gold -> pin-selected, else the base icon.
export const SELECTED_ICON_EXPR = [
  "case",
  [
    "all",
    ["get", "is_working"],
    [">=", ["coalesce", ["get", "ranking_score"], -1], 0],
    ["<=", ["coalesce", ["get", "ranking_score"], -1], GOLD_THRESHOLD],
  ],
  "pin-selected",
  ["get", "icon"],
] as const;
```

- [ ] **Step 6: Update the layers behavioral test (write expectation)**

In `web\lib\map\layers.test.ts` (the `SELECTED_ICON_EXPR behavioral matrix` block), add a case asserting an unrated feature resolves to its base icon, not `pin-selected`:

```ts
it("unrated (null score) -> base icon, not pin-selected", () => {
  // evaluate(...) is the helper the existing matrix uses to run the parsed expr
  // against a feature's properties; mirror its existing call shape.
  expect(
    evaluate({ is_working: true, ranking_score: null, icon: "pin-unrated" }),
  ).toBe("pin-unrated");
});
```
(Match the existing test's evaluation helper name/shape; the block already parses `SELECTED_ICON_EXPR` via `createExpression`.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter web test -- pins layers`
Expected: PASS (all new + existing cases).

- [ ] **Step 8: Build + visual check**

Run: `pnpm --filter web build` → expect success. Then run the web app and confirm in the browser that a fountain with no ratings shows the muted slate-blue pin, rated/gold/broken pins are unchanged, and selecting an unrated pin shows the halo without recoloring to the rated "selected" pin.

- [ ] **Step 9: Commit**

```bash
git add web/lib/map/pins.ts web/lib/map/style.ts web/lib/map/layers.ts web/lib/map/pins.test.ts web/lib/map/layers.test.ts
git commit -m "feat(web/map): render unrated fountains with the muted pin-unrated icon"
```

### Task B3: Mobile — `basePinIcon` unrated branch + register

**Interfaces:**
- Consumes: `pin-unrated` asset, `GOLD_THRESHOLD`.
- Produces: mobile `basePinIcon` returns `"pin-unrated"` for working `ranking_score == null`; `PIN_IMAGES` includes `pin-unrated`. (Mobile has no selected-pin layer — nothing else to change.)

- [ ] **Step 1: Update mobile pin test (write failing)**

In `mobile\lib\map\pins.test.ts`, add:

```ts
it("working + null score -> pin-unrated", () =>
  expect(basePinIcon({ is_working: true, ranking_score: null })).toBe("pin-unrated"));
it("working + rated low score -> pin-standard", () =>
  expect(basePinIcon({ is_working: true, ranking_score: 3.2 })).toBe("pin-standard"));
it("not_working status + null score -> pin-broken (broken wins)", () =>
  expect(basePinIcon({ is_working: true, current_status: "not_working", ranking_score: null })).toBe("pin-broken"));
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter mobile test -- pins`
Expected: FAIL — returns `pin-standard` for null score.

- [ ] **Step 3: Implement in `mobile\lib\map\pins.ts`**

```ts
export function basePinIcon(
  p: PinLike,
): "pin-broken" | "pin-gold" | "pin-unrated" | "pin-standard" {
  if (!p.is_working || p.current_status === "not_working") return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  if (p.ranking_score == null) return "pin-unrated";
  return "pin-standard";
}
```

- [ ] **Step 4: Register the asset in `mobile\components\map\FountainMap.tsx`**

```ts
const PIN_IMAGES = {
  "pin-standard": require("../../assets/pins/pin-standard.png"),
  "pin-gold": require("../../assets/pins/pin-gold.png"),
  "pin-broken": require("../../assets/pins/pin-broken.png"),
  "pin-unrated": require("../../assets/pins/pin-unrated.png"),
};
```

- [ ] **Step 5: Run tests + type-check + lint**

Run: `pnpm --filter mobile test -- pins` → PASS.
Run: `pnpm --filter mobile typecheck && pnpm --filter mobile lint` → clean.

- [ ] **Step 6: On-device verification**

From `mobile\`, launch on the emulator at a zoom showing an unrated fountain. Expected: muted slate-blue pin for unrated; standard/gold/broken unchanged; no missing-image warning in Metro logs. Record the observed result.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/map/pins.ts mobile/components/map/FountainMap.tsx mobile/lib/map/pins.test.ts
git commit -m "feat(mobile/map): render unrated fountains with the muted pin-unrated icon"
```

- [ ] **Step 8: Open PR B, drive to green + Codex APPROVED, squash-merge.**

(If PR A is still open on the same branch, sequence the PRs: merge A first, or use separate branches per PR off `main`. Recommended: one branch per PR — create `feat/unrated-pin` off `main` for B, cherry-pick/move the B commits, so each PR is independently reviewable. Decide at execution time based on whether A has merged.)

---

# PR C — Read-only ratings + detail redesign (web + mobile)

**Files:**
- Web — Create: `web\components\fountain\Stars.tsx`, `web\components\fountain\Stars.test.tsx`, `web\components\fountain\AttributeChips.tsx`. Modify: `web\lib\map\format.ts`, `web\lib\map\format.test.ts`, `web\components\fountain\FountainDetail.tsx`, `web\components\fountain\FountainDetail.test.tsx`, `web\components\fountain\AttributeList.tsx`, `web\components\fountain\AttributeList.test.tsx`.
- Mobile — Create: `mobile\components\fountain\Stars.tsx`. Modify: `mobile\lib\map\format.ts`, `mobile\lib\map\format.test.ts`, `mobile\components\fountain\FountainDetail.tsx`, `mobile\components\fountain\AttributeList.tsx`.
- Docs — Modify: `docs\style-guide.md`.

### Task C1: Web — `starFills` + `attributeChipVariant` helpers (pure, TDD)

**Interfaces:**
- Produces: `starFills(value: number): ("full"|"half"|"empty")[]` (length 5; clamps 0–5; rounds to nearest 0.5). `attributeChipVariant(d: {text: string; tone: AttrTone}): ChipVariant` where `ChipVariant = "positive"|"negative"|"unknown"|"mixed"|"neutral"`.

- [ ] **Step 1: Write failing tests** in `web\lib\map\format.test.ts`:

```ts
import { starFills, attributeChipVariant } from "./format";

describe("starFills", () => {
  it("3.5 -> three full, one half, one empty", () =>
    expect(starFills(3.5)).toEqual(["full", "full", "full", "half", "empty"]));
  it("4 -> four full, one empty", () =>
    expect(starFills(4)).toEqual(["full", "full", "full", "full", "empty"]));
  it("3.2 rounds down to 3.0", () =>
    expect(starFills(3.2)).toEqual(["full", "full", "full", "empty", "empty"]));
  it("3.4 rounds up to 3.5 (half)", () => expect(starFills(3.4)[3]).toBe("half"));
  it("clamps 0 and 5+", () => {
    expect(starFills(0)).toEqual(Array(5).fill("empty"));
    expect(starFills(7)).toEqual(Array(5).fill("full"));
  });
});

describe("attributeChipVariant", () => {
  it("Yes -> positive", () => expect(attributeChipVariant({ text: "Yes", tone: "normal" })).toBe("positive"));
  it("low-confidence Yes is still positive", () =>
    expect(attributeChipVariant({ text: "Yes", tone: "muted" })).toBe("positive"));
  it("No -> negative", () => expect(attributeChipVariant({ text: "No", tone: "normal" })).toBe("negative"));
  it("Unknown -> unknown", () => expect(attributeChipVariant({ text: "Unknown", tone: "muted" })).toBe("unknown"));
  it("Mixed tone -> mixed", () => expect(attributeChipVariant({ text: "Mixed", tone: "mixed" })).toBe("mixed"));
  it("specific value -> neutral", () => expect(attributeChipVariant({ text: "Park", tone: "normal" })).toBe("neutral"));
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter web test -- format`
Expected: FAIL — `starFills`/`attributeChipVariant` not exported.

- [ ] **Step 3: Implement in `web\lib\map\format.ts`** (append near the existing `AttrTone`/`attributeDisplay` definitions):

```ts
export type StarFill = "full" | "half" | "empty";
export function starFills(value: number): StarFill[] {
  const v = Math.max(0, Math.min(5, Math.round(value * 2) / 2));
  return Array.from({ length: 5 }, (_, i) => {
    const slot = i + 1;
    if (v >= slot) return "full";
    if (v >= slot - 0.5) return "half";
    return "empty";
  });
}

export type ChipVariant = "positive" | "negative" | "unknown" | "mixed" | "neutral";
export function attributeChipVariant(d: { text: string; tone: AttrTone }): ChipVariant {
  if (d.tone === "mixed") return "mixed";
  if (d.text === "Yes") return "positive";
  if (d.text === "No") return "negative";
  if (d.text === "Unknown") return "unknown";
  return "neutral";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/map/format.ts web/lib/map/format.test.ts
git commit -m "feat(web): add starFills + attributeChipVariant rating-display helpers"
```

### Task C2: Web — read-only `Stars` component (TDD)

**Interfaces:**
- Consumes: `starFills`.
- Produces: `<Stars value={n} size? label? />` — 5 inline SVG stars (gold `#F2C200` full, slate `#CBD5E1` empty, gold/slate split for half), `role="img"` with an accessible label; each star carries `data-fill` for tests.

- [ ] **Step 1: Write failing test** `web\components\fountain\Stars.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Stars } from "./Stars";

describe("Stars", () => {
  it("exposes an accessible rating label", () => {
    render(<Stars value={3.5} />);
    expect(screen.getByRole("img", { name: "Rated 3.5 out of 5" })).toBeInTheDocument();
  });
  it("renders five stars with the correct fills for 3.5", () => {
    const { container } = render(<Stars value={3.5} />);
    const fills = [...container.querySelectorAll("[data-fill]")].map((n) => n.getAttribute("data-fill"));
    expect(fills).toEqual(["full", "full", "full", "half", "empty"]);
  });
  it("supports a custom label", () => {
    render(<Stars value={4} label="Clarity rated 4 out of 5" />);
    expect(screen.getByRole("img", { name: "Clarity rated 4 out of 5" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter web test -- Stars`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web\components\fountain\Stars.tsx`:**

```tsx
import { useId } from "react";
import { starFills, type StarFill } from "../../lib/map/format";

const GOLD = "#F2C200";
const EMPTY = "#CBD5E1";
const STAR_PATH =
  "M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 15l-5.3 2.8 1-5.8L1.5 7.7l5.9-.9z";

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

export function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- Stars`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/fountain/Stars.tsx web/components/fountain/Stars.test.tsx
git commit -m "feat(web): read-only Stars component with half-star + a11y label"
```

### Task C3: Web — `AttributeChips` + redesigned `AttributeList` (TDD)

**Interfaces:**
- Consumes: `attributeDisplay`, `attributeChipVariant`, `formatCategory`.
- Produces: `AttributeList` renders each attribute as a styled chip grouped under FEATURES/ACCESSIBILITY/ACCESS; chip label = attribute `name` (or `"name: value"` for neutral value-attributes), variant glyph + tone styling, optional hint preserved.

- [ ] **Step 1: Update `web\components\fountain\AttributeList.test.tsx` (write failing assertions)**

Read the current test first; keep its fixture(s). Replace the value-text assertions with chip assertions, e.g.:

```tsx
// A "Bottle filler: Yes" attribute renders as a positive chip showing the name.
it("renders a present feature as a chip with its name", () => {
  render(<AttributeList attributes={[attr({ name: "Bottle filler", consensus_value: "yes", confidence: "high" })]} />);
  const chip = screen.getByText("Bottle filler").closest("[data-variant]");
  expect(chip).toHaveAttribute("data-variant", "positive");
});
it("renders a value attribute as a neutral 'name: value' chip", () => {
  render(<AttributeList attributes={[attr({ name: "Venue type", category: "access", consensus_value: "park", confidence: "high" })]} />);
  expect(screen.getByText("Venue type: Park").closest("[data-variant]")).toHaveAttribute("data-variant", "neutral");
});
```
(`attr(...)` = the test's existing fixture builder for `AttributeConsensusOut`; reuse/extend it. Keep any existing grouping/category-header assertions.)

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter web test -- AttributeList`
Expected: FAIL — chips/`data-variant` not present.

- [ ] **Step 3: Implement `web\components\fountain\AttributeChips.tsx`:**

```tsx
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
```

- [ ] **Step 4: Rewrite `web\components\fountain\AttributeList.tsx` to render chips:**

```tsx
import type { components } from "@fountainrank/api-client";
import { attributeDisplay, formatCategory } from "../../lib/map/format";
import { AttributeChip } from "./AttributeChips";

type Attr = components["schemas"]["AttributeConsensusOut"];

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  if (attributes.length === 0) return null;
  const groups: { category: string; items: Attr[] }[] = [];
  for (const a of attributes) {
    let g = groups.find((x) => x.category === a.category);
    if (!g) {
      g = { category: a.category, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.category}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {formatCategory(g.category)}
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {g.items.map((a) => (
              <AttributeChip key={a.attribute_type_id} name={a.name} display={attributeDisplay(a)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter web test -- AttributeList`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/components/fountain/AttributeChips.tsx web/components/fountain/AttributeList.tsx web/components/fountain/AttributeList.test.tsx
git commit -m "feat(web): render fountain attributes as tone-aware chips"
```

### Task C4: Web — `FountainDetail` hero + dimension star/meter rows

**Interfaces:**
- Consumes: `Stars`, `formatAverage`, `formatVotes`. Replaces the plain overall span + the `<dl>` dimension list (currently lines 38–58).

- [ ] **Step 1: Update `web\components\fountain\FountainDetail.test.tsx` (write failing assertions)**

Read the current test. Update the rating-section assertions to the new structure (the numbers remain; stars are added):

```tsx
// Overall hero: number still shows, plus an accessible star row.
it("shows the overall score number and a star row", () => {
  render(<FountainDetail detail={detailFixture({ average_rating: 3.5, rating_count: 1 })} {...rest} />);
  expect(screen.getByText("3.5")).toBeInTheDocument();
  expect(screen.getByText("1 rating")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Rated 3.5 out of 5" })).toBeInTheDocument();
});
// Per dimension: name + numeric value retained.
it("shows each dimension name with its numeric value", () => {
  render(<FountainDetail detail={detailFixture({ dimensions: [{ rating_type_id: 1, name: "Clarity", average_rating: 4, vote_count: 1 }] })} {...rest} />);
  expect(screen.getByText("Clarity")).toBeInTheDocument();
  expect(screen.getByText("4.0")).toBeInTheDocument();
});
// Unrated overall: friendly empty state, no fabricated number.
it("shows a not-yet-rated state when unrated", () => {
  render(<FountainDetail detail={detailFixture({ average_rating: null, rating_count: 0 })} {...rest} />);
  expect(screen.getByText("Not yet rated")).toBeInTheDocument();
});
```
(`detailFixture`/`rest` = the test's existing fixture + required props; reuse them.)

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter web test -- FountainDetail`
Expected: FAIL — no star `img` role; dimension number format changed.

- [ ] **Step 3: Implement — replace lines 38–58 of `web\components\fountain\FountainDetail.tsx`**

Add the import: `import { Stars } from "./Stars";` and change `import { formatAverage, formatDate, formatDimension, formatVotes } ...` to drop `formatDimension` (no longer used) — keep `formatAverage`, `formatDate`, `formatVotes`. Replace the overall span + `<dl>`:

```tsx
{detail.average_rating != null ? (
  <div className="flex items-center gap-3">
    <span className="text-3xl font-extrabold leading-none text-[#0A357E]">
      {formatAverage(detail.average_rating)}
    </span>
    <div className="flex flex-col">
      <Stars value={detail.average_rating} size={18} />
      <span className="text-xs text-slate-500">{formatVotes(detail.rating_count)}</span>
    </div>
  </div>
) : (
  <div className="flex items-center gap-2">
    <Stars value={0} size={18} label="Not yet rated" />
    <span className="text-sm font-medium text-slate-500">Not yet rated</span>
  </div>
)}
<dl className="space-y-2 border-t border-slate-100 pt-3">
  {detail.dimensions.map((d) => (
    <div key={d.rating_type_id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <dt className="text-sm font-medium text-slate-700">{d.name}</dt>
      <dd className="flex items-center gap-2 text-sm">
        {d.average_rating != null ? (
          <>
            <Stars value={d.average_rating} size={14} label={`${d.name} rated ${d.average_rating.toFixed(1)} out of 5`} />
            <span className="tabular-nums font-semibold text-[#0A357E]">{d.average_rating.toFixed(1)}</span>
            <span className="text-xs text-slate-400">({d.vote_count})</span>
          </>
        ) : (
          <span className="text-xs text-slate-400">Not yet rated</span>
        )}
      </dd>
      {d.average_rating != null && (
        <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-[#0E4DA4]" style={{ width: `${(Math.max(0, Math.min(5, d.average_rating)) / 5) * 100}%` }} />
        </div>
      )}
    </div>
  ))}
</dl>
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm --filter web test -- FountainDetail` → PASS.
Run: `pnpm --filter web lint && pnpm --filter web build` → clean. Fix any unused-import lint error from dropping `formatDimension`.

- [ ] **Step 5: Visual check** (browser): open a rated fountain (hero number + stars + per-dimension stars/number/meter), an unrated fountain (Not yet rated state), and confirm attribute chips render.

- [ ] **Step 6: Commit**

```bash
git add web/components/fountain/FountainDetail.tsx web/components/fountain/FountainDetail.test.tsx
git commit -m "feat(web): graphical hero + star/meter dimension rows on fountain detail"
```

### Task C5: Mobile — `starFills` + `attributeChipVariant` helpers (pure, TDD)

**Interfaces:** identical signatures to Task C1, in `mobile\lib\map\format.ts`.

- [ ] **Step 1: Write failing tests** in `mobile\lib\map\format.test.ts` — same cases as Task C1 Step 1 (import from `./format`).

- [ ] **Step 2: Run to verify fail:** `pnpm --filter mobile test -- format` → FAIL.

- [ ] **Step 3: Implement** — append the **exact same** `StarFill`/`starFills`/`ChipVariant`/`attributeChipVariant` definitions from Task C1 Step 3 into `mobile\lib\map\format.ts` (the two `format.ts` files already duplicate their other helpers — follow that established pattern; do not introduce a shared package).

- [ ] **Step 4: Run to verify pass:** `pnpm --filter mobile test -- format` → PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/map/format.ts mobile/lib/map/format.test.ts
git commit -m "feat(mobile): add starFills + attributeChipVariant rating-display helpers"
```

### Task C6: Mobile — read-only `Stars` component (RN, on-device verified)

**Interfaces:**
- Produces: `<Stars value={n} size? label? />` — a fractional gold overlay over a slate base row of 5 ★ glyphs (no new dependency; no RN render test harness, so verified on-device). Fill % uses the same nearest-0.5 rounding as `starFills` so it matches web.

- [ ] **Step 1: Implement `mobile\components\fountain\Stars.tsx`:**

```tsx
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";

const EMPTY = "#CBD5E1";
const FIVE = "★★★★★";

export function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(5, Math.round(value * 2) / 2)); // match web's starFills rounding
  const pct = (v / 5) * 100;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? `Rated ${v.toFixed(1)} out of 5`}
      style={styles.wrap}
    >
      <Text style={[styles.row, { fontSize: size, color: EMPTY }]}>{FIVE}</Text>
      <View style={[styles.overlay, { width: `${pct}%` }]} pointerEvents="none">
        <Text style={[styles.row, { fontSize: size, color: colors.brandYellow }]}>{FIVE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", alignSelf: "flex-start" },
  row: { letterSpacing: 1 },
  overlay: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" },
});
```

- [ ] **Step 2: Type-check + lint**

Run: `pnpm --filter mobile typecheck && pnpm --filter mobile lint` → clean.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/fountain/Stars.tsx
git commit -m "feat(mobile): read-only Stars component with fractional gold overlay"
```

### Task C7: Mobile — `FountainDetail` hero + dimension rows + attribute chips (RN, on-device verified)

**Interfaces:** consumes mobile `Stars`, `attributeDisplay`, `attributeChipVariant`, `formatAverage`, `formatVotes`, `formatCategory`, `groupAttributes`.

- [ ] **Step 1: Rewrite `mobile\components\fountain\AttributeList.tsx` to render chips**

```tsx
import type { components } from "@fountainrank/api-client";
import { StyleSheet, Text, View } from "react-native";

import { groupAttributes } from "../../lib/detail/attributes";
import { attributeDisplay, attributeChipVariant, type ChipVariant, formatCategory } from "../../lib/map/format";
import { colors, spacing, typography } from "../../theme";

type Attr = components["schemas"]["AttributeConsensusOut"];

const CHIP_BG: Record<ChipVariant, string> = {
  positive: "#E7F0FF",
  neutral: "#E7F0FF",
  negative: "#F1F5F9",
  unknown: "#F1F5F9",
  mixed: "#FEF3C7",
};
const CHIP_FG: Record<ChipVariant, string> = {
  positive: colors.brandBlue,
  neutral: colors.brandBlue,
  negative: colors.textMuted,
  unknown: colors.textMuted,
  mixed: "#92400E",
};
const GLYPH: Record<ChipVariant, string> = { positive: "✓", neutral: "•", negative: "✕", unknown: "?", mixed: "~" };

export function AttributeList({ attributes }: { attributes: Attr[] }) {
  const groups = groupAttributes(attributes);
  if (groups.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {groups.map((g) => (
        <View key={g.category} style={styles.group}>
          <Text style={styles.header}>{formatCategory(g.category).toUpperCase()}</Text>
          <View style={styles.chips}>
            {g.items.map((a) => {
              const d = attributeDisplay(a);
              const variant = attributeChipVariant(d);
              const label = variant === "neutral" ? `${a.name}: ${d.text}` : a.name;
              return (
                <View key={a.attribute_type_id} style={[styles.chip, { backgroundColor: CHIP_BG[variant] }]}>
                  <Text style={[styles.chipText, { color: CHIP_FG[variant] }]}>{`${GLYPH[variant]} ${label}`}</Text>
                  {d.hint ? <Text style={styles.chipHint}>{d.hint}</Text> : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  group: { gap: spacing.xs },
  header: { ...typography.meta, color: colors.textMuted, fontWeight: "600", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { ...typography.meta, fontWeight: "600" },
  chipHint: { ...typography.meta, color: colors.textMuted, fontSize: 10 },
});
```

- [ ] **Step 2: Update the rating section of `mobile\components\fountain\FountainDetail.tsx`**

Add `import { Stars } from "./Stars";`. Drop `formatDimension` from the format import (keep `formatAverage`, `formatDate`, `formatVotes`). Replace the `ratingRow` block (lines ~52–57) and the `dimensions` block (lines ~59–70):

```tsx
{detail.average_rating != null ? (
  <View style={styles.heroRow}>
    <Text style={styles.average}>{formatAverage(detail.average_rating)}</Text>
    <View style={styles.heroStars}>
      <Stars value={detail.average_rating} size={20} />
      <Text style={styles.votes}>{formatVotes(detail.rating_count)}</Text>
    </View>
  </View>
) : (
  <View style={styles.heroRow}>
    <Stars value={0} size={20} label="Not yet rated" />
    <Text style={styles.notRated}>Not yet rated</Text>
  </View>
)}

{detail.dimensions.length > 0 ? (
  <View style={styles.dimensions}>
    {detail.dimensions.map((d) => (
      <View key={d.rating_type_id} style={styles.dimensionRow}>
        <View style={styles.dimensionTop}>
          <Text style={styles.dimensionName}>{d.name}</Text>
          {d.average_rating != null ? (
            <View style={styles.dimensionScore}>
              <Stars value={d.average_rating} size={14} label={`${d.name} rated ${d.average_rating.toFixed(1)} out of 5`} />
              <Text style={styles.dimensionValue}>{`${d.average_rating.toFixed(1)} (${d.vote_count})`}</Text>
            </View>
          ) : (
            <Text style={styles.dimensionMuted}>Not yet rated</Text>
          )}
        </View>
        {d.average_rating != null ? (
          <View style={styles.meterTrack}>
            <View style={[styles.meterFill, { width: `${(Math.max(0, Math.min(5, d.average_rating)) / 5) * 100}%` }]} />
          </View>
        ) : null}
      </View>
    ))}
  </View>
) : null}
```

- [ ] **Step 3: Update the `StyleSheet` in `mobile\components\fountain\FountainDetail.tsx`**

Replace the `ratingRow`/`average`/`votes`/`dimensions`/`dimensionRow`/`dimensionName`/`dimensionValue` entries with:

```tsx
heroRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
average: { fontSize: 34, fontWeight: "800", color: colors.brandBlue, lineHeight: 36 },
heroStars: { gap: 2 },
votes: { ...typography.meta, color: colors.textMuted },
notRated: { ...typography.body, fontWeight: "600", color: colors.textMuted },
dimensions: { gap: spacing.sm, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm },
dimensionRow: { gap: spacing.xs },
dimensionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
dimensionName: { ...typography.body, fontWeight: "600", color: colors.text },
dimensionScore: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
dimensionValue: { ...typography.meta, fontWeight: "700", color: colors.brandBlue },
dimensionMuted: { ...typography.meta, color: colors.textMuted },
meterTrack: { height: 6, borderRadius: 999, backgroundColor: colors.border, overflow: "hidden" },
meterFill: { height: "100%", borderRadius: 999, backgroundColor: "#0E4DA4" },
```

- [ ] **Step 4: Type-check + lint**

Run: `pnpm --filter mobile typecheck && pnpm --filter mobile lint` → clean (resolve any unused-import error from dropping `formatDimension`).

- [ ] **Step 5: On-device verification (the gate)**

From `mobile\`, launch on the emulator. Open: a rated fountain (hero number + stars + per-dimension stars/number/meter), an unrated fountain (Not yet rated, empty stars, no meter), and a fountain with attributes (chips render with correct tone glyphs, including a "Mixed"/low-confidence hint). Record the observed result.

- [ ] **Step 6: Commit**

```bash
git add mobile/components/fountain/FountainDetail.tsx mobile/components/fountain/AttributeList.tsx
git commit -m "feat(mobile): graphical hero + star/meter rows + attribute chips on fountain detail"
```

### Task C8: Style guide

- [ ] **Step 1: Document the new components in `docs\style-guide.md`**

Add entries (follow the file's existing section style): read-only **Stars** (gold `#F2C200` full / slate `#CBD5E1` empty / half via 50% SVG split on web, fractional gold overlay on mobile; `role="img"` + numeric a11y label; sizes used: 14 dimension / 18–20 hero); the **dimension meter** (royal `#0E4DA4` fill on a slate track, width = score/5, decorative); the **hero rating block** (large score + Stars + vote count, and the "Not yet rated" empty state); and **attribute chips** (variants `positive`/`neutral`/`negative`/`unknown`/`mixed` with their fills/glyphs, and that they preserve the consensus tone + hint). Note the web/mobile half-star rendering difference.

- [ ] **Step 2: Commit**

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): document Stars, dimension meter, hero block, attribute chips"
```

- [ ] **Step 3: Run the full web suite + open PR C**

Run: `pnpm --filter web lint && pnpm --filter web test && pnpm --filter web build` → all green.
Run: `pnpm --filter mobile typecheck && pnpm --filter mobile lint && pnpm --filter mobile test` → all green.
Open PR C, run the Codex review loop, address every finding + PR comment, and squash-merge once CI is green AND Codex returns `VERDICT: APPROVED`.

---

## Self-Review (against the spec)

**Spec coverage:**
- Item 1 (splash, mobile-only) → PR A / Task A1. ✓
- Item 2 (unrated pin, web + mobile) → PR B / Tasks B1–B3 (asset, web logic + selected-swap exclusion, mobile logic). ✓
- Item 3a (read-only Stars) → C2 (web), C6 (mobile). ✓
- Item 3b (hero block) → C4 (web), C7 (mobile). ✓
- Item 3c (dimension rows + meter) → C4 (web), C7 (mobile). ✓
- Item 3d (attribute chips, preserve tone/mixed) → C3 (web), C7 (mobile); variant logic C1/C5. ✓
- Item 3e (style guide) → C8. ✓
- Item 4 (leaderboard) → issue #117, intentionally out of plan. ✓

**Placeholder scan:** Test updates for the three *existing* tests (`FountainDetail.test.tsx`, `AttributeList.test.tsx`) instruct reading the current file and give concrete target assertions/fixtures — because the full current test text wasn't loaded into the plan; this is a deliberate "adapt the existing test" step, not a vague placeholder. All new code is complete.

**Type consistency:** `basePinIcon` return union widened to include `"pin-unrated"` on both platforms (B2/B3). `selectedSwapIcon` + `SELECTED_ICON_EXPR` updated together (B2). `starFills`/`StarFill` and `attributeChipVariant`/`ChipVariant` have identical signatures in web (C1) and mobile (C5) and are consumed consistently by `Stars` (C2/C6) and the chip components (C3/C7). Mobile `Stars` uses the same nearest-0.5 rounding as `starFills` so fills match web. Brand hex values are consistent across all tasks and the Global Constraints.

## Notes / risks

- **Asset quality** (A1, B1): both generation scripts include a "verify visually" step before commit; tune the constants if the result is off.
- **Android-12 splash** (A1): the gate is on-device. If a masked-splash issue persists after the opaque-white asset, the contingency is an Expo splash config option — note it on the PR and consult `expo-splash-screen` docs (via Context7) before changing config.
- **PR sequencing:** the spec/branch already exist on `feat/ui-refresh-pins-ratings-splash`. For three independently-reviewable PRs, create a branch per PR off `main` at execution time (move the relevant commits); if the owner prefers, A+B+C can also ship as one bundled PR (squash-merge keeps history linear) — confirm at execution.
