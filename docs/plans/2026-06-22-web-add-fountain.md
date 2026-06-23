# Web add-fountain flow (slice 6b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an authenticated add-a-fountain flow on the web — an overlay on the home map with tap-to-drop + draggable + keyboard pin placement, a client-side GPS bound (proximity when a fix exists; precision-gated fallback otherwise), working-status capture, 409-duplicate handling, and (PR 2) optional rating / attribute / comment / placement-note capture built dynamically from the live API.

**Architecture:** All logic lives in **pure, unit-tested modules** — geo helpers (`web/lib/map/placement.ts`) and a pure state-machine reducer (`web/lib/add-fountain-machine.ts`). The imperative MapLibre work is hidden behind a narrow **`PlacementMap` adapter** (`web/components/map/placement-map.ts`) so the orchestration hook (`useAddFountainMode`) can be unit-tested against a fake map (jsdom has no WebGL); only the thin adapter itself relies on build + manual verification. Writes go through a Next.js Server Action (`web/app/actions/add-fountain.ts`) that fetches the Logto token server-side and POSTs the typed client; the token never reaches the browser. The GPS bound is a **client-side UX guard, not a security control** (the public create endpoint receives only the pin location).

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), React 19, TypeScript, Tailwind, MapLibre GL JS v5, `@logto/next` 4.2.10, `@fountainrank/api-client` (openapi-typescript + openapi-fetch), Vitest + jsdom + `@testing-library/react`.

**Spec:** `docs/specs/2026-06-22-web-add-fountain-design.md` (Codex-approved). Read it before starting; section refs below point into it.

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time.
- **Claude Code runs on Windows:** file tools use backslash paths (`D:\repos\fountainrank\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`). Any path handed to **Codex** in a review prompt must be **repo-relative** (per `claude_help/codex-review-process.md`).
- **Local mirror gates the PR:** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before PR. Mid-loop: `./run.ps1 check -Web`. Per-web-file: `pnpm --filter web exec vitest run <path>`.
- **`"use server"` export rule:** a `"use server"` module may export **only async functions**. Constants/types shared with the client live in a plain module (`web/lib/add-fountain.ts`). This breaks `next build` (not vitest) if violated — so Task 8 and Task 11 MUST run the full `./run.ps1 check -Web` (incl. `next build`), not just vitest.
- **Web lint/format quirks:** eslint forbids duplicate imports (merge named imports into the existing line from a module); Prettier's Tailwind plugin reorders `className` utilities — run `pnpm --filter web exec prettier --write <files>` before committing so `prettier --check` passes.
- **Security invariants (spec §8, §11):** the API access token lives only in `server-only` modules, never serialized to the client or logged; Server Action arguments are **untrusted** and validated server-side as hostile before any API call; the GPS bound is a client guard only; the action logs **only** `requestId`/action/outcome/status — never coordinates, comments, placement notes, rating/observation values, or the token.
- **Backend is unchanged** (`POST /api/v1/fountains`, `GET /api/v1/rating-types`, `GET /api/v1/attribute-types` already live). No DB migration, no openapi/client regeneration, no new env vars; `serverActions.allowedOrigins` already set in 6b-1.
- **Two PRs:** Tasks 1–8 = **PR 1** (one branch off `main`); Tasks 9–11 = **PR 2** (a fresh branch off updated `main` after PR 1 merges). Each PR: full `./run.ps1 check` green → open PR → Codex Loop B + all comments → squash-merge → deploy → verify.
- **Constants (spec §6):** `BOUND_RADIUS_MIN_M = 150`, `ACCURACY_MAX_M = 1000`, `PLACE_MIN_ZOOM = 16`, `FALLBACK_MAX_SPAN_M = 4000`, `NUDGE_STEP_M = 5`.
- **Add-time `comments` cap:** validate `comments` length ≤ **1000** client-side (the backend leaves it unbounded; cap to match the notes convention).

---

## File Structure

**PR 1 — minimal add:**
- Modify `docs/style-guide.md` — PR-1 elements (Task 1).
- Modify `web/lib/map/constants.ts` — placement constants (Task 2).
- Create `web/lib/map/placement.ts` (+ `placement.test.ts`) — pure geo helpers: `boundFromFix`, `clampToBound`, `inBound`, `haversineMeters`, `canPlace`, `ringFeatureCollection` (Task 2).
- Create `web/lib/add-fountain.ts` (+ `add-fountain.test.ts`) — shared types + `isValidAddFountainInput` + `toAddFountainBody` (Task 3).
- Create `web/app/actions/add-fountain.ts` (+ `web/app/actions/add-fountain.test.ts`) — the `addFountain` Server Action (Task 3).
- Create `web/lib/add-fountain-machine.ts` (+ `add-fountain-machine.test.ts`) — pure add-mode reducer (Task 4).
- Create `web/components/map/AddFountainPanel.tsx` (+ test) and `web/components/map/AddFountainFab.tsx` (+ test) — presentational (Task 5).
- Create `web/components/map/placement-map.ts` — the `PlacementMap` adapter interface + MapLibre impl (Task 6).
- Create `web/components/map/useAddFountainMode.tsx` (+ test) — orchestration hook, unit-tested against a fake `PlacementMap` (Task 7).
- Modify `web/components/map/MapBrowser.tsx`, `web/components/map/MapBrowserLoader.tsx`, `web/app/page.tsx` (+ `web/app/page.test.tsx`) — wiring (Task 8).

**PR 2 — optional fields:**
- Modify `docs/style-guide.md` — PR-2 elements (Task 9).
- Create `web/lib/catalog.ts` (+ `catalog.test.ts`) — `buildAttributeGroups` + module-cached catalog fetches (Task 9).
- Create `web/components/fountain/StarGroup.tsx` (extracted from `RatingForm`, + test); modify `web/components/fountain/RatingForm.tsx` to reuse it (Task 10).
- Create `web/components/map/RatingFields.tsx` + `web/components/map/AttributeObservationFields.tsx` (+ tests); extend `AddFountainPanel`, `useAddFountainMode`, and `addFountain` for the optional fields (Task 11).

---

## PR 1 — minimal add (placement + working + 409)

### Task 1: Style-guide entries for PR-1 UI (prerequisite)

**Files:**
- Modify: `docs/style-guide.md`

Per spec §12, document the new elements before building them: the **Add-fountain FAB** (placement, sizing, signed-out vs signed-in behavior, hidden-when-no-WebGL2), the **placement panel / bottom sheet** (steps: placing → details → result; primary action per step; Cancel/Escape + focus behavior), the **bound ring + pin + coordinate readout + out-of-bound note**, the **keyboard placement controls** ("Place at map center" button + N/S/E/W nudge controls + their disabled state below `PLACE_MIN_ZOOM` / over `FALLBACK_MAX_SPAN_M`), the **"We couldn't confirm your location" fallback message**, the **working-status toggle** (Yes/No, default Yes), and the **duplicate-conflict result** (message + "View it" link).

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
- Produces: constants `BOUND_RADIUS_MIN_M=150`, `ACCURACY_MAX_M=1000`, `PLACE_MIN_ZOOM=16`, `FALLBACK_MAX_SPAN_M=4000`; types `LngLat`, `ViewportBounds`, `Bound`, `GpsFix`; `haversineMeters`, `boundFromFix`, `clampToBound`, `inBound`, `canPlace`, `ringFeatureCollection`.

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
  ringFeatureCollection,
  type Bound,
} from "./placement";

const SEATTLE = { lng: -122.3321, lat: 47.6062 };

describe("haversineMeters", () => {
  it("is ~0 for the same point and ~111km per latitude degree", () => {
    expect(haversineMeters(SEATTLE, SEATTLE)).toBeCloseTo(0, 5);
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
    expect(boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 400 }, vp)).toMatchObject({
      kind: "circle",
      radiusM: 400,
    });
  });
  it("falls back to viewport when no fix or accuracy is too poor", () => {
    expect(boundFromFix({ ok: false }, vp)).toEqual({ kind: "viewport", bounds: vp });
    expect(boundFromFix({ ok: true, lat: 47.6, lng: -122.3, accuracy: 2000 }, vp)).toEqual({
      kind: "viewport",
      bounds: vp,
    });
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
    const clamped = clampToBound({ lng: SEATTLE.lng + 0.05, lat: SEATTLE.lat }, b);
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

describe("ringFeatureCollection", () => {
  it("returns an empty FC for a viewport bound and a closed ring for a circle", () => {
    expect(ringFeatureCollection({ kind: "viewport", bounds: { west: 0, south: 0, east: 1, north: 1 } }).features).toHaveLength(0);
    const fc = ringFeatureCollection({ kind: "circle", center: SEATTLE, radiusM: 150 });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("LineString");
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

// A dashed ring polyline for a circle bound (empty for a viewport bound). Pure -> testable.
export function ringFeatureCollection(bound: Bound | null): GeoJSON.FeatureCollection {
  if (!bound || bound.kind !== "circle") return { type: "FeatureCollection", features: [] };
  const { center, radiusM } = bound;
  const dLat = radiusM / 111320;
  const dLngBase = radiusM / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const coords: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([center.lng + dLngBase * Math.cos(a), center.lat + dLat * Math.sin(a)]);
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }],
  };
}
```

- [ ] **Step 5: Run, verify pass.** `pnpm --filter web exec vitest run lib/map/placement.test.ts` → PASS.

- [ ] **Step 6: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/lib/map/constants.ts web/lib/map/placement.ts web/lib/map/placement.test.ts
git add web/lib/map/constants.ts web/lib/map/placement.ts web/lib/map/placement.test.ts
git commit -m "feat(web): placement geo helpers + bound/zoom gate + ring geometry (slice 6b-2)"
```

---

### Task 3: Shared add-fountain module + the `addFountain` Server Action

**Files:**
- Create: `web/lib/add-fountain.ts` (+ `web/lib/add-fountain.test.ts`)
- Create: `web/app/actions/add-fountain.ts` (+ `web/app/actions/add-fountain.test.ts`)

**Interfaces:**
- Consumes: `getAuthedApiClientForAction` (`web/lib/server/api.ts`), `log` (`web/lib/server/log.ts`), `@fountainrank/api-client` types.
- Produces (plain module): `type AddFountainInput`, `type AddFountainError = "unauthenticated" | "validation" | "server"`, `type AddFountainResult = { ok:true; fountainId:string } | { ok:false; error:"duplicate"; fountainId:string } | { ok:false; error:AddFountainError }`, `isUuid`, `isValidAddFountainInput`, `toAddFountainBody`.
- Produces (`"use server"`): `addFountain(input: AddFountainInput): Promise<AddFountainResult>`.

- [ ] **Step 1: Write the failing test (shared)** — `web/lib/add-fountain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isUuid,
  isValidAddFountainInput,
  toAddFountainBody,
  type AddFountainInput,
} from "./add-fountain";

const base: AddFountainInput = { location: { latitude: 47.6, longitude: -122.3 }, is_working: true };

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
  it("rejects hostile non-object / missing-location shapes", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { is_working: true }] as unknown[]) {
      expect(isValidAddFountainInput(bad as AddFountainInput)).toBe(false);
    }
    expect(
      isValidAddFountainInput({ location: [1, 2] as unknown as AddFountainInput["location"], is_working: true }),
    ).toBe(false);
  });
  it("rejects out-of-range / non-finite coordinates", () => {
    expect(isValidAddFountainInput({ ...base, location: { latitude: 91, longitude: 0 } })).toBe(false);
    expect(isValidAddFountainInput({ ...base, location: { latitude: 0, longitude: 181 } })).toBe(false);
    expect(isValidAddFountainInput({ ...base, location: { latitude: NaN, longitude: 0 } })).toBe(false);
  });
  it("rejects a non-boolean is_working", () => {
    expect(isValidAddFountainInput({ ...base, is_working: "yes" as unknown as boolean })).toBe(false);
  });
  it("rejects oversized comments / placement note", () => {
    expect(isValidAddFountainInput({ ...base, placement_note: "x".repeat(201) })).toBe(false);
    expect(isValidAddFountainInput({ ...base, placement_note: "x".repeat(200) })).toBe(true);
    expect(isValidAddFountainInput({ ...base, comments: "x".repeat(1001) })).toBe(false);
    expect(isValidAddFountainInput({ ...base, comments: "x".repeat(1000) })).toBe(true);
  });
  it("rejects bad ratings / observations (incl. hostile non-arrays and null entries)", () => {
    expect(isValidAddFountainInput({ ...base, ratings: "nope" as unknown as [] })).toBe(false);
    expect(isValidAddFountainInput({ ...base, ratings: [null as unknown as { rating_type_id: number; stars: number }] })).toBe(false);
    expect(isValidAddFountainInput({ ...base, ratings: [{ rating_type_id: 0, stars: 3 }] })).toBe(false);
    expect(isValidAddFountainInput({ ...base, ratings: [{ rating_type_id: 1, stars: 6 }] })).toBe(false);
    expect(isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: "" }] })).toBe(false);
    expect(isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: 9 as unknown as string }] })).toBe(false);
    expect(isValidAddFountainInput({ ...base, observations: [{ attribute_type_id: 1, value: "yes" }] })).toBe(true);
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
  it("includes non-empty rating/observation arrays and trimmed comments", () => {
    const body = toAddFountainBody({
      ...base,
      comments: " hi ",
      ratings: [{ rating_type_id: 1, stars: 4 }],
      observations: [{ attribute_type_id: 2, value: "yes" }],
    });
    expect(body.comments).toBe("hi");
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

export const COMMENTS_MAX = 1000;
export const PLACEMENT_NOTE_MAX = 200;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// A Server Action argument is client-originated regardless of its TS type — validate as hostile
// before any API call (spec §8). Returns true only when every field is well-formed.
export function isValidAddFountainInput(input: AddFountainInput): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const loc = input.location;
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return false;
  const { latitude, longitude } = loc;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return false;
  if (typeof input.is_working !== "boolean") return false;
  if (input.comments != null) {
    if (typeof input.comments !== "string") return false;
    if (input.comments.trim().length > COMMENTS_MAX) return false;
  }
  if (input.placement_note != null) {
    if (typeof input.placement_note !== "string") return false;
    if (input.placement_note.trim().length > PLACEMENT_NOTE_MAX) return false;
  }
  if (input.ratings != null) {
    if (!Array.isArray(input.ratings)) return false;
    for (const r of input.ratings) {
      if (!r || typeof r !== "object") return false;
      if (!Number.isInteger(r.rating_type_id) || r.rating_type_id <= 0) return false;
      if (!Number.isInteger(r.stars) || r.stars < 1 || r.stars > 5) return false;
    }
  }
  if (input.observations != null) {
    if (!Array.isArray(input.observations)) return false;
    for (const o of input.observations) {
      if (!o || typeof o !== "object") return false;
      if (!Number.isInteger(o.attribute_type_id) || o.attribute_type_id <= 0) return false;
      if (typeof o.value !== "string" || o.value.trim().length === 0) return false;
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

- [ ] **Step 5: Write the failing test (action)** — `web/app/actions/add-fountain.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { POST, getClient, log } = vi.hoisted(() => ({ POST: vi.fn(), getClient: vi.fn(), log: vi.fn() }));
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
  it("rejects hostile/malformed payloads BEFORE any API call", async () => {
    const hostile: unknown[] = [
      null,
      [],
      { is_working: true },
      { location: { latitude: 999, longitude: 0 }, is_working: true },
      { location: { latitude: 1, longitude: 1 }, is_working: "x" },
      { location: { latitude: 1, longitude: 1 }, is_working: true, ratings: "nope" },
      { location: { latitude: 1, longitude: 1 }, is_working: true, comments: "x".repeat(1001) },
    ];
    for (const bad of hostile) {
      expect(await addFountain(bad as AddFountainInput)).toEqual({ ok: false, error: "validation" });
    }
    expect(getClient).not.toHaveBeenCalled();
  });

  it("returns the new id on 201 and posts the expected body", async () => {
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

  it("maps 401/422/5xx (each HTTP non-success status logs a warn with status)", async () => {
    POST.mockResolvedValue({ error: {}, response: { status: 401 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "unauthenticated" });
    POST.mockResolvedValue({ error: {}, response: { status: 422 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "validation" });
    POST.mockResolvedValue({ error: {}, response: { status: 503 } });
    expect(await addFountain(input)).toEqual({ ok: false, error: "server" });
    // every non-success branch logged with a status field
    expect(log.mock.calls.every((c) => c[0] === "warn")).toBe(true);
    expect(log.mock.calls.some((c) => c[2]?.status === 401)).toBe(true);
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
    if (status === 401) {
      log("warn", "add-fountain", { requestId, outcome: "unauthenticated", status });
      return { ok: false, error: "unauthenticated" };
    }
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
- Create: `web/lib/add-fountain-machine.ts` (+ `web/lib/add-fountain-machine.test.ts`)

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
    expect(Math.abs(s.pin!.lng - -122.3)).toBeLessThan(0.01);
  });
  it("SET_BOUND re-clamps an existing pin", () => {
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3005, lat: 47.6 } });
    const s = addReducer(dropped, { type: "SET_BOUND", bound: circle });
    expect(s.bound).toEqual(circle);
    expect(s.pin).not.toBeNull();
  });
  it("NUDGE moves the pin and clamps; no-op without a pin", () => {
    expect(addReducer(placing, { type: "NUDGE", dir: "n" }).pin).toBeNull();
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3, lat: 47.6 } });
    expect(addReducer(dropped, { type: "NUDGE", dir: "n" }).pin!.lat).toBeGreaterThan(dropped.pin!.lat);
  });
  it("NEXT requires a pin and only advances from placing; BACK returns", () => {
    expect(addReducer(placing, { type: "NEXT" }).phase).toBe("placing");
    const dropped = addReducer(placing, { type: "DROP_PIN", point: { lng: -122.3, lat: 47.6 } });
    const details = addReducer(dropped, { type: "NEXT" });
    expect(details.phase).toBe("details");
    expect(addReducer(details, { type: "BACK" }).phase).toBe("placing");
  });
  it("SET_WORKING updates the flag", () => {
    expect(addReducer(placing, { type: "SET_WORKING", working: false }).working).toBe(false);
  });
  it("submit lifecycle preserves pin & working on error", () => {
    const details: AddState = { ...placing, phase: "details", pin: { lng: -122.3, lat: 47.6 }, working: false };
    expect(addReducer(details, { type: "SUBMIT_START" }).phase).toBe("submitting");
    expect(addReducer(details, { type: "SUBMIT_DONE", fountainId: "f1" })).toMatchObject({ phase: "done", newId: "f1" });
    expect(addReducer(details, { type: "SUBMIT_DUPLICATE", fountainId: "d1" })).toMatchObject({ phase: "duplicate", duplicateId: "d1" });
    const errored = addReducer(details, { type: "SUBMIT_ERROR", errorKind: "server" });
    expect(errored).toMatchObject({ phase: "error", errorKind: "server" });
    expect(errored.pin).toEqual(details.pin);
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
      return { ...state, pin: state.bound ? clampToBound(action.point, state.bound) : action.point };
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
- Create: `web/components/map/AddFountainPanel.tsx` (+ test)
- Create: `web/components/map/AddFountainFab.tsx` (+ test)

**Interfaces:**
- Consumes: `AddPhase`, `AddFountainError` (Tasks 3–4); `signInWithReturn` (`web/app/actions/auth.ts`).
- Produces:
  - `AddFountainFab({ isAuthenticated, webglOk, onEnter })` — returns `null` when `!webglOk`; signed-out renders a `signInWithReturn("/?add=1")` form; signed-in renders a button calling `onEnter`.
  - `AddFountainPanel(props: AddFountainPanelProps)` — presentational; renders by `phase`; `Escape` calls `onCancel`; focuses the panel on mount; `role="status"` outcomes; the keyboard placement controls are **disabled when `!placeable`** (spec §6).

(Presentational → unit-tested without a map.)

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
    const { container } = render(<AddFountainFab isAuthenticated webglOk={false} onEnter={() => {}} />);
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
    expect(screen.getByRole("button", { name: /add a fountain/i })).toHaveProperty("type", "submit");
    expect(onEnter).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run components/map/AddFountainFab.test.tsx` → FAIL.

- [ ] **Step 3: Implement `AddFountainFab.tsx`:**

```tsx
"use client";
import { signInWithReturn } from "../../app/actions/auth";

const FAB_CLASS =
  "absolute bottom-24 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#F2C200] px-4 py-3 text-sm font-bold text-[#0A357E] shadow-lg transition hover:bg-[#ffce1f]";

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
  if (!isAuthenticated) {
    return (
      <form action={signInWithReturn.bind(null, "/?add=1")} className="contents">
        <button type="submit" className={FAB_CLASS} aria-label="Add a fountain">
          <span aria-hidden="true">+</span> Add a fountain
        </button>
      </form>
    );
  }
  return (
    <button type="button" onClick={onEnter} className={FAB_CLASS} aria-label="Add a fountain">
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

vi.mock("../../app/actions/auth", () => ({ signInWithReturn: vi.fn() }));

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
  it("Escape calls onCancel", () => {
    const onCancel = vi.fn();
    render(<AddFountainPanel {...base} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("placing: keyboard controls are disabled until placeable, then enabled", () => {
    const { rerender } = render(<AddFountainPanel {...base} />);
    expect(screen.getByRole("button", { name: /place at map center/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /next/i })).toHaveProperty("disabled", true);
    rerender(<AddFountainPanel {...base} placeable pin={{ lng: -122.3, lat: 47.6 }} />);
    expect(screen.getByRole("button", { name: /place at map center/i })).toHaveProperty("disabled", false);
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
    render(<AddFountainPanel {...base} phase="details" pin={{ lng: -122.3, lat: 47.6 }} onSetWorking={onSetWorking} />);
    expect(screen.getByRole("radio", { name: /yes/i })).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("radio", { name: /no/i }));
    expect(onSetWorking).toHaveBeenCalledWith(false);
  });

  it("duplicate: shows a View it link to the existing fountain", () => {
    render(<AddFountainPanel {...base} phase="duplicate" duplicateId="dup-1" />);
    expect(screen.getByRole("link", { name: /view it/i }).getAttribute("href")).toBe("/fountains/dup-1");
  });

  it("error (server): shows a retry affordance and an aria-live message", () => {
    render(<AddFountainPanel {...base} phase="error" errorKind="server" pin={{ lng: -122.3, lat: 47.6 }} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("error (unauthenticated): offers sign-in instead of retry", () => {
    render(<AddFountainPanel {...base} phase="error" errorKind="unauthenticated" pin={{ lng: -122.3, lat: 47.6 }} />);
    expect(screen.getByRole("button", { name: /sign in/i })).toHaveProperty("type", "submit");
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
```

- [ ] **Step 6: Run, verify fail.** `pnpm --filter web exec vitest run components/map/AddFountainPanel.test.tsx` → FAIL.

- [ ] **Step 7: Implement `AddFountainPanel.tsx`:**

```tsx
"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { signInWithReturn } from "../../app/actions/auth";
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
  const { phase, onCancel } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [phase, onCancel]);

  if (phase === "idle") return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Add a fountain"
      tabIndex={-1}
      className="absolute inset-x-0 bottom-0 z-40 mx-auto max-w-md rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl outline-none sm:bottom-4 sm:left-auto sm:right-4 sm:mx-0 sm:rounded-2xl"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#0A357E]">Add a fountain</h2>
        <button type="button" onClick={onCancel} aria-label="Cancel" className="rounded p-1 text-slate-500 hover:bg-slate-100">
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
          <p role="status" className="text-sm text-slate-700">A fountain already exists here.</p>
          {props.duplicateId && (
            <Link href={`/fountains/${props.duplicateId}`} className="inline-block rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">
              View it
            </Link>
          )}
        </div>
      )}
      {phase === "error" && (
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm text-red-700">{props.errorKind ? ERROR_COPY[props.errorKind] : ERROR_COPY.server}</p>
          {props.errorKind === "unauthenticated" ? (
            // An expired session can't be retried — send the user back through sign-in (spec §8),
            // returning to the add flow. A "use server" action must run from a form action, not onClick.
            <form action={signInWithReturn.bind(null, "/?add=1")}>
              <button type="submit" className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">
                Sign in
              </button>
            </form>
          ) : (
            <button type="button" onClick={props.onSubmit} className="rounded-full bg-[#0A357E] px-4 py-2 text-sm font-bold text-white">
              Try again
            </button>
          )}
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
  const dirs = { n: "north", s: "south", e: "east", w: "west" } as const;
  const glyph = { n: "↑", s: "↓", e: "→", w: "←" } as const;
  return (
    <div>
      <p className="mt-1 text-sm text-slate-600">Tap the map where the fountain is, then drag the pin to fine-tune.</p>
      {props.gpsUnavailable && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          We couldn&rsquo;t confirm your location — make sure the pin is exactly where the fountain is.
        </p>
      )}
      {!props.placeable && (
        <p className="mt-2 text-xs text-slate-500">Zoom in to place the fountain.</p>
      )}
      <Coord pin={props.pin} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onPlaceAtCenter}
          disabled={!props.placeable}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-40"
        >
          Place at map center
        </button>
        <span className="inline-flex gap-1">
          {(["n", "s", "e", "w"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => props.onNudge(d)}
              disabled={!props.pin || !props.placeable}
              aria-label={`Nudge ${dirs[d]}`}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-40"
            >
              {glyph[d]}
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
            <input type="radio" name="working" checked={props.working} onChange={() => props.onSetWorking(true)} />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="working" checked={!props.working} onChange={() => props.onSetWorking(false)} />
            No
          </label>
        </div>
      </fieldset>
      <div className="mt-4 flex justify-between">
        <button type="button" onClick={props.onBack} className="text-sm text-slate-600 underline">Back</button>
        <button type="button" onClick={props.onSubmit} className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">
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
git commit -m "feat(web): AddFountainPanel + FAB (keyboard placement, Escape/focus, gated controls) (slice 6b-2)"
```

---

### Task 6: `PlacementMap` adapter (imperative MapLibre glue, behind a testable interface)

**Files:**
- Create: `web/components/map/placement-map.ts`

**Interfaces:**
- Consumes: `maplibre-gl`, `Bound`/`LngLat`/`ViewportBounds`/`ringFeatureCollection` (Task 2), `PLACE_MIN_ZOOM` (Task 2).
- Produces:
  - `interface PlacementMap { getZoom(): number; getCenter(): LngLat; getViewport(): ViewportBounds; flyToFix(center: LngLat): void; subscribe(h: { onClick: (p: LngLat) => void; onMoveEnd: () => void }): () => void; setPin(p: LngLat | null, onDragEnd: (p: LngLat) => void): void; setRing(bound: Bound | null): void; teardown(): void }`
  - `createPlacementMap(map: maplibregl.Map): PlacementMap`.

This is the **only** module that touches MapLibre imperatively. It has no decision logic — it is verified by `tsc`/`next build` + the owner manual verify (§13), exactly as `MapBrowser` is. All decisions live in Tasks 2/4/7.

- [ ] **Step 1: Implement** — `web/components/map/placement-map.ts`:

```ts
import maplibregl from "maplibre-gl";
import { PLACE_MIN_ZOOM } from "../../lib/map/constants";
import { ringFeatureCollection, type Bound, type LngLat, type ViewportBounds } from "../../lib/map/placement";

const RING_SOURCE = "add-bound";
const RING_LAYER = "add-bound-line";

export interface PlacementMap {
  getZoom(): number;
  getCenter(): LngLat;
  getViewport(): ViewportBounds;
  flyToFix(center: LngLat): void;
  subscribe(h: { onClick: (p: LngLat) => void; onMoveEnd: () => void }): () => void;
  setPin(p: LngLat | null, onDragEnd: (p: LngLat) => void): void;
  setRing(bound: Bound | null): void;
  teardown(): void;
}

export function createPlacementMap(map: maplibregl.Map): PlacementMap {
  let marker: maplibregl.Marker | null = null;

  function ensureRing() {
    if (map.getSource(RING_SOURCE)) return;
    map.addSource(RING_SOURCE, { type: "geojson", data: ringFeatureCollection(null) });
    map.addLayer({
      id: RING_LAYER,
      type: "line",
      source: RING_SOURCE,
      paint: { "line-color": "#0A357E", "line-opacity": 0.4, "line-dasharray": [2, 2] },
    });
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
      map.easeTo({ center: [center.lng, center.lat], zoom: Math.max(map.getZoom(), PLACE_MIN_ZOOM) }),
    subscribe: ({ onClick, onMoveEnd }) => {
      const click = (e: maplibregl.MapMouseEvent) => onClick({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      const move = () => onMoveEnd();
      map.on("click", click);
      map.on("moveend", move);
      return () => {
        map.off("click", click);
        map.off("moveend", move);
      };
    },
    setPin: (p, onDragEnd) => {
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      if (!marker) {
        marker = new maplibregl.Marker({ draggable: true, color: "#0A357E" });
        marker.on("dragend", () => {
          const ll = marker!.getLngLat();
          onDragEnd({ lng: ll.lng, lat: ll.lat });
        });
        marker.setLngLat([p.lng, p.lat]).addTo(map);
      } else {
        marker.setLngLat([p.lng, p.lat]);
      }
    },
    setRing: (bound) => {
      ensureRing();
      const src = map.getSource(RING_SOURCE) as maplibregl.GeoJSONSource | undefined;
      src?.setData(ringFeatureCollection(bound));
    },
    teardown: () => {
      marker?.remove();
      marker = null;
      if (map.getLayer(RING_LAYER)) map.removeLayer(RING_LAYER);
      if (map.getSource(RING_SOURCE)) map.removeSource(RING_SOURCE);
    },
  };
}
```

- [ ] **Step 2: Typecheck only (no unit test — no WebGL in jsdom).** `pnpm --filter web exec tsc --noEmit` → no errors for this file (full build runs in Task 8).

- [ ] **Step 3: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/map/placement-map.ts
git add web/components/map/placement-map.ts
git commit -m "feat(web): PlacementMap adapter (testable MapLibre seam for add-fountain) (slice 6b-2)"
```

---

### Task 7: `useAddFountainMode` hook (orchestration, unit-tested against a fake `PlacementMap`)

**Files:**
- Create: `web/components/map/useAddFountainMode.tsx`
- Test: `web/components/map/useAddFountainMode.test.tsx`

**Interfaces:**
- Consumes: `PlacementMap` (Task 6), `addReducer`/`initialAddState` (Task 4), `boundFromFix`/`canPlace`/`GpsFix` (Task 2), `addFountain` (Task 3), `AddFountainFab`/`AddFountainPanel` (Task 5), `useRouter`.
- Produces: `useAddFountainMode(placementMap: PlacementMap | null, opts: { isAuthenticated: boolean; webglOk: boolean; autoEnter: boolean; hadAddParam: boolean }): { active: boolean; fab: ReactNode; panel: ReactNode }`.

Design notes that resolve the spec-review findings:
- **`?add=1` is always stripped** when `hadAddParam` (authed or not); auto-enter only additionally when authed (spec §4, review MAJOR 1).
- The FAB receives the **real `webglOk`** (review MAJOR 2).
- Map event handlers read **refs** (`placeableRef`, `boundRef`) so there is no stale closure and no re-subscription churn (review MAJOR 3).
- `DROP_PIN` (map click) and `placeAtCenter` are **gated on `placeable`** before dispatch; keyboard controls are disabled in the panel when `!placeable` (review MAJOR 4).
- `fix` is **reset to `{ ok:false }` on every `enter`** before requesting a new position (review MINOR).

- [ ] **Step 1: Write the failing test** — `web/components/map/useAddFountainMode.test.tsx` (a harness component drives the hook against a fake `PlacementMap`):

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlacementMap } from "./placement-map";

const { addFountain, replace, push } = vi.hoisted(() => ({
  addFountain: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("../../app/actions/add-fountain", () => ({ addFountain }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));

import { useAddFountainMode } from "./useAddFountainMode";

function makeFakeMap(zoom = 17) {
  const calls = { pin: [] as ({ lng: number; lat: number } | null)[], ring: [] as unknown[], flyTo: [] as unknown[], unsub: 0, torn: 0 };
  let onClick: ((p: { lng: number; lat: number }) => void) | null = null;
  const map: PlacementMap = {
    getZoom: () => zoom,
    getCenter: () => ({ lng: -122.3, lat: 47.6 }),
    getViewport: () => ({ west: -122.305, south: 47.598, east: -122.295, north: 47.602 }),
    flyToFix: (c) => calls.flyTo.push(c),
    subscribe: (h) => {
      onClick = h.onClick;
      return () => {
        calls.unsub++;
      };
    },
    setPin: (p) => calls.pin.push(p),
    setRing: (b) => calls.ring.push(b),
    teardown: () => {
      calls.torn++;
    },
  };
  return { map, calls, click: (p: { lng: number; lat: number }) => onClick?.(p) };
}

function Harness({ map, opts }: { map: PlacementMap | null; opts: Parameters<typeof useAddFountainMode>[1] }) {
  const { fab, panel } = useAddFountainMode(map, opts);
  return (
    <div>
      {fab}
      {panel}
    </div>
  );
}

const geo = { getCurrentPosition: vi.fn() };
beforeEach(() => {
  Object.defineProperty(global.navigator, "geolocation", { value: geo, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAddFountainMode", () => {
  it("FAB is null when WebGL is unavailable", () => {
    const { map } = makeFakeMap();
    render(<Harness map={map} opts={{ isAuthenticated: true, webglOk: false, autoEnter: false, hadAddParam: false }} />);
    expect(screen.queryByRole("button", { name: /add a fountain/i })).toBeNull();
  });

  it("entering requests geolocation and shows the placing panel", () => {
    geo.getCurrentPosition.mockImplementation((_ok, err) => err({ code: 1 }));
    const { map } = makeFakeMap();
    render(<Harness map={map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    expect(geo.getCurrentPosition).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /add a fountain/i })).toBeTruthy();
    // no GPS -> fallback copy
    expect(screen.getByText(/couldn.t confirm your location/i)).toBeTruthy();
  });

  it("a map click at street zoom drops a pin; below-zoom click is ignored", () => {
    geo.getCurrentPosition.mockImplementation((_ok, err) => err({ code: 1 }));
    const low = makeFakeMap(10);
    const { rerender } = render(
      <Harness map={low.map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => low.click({ lng: -122.3, lat: 47.6 }));
    expect(screen.getByText(/drop a pin to set the location/i)).toBeTruthy(); // still no pin (gated)

    const ok = makeFakeMap(17);
    rerender(<Harness map={ok.map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    expect(screen.getByText(/lat 47\.6/i)).toBeTruthy(); // pin coord readout
  });

  it("auto-enters and strips ?add=1 when authed", () => {
    geo.getCurrentPosition.mockImplementation((_ok, err) => err({ code: 1 }));
    const { map } = makeFakeMap();
    render(<Harness map={map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: true, hadAddParam: true }} />);
    expect(screen.getByRole("dialog", { name: /add a fountain/i })).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("strips ?add=1 without entering when anonymous", () => {
    const { map } = makeFakeMap();
    render(<Harness map={map} opts={{ isAuthenticated: false, webglOk: true, autoEnter: false, hadAddParam: true }} />);
    expect(screen.queryByRole("dialog", { name: /add a fountain/i })).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("submit success navigates to the new fountain", async () => {
    geo.getCurrentPosition.mockImplementation((_ok, err) => err({ code: 1 }));
    addFountain.mockResolvedValue({ ok: true, fountainId: "new-1" });
    const ok = makeFakeMap(17);
    render(<Harness map={ok.map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add fountain/i }));
    });
    expect(addFountain).toHaveBeenCalledWith(
      expect.objectContaining({ location: { latitude: 47.6, longitude: -122.3 }, is_working: true }),
    );
    expect(push).toHaveBeenCalledWith("/fountains/new-1");
  });

  it("submit duplicate shows the View it link", async () => {
    geo.getCurrentPosition.mockImplementation((_ok, err) => err({ code: 1 }));
    addFountain.mockResolvedValue({ ok: false, error: "duplicate", fountainId: "dup-9" });
    const ok = makeFakeMap(17);
    render(<Harness map={ok.map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add fountain/i }));
    });
    expect(screen.getByRole("link", { name: /view it/i }).getAttribute("href")).toBe("/fountains/dup-9");
  });

  it("defers stripping ?add=1 until the map exists, then enters exactly once", () => {
    geo.getCurrentPosition.mockImplementation((_ok, err) => err({ code: 1 }));
    const { map } = makeFakeMap();
    const opts = { isAuthenticated: true, webglOk: true, autoEnter: true, hadAddParam: true };
    const { rerender } = render(<Harness map={null} opts={opts} />);
    expect(replace).not.toHaveBeenCalled(); // no map yet -> keep the param
    expect(screen.queryByRole("dialog", { name: /add a fountain/i })).toBeNull();
    rerender(<Harness map={map} opts={opts} />);
    expect(screen.getByRole("dialog", { name: /add a fountain/i })).toBeTruthy();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("treats poor-accuracy GPS as no usable fix (fallback, no recenter)", () => {
    geo.getCurrentPosition.mockImplementation((ok) =>
      ok({ coords: { latitude: 47.6, longitude: -122.3, accuracy: 5000 } }),
    );
    const { map, calls } = makeFakeMap();
    render(<Harness map={map} opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }} />);
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    expect(calls.flyTo).toHaveLength(0);
    expect(screen.getByText(/couldn.t confirm your location/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run components/map/useAddFountainMode.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — `web/components/map/useAddFountainMode.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { addFountain } from "../../app/actions/add-fountain";
import { addReducer, initialAddState } from "../../lib/add-fountain-machine";
import { ACCURACY_MAX_M, GEOLOCATE_TIMEOUT_MS } from "../../lib/map/constants";
import { boundFromFix, canPlace, type GpsFix } from "../../lib/map/placement";
import { AddFountainFab } from "./AddFountainFab";
import { AddFountainPanel } from "./AddFountainPanel";
import type { PlacementMap } from "./placement-map";

export function useAddFountainMode(
  placementMap: PlacementMap | null,
  opts: { isAuthenticated: boolean; webglOk: boolean; autoEnter: boolean; hadAddParam: boolean },
): { active: boolean; fab: ReactNode; panel: ReactNode } {
  const [state, dispatch] = useReducer(addReducer, initialAddState);
  const [fix, setFix] = useState<GpsFix>({ ok: false });
  const [zoom, setZoom] = useState(0);
  const router = useRouter();
  const active = state.phase !== "idle";

  const placeable = state.bound ? canPlace(zoom, state.bound) : false;
  // Refs so the imperative map handlers always read the latest values (no stale closure).
  const placeableRef = useRef(placeable);
  placeableRef.current = placeable;

  const recomputeBound = useCallback(() => {
    if (!placementMap) return;
    dispatch({ type: "SET_BOUND", bound: boundFromFix(fix, placementMap.getViewport()) });
    setZoom(placementMap.getZoom());
  }, [placementMap, fix]);

  const enter = useCallback(() => {
    if (!placementMap) return;
    dispatch({ type: "ENTER" });
    setFix({ ok: false }); // reset stale GPS before the new request
    setZoom(placementMap.getZoom());
    dispatch({ type: "SET_BOUND", bound: boundFromFix({ ok: false }, placementMap.getViewport()) });
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        // Poor accuracy is NOT a usable fix (spec §6): no recenter, fallback bound + copy.
        if (pos.coords.accuracy > ACCURACY_MAX_M) {
          setFix({ ok: false });
          return;
        }
        const f: GpsFix = { ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setFix(f);
        placementMap.flyToFix({ lng: f.lng, lat: f.lat });
      },
      () => setFix({ ok: false }),
      { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
    );
  }, [placementMap]);

  // Auto-enter (authed) + strip ?add=1 (spec §4). Anonymous/sign-in-abandoned strips immediately;
  // the authed auto-enter case DEFERS the strip until the map adapter exists so we don't lose the
  // signal before we can enter (a premature router.replace would drop hadAddParam).
  const autoEnterDoneRef = useRef(false);
  useEffect(() => {
    if (!opts.hadAddParam) return;
    if (opts.autoEnter && opts.isAuthenticated) {
      if (placementMap && !autoEnterDoneRef.current) {
        autoEnterDoneRef.current = true;
        enter();
        router.replace("/");
      }
      return; // still waiting for the map: keep the param until we can enter
    }
    router.replace("/"); // anonymous / not auto-enter: strip without entering
  }, [opts.hadAddParam, opts.autoEnter, opts.isAuthenticated, placementMap, enter, router]);

  // Subscribe map events while active; handlers read refs so they never go stale.
  useEffect(() => {
    if (!placementMap || !active) return;
    const unsub = placementMap.subscribe({
      onClick: (p) => {
        if (placeableRef.current) dispatch({ type: "DROP_PIN", point: p });
      },
      onMoveEnd: () => recomputeBound(),
    });
    return unsub;
  }, [placementMap, active, recomputeBound]);

  // Recompute the bound when the fix changes (after geolocation resolves).
  useEffect(() => {
    if (active) recomputeBound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);

  // Reflect pin + ring imperatively; tear everything down when leaving add-mode.
  useEffect(() => {
    if (!placementMap) return;
    if (!active) {
      placementMap.teardown();
      return;
    }
    placementMap.setPin(state.pin, (p) => dispatch({ type: "DROP_PIN", point: p }));
    placementMap.setRing(state.bound);
  }, [placementMap, active, state.pin, state.bound]);

  const placeAtCenter = useCallback(() => {
    if (!placementMap || !placeableRef.current) return;
    dispatch({ type: "DROP_PIN", point: placementMap.getCenter() });
  }, [placementMap]);

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

  // Hide the FAB while add-mode is active so it can't re-enter and reset an in-progress flow.
  const fab: ReactNode = active ? null : (
    <AddFountainFab isAuthenticated={opts.isAuthenticated} webglOk={opts.webglOk} onEnter={enter} />
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
      onCancel={() => dispatch({ type: "CANCEL" })}
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
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run components/map/useAddFountainMode.test.tsx` → PASS. (If `navigator.geolocation` cannot be redefined in your jsdom, define it via `vi.stubGlobal("navigator", { ...navigator, geolocation: geo })` instead.)

- [ ] **Step 5: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/map/useAddFountainMode.tsx web/components/map/useAddFountainMode.test.tsx
git add web/components/map/useAddFountainMode.tsx web/components/map/useAddFountainMode.test.tsx
git commit -m "feat(web): useAddFountainMode hook (gated drop, ?add=1 strip, submit nav) + fake-map tests (slice 6b-2)"
```

---

### Task 8: Wire into `MapBrowser` / loader / page (PR 1 integration)

**Files:**
- Modify: `web/components/map/MapBrowser.tsx`
- Modify: `web/components/map/MapBrowserLoader.tsx`
- Modify: `web/app/page.tsx`
- Test: `web/app/page.test.tsx` (new)

- [ ] **Step 1: Wire `MapBrowser.tsx`.**
  - Signature: `export default function MapBrowser({ isAuthenticated = false, autoEnterAdd = false, hadAddParam = false }: { isAuthenticated?: boolean; autoEnterAdd?: boolean; hadAddParam?: boolean })`.
  - Add state `const [placementMap, setPlacementMap] = useState<PlacementMap | null>(null)`; inside the existing `map.on("load", ...)` handler (after layers are added), call `setPlacementMap(createPlacementMap(map))`. In the effect cleanup, `setPlacementMap(null)`.
  - Call the hook: `const add = useAddFountainMode(placementMap, { isAuthenticated, webglOk, autoEnter: autoEnterAdd, hadAddParam });`
  - **Suppress browse nav with a ref (no stale closure):** add `const addActiveRef = useRef(false); addActiveRef.current = add.active;` and in `openPin` early-return `if (addActiveRef.current) return;` (also guard the cluster-click handler the same way). Do **not** add `add.active` to the map-init effect deps.
  - In the returned JSX root `<div className="absolute inset-0">`, render `{webglOk && add.fab}` and `{add.panel}` as siblings of the hints, and render `<FountainsInViewList … />` only when `!add.active`: `{!add.active && <FountainsInViewList … />}`.
  - Import `useAddFountainMode` and `createPlacementMap`/`PlacementMap`.

- [ ] **Step 2: Wire `MapBrowserLoader.tsx`:**

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
  hadAddParam,
}: {
  isAuthenticated: boolean;
  autoEnterAdd: boolean;
  hadAddParam: boolean;
}) {
  return (
    <MapBrowser isAuthenticated={isAuthenticated} autoEnterAdd={autoEnterAdd} hadAddParam={hadAddParam} />
  );
}
```

- [ ] **Step 3: Wire `app/page.tsx`** (server component; Next 16 async `searchParams`):

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
  const hadAddParam = add === "1";
  const autoEnterAdd = hadAddParam && isAuthenticated;
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader variant="hero" />
      <main className="relative flex-1">
        <MapBrowserLoader
          isAuthenticated={isAuthenticated}
          autoEnterAdd={autoEnterAdd}
          hadAddParam={hadAddParam}
        />
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-gradient-to-b from-[#0E4DA4] to-[#0A357E] px-6 py-3 text-xs text-white/60">
        <span>&copy; {new Date().getFullYear()} FountainRank</span>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/privacy">Privacy</Link>
        <Link className="underline-offset-4 hover:text-white hover:underline" href="/terms">Terms</Link>
      </footer>
    </div>
  );
}
```

> `getViewer` is called both here and inside `SiteHeader` — that mirrors the existing 6b-1 cost (the dedupe is a deferred follow-up, out of scope). Keep the second call.

- [ ] **Step 4: Write `web/app/page.test.tsx`:**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { getViewer } = vi.hoisted(() => ({ getViewer: vi.fn() }));
vi.mock("../lib/server/viewer", () => ({ getViewer }));
vi.mock("../components/SiteHeader", () => ({ SiteHeader: () => <div data-testid="site-header" /> }));
vi.mock("../components/map/MapBrowserLoader", () => ({
  default: (p: { isAuthenticated: boolean; autoEnterAdd: boolean; hadAddParam: boolean }) => (
    <div
      data-testid="map"
      data-auth={String(p.isAuthenticated)}
      data-auto={String(p.autoEnterAdd)}
      data-had={String(p.hadAddParam)}
    />
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
  const map = screen.getByTestId("map");
  expect(map.getAttribute("data-auto")).toBe("true");
  expect(map.getAttribute("data-had")).toBe("true");
});

it("flags hadAddParam but does not auto-enter when anonymous", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await Home({ searchParams: Promise.resolve({ add: "1" }) }));
  const map = screen.getByTestId("map");
  expect(map.getAttribute("data-auto")).toBe("false");
  expect(map.getAttribute("data-had")).toBe("true");
});

it("renders the header and no add flags without ?add", async () => {
  getViewer.mockResolvedValue({ state: "anonymous" });
  render(await Home({ searchParams: Promise.resolve({}) }));
  expect(screen.getByTestId("site-header")).toBeTruthy();
  expect(screen.getByTestId("map").getAttribute("data-had")).toBe("false");
});
```

- [ ] **Step 5: Run the web vitest subset.** `pnpm --filter web exec vitest run app/page.test.tsx components/map/useAddFountainMode.test.tsx components/map/AddFountainPanel.test.tsx components/map/AddFountainFab.test.tsx` → PASS.

- [ ] **Step 6: Full local web mirror (incl. `next build`).** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web` → green. Fix any unused-import / Tailwind-order / maplibre-type errors.

- [ ] **Step 7: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/map/MapBrowser.tsx web/components/map/MapBrowserLoader.tsx web/app/page.tsx web/app/page.test.tsx
git add web/components/map/MapBrowser.tsx web/components/map/MapBrowserLoader.tsx web/app/page.tsx web/app/page.test.tsx
git commit -m "feat(web): mount add-fountain mode on the home map (FAB, suppression, ?add=1) (slice 6b-2)"
```

- [ ] **Step 8: Full mirror + open PR 1.** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check` → green. Push, open PR 1, run **Codex Loop B** + address every comment, squash-merge on CI-green + `VERDICT: APPROVED`, deploy, verify per spec §13.

---

## PR 2 — optional fields (rating + attributes + comment + placement note)

> Branch off updated `main` after PR 1 merges. If a Codex/WSL run dirtied the pnpm store, recover first: `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`.

### Task 9: Catalog fetch (module-cached) + `buildAttributeGroups`

**Files:**
- Create: `web/lib/catalog.ts` (+ `web/lib/catalog.test.ts`)

**Interfaces:**
- Produces: `type AttributeControl`, `type AttributeGroup`, `buildAttributeGroups(types)`, `fetchRatingTypes()`, `fetchAttributeTypes()` (module-cached: a successful result is reused for the session; a rejection is **not** cached so a later attempt can retry).

- [ ] **Step 1: Write the failing test** — `web/lib/catalog.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { GET } = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("@fountainrank/api-client", () => ({ makeClient: () => ({ GET }) }));
vi.mock("./api", () => ({ resolveApiBaseUrl: () => "http://api" }));

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
    expect(g.controls[1]).toMatchObject({ kind: "enum", options: ["cold", "ambient", "unknown"] });
  });
});

describe("fetch caching (module-level)", () => {
  beforeEach(() => {
    vi.resetModules(); // fresh module instance -> cleared cache per test
    GET.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("caches a successful rating-types fetch (network hit once)", async () => {
    GET.mockResolvedValue({ data: [{ id: 1, name: "X", description: "", sort_order: 0 }], error: undefined });
    const mod = await import("./catalog");
    await mod.fetchRatingTypes();
    await mod.fetchRatingTypes();
    expect(GET).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failure (a later call retries)", async () => {
    GET.mockResolvedValueOnce({ data: undefined, error: { detail: "boom" } });
    const mod = await import("./catalog");
    await expect(mod.fetchAttributeTypes()).rejects.toThrow();
    GET.mockResolvedValueOnce({ data: [], error: undefined });
    await expect(mod.fetchAttributeTypes()).resolves.toEqual([]);
    expect(GET).toHaveBeenCalledTimes(2);
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
    const options = kind === "enum" ? [...(t.allowed_values ?? []), "unknown"] : ["yes", "no", "unknown"];
    if (!byCat.has(t.category)) {
      byCat.set(t.category, []);
      order.push(t.category);
    }
    byCat.get(t.category)!.push({ id: t.id, key: t.key, name: t.name, description: t.description, kind, options });
  }
  return order.map((category) => ({ category, controls: byCat.get(category)! }));
}

// Module-level session cache: reuse a successful fetch; do NOT cache a rejection (so a later
// attempt retries). Public endpoints — no auth, no token.
let ratingTypes: RatingTypeOut[] | null = null;
let attributeTypes: AttributeTypeOut[] | null = null;

export async function fetchRatingTypes(): Promise<RatingTypeOut[]> {
  if (ratingTypes) return ratingTypes;
  const { data, error } = await makeClient(resolveApiBaseUrl()).GET("/api/v1/rating-types");
  if (error || !data) throw new Error("rating-types fetch failed");
  ratingTypes = data;
  return data;
}

export async function fetchAttributeTypes(): Promise<AttributeTypeOut[]> {
  if (attributeTypes) return attributeTypes;
  const { data, error } = await makeClient(resolveApiBaseUrl()).GET("/api/v1/attribute-types");
  if (error || !data) throw new Error("attribute-types fetch failed");
  attributeTypes = data;
  return data;
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web exec vitest run lib/catalog.test.ts` → PASS.

- [ ] **Step 5: Style-guide + commit.** Add the PR-2 style-guide entries (attribute Yes/No/Unknown + enum controls; the add-flow rating star-group; comment textarea + placement-note input with counters; graceful-skip states), then:

```bash
pnpm --filter web exec prettier --write web/lib/catalog.ts web/lib/catalog.test.ts
git add web/lib/catalog.ts web/lib/catalog.test.ts docs/style-guide.md
git commit -m "feat(web): catalog fetch (session-cached) + buildAttributeGroups; style-guide PR2 entries (slice 6b-2)"
```

---

### Task 10: Extract `StarGroup` (preserve `RatingForm` behavior + accessible names)

**Files:**
- Create: `web/components/fountain/StarGroup.tsx` (+ `web/components/fountain/StarGroup.test.tsx`)
- Modify: `web/components/fountain/RatingForm.tsx`

**Interfaces:**
- Produces: `StarGroup({ id, name, value, onChange }: { id: number; name: string; value: number; onChange: (stars: number) => void })` — one labeled 1–5 radio group; **each radio keeps the existing accessible name** `"{name}: {n} star(s)"` and input id `dim-{id}-star-{n}` so existing `RatingForm` selectors stay valid.

- [ ] **Step 1: Write the failing test** — `web/components/fountain/StarGroup.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StarGroup } from "./StarGroup";

afterEach(cleanup);

describe("StarGroup", () => {
  it("renders per-radio accessible names and reports the chosen star", () => {
    const onChange = vi.fn();
    render(<StarGroup id={7} name="Clarity" value={0} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /clarity: 1 star$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /clarity: 4 stars/i }));
    expect(onChange).toHaveBeenCalledWith(4);
  });
  it("marks the current value checked", () => {
    render(<StarGroup id={7} name="Taste" value={3} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /taste: 3 stars/i })).toHaveProperty("checked", true);
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web exec vitest run components/fountain/StarGroup.test.tsx` → FAIL.

- [ ] **Step 3: Implement `StarGroup.tsx`** (lifted verbatim from the current `RatingForm` per-dimension markup, parameterized):

```tsx
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
    <fieldset className="flex items-center justify-between py-1">
      <legend className="text-sm">{name}</legend>
      <span className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const inputId = `dim-${id}-star-${n}`;
          return (
            <span key={n} className="inline-flex">
              <input
                type="radio"
                id={inputId}
                name={`dim-${id}`}
                value={n}
                checked={value === n}
                aria-label={`${name}: ${n} star${n > 1 ? "s" : ""}`}
                onChange={() => onChange(n)}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                aria-hidden="true"
                className={`cursor-pointer text-lg peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#0A357E] ${
                  value >= n ? "text-[#F2C200]" : "text-slate-300"
                }`}
              >
                ★
              </label>
            </span>
          );
        })}
      </span>
    </fieldset>
  );
}
```

- [ ] **Step 4: Refactor `RatingForm.tsx`** to render `StarGroup` per dimension (no behavior change). Replace the `dimensions.map(...)` `<fieldset>` block with:

```tsx
import { StarGroup } from "./StarGroup";
// ...
{dimensions.map((d) => (
  <StarGroup
    key={d.rating_type_id}
    id={d.rating_type_id}
    name={d.name}
    value={stars[d.rating_type_id] ?? 0}
    onChange={(n) => setStars((s) => ({ ...s, [d.rating_type_id]: n }))}
  />
))}
```

- [ ] **Step 5: Run both, verify green (existing RatingForm tests must still pass).** `pnpm --filter web exec vitest run components/fountain/StarGroup.test.tsx components/fountain/RatingForm.test.tsx` → PASS.

- [ ] **Step 6: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/fountain/StarGroup.tsx web/components/fountain/StarGroup.test.tsx web/components/fountain/RatingForm.tsx
git add web/components/fountain/StarGroup.tsx web/components/fountain/StarGroup.test.tsx web/components/fountain/RatingForm.tsx
git commit -m "refactor(web): extract StarGroup from RatingForm (preserve a11y names) (slice 6b-2)"
```

---

### Task 11: Optional fields in the add flow (rating, attributes, comment, placement note)

**Files:**
- Create: `web/components/map/RatingFields.tsx` (+ test), `web/components/map/AttributeObservationFields.tsx` (+ test)
- Modify: `web/components/map/AddFountainPanel.tsx` (+ test), `web/components/map/useAddFountainMode.tsx` (+ test)

**Interfaces:**
- `RatingFields({ types, value, onChange }: { types: RatingTypeOut[]; value: Record<number, number>; onChange: (id: number, stars: number) => void })` — one `StarGroup` per type, mapping `RatingTypeOut.id → rating_type_id`.
- `AttributeObservationFields({ groups, value, onChange }: { groups: AttributeGroup[]; value: Record<number, string>; onChange: (attributeTypeId: number, v: string) => void })`.
- `AddFountainPanel` gains optional details props: `ratingTypes?`, `attributeGroups?`, `ratingValue?`, `obsValue?`, `comments?`, `placementNote?`, and `onRate?`, `onObserve?`, `onComments?`, `onPlacementNote?` — all optional so Task-5 tests stay green.

- [ ] **Step 1: `RatingFields` (TDD, id-mapping).** `web/components/map/RatingFields.test.tsx`: selecting stars calls `onChange(type.id, n)` — proving the `RatingTypeOut.id → rating_type_id` mapping (a `rating_type_id` mixup fails because `RatingTypeOut` has no such field). Implement:

```tsx
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
    <div className="mt-3 space-y-1">
      <p className="text-sm font-semibold text-slate-700">Rate it (optional)</p>
      {types.map((t) => (
        <StarGroup key={t.id} id={t.id} name={t.name} value={value[t.id] ?? 0} onChange={(s) => onChange(t.id, s)} />
      ))}
    </div>
  );
}
```

Test:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RatingFields } from "./RatingFields";

afterEach(cleanup);

it("maps RatingTypeOut.id to the onChange id", () => {
  const onChange = vi.fn();
  render(
    <RatingFields
      types={[{ id: 11, name: "Coldness", description: "", sort_order: 0 }]}
      value={{}}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: /coldness: 5 stars/i }));
  expect(onChange).toHaveBeenCalledWith(11, 5);
});
```

- [ ] **Step 2: `AttributeObservationFields` (TDD).** `web/components/map/AttributeObservationFields.test.tsx`: a fixture renders boolean Yes/No/Unknown radios + an enum select; default shown is Unknown; selecting calls `onChange(id, value)`. Implement:

```tsx
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
                  <span className="flex gap-2 text-xs">
                    {c.options.map((opt) => (
                      <label key={opt} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`attr-${c.id}`}
                          aria-label={`${c.name}: ${opt}`}
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

- [ ] **Step 3: Extend `AddFountainPanel` details step.** Add the optional props (above) and render, inside `DetailsStep`, after the working toggle and only when data is present: `<RatingFields … />`, `<AttributeObservationFields … />`, a **comment** `<textarea>` (counter, cap `COMMENTS_MAX`), and a **placement-note** single-line `<input>` (counter, cap `PLACEMENT_NOTE_MAX`). Keep all new props optional. Update `AddFountainPanel.test.tsx` with: placement-note input enforces a 200-char cap (counter shown); the comment textarea calls `onComments`. Run the panel test → PASS (and the Task-5 cases still pass).

- [ ] **Step 4: Extend `useAddFountainMode`.** Add local state `ratingValue: Record<number,number>`, `obsValue: Record<number,string>`, `comments: string`, `placementNote: string`, plus `ratingTypes`/`attributeGroups` state. On first transition into `details`, call `fetchRatingTypes()`/`fetchAttributeTypes()` best-effort (`.then(setRatingTypes)` / `.then((t) => setAttributeGroups(buildAttributeGroups(t)))`; on rejection leave empty → sections skip). Pass everything to the panel. In `submit`, build the optional fields and pass them to `addFountain`:

```ts
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

Update `useAddFountainMode.test.tsx` with a case: set a rating + a boolean attribute → submit → `addFountain` called with the mapped `ratings` + `observations` (unknown excluded). Run → PASS.

- [ ] **Step 5: The action already forwards the optional fields** (Task 3 `toAddFountainBody`). Add an action test asserting a full payload (ratings + observations + comment + placement note) is forwarded. Run `pnpm --filter web exec vitest run app/actions/add-fountain.test.ts` → PASS.

- [ ] **Step 6: Run the PR-2 vitest subset + full web mirror.** `pnpm --filter web exec vitest run components/map/RatingFields.test.tsx components/map/AttributeObservationFields.test.tsx components/map/AddFountainPanel.test.tsx components/map/useAddFountainMode.test.tsx components/fountain/RatingForm.test.tsx app/actions/add-fountain.test.ts` → PASS. Then `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Web` → green (incl. `next build`).

- [ ] **Step 7: Format + commit.**

```bash
pnpm --filter web exec prettier --write web/components/map/RatingFields.tsx web/components/map/RatingFields.test.tsx web/components/map/AttributeObservationFields.tsx web/components/map/AttributeObservationFields.test.tsx web/components/map/AddFountainPanel.tsx web/components/map/AddFountainPanel.test.tsx web/components/map/useAddFountainMode.tsx web/components/map/useAddFountainMode.test.tsx web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts
git add web/components/map/RatingFields.tsx web/components/map/RatingFields.test.tsx web/components/map/AttributeObservationFields.tsx web/components/map/AttributeObservationFields.test.tsx web/components/map/AddFountainPanel.tsx web/components/map/AddFountainPanel.test.tsx web/components/map/useAddFountainMode.tsx web/components/map/useAddFountainMode.test.tsx web/app/actions/add-fountain.ts web/app/actions/add-fountain.test.ts
git commit -m "feat(web): optional rating/attributes/comment/placement-note on add-fountain (slice 6b-2 PR2)"
```

- [ ] **Step 8: Full mirror + open PR 2.** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check` → green. Push, open PR 2, run **Codex Loop B** + address all comments, squash-merge on CI-green + `VERDICT: APPROVED`, deploy, verify per spec §13.

---

## Self-Review (against the spec)

- **§4 entry/auth + `?add=1` strip (both authed & anon)** → Task 5 (FAB), Task 7 (hook: `hadAddParam` always strips, `autoEnter` only when authed), Task 8 (page server/client split). ✓
- **§5 state machine / coupling containment** → Task 4 (pure reducer), Task 6 (`PlacementMap` adapter), Task 7 (thin hook), Task 8 (`addActiveRef` suppression — no stale closure). ✓
- **§6 placement, GPS bound, fallback gate, keyboard path, gated drop** → Task 2 (helpers/constants + ring), Task 4 (clamp/nudge), Task 5 (keyboard controls disabled when `!placeable`), Task 7 (drop/center gated on `placeableRef`, fix reset on enter, GPS via adapter). ✓
- **§7 details (working PR1; rating/attributes/comment/note PR2)** → Task 5 (working), Tasks 9–11 (optional fields, catalog cache). ✓
- **§8 action + 409 via openapi-fetch `error` + malformed-409 + 401 log + logging hygiene** → Task 3. ✓
- **§9 components** → Tasks 5–8, 9–11 file structure matches. ✓
- **§10 edge cases** → action (401/422/5xx/malformed-409/hostile), reducer (no-pin NEXT, preserved-on-error), helpers (clamp/zoom/span gate), FAB (no-WebGL), hook (gated drop, fix reset). ✓
- **§11 security** → Task 3 (hostile validation, comments cap, no-PII logging), client-guard-only framing. ✓
- **§12 style guide** → Tasks 1, 9 (prerequisites). ✓
- **§13 testing** → pure helpers + ring (Task 2), machine (Task 4), action incl. hostile + malformed-409 + no-PII-log + 401-log (Task 3), keyboard-only completion + Escape + gated controls + duplicate link + working default (Task 5), hook behavior incl. drop-gating + `?add=1` strip (both) + submit nav/duplicate via a **fake `PlacementMap`** (Task 7), page prop threading (Task 8), attribute/rating builders + id-mapping + StarGroup a11y (Tasks 9–11). The only build+manual-covered module is the thin `PlacementMap` adapter (Task 6), which has no decision logic. ✓
- **§15 two-PR sequencing** → Tasks 1–8 (PR1), 9–11 (PR2). ✓
