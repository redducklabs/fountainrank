# Phase 3a — Web Map Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, no-auth drinking-fountain discovery map at `/` — a branded hero band over a live MapLibre map (self-hosted Protomaps basemap) with bbox-loaded custom pins, clustering, and a tap-to-open fountain detail overlay backed by a real SSR route.

**Architecture:** The web app (Next.js App Router) renders an RSC hero + a client-only MapLibre map. The map loads pins client-side from the live public `GET /api/v1/fountains/bbox` and renders them as GL symbol-layer icons whose state (standard/gold/broken + selected/halo) is precomputed by pure, unit-tested helpers. Tapping a pin opens `/fountains/[id]` as an overlay via parallel + intercepting routes while the map stays mounted. Two small backend changes (expose `ranking_score` on the pin payload; order detail dimensions by `sort_order`) + an api-client regen support it.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4; MapLibre GL JS + the `pmtiles` protocol plugin; vitest (+ jsdom + Testing Library for component tests); FastAPI + SQLAlchemy 2 (async) backend; pnpm + Turborepo monorepo; self-hosted Protomaps basemap on DO Spaces + CDN (Terraform-owned).

**Spec:** `docs/specs/2026-06-20-web-map-browsing-design.md` (read it first; section refs below point into it).

## Global Constraints

- **Conventional Commits**; **no AI attribution**; **no time estimates** anywhere (commits, docs, PR).
- **No secrets / no `.env` writes.** Public browse path has no secrets; never log tokens/PII.
- **IaC is read-only locally** — Terraform `apply`/`import`/`state` and `kubectl apply`/`helm upgrade` are never run by hand; the basemap bucket/CDN + CORS are Terraform-owned, applied via CI; the planet `.pmtiles` upload is an owner runbook step.
- **CI is the source of truth.** Run `./run.ps1 check` (the full local CI mirror) before the PR and after any change; never claim green without running it.
- **TDD** for all pure logic; **frequent commits**; one task at a time.
- **Style-guide house rule:** document every new UI element in `docs/style-guide.md` (Task 17).
- **API contract is `latitude`/`longitude`** everywhere; PostGIS `(lon,lat)` stays confined to `backend/app/geo.py` (do not touch).
- **Named constants** (no magic numbers): `GOLD_THRESHOLD = 4`, `MAX_BBOX_RESULTS = 500` (mirrors backend `settings.max_results`), `MIN_ZOOM = 10`, `DEBOUNCE_MS = 300`, `GEOLOCATE_TIMEOUT_MS = 8000`, `NEIGHBORHOOD_ZOOM = 14`, `DEFAULT_CENTER = [-98.5, 39.8]`, `DEFAULT_ZOOM = 3.5`. Final values are chosen here; tests assert behavior, not literals.
- **Gate before merge:** CI green **AND** Codex `VERDICT: APPROVED` **AND** every PR comment addressed → squash-merge. Deploy is an owner-gated `v*.*.*` tag.

---

## File structure

**Backend (modify):**
- `backend/app/schemas.py` — add `ranking_score` to `FountainPin`.
- `backend/app/routers/fountains.py` — select `ranking_score` in bbox + nearby; order detail dimensions by `sort_order`.
- `backend/tests/test_fountains_api.py` (or the existing fountains test module) — assert the new field + ordering.

**Shared client (regenerate):**
- `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts` — regenerated artifacts (committed).

**Web — new files:**
- `web/lib/map/constants.ts` — the named constants above.
- `web/lib/map/pins.ts` — pure pin-icon/selection + GeoJSON helpers.
- `web/lib/map/bounds.ts` — pure `normalizeBounds` + `shouldLoadPins` + `isAtCap`.
- `web/lib/map/format.ts` — pure rating/vote/pill formatters.
- `web/lib/map/style.ts` — basemap style URL/flavor config (one swappable value) + pin asset URL map (dark-mode-ready hygiene, spec §5.4).
- `web/lib/fountains.ts` — typed pin/detail fetch wrappers over the public client (client bbox + a server detail helper that attaches `X-Request-ID`).
- `web/components/map/MapBrowserLoader.tsx` — `"use client"` loader that `dynamic(() => import("./MapBrowser"), { ssr:false })`.
- `web/components/map/MapBrowser.tsx` — the client map (MapLibre init, moveend→fetch, layers, selection, states).
- `web/components/map/FountainsInViewList.tsx` — accessible DOM list of in-view fountains (keyboard path, spec §7.4).
- `web/components/map/MapStates.tsx` — loading / empty / error toast / "zoom in" hint UI.
- `web/components/fountain/FountainDetail.tsx` — pure presentational detail content (shared by route + overlay).
- `web/components/fountain/DetailOverlay.tsx` — `"use client"` overlay container (side panel / bottom sheet, dismiss/focus-trap).
- `web/app/fountains/[id]/page.tsx` — standalone SSR detail route.
- `web/app/@modal/(.)fountains/[id]/page.tsx` — intercepting overlay route.
- `web/app/@modal/default.tsx` — returns `null`.
- Test files co-located as `*.test.ts` (pure) / `*.test.tsx` (component).

**Web — modify:**
- `web/app/page.tsx` — replace the "coming soon" hero with the hero band + `MapBrowserLoader`.
- `web/app/layout.tsx` — add the `@modal` parallel slot; update metadata copy (drop "Launching soon").
- `web/vitest.config.ts` — add `*.test.tsx` + a jsdom opt-in + setup file.
- `web/package.json` — add `maplibre-gl`, `pmtiles`; dev: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- `docs/style-guide.md` — new map UI elements.
- `README.md` — Software Versions: record the pinned map + test dep versions.

**Infra (Terraform — plan/validate locally only; apply via CI):**
- `infra/terraform/` — the Spaces bucket/CDN for the basemap + **bucket CORS rules** (web origins, `GET`/`HEAD` + `Range`, expose `Accept-Ranges`/`Content-Range`/`Content-Length`).
- `docs/setup/README.md` — owner runbook step for the one-time planet `.pmtiles` + style/glyphs/sprite upload.

---

## Task 1: Backend — `ranking_score` on the pin payload (bbox + nearby)

Spec §4.1. The column is already denormalized on `Fountain` and returned by `FountainDetail`; surface it on `FountainPin` and both list serializers.

**Files:**
- Modify: `backend/app/schemas.py` (`FountainPin`)
- Modify: `backend/app/routers/fountains.py` (`fountains_in_bbox`, `nearby_fountains`)
- Test: `backend/tests/test_fountains_api.py` (use the existing fountains test module/fixtures; confirm the path with `ls backend/tests`)

**Interfaces:**
- Produces: `FountainPin.ranking_score: float | None` present in both `GET /api/v1/fountains/bbox` and `GET /api/v1/fountains` responses.

- [ ] **Step 1: Write the failing tests.** In the existing fountains API test module, seed one fountain with ratings so `ranking_score` is non-null, then assert both endpoints return the field.

```python
async def test_bbox_pin_includes_ranking_score(client, seed_rated_fountain):
    f = seed_rated_fountain  # a fountain with >=1 rating; ranking_score computed
    r = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": -90, "min_lng": -180, "max_lat": 90, "max_lng": 180},
    )
    assert r.status_code == 200
    pin = next(p for p in r.json() if p["id"] == str(f.id))
    assert "ranking_score" in pin
    assert pin["ranking_score"] is not None

async def test_nearby_pin_includes_ranking_score(client, seed_rated_fountain):
    f = seed_rated_fountain
    lat = f_lat(f); lng = f_lng(f)  # use the test's existing coord helper
    r = await client.get("/api/v1/fountains", params={"lat": lat, "lng": lng})
    assert r.status_code == 200
    pin = next(p for p in r.json() if p["id"] == str(f.id))
    assert "ranking_score" in pin and pin["ranking_score"] is not None
```

(Match the existing tests' fixture/style — reuse their client fixture and seeding helper rather than inventing new ones.)

- [ ] **Step 2: Run to verify they fail.**

Run: `cd backend && uv run pytest tests/test_fountains_api.py -k ranking_score -v`
Expected: FAIL — `ranking_score` not in the pin dicts (KeyError / assertion).

- [ ] **Step 3: Add the field to the schema.** In `backend/app/schemas.py`, add to `FountainPin` (after `rating_count`):

```python
class FountainPin(BaseModel):
    id: uuid.UUID
    location: Coordinates
    is_working: bool
    average_rating: float | None
    rating_count: int
    ranking_score: float | None = None
    distance_m: float | None = None
```

- [ ] **Step 4: Select + populate it in both serializers.** In `backend/app/routers/fountains.py`, add `Fountain.ranking_score` to each `select(...)` and pass it through:

In `nearby_fountains` — add `Fountain.ranking_score` to the `select(...)` column list (before `distance`), unpack it in the comprehension, and set `ranking_score=score` on the `FountainPin`:

```python
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                Fountain.ranking_score,
                distance,
            )
            ...
    return [
        FountainPin(
            id=rid, location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working, average_rating=avg, rating_count=count,
            ranking_score=score, distance_m=float(dist),
        )
        for (rid, rlat, rlng, working, avg, count, score, dist) in rows
    ]
```

In `fountains_in_bbox` — add `Fountain.ranking_score` to the `select(...)` (after `rating_count`), unpack it, set `ranking_score=score`, keep `distance_m=None`:

```python
            select(
                Fountain.id,
                latitude_of(Fountain.location),
                longitude_of(Fountain.location),
                Fountain.is_working,
                Fountain.average_rating,
                Fountain.rating_count,
                Fountain.ranking_score,
            )
            ...
    return [
        FountainPin(
            id=rid, location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
            is_working=working, average_rating=avg, rating_count=count,
            ranking_score=score, distance_m=None,
        )
        for (rid, rlat, rlng, working, avg, count, score) in rows
    ]
```

- [ ] **Step 5: Run to verify pass + no regressions.**

Run: `cd backend && uv run pytest tests/test_fountains_api.py -v`
Expected: PASS (new + existing).

- [ ] **Step 6: Commit.**

```bash
git add backend/app/schemas.py backend/app/routers/fountains.py backend/tests/test_fountains_api.py
git commit -m "feat(backend): expose ranking_score on bbox + nearby pin payload"
```

---

## Task 2: Backend — order detail dimensions by `sort_order`

Spec §4.2. The detail serializer orders by `RatingType.id`; change it to `sort_order`. To actually test it, seed rating types whose `sort_order` differs from `id` order.

**Files:**
- Modify: `backend/app/routers/fountains.py` (`serialize_fountain_detail`)
- Test: `backend/tests/test_fountains_api.py`

**Interfaces:**
- Produces: `GET /api/v1/fountains/{id}` returns `dimensions[]` ordered by `RatingType.sort_order`.

- [ ] **Step 1: Write the failing test.** Seed (or override the seed for this test) so a rating type with a higher `id` has a lower `sort_order`, then assert the detail dimensions come back in `sort_order`.

```python
async def test_detail_dimensions_ordered_by_sort_order(session, client, make_rating_types):
    # rating types with id ascending but sort_order intentionally NOT id-order:
    make_rating_types([(1, "Clarity", 2), (2, "Taste", 1)])  # (id, name, sort_order)
    f = await seed_fountain(session)
    r = await client.get(f"/api/v1/fountains/{f.id}")
    names = [d["name"] for d in r.json()["dimensions"]]
    assert names == ["Taste", "Clarity"]  # sort_order 1, 2 — not id order
```

(If the seed is fixed/global, instead assert the returned order equals the rating types sorted by `sort_order` queried from the DB — the point is to bind the test to `sort_order`, not to `id`.)

- [ ] **Step 2: Run to verify it fails.**

Run: `cd backend && uv run pytest tests/test_fountains_api.py -k sort_order -v`
Expected: FAIL — current order is by `id`.

- [ ] **Step 3: Change the ordering.** In `serialize_fountain_detail`, change `.order_by(RatingType.id)` to `.order_by(RatingType.sort_order)`, and add `RatingType.sort_order` to the `group_by` so it is valid under the aggregate:

```python
            .group_by(RatingType.id, RatingType.name, RatingType.sort_order)
            .order_by(RatingType.sort_order)
```

- [ ] **Step 4: Run to verify pass + no regressions.**

Run: `cd backend && uv run pytest tests/test_fountains_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/app/routers/fountains.py backend/tests/test_fountains_api.py
git commit -m "fix(backend): order fountain detail dimensions by sort_order"
```

---

## Task 3: Regenerate the shared api-client

Spec §4. Surface the new `ranking_score` field in the generated TS types.

**Files:**
- Modify (regenerated): `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`

- [ ] **Step 1: Regenerate.**

Run: `./run.ps1 generate`  (= `pnpm run generate` → exports backend OpenAPI then runs `openapi-typescript`)
Expected: `packages/api-client/openapi.json` + `src/schema.d.ts` updated.

- [ ] **Step 2: Verify the field is present.**

Run (Grep): search `packages/api-client/src/schema.d.ts` for `ranking_score`.
Expected: `ranking_score` appears in the `FountainPin` shape (nullable number).

- [ ] **Step 3: Run the api-client checks.**

Run: `./run.ps1 check -ApiClient`
Expected: lint + typecheck + test PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/api-client/openapi.json packages/api-client/src/schema.d.ts
git commit -m "chore(api-client): regenerate for ranking_score on pin payload"
```

---

## Task 4: Web — add map + test dependencies and pin versions

Spec §9, §12. Add MapLibre + pmtiles and the component-test toolchain. Pin the **latest stable** versions (house rule) and record them.

**Files:**
- Modify: `web/package.json`, `README.md` (Software Versions)

- [ ] **Step 1: Determine the latest stable versions.**

Run: `pnpm view maplibre-gl version` and `pnpm view pmtiles version` and `pnpm view @testing-library/react version` and `pnpm view @testing-library/jest-dom version` and `pnpm view jsdom version`.
Record the exact resolved versions; install those exact versions (current majors as a sanity check: `maplibre-gl` v5.x, `pmtiles` v4.x).

- [ ] **Step 2: Install.**

```bash
pnpm --filter web add maplibre-gl pmtiles
pnpm --filter web add -D @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Record versions in `README.md`** under the Software Versions section (exact resolved versions + the date of the check).

- [ ] **Step 4: Verify install + workspace still type-checks.**

Run: `./run.ps1 check -Web -Fast`
Expected: lint + typecheck + test PASS (no map code yet).

- [ ] **Step 5: Commit.**

```bash
git add web/package.json pnpm-lock.yaml README.md
git commit -m "build(web): add maplibre-gl, pmtiles, and component-test deps"
```

---

## Task 5: Web — vitest jsdom + Testing Library setup

Spec §12. Current config is node-env + `*.test.ts` only; component tests need jsdom + `.test.tsx`.

**Files:**
- Modify: `web/vitest.config.ts`
- Create: `web/vitest.setup.ts`

**Interfaces:**
- Produces: `.test.tsx` files run; per-file `// @vitest-environment jsdom` opts a file into jsdom; `@testing-library/jest-dom` matchers are available.

- [ ] **Step 1: Add the setup file.** `web/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Update `web/vitest.config.ts`.**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 3: Smoke test the jsdom opt-in.** Create a throwaway `web/lib/_setupcheck.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("jsdom + testing-library", () => {
  it("renders", () => {
    render(<p>hello</p>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run, confirm pass, then delete the smoke test.**

Run: `pnpm --filter web exec vitest run lib/_setupcheck.test.tsx`
Expected: PASS. Then `rm web/lib/_setupcheck.test.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add web/vitest.config.ts web/vitest.setup.ts
git commit -m "test(web): vitest jsdom + testing-library setup for component tests"
```

---

## Task 6: Web — map constants

**Files:**
- Create: `web/lib/map/constants.ts`

**Interfaces:**
- Produces: the named constants used by every later web task.

- [ ] **Step 1: Write the file.** `web/lib/map/constants.ts`:

```ts
/** Average/ranking thresholds and map tuning. Behavior is tested; values are tunable here. */
export const GOLD_THRESHOLD = 4; // ranking_score strictly greater than this -> gold pin (spec §7.2)

/** Mirrors backend `settings.max_results` (backend/app/config.py). Kept in sync; see Task 9 test. */
export const MAX_BBOX_RESULTS = 500;

export const MIN_ZOOM = 10; // below this we don't fetch (spec §6.1)
export const DEBOUNCE_MS = 300; // moveend debounce
export const GEOLOCATE_TIMEOUT_MS = 8000;
export const NEIGHBORHOOD_ZOOM = 14; // zoom after a successful geolocate
export const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]; // continental US [lng, lat]
export const DEFAULT_ZOOM = 3.5;
```

- [ ] **Step 2: Commit.**

```bash
git add web/lib/map/constants.ts
git commit -m "feat(web): map tuning constants"
```

---

## Task 7: Web — pure pin icon/selection + GeoJSON helpers (TDD)

Spec §7.2. Implements the icon state machine and feature building. Selection is additive.

**Files:**
- Create: `web/lib/map/pins.ts`
- Test: `web/lib/map/pins.test.ts`

**Interfaces:**
- Consumes: `GOLD_THRESHOLD` from `constants.ts`; the generated `FountainPin` type (id, location{latitude,longitude}, is_working, average_rating, rating_count, ranking_score).
- Produces:
  - `basePinIcon(p: PinLike): "pin-broken" | "pin-gold" | "pin-standard"`
  - `selectedSwapIcon(p: PinLike): "pin-selected" | null`
  - `pinsToFeatureCollection(pins: FountainPin[]): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps>`
  - types `PinLike = { is_working: boolean; ranking_score: number | null }`, `PinProps = { id: string; is_working: boolean; ranking_score: number | null; average_rating: number | null; icon: string; pill: string | null }`

- [ ] **Step 1: Write the failing tests.** `web/lib/map/pins.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { basePinIcon, selectedSwapIcon, pinsToFeatureCollection } from "./pins";

const mk = (is_working: boolean, ranking_score: number | null) => ({ is_working, ranking_score });

describe("basePinIcon", () => {
  it("broken beats gold", () => expect(basePinIcon(mk(false, 4.9))).toBe("pin-broken"));
  it("gold only when working and score > 4", () => expect(basePinIcon(mk(true, 4.1))).toBe("pin-gold"));
  it("score exactly 4 is not gold", () => expect(basePinIcon(mk(true, 4))).toBe("pin-standard"));
  it("null score is not gold", () => expect(basePinIcon(mk(true, null))).toBe("pin-standard"));
  it("working unrated is standard", () => expect(basePinIcon(mk(true, null))).toBe("pin-standard"));
});

describe("selectedSwapIcon (additive selection)", () => {
  it("working non-gold swaps to selected", () => expect(selectedSwapIcon(mk(true, 3.2))).toBe("pin-selected"));
  it("broken keeps its icon (halo only)", () => expect(selectedSwapIcon(mk(false, 2))).toBeNull());
  it("gold keeps its icon (halo only)", () => expect(selectedSwapIcon(mk(true, 4.6))).toBeNull());
});

describe("pinsToFeatureCollection", () => {
  it("maps lat/lng to [lng,lat] and computes icon + pill", () => {
    const fc = pinsToFeatureCollection([
      { id: "a", location: { latitude: 10, longitude: 20 }, is_working: true, average_rating: 4.6, rating_count: 9, ranking_score: 4.5 } as any,
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([20, 10]);
    expect(fc.features[0].properties.icon).toBe("pin-gold");
    expect(fc.features[0].properties.pill).toBe("★ 4.6");
  });
});
```

- [ ] **Step 2: Run to verify fail.** `pnpm --filter web exec vitest run lib/map/pins.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement.** `web/lib/map/pins.ts`:

```ts
import type { FountainPin } from "../fountains"; // re-exported generated type (Task 12 also uses it)
import { GOLD_THRESHOLD } from "./constants";
import { formatPill } from "./format";

export type PinLike = { is_working: boolean; ranking_score: number | null };

export function basePinIcon(p: PinLike): "pin-broken" | "pin-gold" | "pin-standard" {
  if (!p.is_working) return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  return "pin-standard";
}

export function selectedSwapIcon(p: PinLike): "pin-selected" | null {
  // Additive: only a working, non-gold pin swaps its icon; broken/gold keep their status icon.
  return p.is_working && !(p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD)
    ? "pin-selected"
    : null;
}

export type PinProps = {
  id: string;
  is_working: boolean;
  ranking_score: number | null;
  average_rating: number | null;
  icon: string;
  pill: string | null;
};

export function pinsToFeatureCollection(
  pins: FountainPin[],
): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps> {
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
        icon: basePinIcon(p),
        pill: formatPill(p.average_rating ?? null),
      },
    })),
  };
}
```

(Define `FountainPin`/`formatPill` in Tasks 12/8; if implementing 7 first, add a local `PinLike`-only test and wire the imports when those land. Recommended order: 6 → 8 → 7 → 9 → ... so imports exist.)

- [ ] **Step 4: Run to verify pass.** `pnpm --filter web exec vitest run lib/map/pins.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/lib/map/pins.ts web/lib/map/pins.test.ts
git commit -m "feat(web): pure pin icon/selection + geojson helpers"
```

---

## Task 8: Web — pure rating/vote/pill formatters (TDD)

Spec §7.1, §8, §12. Null-safe formatting so the map/panel never render `null`/`NaN`.

**Files:**
- Create: `web/lib/map/format.ts`
- Test: `web/lib/map/format.test.ts`

**Interfaces:**
- Produces:
  - `formatPill(avg: number | null): string | null` — `"★ 4.3"` or `null` (unrated → no pill)
  - `formatAverage(avg: number | null): string` — `"4.3"` or `"Not yet rated"`
  - `formatVotes(n: number): string` — `"1 rating"` / `"12 ratings"`
  - `formatDimension(avg: number | null, votes: number): string` — `"★ 4.4 (72)"` or `"Not yet rated"`

- [ ] **Step 1: Write the failing tests.** `web/lib/map/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatPill, formatAverage, formatVotes, formatDimension } from "./format";

describe("formatPill", () => {
  it("rounds to one decimal", () => expect(formatPill(4.26)).toBe("★ 4.3"));
  it("null -> no pill", () => expect(formatPill(null)).toBeNull());
});
describe("formatAverage", () => {
  it("formats", () => expect(formatAverage(3.95)).toBe("4.0"));
  it("null", () => expect(formatAverage(null)).toBe("Not yet rated"));
});
describe("formatVotes", () => {
  it("singular", () => expect(formatVotes(1)).toBe("1 rating"));
  it("plural", () => expect(formatVotes(12)).toBe("12 ratings"));
  it("zero", () => expect(formatVotes(0)).toBe("0 ratings"));
});
describe("formatDimension", () => {
  it("with votes", () => expect(formatDimension(4.4, 72)).toBe("★ 4.4 (72)"));
  it("no votes", () => expect(formatDimension(null, 0)).toBe("Not yet rated"));
});
```

- [ ] **Step 2: Run to verify fail.** `pnpm --filter web exec vitest run lib/map/format.test.ts` → FAIL.

- [ ] **Step 3: Implement.** `web/lib/map/format.ts`:

```ts
const one = (n: number) => n.toFixed(1);

export function formatPill(avg: number | null): string | null {
  return avg == null ? null : `★ ${one(avg)}`;
}
export function formatAverage(avg: number | null): string {
  return avg == null ? "Not yet rated" : one(avg);
}
export function formatVotes(n: number): string {
  return `${n} ${n === 1 ? "rating" : "ratings"}`;
}
export function formatDimension(avg: number | null, votes: number): string {
  return avg == null ? "Not yet rated" : `★ ${one(avg)} (${votes})`;
}
```

- [ ] **Step 4: Run to verify pass.** → PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/lib/map/format.ts web/lib/map/format.test.ts
git commit -m "feat(web): null-safe rating/vote/pill formatters"
```

---

## Task 9: Web — pure bounds normalization + fetch gating (TDD)

Spec §6.1. Defends the strict bbox API (lat/lng ranges, antimeridian).

**Files:**
- Create: `web/lib/map/bounds.ts`
- Test: `web/lib/map/bounds.test.ts`

**Interfaces:**
- Consumes: `MIN_ZOOM`, `MAX_BBOX_RESULTS` from `constants.ts`.
- Produces:
  - `wrapLng(lng: number): number` — into `[-180, 180]`
  - `normalizeBounds(b: RawBounds): { skip: true } | { skip: false; params: BboxParams }` where `RawBounds = { west: number; south: number; east: number; north: number }`, `BboxParams = { min_lat: number; min_lng: number; max_lat: number; max_lng: number }`
  - `shouldLoadPins(zoom: number): boolean`
  - `isAtCap(count: number): boolean`

- [ ] **Step 1: Write the failing tests.** `web/lib/map/bounds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wrapLng, normalizeBounds, shouldLoadPins, isAtCap } from "./bounds";
import { MAX_BBOX_RESULTS } from "./constants";

describe("wrapLng", () => {
  it("passes through in-range", () => expect(wrapLng(20)).toBe(20));
  it("wraps a world-copy longitude", () => expect(wrapLng(200)).toBe(-160));
  it("wraps -200 to 160", () => expect(wrapLng(-200)).toBe(160));
});

describe("normalizeBounds", () => {
  it("emits valid params for a normal viewport", () => {
    const r = normalizeBounds({ west: 10, south: 40, east: 12, north: 42 });
    expect(r).toEqual({ skip: false, params: { min_lat: 40, min_lng: 10, max_lat: 42, max_lng: 12 } });
  });
  it("clamps latitude to [-90, 90]", () => {
    const r = normalizeBounds({ west: 0, south: -120, east: 1, north: 95 });
    expect(r).toEqual({ skip: false, params: { min_lat: -90, min_lng: 0, max_lat: 90, max_lng: 1 } });
  });
  it("wraps world-copy longitudes", () => {
    const r = normalizeBounds({ west: 190, south: 0, east: 200, north: 1 });
    // 190 -> -170, 200 -> -160 ; still west < east after wrap
    expect(r).toEqual({ skip: false, params: { min_lat: 0, min_lng: -170, max_lat: 1, max_lng: -160 } });
  });
  it("skips an antimeridian-crossing viewport", () => {
    // west 170, east 190(->-170): after wrap min_lng 170 > max_lng -170 -> crossing
    expect(normalizeBounds({ west: 170, south: 0, east: 190, north: 1 })).toEqual({ skip: true });
  });
});

describe("shouldLoadPins", () => {
  it("false below MIN_ZOOM", () => expect(shouldLoadPins(9.9)).toBe(false));
  it("true at/above MIN_ZOOM", () => expect(shouldLoadPins(10)).toBe(true));
});

describe("isAtCap", () => {
  it("true at cap", () => expect(isAtCap(MAX_BBOX_RESULTS)).toBe(true));
  it("false below", () => expect(isAtCap(MAX_BBOX_RESULTS - 1)).toBe(false));
});
```

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement.** `web/lib/map/bounds.ts`:

```ts
import { MAX_BBOX_RESULTS, MIN_ZOOM } from "./constants";

export type RawBounds = { west: number; south: number; east: number; north: number };
export type BboxParams = { min_lat: number; min_lng: number; max_lat: number; max_lng: number };

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

export function normalizeBounds(
  b: RawBounds,
): { skip: true } | { skip: false; params: BboxParams } {
  const min_lat = clampLat(b.south);
  const max_lat = clampLat(b.north);
  const min_lng = wrapLng(b.west);
  const max_lng = wrapLng(b.east);
  // After wrapping, a viewport that crosses the antimeridian has min_lng > max_lng.
  // The bbox API rejects this (422); skip the fetch this frame (spec §6.1).
  if (min_lng > max_lng || min_lat > max_lat) return { skip: true };
  return { skip: false, params: { min_lat, min_lng, max_lat, max_lng } };
}

export const shouldLoadPins = (zoom: number) => zoom >= MIN_ZOOM;
export const isAtCap = (count: number) => count >= MAX_BBOX_RESULTS;
```

- [ ] **Step 4: Run to verify pass.** → PASS.

- [ ] **Step 5: Add the cap-constant sync test.** Spec §12 / Codex round-2 note. `web/lib/map/constants.test.ts` — assert `MAX_BBOX_RESULTS` matches the backend value read from the exported OpenAPI artifact (the regenerated `packages/api-client/openapi.json` is the cross-language source of truth we already commit), with a clear comment. If the OpenAPI does not encode the limit, assert against the documented value with a comment pointing at `backend/app/config.py` `max_results` and add a backend test pinning `settings.max_results == 500` (Task 1 module).

```ts
import { describe, expect, it } from "vitest";
import { MAX_BBOX_RESULTS } from "./constants";

// Source of truth: backend `settings.max_results` (backend/app/config.py). The backend
// test `test_max_results_pinned` asserts the backend value is 500; keep these in sync.
describe("MAX_BBOX_RESULTS", () => {
  it("matches the documented backend max_results", () => expect(MAX_BBOX_RESULTS).toBe(500));
});
```

Add the matching backend test in `backend/tests/test_fountains_api.py`:

```python
def test_max_results_pinned():
    from app.config import Settings
    assert Settings().max_results == 500  # mirror in web MAX_BBOX_RESULTS
```

- [ ] **Step 6: Run both.** `pnpm --filter web exec vitest run lib/map/bounds.test.ts lib/map/constants.test.ts` and `cd backend && uv run pytest -k max_results` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add web/lib/map/bounds.ts web/lib/map/bounds.test.ts web/lib/map/constants.test.ts backend/tests/test_fountains_api.py
git commit -m "feat(web): bounds normalization, fetch gating, cap-constant sync"
```

---

## Task 10: Web — fountains fetch wrappers + basemap style config

Spec §5.2, §5.4, §6.2, §9. Typed access to the public API + the single swappable basemap config.

**Files:**
- Create: `web/lib/fountains.ts`, `web/lib/map/style.ts`
- Test: `web/lib/fountains.test.ts`

**Interfaces:**
- Consumes: `getApiClient`/`makeClient` + `resolveApiBaseUrl` (`web/lib/api.ts`), generated schema.
- Produces:
  - re-exported types `FountainPin`, `FountainDetail`, `DimensionSummary` (from the generated schema) so other modules import from one place.
  - `fetchBbox(params: BboxParams, requestId?: string): Promise<FountainPin[]>` (client-side; attaches `X-Request-ID` when given)
  - `getFountainDetailServer(id: string, requestId: string): Promise<{ data?: FountainDetail; status: number }>` (server-only helper attaching `X-Request-ID`, mirroring `account/page.tsx`)
  - `BASEMAP` config in `style.ts`: `{ styleUrl: string; pmtilesUrl: string; flavor: "light" }` from `NEXT_PUBLIC_*` env, and `PIN_ASSETS: Record<"pin-standard"|"pin-selected"|"pin-gold"|"pin-broken", string>` (swappable; spec §5.4).

- [ ] **Step 1: Write the failing test** for `fetchBbox` param/serialization using a mocked client (vitest `vi.mock` of `./api`), asserting it calls `GET /api/v1/fountains/bbox` with the params and returns `data`. (Detail server helper is covered by the route test in Task 13.)

```ts
// web/lib/fountains.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  resolveApiBaseUrl: () => "http://x",
  getApiClient: () => ({
    GET: vi.fn(async (path: string, opts: any) => {
      expect(path).toBe("/api/v1/fountains/bbox");
      expect(opts.params.query).toEqual({ min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 });
      return { data: [{ id: "a" }], error: undefined, response: { status: 200 } };
    }),
  }),
}));

import { fetchBbox } from "./fountains";

describe("fetchBbox", () => {
  it("queries the bbox endpoint and returns data", async () => {
    const pins = await fetchBbox({ min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 });
    expect(pins).toEqual([{ id: "a" }]);
  });
});
```

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement `web/lib/fountains.ts`.**

```ts
import { makeClient } from "@fountainrank/api-client";
import type { components } from "@fountainrank/api-client/schema"; // adjust to the generated export path
import { getApiClient, resolveApiBaseUrl } from "./api";

export type FountainPin = components["schemas"]["FountainPin"];
export type FountainDetail = components["schemas"]["FountainDetail"];
export type DimensionSummary = components["schemas"]["DimensionSummary"];
import type { BboxParams } from "./map/bounds";

export async function fetchBbox(params: BboxParams, requestId?: string): Promise<FountainPin[]> {
  const client = requestId
    ? makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } })
    : getApiClient();
  const { data } = await client.GET("/api/v1/fountains/bbox", { params: { query: params } });
  return data ?? [];
}
```

(Verify the exact generated type path — `openapi-typescript` emits `paths`/`components` in `src/schema.d.ts`; import via the package's export. If only `paths` is exported, derive the types from the path response, e.g. `paths["/api/v1/fountains/bbox"]["get"]["responses"][200]["content"]["application/json"]`.)

Add the server detail helper (in the same file, guarded `import "server-only"` is unnecessary since it's plain fetch logic, but keep it server-invoked):

```ts
export async function getFountainDetailServer(id: string, requestId: string) {
  const client = makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } });
  const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}", {
    params: { path: { fountain_id: id } },
  });
  return { data, status: response?.status ?? 0 };
}
```

- [ ] **Step 4: Implement `web/lib/map/style.ts`.**

```ts
// One swappable basemap config (dark-mode-ready hygiene, spec §5.4). URLs come from
// NEXT_PUBLIC_* env so prod/dev point at the right Spaces/CDN origin.
export const BASEMAP = {
  flavor: "light" as const,
  styleUrl: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? "",
  pmtilesUrl: process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL ?? "",
};

// Swappable so a dark set can be added later (issue #18). Served from /public for now.
export const PIN_ASSETS: Record<"pin-standard" | "pin-selected" | "pin-gold" | "pin-broken", string> = {
  "pin-standard": "/pins/pin-standard.png",
  "pin-selected": "/pins/pin-selected.png",
  "pin-gold": "/pins/pin-gold.png",
  "pin-broken": "/pins/pin-broken.png",
};
```

- [ ] **Step 5: Run to verify pass + typecheck.** `pnpm --filter web exec vitest run lib/fountains.test.ts` then `./run.ps1 check -Web -Fast`.

- [ ] **Step 6: Commit.**

```bash
git add web/lib/fountains.ts web/lib/fountains.test.ts web/lib/map/style.ts
git commit -m "feat(web): typed fountains fetch wrappers + basemap style config"
```

---

## Task 11: Web — pin assets (export from the sheet)

Spec §7.3. Export the chosen variants as transparent, tip-anchored PNGs and verify on the light basemap.

**Files:**
- Create: `web/public/pins/pin-standard.png`, `pin-selected.png`, `pin-gold.png`, `pin-broken.png`
- Source: `docs/logos/pin-only-logo-sheet.png` (working = #3, selected = #1, gold = #4; broken = #3 with the red slash composited)

- [ ] **Step 1: Export** the four PNGs at 2–3× display size (≈ 96 px tall), transparent background, with the visual tip at bottom-center (for `icon-anchor: "bottom"`). Composite the red slash into `pin-broken.png`. (Owner/designer provides exports; if generated programmatically, document the steps.)

- [ ] **Step 2: Verify legibility** against the light basemap at marker scale — if the white/cyan spray washes out, add a subtle outline/shadow on export. (Manual visual check.)

- [ ] **Step 3: Commit.**

```bash
git add web/public/pins/
git commit -m "assets(web): fountain pin variants (standard/selected/gold/broken)"
```

---

## Task 12: Web — `MapBrowser` client component (map init, fetch loop, layers, selection, states)

Spec §5–§7. The MapLibre glue. Logic lives in the tested helpers (Tasks 7–9); this wires them. WebGL can't run headless, so this task is verified manually + by the helper tests; keep it thin.

**Files:**
- Create: `web/components/map/MapBrowser.tsx`, `web/components/map/MapBrowserLoader.tsx`, `web/components/map/MapStates.tsx`

**Interfaces:**
- Consumes: `BASEMAP`, `PIN_ASSETS`, `fetchBbox`, `pinsToFeatureCollection`, `normalizeBounds`, `shouldLoadPins`, `isAtCap`, constants, `selectedSwapIcon`/`basePinIcon`.
- Produces: `<MapBrowser />` (default export) and `<MapBrowserLoader />` (the `"use client"` dynamic wrapper used by `/`).

- [ ] **Step 1: `MapBrowserLoader.tsx`** (the only place `ssr:false` lives — spec §5.1):

```tsx
"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#e9efe7]" aria-hidden />,
});
export default function MapBrowserLoader() {
  return <MapBrowser />;
}
```

- [ ] **Step 2: `MapStates.tsx`** — presentational, pure props (unit-testable):

```tsx
export function ZoomInHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow">
        🔍 Zoom in to see fountains
      </span>
    </div>
  );
}
export function EmptyHint() { /* "No fountains mapped here yet." pill */ }
export function CapHint() { /* "Lots of fountains here — zoom in to see them all." */ }
export function ErrorToast({ onRetry }: { onRetry: () => void }) { /* dismissible + Retry */ }
export function LoadingBar() { /* subtle top progress bar */ }
```

(Write the full markup for each following the style-guide tokens; keep them dumb components driven by `MapBrowser` state.)

- [ ] **Step 3: `MapBrowser.tsx`** — init MapLibre with the pmtiles protocol, register pin images, add the source + layers, wire the debounced moveend fetch, selection, and states. Skeleton (fill in with the real layer paint/layout from MapLibre docs — use Context7 for current API):

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import { BASEMAP, PIN_ASSETS } from "../../lib/map/style";
import { fetchBbox } from "../../lib/fountains";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { normalizeBounds, shouldLoadPins, isAtCap } from "../../lib/map/bounds";
import { DEBOUNCE_MS, DEFAULT_CENTER, DEFAULT_ZOOM, GEOLOCATE_TIMEOUT_MS, NEIGHBORHOOD_ZOOM } from "../../lib/map/constants";
import { FountainsInViewList } from "./FountainsInViewList";
import { CapHint, EmptyHint, ErrorToast, LoadingBar, ZoomInHint } from "./MapStates";

export default function MapBrowser() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map>();
  const router = useRouter();
  const [pins, setPins] = useState<FountainPin[]>([]);
  const [status, setStatus] = useState<"idle"|"loading"|"empty"|"error"|"belowZoom"|"capped">("idle");

  useEffect(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const map = new maplibregl.Map({
      container: ref.current!, style: BASEMAP.styleUrl,
      center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
      trackUserLocation: false, showUserLocation: true,
    }), "top-right");

    map.on("load", async () => {
      await Promise.all(Object.entries(PIN_ASSETS).map(async ([name, url]) => {
        const img = await map.loadImage(url);
        if (!map.hasImage(name)) map.addImage(name, img.data);
      }));
      // source with clustering + layers: clusters (circle+count), unclustered pins
      // (icon-image: ["get","icon"], icon-anchor:"bottom"), rating pill (icon-text-fit
      // pill + text-field, minzoom), selected halo/#1 layer filtered by active id.
      addSourcesAndLayers(map); // implement per MapLibre docs
      // geolocate on load (short timeout) -> flyTo NEIGHBORHOOD_ZOOM; else stay at default.
      void load();
    });

    let t: ReturnType<typeof setTimeout>;
    const onMoveEnd = () => { clearTimeout(t); t = setTimeout(load, DEBOUNCE_MS); };
    map.on("moveend", onMoveEnd);
    // tap handlers: click on cluster -> zoom; click on pin -> router.push(`/fountains/${id}`)

    return () => { clearTimeout(t); map.remove(); maplibregl.removeProtocol("pmtiles"); };

    async function load() {
      const m = mapRef.current!;
      if (!shouldLoadPins(m.getZoom())) { setStatus("belowZoom"); setPins([]); return; }
      const b = m.getBounds();
      const norm = normalizeBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      if (norm.skip) return; // antimeridian/out-of-range: keep prior pins
      setStatus("loading");
      try {
        const data = await fetchBbox(norm.params, crypto.randomUUID());
        setPins(data);
        (m.getSource("fountains") as maplibregl.GeoJSONSource | undefined)?.setData(pinsToFeatureCollection(data));
        setStatus(isAtCap(data.length) ? "capped" : data.length === 0 ? "empty" : "idle");
      } catch (e) {
        console.error("[map] bbox fetch failed", { name: (e as Error).name });
        setStatus("error");
      }
    }
  }, [router]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {status === "loading" && <LoadingBar />}
      {status === "belowZoom" && <ZoomInHint />}
      {status === "empty" && <EmptyHint />}
      {status === "capped" && <CapHint />}
      {status === "error" && <ErrorToast onRetry={() => mapRef.current?.fire("moveend")} />}
      <FountainsInViewList pins={pins} onOpen={(id) => router.push(`/fountains/${id}`)} />
    </div>
  );
}
```

(Use Context7 for the exact MapLibre 5.x APIs — `loadImage` return shape, `GeoJSONSource.setData`, cluster layer config, `icon-text-fit` pill. The selected halo/#1 layer reads the active id from the route — pass it in via a prop from a thin wrapper or `usePathname()`.)

- [ ] **Step 4: Manual verification.** Run the app against a deployed (or local) basemap + the live API; confirm: geolocate-on-load + locate control; pins/clusters render; gold/broken/selected icons + pill behave; zoom-in hint below `MIN_ZOOM`; empty + error states; tap → overlay.

Run: `./run.ps1 web` (set `NEXT_PUBLIC_API_BASE_URL` + the `NEXT_PUBLIC_BASEMAP_*` envs in your shell — never write `.env`).

- [ ] **Step 5: Commit.**

```bash
git add web/components/map/
git commit -m "feat(web): MapBrowser client map — pins, clustering, selection, states"
```

---

## Task 13: Web — fountain detail content + standalone route

Spec §3, §8. The presentational content (tested) + the SSR route with precise 404 behavior.

**Files:**
- Create: `web/components/fountain/FountainDetail.tsx`, `web/app/fountains/[id]/page.tsx`
- Test: `web/components/fountain/FountainDetail.test.tsx`

**Interfaces:**
- Consumes: `FountainDetail` type, `formatAverage`/`formatVotes`/`formatDimension`.
- Produces: `<FountainDetail detail={...} />` (pure presentational); the route renders it inside the standalone page shell.

- [ ] **Step 1: Write the failing component tests.** `web/components/fountain/FountainDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FountainDetail } from "./FountainDetail";

const base = {
  id: "a", location: { latitude: 1, longitude: 2 }, is_working: true,
  comments: null, average_rating: 4.3, rating_count: 128, ranking_score: 4.1,
  created_at: "2026-06-01T00:00:00Z", last_rated_at: "2026-06-17T00:00:00Z",
  dimensions: [
    { rating_type_id: 1, name: "Clarity", average_rating: 4.6, vote_count: 96 },
    { rating_type_id: 4, name: "Appearance", average_rating: null, vote_count: 0 },
  ],
} as any;

describe("FountainDetail", () => {
  it("shows working status + overall + votes", () => {
    render(<FountainDetail detail={base} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
  });
  it("renders out-of-order", () => {
    render(<FountainDetail detail={{ ...base, is_working: false }} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
  it("handles unrated overall + unrated dimension", () => {
    render(<FountainDetail detail={{ ...base, average_rating: null }} />);
    expect(screen.getAllByText("Not yet rated").length).toBeGreaterThan(0);
  });
  it("shows the note only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} />);
    expect(screen.queryByText(/Notes/i)).not.toBeInTheDocument();
    rerender(<FountainDetail detail={{ ...base, comments: "Cold and fast" }} />);
    expect(screen.getByText("Cold and fast")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement `FountainDetail.tsx`** — generic title + status chip; overall stars/avg/votes; per-dimension rows (in returned order); optional note; meta; Directions + Share actions; the "rate in 3b" note. Use `formatAverage`/`formatVotes`/`formatDimension`. (Write the full JSX with the brand tokens from the style guide.)

- [ ] **Step 4: Run to verify pass.** → PASS.

- [ ] **Step 5: Implement the standalone route `web/app/fountains/[id]/page.tsx`** (RSC, `force-dynamic`):

```tsx
import { notFound } from "next/navigation";
import { getFountainDetailServer } from "../../../lib/fountains";
import { log } from "../../../lib/server/log";
import { FountainDetail } from "../../../components/fountain/FountainDetail";

export const dynamic = "force-dynamic";

export default async function FountainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const { data, status } = await getFountainDetailServer(id, requestId);
  if (status === 404) { log("info", "fountain not found", { requestId, id, status }); notFound(); }
  if (!data) { log("error", "failed to load fountain", { requestId, id, status }); /* render error shell */ }
  return <main className="...standalone shell with a back-to-map link...">{data && <FountainDetail detail={data} />}</main>;
}
```

- [ ] **Step 6: Verify 404 returns HTTP 404.** Manual: `curl -i http://localhost:3020/fountains/<nonexistent-uuid>` → status `404`.

- [ ] **Step 7: Commit.**

```bash
git add web/components/fountain/FountainDetail.tsx web/components/fountain/FountainDetail.test.tsx web/app/fountains/
git commit -m "feat(web): fountain detail content + standalone SSR route (404-correct)"
```

---

## Task 14: Web — intercepting overlay route + `@modal` slot

Spec §3. Soft-nav from the map shows the detail as an overlay while the map stays mounted; hard-nav shows the standalone page.

**Files:**
- Create: `web/app/@modal/default.tsx`, `web/app/@modal/(.)fountains/[id]/page.tsx`, `web/components/fountain/DetailOverlay.tsx`
- Modify: `web/app/layout.tsx` (add the `@modal` slot)

**Interfaces:**
- Consumes: `getFountainDetailServer`, `FountainDetail`, `DetailOverlay`.
- Produces: an overlay rendered into the `@modal` slot on soft navigation.

- [ ] **Step 1: `@modal/default.tsx`:**

```tsx
export default function Default() { return null; }
```

- [ ] **Step 2: Add the slot to `layout.tsx`.** Accept and render `modal` alongside `children`:

```tsx
export default function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return (<html lang="en"><body>{children}{modal}</body></html>);
}
```

- [ ] **Step 3: `DetailOverlay.tsx`** (`"use client"`) — a dismissible side panel (desktop) / bottom sheet (mobile) wrapper: backdrop, `router.back()` on close/escape/backdrop, focus trap, role="dialog" + aria-label. Renders `children`.

- [ ] **Step 4: `@modal/(.)fountains/[id]/page.tsx`** (RSC) — fetch detail; if 404, render an in-panel "Fountain not found" state inside `DetailOverlay` (NOT `notFound()` — the underlying map page must stay); else render `<DetailOverlay><FountainDetail detail={data} /></DetailOverlay>`. Log with request id/status.

- [ ] **Step 5: Manual verification.** From the map, tap a pin → overlay opens, map still mounted behind it; Back/escape closes; refresh on `/fountains/[id]` → standalone page; unknown id soft-nav → in-panel not-found; unknown id hard-load → 404 page.

- [ ] **Step 6: Commit.**

```bash
git add web/app/@modal web/app/layout.tsx web/components/fountain/DetailOverlay.tsx
git commit -m "feat(web): intercepting overlay route for fountain detail (map stays mounted)"
```

---

## Task 15: Web — accessible "fountains in view" list

Spec §7.4 (a requirement, not optional). A keyboard/AT path to open any in-view fountain.

**Files:**
- Create: `web/components/map/FountainsInViewList.tsx`
- Test: `web/components/map/FountainsInViewList.test.tsx`

**Interfaces:**
- Consumes: `FountainPin[]`, `formatAverage`, `basePinIcon` (for a status label), an `onOpen(id)` callback, and an optional `activeId`.
- Produces: `<FountainsInViewList pins activeId onOpen />` — a labelled list where each item is a `<button>` opening the fountain; the active item reflects `activeId`.

- [ ] **Step 1: Write the failing test.** `FountainsInViewList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event"; // add dep if not present, or use fireEvent
import { describe, expect, it, vi } from "vitest";
import { FountainsInViewList } from "./FountainsInViewList";

const pins = [
  { id: "a", location: { latitude: 1, longitude: 2 }, is_working: true, average_rating: 4.6, rating_count: 9, ranking_score: 4.5 },
  { id: "b", location: { latitude: 3, longitude: 4 }, is_working: false, average_rating: 2.1, rating_count: 3, ranking_score: 2.0 },
] as any;

describe("FountainsInViewList", () => {
  it("renders one focusable control per fountain and opens on activate", async () => {
    const onOpen = vi.fn();
    render(<FountainsInViewList pins={pins} onOpen={onOpen} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("a");
  });
  it("marks the active item", () => {
    render(<FountainsInViewList pins={pins} activeId="b" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /out of order/i })).toHaveAttribute("aria-current", "true");
  });
});
```

(If `@testing-library/user-event` is not desired, use `fireEvent.click`/`keyDown` instead and drop the dep.)

- [ ] **Step 2: Run to verify fail.** → FAIL.

- [ ] **Step 3: Implement** an accessible, labelled list (`<nav aria-label="Fountains in view">` → `<ul>` → `<li>` → `<button onClick={() => onOpen(id)} aria-current={id === activeId}>`), each button naming the status (Working/Out of order) + rating. Collapsible on mobile but always reachable; visible focus ring. It receives the same `pins` the map shows, so it stays in sync.

- [ ] **Step 4: Run to verify pass.** → PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/components/map/FountainsInViewList.tsx web/components/map/FountainsInViewList.test.tsx
git commit -m "feat(web): accessible fountains-in-view list (keyboard path)"
```

---

## Task 16: Web — homepage hero + map, and metadata

Spec §2.4, §2.9, §9. Replace the "coming soon" page with the hero band + live map; update metadata.

**Files:**
- Modify: `web/app/page.tsx`, `web/app/layout.tsx`

- [ ] **Step 1: Rewrite `web/app/page.tsx`** as an RSC: the brand-gradient hero band (wordmark via `next/image`, gold Sign-in linking `/account`, headline "Find a drinking fountain near you.", the pitch line) sized ~top third, then `<MapBrowserLoader />` filling the rest in a `min-h-dvh` flex column so the map is the lower region (fold cuts through it). Compact hero on mobile (responsive). Keep the footer links (Privacy/Terms/Sign in).

- [ ] **Step 2: Update metadata in `web/app/layout.tsx`** — new `title`/`description`/OpenGraph reflecting the live product; remove "Launching soon."

```ts
const title = "FountainRank — Find drinking fountains near you";
const description =
  "A free, community map of public drinking fountains. See what's nearby, what's working, and how people rate it.";
```

- [ ] **Step 3: Verify build + lint + typecheck.**

Run: `./run.ps1 check -Web`
Expected: PASS (full web check incl. `next build`; `run.ps1` restores the build-mutated tracked files).

- [ ] **Step 4: Manual verification** of `/` desktop + mobile (hero proportion, map visible above the fold, Sign-in works).

- [ ] **Step 5: Commit.**

```bash
git add web/app/page.tsx web/app/layout.tsx
git commit -m "feat(web): homepage hero band + live map at / (and metadata)"
```

---

## Task 17: Style guide — document the new map UI

Spec §11 (house rule).

**Files:**
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Add entries** for: the homepage hero band on `/`, map controls (locate-me + zoom), the pins (standard/selected/gold + broken-slash) and rating pill, cluster bubbles, the detail overlay (side panel + bottom sheet), the accessible fountains-in-view list, and the loading/empty/error/zoom-in states. Each: purpose, structure, states, accessibility, example.

- [ ] **Step 2: Commit.**

```bash
git add docs/style-guide.md
git commit -m "docs(style-guide): map shell, pins, clusters, detail overlay, states"
```

---

## Task 18: Infra — basemap Spaces/CDN + CORS/range (Terraform) + upload runbook

Spec §5.2, §6.2, §14. Terraform-owned; **plan/validate locally only — apply via CI**.

**Files:**
- Modify: `infra/terraform/` (Spaces bucket/CDN for the basemap + bucket **CORS rules**)
- Modify: `docs/setup/README.md` (owner upload runbook)

- [ ] **Step 1: Terraform** — ensure a Spaces bucket + CDN endpoint for the basemap, with **CORS rules** allowing the web origins (`https://fountainrank.com`, `https://www.fountainrank.com`, dev/preview), `GET`/`HEAD` methods, the `Range` request header, and exposing `Accept-Ranges`/`Content-Range`/`Content-Length`. Follow `claude_help/kubernetes-infra.md` and existing TF patterns.

- [ ] **Step 2: Validate locally (read-only).**

Run: `cd infra/terraform && terraform fmt -check && terraform validate && terraform plan` (no `apply`).
Expected: clean plan; the CORS rule appears in the diff.

- [ ] **Step 3: Runbook** — add to `docs/setup/README.md` the one-time owner steps: download a Protomaps daily-build planet `.pmtiles`, upload it + the Light style JSON + glyphs + sprite to the bucket, and the `NEXT_PUBLIC_BASEMAP_*` env values the web app needs.

- [ ] **Step 4: Commit** (apply happens in CI on merge, per IaC rules).

```bash
git add infra/terraform docs/setup/README.md
git commit -m "feat(infra): basemap Spaces/CDN with browser CORS + range; upload runbook"
```

---

## Task 19: Full local CI mirror, PR, Codex Loop B, merge

Spec §15. The gate.

- [ ] **Step 1: Run the full local CI mirror.**

Run: `./run.ps1 check`
Expected: backend (ruff/format/alembic check/pytest) + frontend (lint/prettier/typecheck/test) + web build + mobile checks all PASS. Fix any failure at the root cause and re-run.

- [ ] **Step 2: Open the PR.**

```bash
git push -u origin feat/3a-web-map-browsing
gh pr create --fill
```

- [ ] **Step 3: Get CI green** (`gh pr checks <N>` / `gh run view`). Fix + push until green.

- [ ] **Step 4: Codex Loop B** (PR review) per `claude_help/codex-review-process.md`: invoke Codex in bypass mode (`sandbox: danger-full-access`, `approval-policy: never`, `cwd` = the derived WSL repo path), have it diff `origin/main...HEAD`, post findings on the PR + write `temp/codex-reviews/pr-<N>-review-1.md`. Address every finding (Codex + any other commenter), re-run `./run.ps1 check`, push, re-review. Loop until `VERDICT: APPROVED`.

- [ ] **Step 5: Squash-merge** once CI is green AND Codex APPROVED AND all comments addressed.

```bash
gh pr merge <N> --squash
```

- [ ] **Step 6: Hand back to the owner** for the gated `v*.*.*` deploy tag (do not deploy locally). Confirm the basemap upload + `NEXT_PUBLIC_BASEMAP_*` env + Terraform apply landed via CI, then smoke-check the live map (pins load cross-origin; tiles render cross-origin).

---

## Self-review checklist (author)

- **Spec coverage:** hero+map (T16), basemap+hosting+CORS/range (T10,T18), geolocation (T12), bbox loading+normalization+gate+cap (T9,T12), pins/clusters/states (T7,T11,T12), detail overlay+route+404 (T13,T14), accessible list (T15), ranking_score + sort_order backend + client regen (T1,T2,T3), dark-mode hygiene (T6,T10 — swappable config), style guide (T17), tests (T1,T2,T7,T8,T9,T13,T15), metadata (T16). All spec sections map to a task.
- **Placeholders:** pure-logic tasks have full test+impl code; the MapLibre glue (T12) and overlay (T14) carry concrete skeletons + explicit manual-verification steps because WebGL/route behavior can't be unit-tested headlessly — verify against the live basemap + API.
- **Type consistency:** `FountainPin`/`FountainDetail`/`DimensionSummary` are defined once in `web/lib/fountains.ts` and reused; `BboxParams`/`RawBounds` in `bounds.ts`; `PinProps` in `pins.ts`; icon names (`pin-standard`/`pin-selected`/`pin-gold`/`pin-broken`) are identical across `pins.ts`, `style.ts` (`PIN_ASSETS`), and T11 asset filenames.
