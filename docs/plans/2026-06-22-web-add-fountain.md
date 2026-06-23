# Web add-fountain flow (slice 6b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an authenticated add-a-fountain flow on the web — an overlay on the home map with tap-to-drop + draggable + keyboard pin placement, a client-side GPS bound (proximity when a fix exists; precision-gated fallback otherwise), working-status capture, 409-duplicate handling, and (PR 2) optional rating / attribute / comment / placement-note capture built dynamically from the live API.

**Architecture:** All logic lives in **pure, unit-tested modules** — geo helpers (`web/lib/map/placement.ts`) and a pure state-machine reducer (`web/lib/add-fountain-machine.ts`) — so the imperative MapLibre glue (which cannot run under jsdom: no WebGL) stays a thin seam, exactly as `MapBrowser` is already handled in this repo. Writes go through a Next.js Server Action (`web/app/actions/add-fountain.ts`) that fetches the Logto token server-side and POSTs the typed client; the token never reaches the browser. The GPS bound is a **client-side UX guard, not a security control** (the public create endpoint receives only the pin location).

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, TypeScript, Tailwind, MapLibre GL JS v5, `@logto/next` 4.2.10, `@fountainrank/api-client` (openapi-typescript + openapi-fetch), Vitest + jsdom.

**Spec:** `docs/specs/2026-06-22-web-add-fountain-design.md` (Codex-approved). Read it before starting; section refs below point into it.

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time.
- **Windows host:** file tools use backslash paths (`D:\repos\fountainrank\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`).
- **Local mirror gates the PR:** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before PR. Mid-loop: `./run.ps1 check -Web`. Per-web-file: `pnpm --filter web exec vitest run <path>`.
- **`"use server"` export rule:** a `"use server"` module may export **only async functions**. Constants/types shared with the client live in a plain module (`web/lib/add-fountain.ts`). This breaks `next build` (not vitest) if violated — so Tasks 6 and 9 MUST run the full `./run.ps1 check -Web` (incl. `next build`), not just vitest.
- **Web lint/format quirks:** eslint forbids duplicate imports (merge named imports into the existing line from a module); Prettier's Tailwind plugin reorders `className` utilities — run `pnpm --filter web exec prettier --write <files>` before committing so `prettier --check` passes.
- **Security invariants (spec §8, §11):** the API access token lives only in `server-only` modules, never serialized to the client or logged; Server Action arguments are **untrusted** and validated server-side as hostile before any API call; the GPS bound is a client guard only; the action logs **only** `requestId`/action/outcome/status — never coordinates, comments, placement notes, rating/observation values, or the token.
- **Backend is unchanged** (`POST /api/v1/fountains`, `GET /api/v1/rating-types`, `GET /api/v1/attribute-types` already live). No DB migration, no openapi/client regeneration, no new env vars; `serverActions.allowedOrigins` already set in 6b-1.
- **Two PRs:** Tasks 1–6 = **PR 1** (one branch off `main`); Tasks 7–9 = **PR 2** (a fresh branch off updated `main` after PR 1 merges). Each PR: full `./run.ps1 check` green → open PR → Codex Loop B + all comments → squash-merge → deploy → verify.
- **Constants (spec §6):** `BOUND_RADIUS_MIN_M = 150`, `ACCURACY_MAX_M = 1000`, `PLACE_MIN_ZOOM = 16`, `FALLBACK_MAX_SPAN_M = 4000`, `NUDGE_STEP_M = 5`.

---

## File Structure

**PR 1 — minimal add:**
- Modify `docs/style-guide.md` — PR-1 elements (Task 1).
- Modify `web/lib/map/constants.ts` — add the placement constants (Task 2).
- Create `web/lib/map/placement.ts` (+ `placement.test.ts`) — pure geo helpers: `boundFromFix`, `clampToBound`, `inBound`, `haversineMeters`, `canPlace` (Task 2).
- Create `web/lib/add-fountain.ts` (+ `add-fountain.test.ts`) — shared types + `isValidAddFountainInput` + `toAddFountainBody` (Task 3).
- Create `web/app/actions/add-fountain.ts` (+ `web/app/actions/add-fountain.test.ts`) — the `addFountain` Server Action (Task 3).
- Create `web/lib/add-fountain-machine.ts` (+ `add-fountain-machine.test.ts`) — pure add-mode reducer (Task 4).
- Create `web/components/map/AddFountainPanel.tsx` (+ test) and `web/components/map/AddFountainFab.tsx` (+ test) — presentational (Task 5).
- Create `web/components/map/useAddFountainMode.ts` — the hook (map glue) (Task 6).
- Modify `web/components/map/MapBrowser.tsx`, `web/components/map/MapBrowserLoader.tsx`, `web/app/page.tsx` (+ `web/app/page.test.tsx`) — thread `isAuthenticated`/`autoEnterAdd`, mount the hook, suppress browse interactions, strip `?add=1` (Task 6).

**PR 2 — optional fields:**
- Modify `docs/style-guide.md` — PR-2 elements (Task 7).
- Create `web/lib/catalog.ts` (+ `catalog.test.ts`) — `buildAttributeGroups` + a session-cached catalog fetch (Task 8).
- Create `web/components/fountain/StarGroup.tsx` (extracted from `RatingForm`) + `web/components/map/RatingFields.tsx` + `web/components/map/AttributeObservationFields.tsx` (+ tests); modify `web/components/fountain/RatingForm.tsx` to reuse `StarGroup`; extend `AddFountainPanel` + `useAddFountainMode` + the `addFountain` action for the optional fields (Task 9).

---

## PR 1 — minimal add (placement + working + 409)

### Task 1: Style-guide entries for PR-1 UI (prerequisite)

**Files:**
- Modify: `docs/style-guide.md`

Per spec §12, document the new elements before building them: the **Add-fountain FAB** (placement, sizing, signed-out vs signed-in behavior, hidden-when-no-WebGL2), the **placement panel / bottom sheet** (steps: placing → details → result; primary action per step; Cancel/Escape), the **bound ring + pin + coordinate readout + out-of-bound note**, the **keyboard placement controls** ("Place at map center" button + N/S/E/W nudge controls + their disabled state below `PLACE_MIN_ZOOM` / over `FALLBACK_MAX_SPAN_M`), the **"We couldn't confirm your location" fallback message**, the **working-status toggle** (Yes/No, default Yes), and the **duplicate-conflict result** (message + "View it" link).

- [ ] **Step 1:** Read `docs/style-guide.md` (match its structure/voice; reuse the palette `#0A357E`, `#F2C200`, slate/emerald/amber/red).
- [ ] **Step 2:** Add the entries above (element name, purpose, structure, states, a11y, example classes).
- [ ] **Step 3:** Commit.

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): add add-fountain FAB, placement panel, keyboard controls, duplicate result (slice 6b-2)"
```

---

### Task 2: Placement constants + pure geo helpers

**Files:**
- Modify: `web/lib/map/constants.ts`
- Create: `web/lib/map/placement.ts`
- Test: `web/lib/map/placement.test.ts`

**Interfaces:**
- Produces:
  - constants `BOUND_RADIUS_MIN_M=150`, `ACCURACY_MAX_M=1000`, `PLACE_MIN_ZOOM=16`, `FALLBACK_MAX_SPAN_M=4000`.
  - `type LngLat = { lng: number; lat: number }`
  - `type ViewportBounds = { west: number; south: number; east: number; north: number }`
  - `type Bound = { kind:"circle"; center:LngLat; radiusM:number } | { kind:"viewport"; bounds:ViewportBounds }`
  - `type GpsFix = { ok:true; lat:number; lng:number; accuracy:number } | { ok:false }`
  - `haversineMeters(a,b): number`, `boundFromFix(fix, viewport): Bound`, `clampToBound(point, bound): LngLat`, `inBound(point, bound): boolean`, `canPlace(zoom, bound): boolean`.

- [ ] **Step 1: Add constants** — append to `web/lib/map/constants.ts`:

```ts
// Add-fountain placement (slice 6b-2, spec §6).
export const BOUND_RADIUS_MIN_M = 150;
export const ACCURACY_MAX_M = 1000;
export const PLACE_MIN_ZOOM = 16;
export const FALLBACK_MAX_SPAN_M = 4000;
```

- [ ] **Step 2: Write the failing test** — `web/lib/map/placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  boundFromFix,
  canPlace,
  clampToBound,
  haversineMeters,
  inBound,
  type Bound,
} from "./placement";

const SEATTLE = { lng: -122.3321, lat: 47.6062 };

describe("haversineMeters", () => {
  it("is ~0 for the same point and grows with distance", () => {
    expect(haversineMeters(SEATTLE, SEATTLE)).toBeCloseTo(0, 5);
    // ~1 degree of latitude ≈ 111 km
    const d = haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("boundFromFix", () => {
  const vp = { west: -122.4, south: 47.5, east: -122.2, north: 47.7 };
  it("returns a circle for a usable fix, radius = max(150, accuracy)", () => {
    expect(boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 30 }, vp)).toEqual({
      kind: "circle",
      center: { lng: -122.3, lat: 47.6 },
      radiusM: 150,
    });
    expect(
      boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 400 }, vp),
    ).toMatchObject({ kind: "circle", radiusM: 400 });
  });
  it("falls back to viewport when no fix or accuracy is too poor", () => {
    expect(boundFromFix({ ok: false }, vp)).toEqual({ kind: "viewport", bounds: vp });
    expect(
      boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 2000 }, vp),
    ).toEqual({ kind: "viewport", bounds: vp });
  });
});

describe("clampToBound", () => {
  it("leaves an in-bound point unchanged (circle)", () => {
    const b: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
    const p = { lng: SEATTLE.lng + 0.0005, lat: SEATTLE.lat };
    expect(clampToBound(p, b)).toEqual(p);
  });
  it("pulls an out-of-bound point onto the ring (circle)", () => {
    const b: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
    const far = { lng: SEATTLE.lng + 0.05, lat: SEATTLE.lat };
    const clamped = clampToBound(far, b);
    expect(haversineMeters(SEATTLE, clamped)).toBeLessThanOrEqual(151);
    expect(inBound(clamped, b)).toBe(true);
  });
  it("clamps into the rectangle (viewport)", () => {
    const b: Bound = {
      kind: "viewport",
      bounds: { west: -122.4, south: 47.5, east: -122.2, north: 47.7 },
    };
    expect(clampToBound({ lng: -123, lat: 48 }, b)).toEqual({ lng: -122.4, lat: 47.7 });
  });
});

describe("canPlace", () => {
  const circle: Bound = { kind: "circle", center: SEATTLE, radiusM: 150 };
  const tightVp: Bound = {
    kind: "viewport",
    bounds: { west: -122.335, south: 47.604, east: -122.329, north: 47.608 },
  };
  const wideVp: Bound = {
    kind: "viewport",
    bounds: { west: -122.5, south: 47.5, east: -122.1, north: 47.7 },
  };
  it("requires zoom >= PLACE_MIN_ZOOM", () => {
    expect(canPlace(15.9, circle)).toBe(false);
    expect(canPlace(16, circle)).toBe(true);
  });
  it("rejects a fallback viewport wider than FALLBACK_MAX_SPAN_M even at high zoom", () => {
    expect(canPlace(17, wideVp)).toBe(false);
    expect(canPlace(17, tightVp)).toBe(true);
  });
});
```

- [ ] **Step 3: Run, verify fail.** `pnpm --filter web exec vitest run lib/map/placement.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `web/lib/map/placement.ts`:

```ts
import {
  ACCURACY_MAX_M,
  BOUND_RADIUS_MIN_M,
  FALLBACK_MAX_SPAN_M,
  PLACE_MIN_ZOOM,
} from "./constants";

export type LngLat = { lng: number; lat: number };
export type ViewportBounds = { west: number; south: number; east: number; north: number };
export type Bound =
  | { kind: "circle"; center: LngLat; radiusM: number }
  | { kind: "viewport"; bounds: ViewportBounds };
export type GpsFix = { ok: true; lat: number; lng: number; accuracy: number } | { ok: false };

const EARTH_R = 6371008.8; // mean Earth radius (m)
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Proximity circle when we have a usable fix; otherwise a viewport (precision-only) bound (spec §6).
export function boundFromFix(fix: GpsFix, viewport: ViewportBounds): Bound {
  if (fix.ok && fix.accuracy <= ACCURACY_MAX_M) {
    return {
      kind: "circle",
      center: { lng: fix.lng, lat: fix.lat },
      radiusM: Math.max(BOUND_RADIUS_MIN_M, fix.accuracy),
    };
  }
  return { kind: "viewport", bounds: viewport };
}

// Pull a candidate point to the bound. Circle: interpolate toward center to the ring edge (a good
// approximation at the small radii used here, ≤ ~1 km). Viewport: clamp lng/lat into the rectangle.
export function clampToBound(point: LngLat, bound: Bound): LngLat {
  if (bound.kind === "circle") {
    const d = haversineMeters(bound.center, point);
    if (d <= bound.radiusM) return point;
    const t = bound.radiusM / d;
    return {
      lng: bound.center.lng + (point.lng - bound.center.lng) * t,
      lat: bound.center.lat + (point.lat - bound.center.lat) * t,
    };
  }
  const { west, south, east, north } = bound.bounds;
  return {
    lng: Math.min(east, Math.max(west, point.lng)),
    lat: Math.min(north, Math.max(south, point.lat)),
  };
}

export function inBound(point: LngLat, bound: Bound): boolean {
  if (bound.kind === "circle") {
    return haversineMeters(bound.center, point) <= bound.radiusM + 0.5;
  }
  const { west, south, east, north } = bound.bounds;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

function viewportDiagonalM(b: ViewportBounds): number {
  return haversineMeters({ lng: b.west, lat: b.north }, { lng: b.east, lat: b.south });
}

// Placement-precision gate (spec §6): both modes require zoom >= PLACE_MIN_ZOOM; the fallback
// viewport additionally caps the visible diagonal at FALLBACK_MAX_SPAN_M (screen-size-independent).
export function canPlace(zoom: number, bound: Bound): boolean {
  if (zoom < PLACE_MIN_ZOOM) return false;
  if (bound.kind === "viewport" && viewportDiagonalM(bound.bounds) > FALLBACK_MAX_SPAN_M) {
    return false;
  }
  return true;
}
```

- [ ] **Step 5: Run, verify pass.** `pnpm --filter web exec vitest run lib/map/placement.test.ts` → PASS.

- [ ] **Step 6: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/lib/map/constants.ts web/lib/map/placement.ts web/lib/map/placement.test.ts
git add web/lib/map/constants.ts web/lib/map/placement.ts web/lib/map/placement.test.ts
git commit -m "feat(web): placement geo helpers + bound/zoom gate (slice 6b-2)"
```

---

### Task 3: Shared add-fountain module + the `addFountain` Server Action

**Files:**
- Create: `web/lib/add-fountain.ts`
- Test: `web/lib/add-fountain.test.ts`
- Create: `web/app/actions/add-fountain.ts`
- Test: `web/app/actions/add-fountain.test.ts`

**Interfaces:**
- Consumes: `getAuthedApiClientForAction` (`web/lib/server/api.ts`), `log` (`web/lib/server/log.ts`), `@fountainrank/api-client` types.
- Produces (plain module `web/lib/add-fountain.ts`):
  - `type AddFountainInput` (mirrors `AddFountainRequest`: `location{latitude,longitude}`, `is_working`, optional `comments`, `placement_note`, `ratings[]`, `observations[]`).
  - `type AddFountainError = "unauthenticated" | "validation" | "server"`.
  - `type AddFountainResult = { ok:true; fountainId:string } | { ok:false; error:"duplicate"; fountainId:string } | { ok:false; error:AddFountainError }`.
  - `isUuid(v): boolean`, `isValidAddFountainInput(input): boolean`, `toAddFountainBody(input): AddFountainRequest`.
- Produces (`"use server"` `web/app/actions/add-fountain.ts`): `addFountain(input: AddFountainInput): Promise<AddFountainResult>`.

- [ ] **Step 1: Write the failing test (shared)** — `web/lib/add-fountain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isUuid,
  isValidAddFountainInput,
  toAddFountainBody,
  type AddFountainInput,
} from "./add-fountain";

const base: AddFountainInput = {
  location: { latitude: 47.6, longitude: -122.3 },
  is_working: true,
};

describe("isUuid", () => {
  it("accepts a UUID, rejects junk", () => {
    expect(isUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("isValidAddFountainInput", () => {
  it("accepts a minimal valid input", () => {
    expect(isValidAddFountainInput(base)).toBe(true);
  });
  it("rejects out-of-range / non-finite coordinates", () => {
    expect(isValidAddFountainInput({ ...base, location: { latitude: 91, longitude: 0 } })).toBe(
      false,
    );
    expect(
      isValidAddFountainInput({ ...base, location: { latitude: 0, longitude: 181 } }),
    ).toBe(false);
    expect(
      isValidAddFountainInput({ ...base, location: { latitude: NaN, longitude: 0 } }),
    ).toBe(false);
  });
  it("rejects a non-boolean is_working", () => {
    expect(isValidAddFountainInput({ ...base, is_working: "yes" as unknown as boolean })).toBe(
      false,
    );
  });
  it("rejects an oversized placement note", () => {
    expect(isValidAddFountainInput({ ...base, placement_note: "x".repeat(201) })).toBe(false);
    expect(isValidAddFountainInput({ ...base, placement_note: "x".repeat(200) })).toBe(true);
  });
  it("rejects bad ratings / observations", () => {
    expect(
      isValidAddFountainInput({ ...base, ratings: [{ rating_type_id: 0, stars: 3 }] }),
    ).toBe(false);
    expect(
      isValidAddFountainInput({ ...base, ratings: [{ rating_type_id: 1, stars: 6 }] }),
    ).toBe(false);
    expect(
      isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: "" }] }),
    ).toBe(false);
    expect(
      isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: "yes" }] }),
    ).toBe(true);
  });
});

describe("toAddFountainBody", () => {
  it("drops empty optionals and trims text", () => {
    expect(toAddFountainBody({ ...base, comments: "  ", placement_note: "  near gate " })).toEqual({
      location: { latitude: 47.6, longitude: -122.3 },
      is_working: true,
      placement_note: "near gate",
    });
  });
  it("includes non-empty rating/observation arrays", () => {
    const body = toAddFountainBody({
      ...base,
      ratings: [{ rating_type_id: 1, stars: 4 }],
      observations: [{ attribute_type_id: 2, value: "yes" }],
    });
    expect(body.ratings).toEqual([{ rating_type_id: 1, stars: 4 }]);
    expect(body.observations).toEqual([{ attribute_type_id: 2, value: "yes" }]);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run lib/add-fountain.test.ts` → FAIL.

- [ ] **Step 3: Implement shared module** — `web/lib/add-fountain.ts`:

```ts
import type { components } from "@fountainrank/api-client";

export type AddFountainInput = {
  location: { latitude: number; longitude: number };
  is_working: boolean;
  comments?: string | null;
  placement_note?: string | null;
  ratings?: { rating_type_id: number; stars: number }[];
  observations?: { attribute_type_id: number; value: string }[];
};

export type AddFountainError = "unauthenticated" | "validation" | "server";
export type AddFountainResult =
  | { ok: true; fountainId: string }
  | { ok: false; error: "duplicate"; fountainId: string }
  | { ok: false; error: AddFountainError };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// A Server Action argument is client-originated regardless of its TS type — validate as hostile
// before any API call (spec §8). Returns true only when every field is well-formed.
export function isValidAddFountainInput(input: AddFountainInput): boolean {
  if (!input || typeof input !== "object") return false;
  const loc = input.location;
  if (!loc || typeof loc !== "object") return false;
  const { latitude, longitude } = loc;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  if (typeof input.is_working !== "boolean") return false;
  if (input.comments != null && typeof input.comments !== "string") return false;
  if (input.placement_note != null) {
    if (typeof input.placement_note !== "string") return false;
    if (input.placement_note.trim().length > 200) return false;
  }
  if (input.ratings != null) {
    if (!Array.isArray(input.ratings)) return false;
    for (const r of input.ratings) {
      if (!Number.isInteger(r?.rating_type_id) || r.rating_type_id <= 0) return false;
      if (!Number.isInteger(r?.stars) || r.stars < 1 || r.stars > 5) return false;
    }
  }
  if (input.observations != null) {
    if (!Array.isArray(input.observations)) return false;
    for (const o of input.observations) {
      if (!Number.isInteger(o?.attribute_type_id) || o.attribute_type_id <= 0) return false;
      if (typeof o?.value !== "string" || o.value.trim().length === 0) return false;
    }
  }
  return true;
}

// Assemble the API body, dropping empty optionals (spec §8 step 3).
export function toAddFountainBody(
  input: AddFountainInput,
): components["schemas"]["AddFountainRequest"] {
  const body: components["schemas"]["AddFountainRequest"] = {
    location: { latitude: input.location.latitude, longitude: input.location.longitude },
    is_working: input.is_working,
  };
  const comments = input.comments?.trim();
  if (comments) body.comments = comments;
  const note = input.placement_note?.trim();
  if (note) body.placement_note = note;
  if (input.ratings && input.ratings.length) body.ratings = input.ratings;
  if (input.observations && input.observations.length) body.observations = input.observations;
  return body;
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run lib/add-fountain.test.ts` → PASS.

- [ ] **Step 5: Write the failing test (action)** — `web/app/actions/add-fountain.test.ts` (mirror `contribute.test.ts`'s hoisted-mock style):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { POST, getClient, log } = vi.hoisted(() => ({
  POST: vi.fn(),
  getClient: vi.fn(),
  log: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../../lib/server/api", () => ({ getAuthedApiClientForAction: getClient }));
vi.mock("../../lib/server/log", () => ({ log }));

import { addFountain } from "./add-fountain";
import type { AddFountainInput } from "../../lib/add-fountain";

const NEW_ID = "123e4567-e89b-12d3-a456-426614174000";
const DUP_ID = "223e4567-e89b-12d3-a456-426614174000";
const input: AddFountainInput = { location: { latitude: 47.6, longitude: -122.3 }, is_working: true };

beforeEach(() => getClient.mockImplementation(async () => ({ POST })));
afterEach(() => vi.clearAllMocks());

describe("addFountain", () => {
  it("validation fails BEFORE any API call for bad coordinates", async () => {
    const res = await addFountain({ ...input, location: { latitude: 999, longitude: 0 } });
    expect(res).toEqual({ ok: false, error: "validation" });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("returns the new id on 201", async () => {
    POST.mockResolvedValue({ data: { id: NEW_ID }, error: undefined, response: { status: 201 } });
    expect(await addFountain(input)).toEqual({ ok: true, fountainId: NEW_ID });
    expect(POST).toHaveBeenCalledWith(
      "/api/v1/fountains",
      expect.objectContaining({ body: { location: input.location, is_working: true } }),
    );
  });

  it("reads the duplicate id from the error side on 409", async () => {
    POST.mockResolvedValue({
      data: undefined,
      error: { detail: "duplicate_fountain", fountain_id: DUP_ID },
      response: { status: 409 },
    });
    expect(await addFountain(input)).toEqual({ ok: false, error: "duplicate", fountainId: DUP_ID });
  });

  it("treats a malformed 409 body as server (never a duplicate with an undefined route)", async () => {
    POST.mockResolvedValue({ data: undefined, error: { detail: "x" }, response: { status: 409 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
  });

  it("maps 401/422/5xx", async () => {
    POST.mockResolvedValue({ error: {}, response: { status: 401 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "unauthenticated" });
    POST.mockResolvedValue({ error: {}, response: { status: 422 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "validation" });
    POST.mockResolvedValue({ error: {}, response: { status: 503 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
  });

  it("treats a thrown token error as unauthenticated and a POST throw as server", async () => {
    getClient.mockRejectedValueOnce(new Error("no token"));
    expect(await addFountain(input)).toEqual({ ok: false, error: "unauthenticated" });
    POST.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
  });

  it("never logs coordinates, comments, or placement notes", async () => {
    POST.mockResolvedValue({ data: { id: NEW_ID }, response: { status: 201 } });
    await addFountain({ ...input, comments: "secret comment", placement_note: "by the gate" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("secret comment");
    expect(logged).not.toContain("by the gate");
    expect(logged).not.toContain("47.6");
  });
});
```

- [ ] **Step 6: Run, verify fail.** `pnpm --filter web exec vitest run app/actions/add-fountain.test.ts` → FAIL.

- [ ] **Step 7: Implement the action** — `web/app/actions/add-fountain.ts`:

```ts
"use server";
import type { components } from "@fountainrank/api-client";
import { getAuthedApiClientForAction } from "../../lib/server/api";
import { log } from "../../lib/server/log";
import {
  isUuid,
  isValidAddFountainInput,
  toAddFountainBody,
  type AddFountainInput,
  type AddFountainResult,
} from "../../lib/add-fountain";

export async function addFountain(input: AddFountainInput): Promise<AddFountainResult> {
  const requestId = crypto.randomUUID();
  if (!isValidAddFountainInput(input)) {
    log("warn", "add-fountain", { requestId, outcome: "validation" });
    return { ok: false, error: "validation" };
  }
  let client: Awaited<ReturnType<typeof getAuthedApiClientForAction>>;
  try {
    client = await getAuthedApiClientForAction(requestId);
  } catch (err) {
    log("warn", "add-fountain auth error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "unauthenticated" };
  }
  try {
    // openapi-fetch surfaces a non-2xx typed body on `error`, not `data`.
    const { data, error, response } = await client.POST("/api/v1/fountains", {
      body: toAddFountainBody(input),
    });
    const status = response?.status ?? 0;
    if (status === 201 && data) {
      const fountainId = (data as components["schemas"]["FountainDetail"]).id;
      log("info", "add-fountain", { requestId, outcome: "created", status });
      return { ok: true, fountainId };
    }
    if (status === 409) {
      const dup = error as components["schemas"]["DuplicateFountainConflict"] | undefined;
      if (dup && isUuid(dup.fountain_id)) {
        log("info", "add-fountain", { requestId, outcome: "duplicate", status });
        return { ok: false, error: "duplicate", fountainId: dup.fountain_id };
      }
      log("warn", "add-fountain", { requestId, outcome: "malformed-409", status });
      return { ok: false, error: "server" };
    }
    if (status === 401) return { ok: false, error: "unauthenticated" };
    if (status === 422) {
      log("warn", "add-fountain", { requestId, outcome: "validation", status });
      return { ok: false, error: "validation" };
    }
    log("warn", "add-fountain", { requestId, outcome: "server", status });
    return { ok: false, error: "server" };
  } catch (err) {
    log("warn", "add-fountain error", { requestId, reason: (err as Error).name });
    return { ok: false, error: "server" };
  }
}
```

- [ ] **Step 8: Run, verify pass.** `pnpm --filter web exec vitest run app/actions/add-fountain.test.ts lib/add-fountain.test.ts` → PASS.

- [ ] **Step 9: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/lib/add-fountain.ts web/lib/add-fountain.test.ts web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts
git add web/lib/add-fountain.ts web/lib/add-fountain.test.ts web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts
git commit -m "feat(web): addFountain server action + hostile-input validation + typed 409 handling (slice 6b-2)"
```

---

### Task 4: Pure add-mode state machine

**Files:**
- Create: `web/lib/add-fountain-machine.ts`
- Test: `web/lib/add-fountain-machine.test.ts`

**Interfaces:**
- Consumes: `Bound`, `LngLat`, `clampToBound` (Task 2); `AddFountainError` (Task 3).
- Produces: `NUDGE_STEP_M`, `type AddPhase`, `type AddState`, `initialAddState`, `type AddAction`, `addReducer(state, action): AddState`.

- [ ] **Step 1: Write the failing test** — `web/lib/add-fountain-machine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addReducer, initialAddState, type AddState } from "./add-fountain-machine";
import type { Bound } from "./map/placement";

const circle: Bound = { kind: "circle", center: { lng: -122.3, lat: 47.6 }, radiusM: 150 };
const placing: AddState = { ...initialAddState, phase: "placing", bound: circle };

describe("addReducer", () => {
  it("ENTER starts placing with defaults (working = true)", () => {
    const s = addReducer(initialAddState, { type: "ENTER" });
    expect(s.phase).toBe("placing");
    expect(s.working).toBe(true);
    expect(s.pin).toBeNull();
  });

  it("CANCEL resets to idle", () => {
    expect(addReducer(placing, { type: "CANCEL" })).toEqual(initialAddState);
  });

  it("DROP_PIN clamps to the bound", () => {
    const s = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.0, lat: 47.6 } });
    expect(s.pin).not.toBeNull();
    // clamped within the 150m circle, so far less than the 0.3deg requested offset
    expect(Math.abs(s.pin!.lng - -122.3)).toBeLessThan(0.01);
  });

  it("SET_BOUND re-clamps an existing pin", () => {
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3005, lat: 47.6 } });
    const tighter: Bound = { kind: "circle", center: { lng: -122.3, lat: 47.6 }, radiusM: 150 };
    const s = addReducer(dropped, { type: "SET_BOUND", bound: tighter });
    expect(s.bound).toEqual(tighter);
  });

  it("NUDGE moves the pin and clamps; no-op without a pin", () => {
    expect(addReducer(placing, { type: "NUDGE", dir: "n" }).pin).toBeNull();
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3, lat: 47.6 } });
    const up = addReducer(dropped, { type: "NUDGE", dir: "n" });
    expect(up.pin!.lat).toBeGreaterThan(dropped.pin!.lat);
  });

  it("NEXT requires a pin and only advances from placing", () => {
    expect(addReducer(placing, { type: "NEXT" }).phase).toBe("placing"); // no pin yet
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3, lat: 47.6 } });
    expect(addReducer(dropped, { type: "NEXT" }).phase).toBe("details");
  });

  it("BACK returns details -> placing", () => {
    const details: AddState = { ...placing, phase: "details", pin: { lng: -122.3, lat: 47.6 } };
    expect(addReducer(details, { type: "BACK" }).phase).toBe("placing");
  });

  it("SET_WORKING updates the flag", () => {
    expect(addReducer(placing, { type: "SET_WORKING", working: false }).working).toBe(false);
  });

  it("submit lifecycle: start -> done/duplicate/error preserves pin & working", () => {
    const details: AddState = {
      ...placing,
      phase: "details",
      pin: { lng: -122.3, lat: 47.6 },
      working: false,
    };
    expect(addReducer(details, { type: "SUBMIT_START" }).phase).toBe("submitting");
    expect(addReducer(details, { type: "SUBMIT_DONE", fountainId: "f1" })).toMatchObject({
      phase: "done",
      newId: "f1",
    });
    expect(addReducer(details, { type: "SUBMIT_DUPLICATE", fountainId: "d1" })).toMatchObject({
      phase: "duplicate",
      duplicateId: "d1",
    });
    const errored = addReducer(details, { type: "SUBMIT_ERROR", errorKind: "server" });
    expect(errored).toMatchObject({ phase: "error", errorKind: "server" });
    expect(errored.pin).toEqual(details.pin); // preserved for retry
    expect(errored.working).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run lib/add-fountain-machine.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `web/lib/add-fountain-machine.ts`:

```ts
import type { AddFountainError } from "./add-fountain";
import { clampToBound, type Bound, type LngLat } from "./map/placement";

export const NUDGE_STEP_M = 5;

export type AddPhase =
  | "idle"
  | "placing"
  | "details"
  | "submitting"
  | "done"
  | "duplicate"
  | "error";

export type AddState = {
  phase: AddPhase;
  bound: Bound | null;
  pin: LngLat | null;
  working: boolean;
  newId: string | null;
  duplicateId: string | null;
  errorKind: AddFountainError | null;
};

export const initialAddState: AddState = {
  phase: "idle",
  bound: null,
  pin: null,
  working: true,
  newId: null,
  duplicateId: null,
  errorKind: null,
};

export type AddAction =
  | { type: "ENTER" }
  | { type: "CANCEL" }
  | { type: "SET_BOUND"; bound: Bound }
  | { type: "DROP_PIN"; point: LngLat }
  | { type: "NUDGE"; dir: "n" | "s" | "e" | "w" }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SET_WORKING"; working: boolean }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_DONE"; fountainId: string }
  | { type: "SUBMIT_DUPLICATE"; fountainId: string }
  | { type: "SUBMIT_ERROR"; errorKind: AddFountainError };

function nudged(pin: LngLat, dir: "n" | "s" | "e" | "w"): LngLat {
  const dLat = NUDGE_STEP_M / 111320;
  const dLng = NUDGE_STEP_M / (111320 * Math.cos((pin.lat * Math.PI) / 180));
  if (dir === "n") return { lng: pin.lng, lat: pin.lat + dLat };
  if (dir === "s") return { lng: pin.lng, lat: pin.lat - dLat };
  if (dir === "e") return { lng: pin.lng + dLng, lat: pin.lat };
  return { lng: pin.lng - dLng, lat: pin.lat };
}

export function addReducer(state: AddState, action: AddAction): AddState {
  switch (action.type) {
    case "ENTER":
      return { ...initialAddState, phase: "placing" };
    case "CANCEL":
      return initialAddState;
    case "SET_BOUND":
      return {
        ...state,
        bound: action.bound,
        pin: state.pin ? clampToBound(state.pin, action.bound) : null,
      };
    case "DROP_PIN":
      return {
        ...state,
        pin: state.bound ? clampToBound(action.point, state.bound) : action.point,
      };
    case "NUDGE": {
      if (!state.pin) return state;
      const moved = nudged(state.pin, action.dir);
      return { ...state, pin: state.bound ? clampToBound(moved, state.bound) : moved };
    }
    case "NEXT":
      return state.pin && state.phase === "placing" ? { ...state, phase: "details" } : state;
    case "BACK":
      return state.phase === "details" ? { ...state, phase: "placing" } : state;
    case "SET_WORKING":
      return { ...state, working: action.working };
    case "SUBMIT_START":
      return { ...state, phase: "submitting", errorKind: null };
    case "SUBMIT_DONE":
      return { ...state, phase: "done", newId: action.fountainId };
    case "SUBMIT_DUPLICATE":
      return { ...state, phase: "duplicate", duplicateId: action.fountainId };
    case "SUBMIT_ERROR":
      return { ...state, phase: "error", errorKind: action.errorKind };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run lib/add-fountain-machine.test.ts` → PASS.

- [ ] **Step 5: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/lib/add-fountain-machine.ts web/lib/add-fountain-machine.test.ts
git add web/lib/add-fountain-machine.ts web/lib/add-fountain-machine.test.ts
git commit -m "feat(web): pure add-mode state machine (placing/details/submit, clamped) (slice 6b-2)"
```

---

### Task 5: Presentational `AddFountainPanel` + `AddFountainFab`

**Files:**
- Create: `web/components/map/AddFountainPanel.tsx`
- Test: `web/components/map/AddFountainPanel.test.tsx`
- Create: `web/components/map/AddFountainFab.tsx`
- Test: `web/components/map/AddFountainFab.test.tsx`

**Interfaces:**
- Consumes: `AddPhase`, `AddFountainError` (Tasks 3–4); `signInWithReturn` (`web/app/actions/auth.ts`).
- Produces:
  - `AddFountainFab({ isAuthenticated, webglOk, onEnter }: { isAuthenticated: boolean; webglOk: boolean; onEnter: () => void })` — hidden when `!webglOk`; signed-out renders a `signInWithReturn("/?add=1")` form; signed-in renders a button calling `onEnter`.
  - `AddFountainPanel(props)` — presentational, all state + callbacks passed in (see the prop type in Step 3). Renders by `phase`; `role="status"`/`aria-live="polite"` outcomes; keyboard controls.

These are presentational so they unit-test without a map (jsdom has no WebGL — the map glue is Task 6 and is covered by build + manual verify, as `MapBrowser` already is).

- [ ] **Step 1: Write the failing FAB test** — `web/components/map/AddFountainFab.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../app/actions/auth", () => ({ signInWithReturn: vi.fn() }));

import { AddFountainFab } from "./AddFountainFab";

afterEach(cleanup);

describe("AddFountainFab", () => {
  it("is hidden when WebGL is unavailable", () => {
    const { container } = render(
      <AddFountainFab isAuthenticated webglOk={false} onEnter={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
  it("signed-in: clicking calls onEnter", () => {
    const onEnter = vi.fn();
    render(<AddFountainFab isAuthenticated webglOk onEnter={onEnter} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    expect(onEnter).toHaveBeenCalled();
  });
  it("signed-out: renders a sign-in submit (no onEnter)", () => {
    const onEnter = vi.fn();
    render(<AddFountainFab isAuthenticated={false} webglOk onEnter={onEnter} />);
    expect(screen.getByRole("button", { name: /add a fountain/i })).toHaveProperty(
      "type",
      "submit",
    );
    expect(onEnter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run components/map/AddFountainFab.test.tsx` → FAIL.

- [ ] **Step 3: Implement `AddFountainFab.tsx`:**

```tsx
"use client";
import { signInWithReturn } from "../../app/actions/auth";

export function AddFountainFab({
  isAuthenticated,
  webglOk,
  onEnter,
}: {
  isAuthenticated: boolean;
  webglOk: boolean;
  onEnter: () => void;
}) {
  if (!webglOk) return null; // no map -> no placement
  const className =
    "absolute bottom-24 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#F2C200] px-4 py-3 text-sm font-bold text-[#0A357E] shadow-lg transition hover:bg-[#ffce1f]";
  if (!isAuthenticated) {
    return (
      <form action={signInWithReturn.bind(null, "/?add=1")} className="contents">
        <button type="submit" className={className} aria-label="Add a fountain">
          <span aria-hidden="true">+</span> Add a fountain
        </button>
      </form>
    );
  }
  return (
    <button type="button" onClick={onEnter} className={className} aria-label="Add a fountain">
      <span aria-hidden="true">+</span> Add a fountain
    </button>
  );
}
```

- [ ] **Step 4: Run FAB test, verify pass.** `pnpm --filter web exec vitest run components/map/AddFountainFab.test.tsx` → PASS.

- [ ] **Step 5: Write the failing panel test** — `web/components/map/AddFountainPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AddFountainPanel, type AddFountainPanelProps } from "./AddFountainPanel";

const base: AddFountainPanelProps = {
  phase: "placing",
  pin: null,
  working: true,
  placeable: false,
  gpsUnavailable: false,
  duplicateId: null,
  errorKind: null,
  onCancel: vi.fn(),
  onPlaceAtCenter: vi.fn(),
  onNudge: vi.fn(),
  onNext: vi.fn(),
  onBack: vi.fn(),
  onSetWorking: vi.fn(),
  onSubmit: vi.fn(),
};

afterEach(cleanup);

describe("AddFountainPanel", () => {
  it("placing: Next is disabled until a placeable pin exists", () => {
    const { rerender } = render(<AddFountainPanel {...base} />);
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", true);
    rerender(
      <AddFountainPanel {...base} pin={{ lng: -122.3, lat: 47.6 }} placeable />,
    );
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", false);
  });

  it("placing: keyboard controls complete placement with no canvas interaction", () => {
    const onPlaceAtCenter = vi.fn();
    const onNudge = vi.fn();
    const onNext = vi.fn();
    render(
      <AddFountainPanel
        {...base}
        placeable
        pin={{ lng: -122.3, lat: 47.6 }}
        onPlaceAtCenter={onPlaceAtCenter}
        onNudge={onNudge}
        onNext={onNext}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /place at map center/i }));
    expect(onPlaceAtCenter).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /nudge north/i }));
    expect(onNudge).toHaveBeenCalledWith("n");
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(onNext).toHaveBeenCalled();
  });

  it("placing: shows the fallback copy when GPS is unavailable", () => {
    render(<AddFountainPanel {...base} gpsUnavailable />);
    expect(screen.getByText(/couldn.t confirm your location/i)).toBeTruthy();
  });

  it("details: working toggle defaults to Yes and can flip", () => {
    const onSetWorking = vi.fn();
    render(
      <AddFountainPanel
        {...base}
        phase="details"
        pin={{ lng: -122.3, lat: 47.6 }}
        onSetWorking={onSetWorking}
      />,
    );
    const yes = screen.getByRole("radio", { name: /yes/i });
    expect(yes).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("radio", { name: /no/i }));
    expect(onSetWorking).toHaveBeenCalledWith(false);
  });

  it("duplicate: shows a View it link to the existing fountain", () => {
    render(<AddFountainPanel {...base} phase="duplicate" duplicateId="dup-1" />);
    const link = screen.getByRole("link", { name: /view it/i });
    expect(link.getAttribute("href")).toBe("/fountains/dup-1");
  });

  it("error: shows a retry affordance and an aria-live message", () => {
    render(<AddFountainPanel {...base} phase="error" errorKind="server" pin={{ lng: -122.3, lat: 47.6 }} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run, verify fail.** `pnpm --filter web exec vitest run components/map/AddFountainPanel.test.tsx` → FAIL.

- [ ] **Step 7: Implement `AddFountainPanel.tsx`** (presentational; bottom sheet/card; per-phase UI):

```tsx
"use client";
import Link from "next/link";
import type { AddFountainError } from "../../lib/add-fountain";
import type { AddPhase } from "../../lib/add-fountain-machine";
import type { LngLat } from "../../lib/map/placement";

export type AddFountainPanelProps = {
  phase: AddPhase;
  pin: LngLat | null;
  working: boolean;
  placeable: boolean;
  gpsUnavailable: boolean;
  duplicateId: string | null;
  errorKind: AddFountainError | null;
  onCancel: () => void;
  onPlaceAtCenter: () => void;
  onNudge: (dir: "n" | "s" | "e" | "w") => void;
  onNext: () => void;
  onBack: () => void;
  onSetWorking: (working: boolean) => void;
  onSubmit: () => void;
};

const ERROR_COPY: Record<AddFountainError, string> = {
  unauthenticated: "Your session expired — sign in to finish.",
  validation: "Something about this fountain looks off. Check the details and try again.",
  server: "Couldn't add the fountain — please try again.",
};

export function AddFountainPanel(props: AddFountainPanelProps) {
  const { phase } = props;
  if (phase === "idle") return null;
  return (
    <div
      role="dialog"
      aria-label="Add a fountain"
      className="absolute inset-x-0 bottom-0 z-40 mx-auto max-w-md rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:bottom-4 sm:right-4 sm:left-auto sm:mx-0 sm:rounded-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#0A357E]">Add a fountain</h2>
        <button
          type="button"
          onClick={props.onCancel}
          aria-label="Cancel"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      </div>

      {phase === "placing" && <PlacingStep {...props} />}
      {phase === "details" && <DetailsStep {...props} />}
      {(phase === "submitting" || phase === "done") && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {phase === "submitting" ? "Adding…" : "Fountain added."}
        </p>
      )}
      {phase === "duplicate" && (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm text-slate-700">
            A fountain already exists here.
          </p>
          {props.duplicateId && (
            <Link
              href={`/fountains/${props.duplicateId}`}
              className="inline-block rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
            >
              View it
            </Link>
          )}
        </div>
      )}
      {phase === "error" && (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm text-red-700">
            {props.errorKind ? ERROR_COPY[props.errorKind] : ERROR_COPY.server}
          </p>
          <button
            type="button"
            onClick={props.onSubmit}
            className="rounded-full bg-[#0A357E] px-4 py-2 text-sm font-bold text-white"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Coord({ pin }: { pin: LngLat | null }) {
  if (!pin) return <p className="mt-2 text-xs text-slate-500">Drop a pin to set the location.</p>;
  return (
    <p className="mt-2 text-xs tabular-nums text-slate-500">
      Lat {pin.lat.toFixed(5)} · Lng {pin.lng.toFixed(5)}
    </p>
  );
}

function PlacingStep(props: AddFountainPanelProps) {
  return (
    <div>
      <p className="mt-1 text-sm text-slate-600">
        Tap the map where the fountain is, then drag the pin to fine-tune.
      </p>
      {props.gpsUnavailable && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          We couldn&rsquo;t confirm your location — make sure the pin is exactly where the fountain
          is.
        </p>
      )}
      {!props.placeable && props.pin === null && (
        <p className="mt-2 text-xs text-slate-500">Zoom in to place the fountain.</p>
      )}
      <Coord pin={props.pin} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onPlaceAtCenter}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
        >
          Place at map center
        </button>
        <span className="inline-flex gap-1" aria-label="Nudge the pin">
          {(["n", "s", "e", "w"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => props.onNudge(d)}
              disabled={!props.pin}
              aria-label={`Nudge ${{ n: "north", s: "south", e: "east", w: "west" }[d]}`}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
            >
              {{ n: "↑", s: "↓", e: "→", w: "←" }[d]}
            </button>
          ))}
        </span>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={props.onNext}
          disabled={!props.pin || !props.placeable}
          className="rounded-full bg-[#0A357E] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Next: details
        </button>
      </div>
    </div>
  );
}

function DetailsStep(props: AddFountainPanelProps) {
  return (
    <div className="mt-2">
      <Coord pin={props.pin} />
      <fieldset className="mt-3">
        <legend className="text-sm font-semibold text-slate-700">Is it working?</legend>
        <div className="mt-1 flex gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="working"
              checked={props.working}
              onChange={() => props.onSetWorking(true)}
            />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="working"
              checked={!props.working}
              onChange={() => props.onSetWorking(false)}
            />
            No
          </label>
        </div>
      </fieldset>
      <div className="mt-4 flex justify-between">
        <button type="button" onClick={props.onBack} className="text-sm text-slate-600 underline">
          Back
        </button>
        <button
          type="button"
          onClick={props.onSubmit}
          className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]"
        >
          Add fountain
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run panel test, verify pass.** `pnpm --filter web exec vitest run components/map/AddFountainPanel.test.tsx` → PASS.

- [ ] **Step 9: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/map/AddFountainPanel.tsx web/components/map/AddFountainPanel.test.tsx web/components/map/AddFountainFab.tsx web/components/map/AddFountainFab.test.tsx
git add web/components/map/AddFountainPanel.tsx web/components/map/AddFountainPanel.test.tsx web/components/map/AddFountainFab.tsx web/components/map/AddFountainFab.test.tsx
git commit -m "feat(web): AddFountainPanel + FAB (presentational, keyboard placement, duplicate/error) (slice 6b-2)"
```

---

### Task 6: `useAddFountainMode` hook + MapBrowser/loader/page wiring (PR 1 integration)

**Files:**
- Create: `web/components/map/useAddFountainMode.ts`
- Modify: `web/components/map/MapBrowser.tsx`
- Modify: `web/components/map/MapBrowserLoader.tsx`
- Modify: `web/app/page.tsx`
- Test: `web/app/page.test.tsx` (new)

**Interfaces:**
- Consumes: `addReducer`/`initialAddState`/`NUDGE_STEP_M` (Task 4), `boundFromFix`/`clampToBound`/`canPlace`/`Bound`/`LngLat`/`GpsFix` (Task 2), `addFountain` (Task 3), `AddFountainPanel`/`AddFountainFab` (Task 5).
- Produces: `useAddFountainMode(getMap: () => maplibregl.Map | null, opts: { isAuthenticated: boolean; autoEnter: boolean }): { active: boolean; fab: ReactNode; panel: ReactNode }` — encapsulates all map glue + state; `MapBrowser` renders `{fab}` and `{panel}` and consults `active` to suppress browse interactions.

> The hook's MapLibre glue cannot run under jsdom (no WebGL), exactly like `MapBrowser` itself — so it is covered by `next build` typecheck + the owner-driven manual verify (§13), while the **logic** it orchestrates is already unit-tested in Tasks 2 and 4. Keep the hook a thin orchestration layer; do not put testable logic here.

- [ ] **Step 1: Implement `useAddFountainMode.ts`.** The hook owns: a `useReducer(addReducer, initialAddState)`; a maplibre `Marker` (draggable) for the pin; a `circle`/`viewport` indicator (a GeoJSON source + a line/fill layer named `add-bound` for the ring); a one-shot `navigator.geolocation.getCurrentPosition`; map `click` (drop), marker `dragend` (drop), and `moveend` (recompute bound + `canPlace`) listeners installed on `enter` and torn down on `cancel`/unmount.

```tsx
"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";
import maplibregl from "maplibre-gl";
import { useRouter } from "next/navigation";
import { addFountain } from "../../app/actions/add-fountain";
import { addReducer, initialAddState } from "../../lib/add-fountain-machine";
import {
  boundFromFix,
  canPlace,
  type Bound,
  type GpsFix,
  type LngLat,
} from "../../lib/map/placement";
import { GEOLOCATE_TIMEOUT_MS } from "../../lib/map/constants";
import { AddFountainFab } from "./AddFountainFab";
import { AddFountainPanel } from "./AddFountainPanel";

function viewportOf(map: maplibregl.Map) {
  const b = map.getBounds();
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
}

export function useAddFountainMode(
  getMap: () => maplibregl.Map | null,
  opts: { isAuthenticated: boolean; autoEnter: boolean },
) {
  const [state, dispatch] = useReducer(addReducer, initialAddState);
  const [zoom, setZoom] = useState(0);
  const [fix, setFix] = useState<GpsFix>({ ok: false });
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const router = useRouter();
  const active = state.phase !== "idle";

  // Derive the bound from the current fix + viewport whenever either changes (during placing).
  const recomputeBound = useCallback(() => {
    const map = getMap();
    if (!map) return;
    const bound = boundFromFix(fix, viewportOf(map));
    dispatch({ type: "SET_BOUND", bound });
    setZoom(map.getZoom());
  }, [getMap, fix]);

  const enter = useCallback(() => {
    const map = getMap();
    if (!map) return;
    dispatch({ type: "ENTER" });
    setZoom(map.getZoom());
    dispatch({ type: "SET_BOUND", bound: boundFromFix({ ok: false }, viewportOf(map)) });
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        const f: GpsFix = {
          ok: true,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setFix(f);
        map.easeTo({ center: [f.lng, f.lat], zoom: Math.max(map.getZoom(), 16) });
      },
      () => setFix({ ok: false }),
      { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
    );
  }, [getMap]);

  const cancel = useCallback(() => dispatch({ type: "CANCEL" }), []);

  // Auto-enter after a post-sign-in return (?add=1 + authed), then strip the query (spec §4).
  useEffect(() => {
    if (opts.autoEnter && opts.isAuthenticated && state.phase === "idle") {
      enter();
      router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.autoEnter, opts.isAuthenticated]);

  // Map event wiring while active: click to drop, recompute bound on move, keep zoom fresh.
  useEffect(() => {
    const map = getMap();
    if (!map || !active) return;
    const onClick = (e: maplibregl.MapMouseEvent) =>
      dispatch({ type: "DROP_PIN", point: { lng: e.lngLat.lng, lat: e.lngLat.lat } });
    const onMove = () => recomputeBound();
    map.on("click", onClick);
    map.on("moveend", onMove);
    return () => {
      map.off("click", onClick);
      map.off("moveend", onMove);
    };
  }, [getMap, active, recomputeBound]);

  // Recompute the bound when the fix changes.
  useEffect(() => {
    if (active) recomputeBound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  // Reflect the pin as a draggable marker.
  useEffect(() => {
    const map = getMap();
    if (!map) return;
    if (!state.pin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const m = new maplibregl.Marker({ draggable: true, color: "#0A357E" });
      m.on("dragend", () => {
        const ll = m.getLngLat();
        dispatch({ type: "DROP_PIN", point: { lng: ll.lng, lat: ll.lat } });
      });
      markerRef.current = m;
      m.setLngLat([state.pin.lng, state.pin.lat]).addTo(map);
    } else {
      markerRef.current.setLngLat([state.pin.lng, state.pin.lat]);
    }
  }, [getMap, state.pin]);

  // Draw/update the bound ring (circle) or clear it (viewport) — a GeoJSON source `add-bound`.
  useEffect(() => {
    const map = getMap();
    if (!map || !map.isStyleLoaded?.()) return;
    const fc = boundToFeatureCollection(state.bound);
    const src = map.getSource("add-bound") as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(fc);
    } else if (active) {
      map.addSource("add-bound", { type: "geojson", data: fc });
      map.addLayer({
        id: "add-bound",
        type: "line",
        source: "add-bound",
        paint: { "line-color": "#0A357E", "line-opacity": 0.4, "line-dasharray": [2, 2] },
      });
    }
    if (!active && map.getLayer("add-bound")) {
      map.removeLayer("add-bound");
      map.removeSource("add-bound");
      markerRef.current?.remove();
      markerRef.current = null;
    }
  }, [getMap, state.bound, active]);

  const placeAtCenter = useCallback(() => {
    const map = getMap();
    if (!map) return;
    const c = map.getCenter();
    dispatch({ type: "DROP_PIN", point: { lng: c.lng, lat: c.lat } });
  }, [getMap]);

  const submit = useCallback(async () => {
    if (!state.pin) return;
    dispatch({ type: "SUBMIT_START" });
    const res = await addFountain({
      location: { latitude: state.pin.lat, longitude: state.pin.lng },
      is_working: state.working,
    });
    if (res.ok) {
      dispatch({ type: "SUBMIT_DONE", fountainId: res.fountainId });
      router.push(`/fountains/${res.fountainId}`);
    } else if (res.error === "duplicate") {
      dispatch({ type: "SUBMIT_DUPLICATE", fountainId: res.fountainId });
    } else {
      dispatch({ type: "SUBMIT_ERROR", errorKind: res.error });
    }
  }, [state.pin, state.working, router]);

  const placeable = state.bound ? canPlace(zoom, state.bound) : false;

  const fab: ReactNode = (
    <AddFountainFab isAuthenticated={opts.isAuthenticated} webglOk onEnter={enter} />
  );
  const panel: ReactNode = (
    <AddFountainPanel
      phase={state.phase}
      pin={state.pin}
      working={state.working}
      placeable={placeable}
      gpsUnavailable={!fix.ok}
      duplicateId={state.duplicateId}
      errorKind={state.errorKind}
      onCancel={cancel}
      onPlaceAtCenter={placeAtCenter}
      onNudge={(dir) => dispatch({ type: "NUDGE", dir })}
      onNext={() => dispatch({ type: "NEXT" })}
      onBack={() => dispatch({ type: "BACK" })}
      onSetWorking={(working) => dispatch({ type: "SET_WORKING", working })}
      onSubmit={submit}
    />
  );

  return { active, fab, panel };
}

function boundToFeatureCollection(bound: Bound | null): GeoJSON.FeatureCollection {
  if (!bound || bound.kind !== "circle") return { type: "FeatureCollection", features: [] };
  const { center, radiusM } = bound;
  const pts: [number, number][] = [];
  const dLat = radiusM / 111320;
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    const dLng = (radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180))) * Math.cos(a);
    pts.push([center.lng + dLng, center.lat + dLat * Math.sin(a)]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } }],
  };
}
```

> **Note:** `AddFountainFab` is rendered here with `webglOk` hardcoded `true` because the hook only mounts inside `MapBrowser` (which renders nothing map-related when `!webglOk`). The FAB's own `!webglOk` guard remains for unit-test clarity. If `MapBrowser` is refactored to always mount the FAB, thread the real `webglOk` here.

- [ ] **Step 2: Wire `MapBrowser.tsx`.** Add props and integrate the hook:
  - Change the signature to `export default function MapBrowser({ isAuthenticated = false, autoEnterAdd = false }: { isAuthenticated?: boolean; autoEnterAdd?: boolean })`.
  - After `mapRef` is set up, call: `const add = useAddFountainMode(() => mapRef.current, { isAuthenticated, autoEnter: autoEnterAdd });`
  - In the pin-click handlers (`openPin`), early-return when `add.active` so a click in placement mode does not navigate: `const openPin = (e) => { if (add.active) return; ... }`.
  - In the returned JSX, render `{add.fab}` and `{add.panel}` inside the root `<div className="absolute inset-0">` (siblings of the existing hints), and pass through the existing `FountainsInViewList` only when `!add.active` (hide it behind the panel): wrap it `{!add.active && <FountainsInViewList … />}`.

- [ ] **Step 3: Wire `MapBrowserLoader.tsx`.** Accept and forward the props:

```tsx
"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#e9efe7]" aria-hidden />,
});
export default function MapBrowserLoader({
  isAuthenticated,
  autoEnterAdd,
}: {
  isAuthenticated: boolean;
  autoEnterAdd: boolean;
}) {
  return <MapBrowser isAuthenticated={isAuthenticated} autoEnterAdd={autoEnterAdd} />;
}
```

- [ ] **Step 4: Wire `app/page.tsx`.** It is a server component; read `searchParams` (async in Next 16), call `getViewer`, and pass props:

```tsx
import Link from "next/link";
import { SiteHeader } from "../components/SiteHeader";
import MapBrowserLoader from "../components/map/MapBrowserLoader";
import { getViewer } from "../lib/server/viewer";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ add?: string }>;
}) {
  const [{ add }, viewer] = await Promise.all([searchParams, getViewer(crypto.randomUUID())]);
  const isAuthenticated = viewer.state === "authed";
  const autoEnterAdd = add === "1" && isAuthenticated;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant="hero" />
      <main className="relative flex-1">
        <MapBrowserLoader isAuthenticated={isAuthenticated} autoEnterAdd={autoEnterAdd} />
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-gradient-to-b from-[#0E4DA4] to-[#0A357E] px-6 py-3 text-xs text-white/60">
        <span>&copy; {new Date().getFullYear()} FountainRank</span>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/privacy">
          Privacy
        </Link>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/terms">
          Terms
        </Link>
      </footer>
    </div>
  );
}
```

> `getViewer` is called both here and inside `SiteHeader`. That mirrors the existing 6b-1 cost (the deferred follow-up to dedupe `/me` is out of scope for this slice); keep the second call.

- [ ] **Step 5: Update `web/app/page.test.tsx`.** The page is now async and takes `searchParams`. Mock `getViewer`, `SiteHeader`, and `MapBrowserLoader`, and assert prop threading:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer } = vi.hoisted(() => ({ getViewer: vi.fn() }));
vi.mock("../lib/server/viewer", () => ({ getViewer }));
vi.mock("../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="site-header" /> }));
vi.mock("../components/map/MapBrowserLoader", () => ({
  default: (p: { isAuthenticated: boolean; autoEnterAdd: boolean }) => (
    <div data-testid="map" data-auth={String(p.isAuthenticated)} data-auto={String(p.autoEnterAdd)} />
  ),
}));

import Home from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("auto-enters add when ?add=1 and authed", async () => {
  getViewer.mockResolvedValue({ state: "authed", displayName: "A", avatarUrl: null, isAdmin: false });
  render(await Home({ searchParams: Promise.resolve({ add: "1" }) }));
  expect(screen.getByTestId("map").getAttribute("data-auto")).toBe("true");
  expect(screen.getByTestId("map").getAttribute("data-auth")).toBe("true");
});

it("does not auto-enter when ?add=1 but anonymous", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await Home({ searchParams: Promise.resolve({ add: "1" }) }));
  expect(screen.getByTestId("map").getAttribute("data-auto")).toBe("false");
  expect(screen.getByTestId("map").getAttribute("data-auth")).toBe("false");
});

it("renders the header", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await Home({ searchParams: Promise.resolve({}) }));
  expect(screen.getByTestId("site-header")).toBeTruthy();
});
```

- [ ] **Step 6: Run the web vitest subset.** `pnpm --filter web exec vitest run app/page.test.tsx components/map/AddFountainFab.test.tsx components/map/AddFountainPanel.test.tsx` → PASS.

- [ ] **Step 7: Full local web mirror (incl. `next build` — the `"use server"`/route gotcha).** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web` → green (ESLint + Prettier + tsc + vitest + build). Fix any unused-import / Tailwind-order / type errors (e.g. the maplibre event types).

- [ ] **Step 8: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/map/useAddFountainMode.ts web/components/map/MapBrowser.tsx web/components/map/MapBrowserLoader.tsx web/app/page.tsx web/app/page.test.tsx
git add web/components/map/useAddFountainMode.ts web/components/map/MapBrowser.tsx web/components/map/MapBrowserLoader.tsx web/app/page.tsx web/app/page.test.tsx
git commit -m "feat(web): add-fountain placement mode on the home map (FAB, pin, bound, 409, ?add=1) (slice 6b-2)"
```

- [ ] **Step 9: Full mirror + open PR 1.** Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check` (full: backend + workspace-js + web build + mobile) → green. Push the branch and open PR 1; then run **Codex Loop B** (`claude_help/codex-review-process.md`) + address every comment; squash-merge once CI is green and Codex `VERDICT: APPROVED`; deploy; verify per spec §13.

---

## PR 2 — optional fields (rating + attributes + comment + placement note)

> Branch off updated `main` after PR 1 merges. Re-run the pnpm-store recovery if a Codex/WSL run dirtied it (`handoffs` gotcha): `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`.

### Task 7: Style-guide entries for PR-2 UI (prerequisite)

**Files:**
- Modify: `docs/style-guide.md`

Add: the **attribute observation controls** (boolean Yes/No/Unknown; enum select + Unknown; grouped by category; default Unknown), the **rating star-group** as used in the add flow, and the **comment + placement-note inputs** (textarea; ≤200 single-line with counter). Note the graceful-skip states (rating/attribute fetch failure).

- [ ] **Step 1:** Add the entries (match structure/voice).
- [ ] **Step 2:** Commit.

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): add attribute/rating/comment add-fountain controls (slice 6b-2 PR2)"
```

---

### Task 8: Catalog fetch + `buildAttributeGroups`

**Files:**
- Create: `web/lib/catalog.ts`
- Test: `web/lib/catalog.test.ts`

**Interfaces:**
- Consumes: `@fountainrank/api-client` types (`AttributeTypeOut`, `RatingTypeOut`), `resolveApiBaseUrl`/`makeClient` (public, unauthenticated reads).
- Produces:
  - `type AttributeControl = { id:number; key:string; name:string; description:string; kind:"boolean"|"enum"; options:string[] }` (boolean → `["yes","no","unknown"]`; enum → `[...allowed_values,"unknown"]`).
  - `type AttributeGroup = { category:string; controls:AttributeControl[] }`.
  - `buildAttributeGroups(types: AttributeTypeOut[]): AttributeGroup[]` — group by `category`, controls + groups ordered by `sort_order`, unknown appended.
  - `fetchRatingTypes(): Promise<RatingTypeOut[]>`, `fetchAttributeTypes(): Promise<AttributeTypeOut[]>` (thin unauthenticated client GETs; callers handle rejection by skipping the section).

- [ ] **Step 1: Write the failing test** — `web/lib/catalog.test.ts` (pure `buildAttributeGroups`):

```ts
import { describe, expect, it } from "vitest";
import { buildAttributeGroups } from "./catalog";
import type { components } from "@fountainrank/api-client";

type A = components["schemas"]["AttributeTypeOut"];
const t = (o: Partial<A>): A => ({
  id: 1,
  key: "k",
  place_type: "fountain",
  category: "physical",
  name: "N",
  description: "",
  value_kind: "boolean",
  allowed_values: null,
  sort_order: 0,
  ...o,
});

describe("buildAttributeGroups", () => {
  it("groups by category and orders by sort_order", () => {
    const groups = buildAttributeGroups([
      t({ id: 2, category: "access", name: "Indoor", sort_order: 1 }),
      t({ id: 1, category: "physical", name: "Bottle filler", sort_order: 0 }),
      t({ id: 3, category: "physical", name: "Dog bowl", sort_order: 2 }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["physical", "access"]);
    expect(groups[0].controls.map((c) => c.name)).toEqual(["Bottle filler", "Dog bowl"]);
  });

  it("boolean -> yes/no/unknown; enum -> allowed_values + unknown", () => {
    const [g] = buildAttributeGroups([
      t({ id: 1, value_kind: "boolean" }),
      t({ id: 2, value_kind: "enum", allowed_values: ["cold", "ambient"], sort_order: 1 }),
    ]);
    expect(g.controls[0]).toMatchObject({ kind: "boolean", options: ["yes", "no", "unknown"] });
    expect(g.controls[1]).toMatchObject({
      kind: "enum",
      options: ["cold", "ambient", "unknown"],
    });
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run lib/catalog.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `web/lib/catalog.ts`:

```ts
import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { resolveApiBaseUrl } from "./api";

type AttributeTypeOut = components["schemas"]["AttributeTypeOut"];
type RatingTypeOut = components["schemas"]["RatingTypeOut"];

export type AttributeControl = {
  id: number;
  key: string;
  name: string;
  description: string;
  kind: "boolean" | "enum";
  options: string[];
};
export type AttributeGroup = { category: string; controls: AttributeControl[] };

export function buildAttributeGroups(types: AttributeTypeOut[]): AttributeGroup[] {
  const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order);
  const order: string[] = [];
  const byCat = new Map<string, AttributeControl[]>();
  for (const t of sorted) {
    const kind: "boolean" | "enum" = t.value_kind === "enum" ? "enum" : "boolean";
    const options =
      kind === "enum" ? [...(t.allowed_values ?? []), "unknown"] : ["yes", "no", "unknown"];
    if (!byCat.has(t.category)) {
      byCat.set(t.category, []);
      order.push(t.category);
    }
    byCat.get(t.category)!.push({
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      kind,
      options,
    });
  }
  return order.map((category) => ({ category, controls: byCat.get(category)! }));
}

export async function fetchAttributeTypes(): Promise<AttributeTypeOut[]> {
  const client = makeClient(resolveApiBaseUrl());
  const { data, error } = await client.GET("/api/v1/attribute-types");
  if (error || !data) throw new Error("attribute-types fetch failed");
  return data;
}

export async function fetchRatingTypes(): Promise<RatingTypeOut[]> {
  const client = makeClient(resolveApiBaseUrl());
  const { data, error } = await client.GET("/api/v1/rating-types");
  if (error || !data) throw new Error("rating-types fetch failed");
  return data;
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run lib/catalog.test.ts` → PASS.

- [ ] **Step 5: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/lib/catalog.ts web/lib/catalog.test.ts
git add web/lib/catalog.ts web/lib/catalog.test.ts
git commit -m "feat(web): catalog fetch + buildAttributeGroups (rating/attribute types) (slice 6b-2)"
```

---

### Task 9: Optional fields in the add flow (rating, attributes, comment, placement note)

**Files:**
- Create: `web/components/fountain/StarGroup.tsx` (extract from `RatingForm`) + `web/components/fountain/StarGroup.test.tsx`
- Modify: `web/components/fountain/RatingForm.tsx` (reuse `StarGroup`)
- Create: `web/components/map/RatingFields.tsx` + `web/components/map/AttributeObservationFields.tsx` (+ tests)
- Modify: `web/components/map/AddFountainPanel.tsx` + `AddFountainPanel.test.tsx`
- Modify: `web/components/map/useAddFountainMode.ts`
- Modify: `web/app/actions/add-fountain.ts` (pass the optional fields)

**Interfaces:**
- Produces: `StarGroup({ id, name, value, onChange }: { id:number; name:string; value:number; onChange:(stars:number)=>void })` — one labeled 1–5 radio group, emitting `(stars)`.
- `RatingFields({ types, value, onChange }: { types: RatingTypeOut[]; value: Record<number,number>; onChange:(id:number, stars:number)=>void })` — renders one `StarGroup` per type, mapping `RatingTypeOut.id → rating_type_id`.
- `AttributeObservationFields({ groups, value, onChange }: { groups: AttributeGroup[]; value: Record<number,string>; onChange:(attributeTypeId:number, v:string)=>void })`.
- `AddFountainPanel` gains optional `details` props (ratingTypes, attributeGroups, ratings, observations, comments, placementNote + their onChange) — all optional so PR-1 tests still pass.

- [ ] **Step 1: Extract `StarGroup` (TDD).** Write `web/components/fountain/StarGroup.test.tsx` asserting it renders 5 radios labeled by `name`, marks `value` checked, and calls `onChange(stars)` on select. Then create `StarGroup.tsx` by lifting the per-dimension radio markup out of `RatingForm.tsx`, and refactor `RatingForm` to render `StarGroup` per `DimensionSummary` (mapping `dimension.rating_type_id`). Run `pnpm --filter web exec vitest run components/fountain/StarGroup.test.tsx components/fountain/RatingForm.test.tsx` → PASS (RatingForm behavior unchanged).

```tsx
// web/components/fountain/StarGroup.tsx
"use client";
export function StarGroup({
  id,
  name,
  value,
  onChange,
}: {
  id: number;
  name: string;
  value: number;
  onChange: (stars: number) => void;
}) {
  return (
    <fieldset className="flex items-center justify-between gap-3">
      <legend className="sr-only">{name}</legend>
      <span className="text-sm text-slate-700">{name}</span>
      <span className="flex gap-1" role="radiogroup" aria-label={name}>
        {[1, 2, 3, 4, 5].map((s) => (
          <label key={s} className="cursor-pointer">
            <input
              type="radio"
              name={`stars-${id}`}
              value={s}
              checked={value === s}
              onChange={() => onChange(s)}
              className="peer sr-only"
            />
            <span aria-hidden="true" className={s <= value ? "text-[#F2C200]" : "text-slate-300"}>
              ★
            </span>
            <span className="sr-only">
              {s} star{s > 1 ? "s" : ""}
            </span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}
```

- [ ] **Step 2: `RatingFields` (TDD, id-mapping test).** Write `web/components/map/RatingFields.test.tsx` proving selecting stars calls `onChange(ratingTypeOut.id, stars)` — i.e. the add form maps `RatingTypeOut.id` to `rating_type_id` (a mixup that used `rating_type_id` would fail because `RatingTypeOut` has no such field). Implement `RatingFields.tsx` rendering a `StarGroup` per `RatingTypeOut` (`id`, `name`). Run its test → PASS.

```tsx
// web/components/map/RatingFields.tsx
"use client";
import type { components } from "@fountainrank/api-client";
import { StarGroup } from "../fountain/StarGroup";

export function RatingFields({
  types,
  value,
  onChange,
}: {
  types: components["schemas"]["RatingTypeOut"][];
  value: Record<number, number>;
  onChange: (id: number, stars: number) => void;
}) {
  if (!types.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-semibold text-slate-700">Rate it (optional)</p>
      {types.map((t) => (
        <StarGroup key={t.id} id={t.id} name={t.name} value={value[t.id] ?? 0} onChange={(s) => onChange(t.id, s)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `AttributeObservationFields` (TDD).** Write `web/components/map/AttributeObservationFields.test.tsx`: a fixture of `AttributeGroup[]` renders boolean Yes/No/Unknown radios + an enum select; selecting calls `onChange(attributeTypeId, value)`; default shown is Unknown. Implement `AttributeObservationFields.tsx`. Run → PASS.

```tsx
// web/components/map/AttributeObservationFields.tsx
"use client";
import type { AttributeGroup } from "../../lib/catalog";

export function AttributeObservationFields({
  groups,
  value,
  onChange,
}: {
  groups: AttributeGroup[];
  value: Record<number, string>;
  onChange: (attributeTypeId: number, v: string) => void;
}) {
  if (!groups.length) return null;
  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm font-semibold text-slate-700">Details (optional)</p>
      {groups.map((g) => (
        <fieldset key={g.category}>
          <legend className="text-xs font-semibold uppercase text-slate-500">{g.category}</legend>
          {g.controls.map((c) => {
            const v = value[c.id] ?? "unknown";
            return (
              <div key={c.id} className="mt-1 flex items-center justify-between gap-2">
                <span className="text-sm text-slate-700">{c.name}</span>
                {c.kind === "boolean" ? (
                  <span role="radiogroup" aria-label={c.name} className="flex gap-2 text-xs">
                    {c.options.map((opt) => (
                      <label key={opt} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`attr-${c.id}`}
                          checked={v === opt}
                          onChange={() => onChange(c.id, opt)}
                        />
                        {opt}
                      </label>
                    ))}
                  </span>
                ) : (
                  <select
                    aria-label={c.name}
                    value={v}
                    onChange={(e) => onChange(c.id, e.target.value)}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    {c.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Extend `AddFountainPanel` details step.** Add optional props for the catalog + values + onChange handlers + a `comments` textarea and a `placementNote` input (≤200, live counter). Only render each section when its data is present. Update `AddFountainPanel.test.tsx` with: rating section maps id→stars; attribute unknown is excluded by the parent (assert the onChange contract); placement-note counter caps at 200. The `onSubmit` contract is unchanged. Keep all new props optional so the Task-5 tests stay green.

- [ ] **Step 5: Extend `useAddFountainMode`.** On entering `details` (first time), fire `fetchRatingTypes()` + `fetchAttributeTypes()` (best-effort; on rejection leave the lists empty so the sections are skipped). Hold `ratings`/`observations`/`comments`/`placementNote` in local state; pass them to the panel; include them in the `addFountain(...)` call in `submit` (only non-`unknown` observations; only set ratings; trimmed text). Convert `value` maps to the API arrays before submit.

```ts
// in submit(), build the optional fields:
const ratings = Object.entries(ratingValue)
  .filter(([, stars]) => stars >= 1)
  .map(([id, stars]) => ({ rating_type_id: Number(id), stars }));
const observations = Object.entries(obsValue)
  .filter(([, v]) => v && v !== "unknown")
  .map(([id, v]) => ({ attribute_type_id: Number(id), value: v }));
const res = await addFountain({
  location: { latitude: state.pin.lat, longitude: state.pin.lng },
  is_working: state.working,
  comments: comments.trim() || undefined,
  placement_note: placementNote.trim() || undefined,
  ratings: ratings.length ? ratings : undefined,
  observations: observations.length ? observations : undefined,
});
```

- [ ] **Step 6: The action already accepts the optional fields** (Task 3 `toAddFountainBody` handles them). Add an action test asserting a full payload (ratings + observations + comment + placement note) is forwarded in the POST body. Run `pnpm --filter web exec vitest run app/actions/add-fountain.test.ts` → PASS.

- [ ] **Step 7: Run the web vitest subset + full web mirror.** `pnpm --filter web exec vitest run components/fountain/StarGroup.test.tsx components/fountain/RatingForm.test.tsx components/map/RatingFields.test.tsx components/map/AttributeObservationFields.test.tsx components/map/AddFountainPanel.test.tsx app/actions/add-fountain.test.ts` → PASS. Then `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web` → green (incl. `next build`).

- [ ] **Step 8: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/fountain/StarGroup.tsx web/components/fountain/StarGroup.test.tsx web/components/fountain/RatingForm.tsx web/components/map/RatingFields.tsx web/components/map/RatingFields.test.tsx web/components/map/AttributeObservationFields.tsx web/components/map/AttributeObservationFields.test.tsx web/components/map/AddFountainPanel.tsx web/components/map/AddFountainPanel.test.tsx web/components/map/useAddFountainMode.ts web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts
git add web/components/fountain/StarGroup.tsx web/components/fountain/StarGroup.test.tsx web/components/fountain/RatingForm.tsx web/components/map/RatingFields.tsx web/components/map/RatingFields.test.tsx web/components/map/AttributeObservationFields.tsx web/components/map/AttributeObservationFields.test.tsx web/components/map/AddFountainPanel.tsx web/components/map/AddFountainPanel.test.tsx web/components/map/useAddFountainMode.ts web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts
git commit -m "feat(web): optional rating/attributes/comment/placement-note on add-fountain (slice 6b-2 PR2)"
```

- [ ] **Step 9: Full mirror + open PR 2.** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check` → green. Push, open PR 2, run **Codex Loop B** + address all comments, squash-merge on CI-green + `VERDICT: APPROVED`, deploy, verify per spec §13.

---

## Self-Review (against the spec)

- **§4 entry/auth** → Tasks 5 (FAB), 6 (page server/client split + `?add=1` strip). ✓
- **§5 state machine / coupling containment** → Task 4 (pure reducer), Task 6 (thin `MapBrowser` seam). ✓
- **§6 placement, GPS bound, fallback gate, keyboard path** → Tasks 2 (helpers/constants), 4 (clamp/nudge), 5 (keyboard controls), 6 (GPS + ring glue). ✓
- **§7 details (working PR1; rating/attributes/comment/note PR2)** → Tasks 5 (working), 8–9 (optional fields). ✓
- **§8 action + 409 via openapi-fetch `error` + logging** → Task 3. ✓
- **§9 components** → Tasks 5–6, 8–9 file structure matches. ✓
- **§10 edge cases** → covered across action (401/422/5xx/malformed-409), reducer (no-pin NEXT, preserved-on-error), helpers (clamp/zoom/span gate), FAB (no-WebGL). ✓
- **§11 security** → Task 3 (hostile validation, logging), spec framing (client guard only). ✓
- **§12 style guide** → Tasks 1, 7 (prerequisites). ✓
- **§13 testing** → pure helpers (Task 2), machine (Task 4), action incl. malformed-409 + no-PII-log (Task 3), keyboard-only completion + duplicate link + working default (Task 5), `?add=1` (Task 6), attribute/rating builders + id-mapping (Tasks 8–9). The map glue (Task 6 hook) is covered by `next build` + owner manual verify, as `MapBrowser` already is (jsdom has no WebGL). ✓
- **§15 two-PR sequencing** → Tasks 1–6 (PR1), 7–9 (PR2). ✓
