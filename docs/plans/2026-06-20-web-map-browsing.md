# Phase 3a — Web Map Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, no-auth drinking-fountain discovery map at `/` — a branded hero band over a live MapLibre map (self-hosted Protomaps basemap) with bbox-loaded custom pins, clustering, and a tap-to-open fountain detail overlay backed by a real SSR route.

**Architecture:** The web app (Next.js App Router) renders an RSC hero + a client-only MapLibre map. The map loads pins client-side from the live public `GET /api/v1/fountains/bbox` and renders them as GL symbol-layer icons whose state (standard/gold/broken + selected/halo) is computed by pure, unit-tested helpers and pure layer-spec builders. Tapping a pin opens `/fountains/[id]` as an overlay via parallel + intercepting routes while the map stays mounted. Two small backend changes (expose `ranking_score` on the pin payload; order detail dimensions by `sort_order`) + an api-client regen support it.

**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4; MapLibre GL JS + the `pmtiles` protocol plugin; vitest (+ jsdom + Testing Library for component tests); FastAPI + SQLAlchemy 2 (async) backend; pnpm + Turborepo monorepo; self-hosted Protomaps basemap on DO Spaces + CDN (Terraform-owned, applied via CI).

**Spec:** `docs/specs/2026-06-20-web-map-browsing-design.md` (read it first; section refs below point into it).

## Global Constraints

- **Conventional Commits**; **no AI attribution**; **no time estimates** anywhere (commits, docs, PR). Dates (e.g. "version checked 2026-06-20") are allowed; durations are not.
- **No secrets / no `.env` writes.** The public browse path has no secrets; never log tokens/PII. Env var *names* may be documented in README/runbook; never write `.env` files.
- **IaC is read-only locally** — Terraform `apply`/`import`/`state` and `kubectl apply`/`helm upgrade` are never run by hand; the basemap bucket/CDN + CORS are Terraform-owned and applied via CI; the planet `.pmtiles` upload is an owner runbook step.
- **CI is the source of truth.** Run `./run.ps1 check` (the full local CI mirror) before the PR and after any change; never claim green without running it.
- **TDD** for all pure logic; **frequent commits**; one task at a time.
- **Style-guide house rule:** document every new UI element in `docs/style-guide.md` (Task 18).
- **API contract is `latitude`/`longitude`** everywhere; PostGIS `(lon,lat)` stays confined to `backend/app/geo.py` (do not touch).
- **Named constants** (no magic numbers): `GOLD_THRESHOLD = 4`, `MAX_BBOX_RESULTS = 500` (mirrors backend `settings.max_results`), `MIN_ZOOM = 10`, `PILL_MIN_ZOOM = 13`, `DEBOUNCE_MS = 300`, `GEOLOCATE_TIMEOUT_MS = 8000`, `NEIGHBORHOOD_ZOOM = 14`, `DEFAULT_CENTER = [-98.5, 39.8]`, `DEFAULT_ZOOM = 3.5`, `CLUSTER_RADIUS = 60`, `CLUSTER_MAX_ZOOM = 14`. Values are chosen here; tests assert behavior, not literals.
- **Gate before merge:** CI green **AND** Codex `VERDICT: APPROVED` **AND** every PR comment addressed → squash-merge. Deploy is an owner-gated `v*.*.*` tag.

---

## File structure

**Backend (modify):**
- `backend/app/schemas.py` — add `ranking_score` to `FountainPin`.
- `backend/app/routers/fountains.py` — select `ranking_score` in bbox + nearby; order detail dimensions by `sort_order`.
- Tests: `backend/tests/test_fountains_query.py` (bbox/nearby), `backend/tests/test_fountains_detail.py` (detail), `backend/tests/test_config.py` (max_results pin).

**Shared client (modify + regenerate):**
- `packages/api-client/src/index.ts` — re-export `paths`/`components` types.
- `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts` — regenerated artifacts (committed).

**Web — new files:**
- `web/lib/map/constants.ts` — the named constants.
- `web/lib/map/pins.ts` — pure pin-icon/selection + GeoJSON helpers.
- `web/lib/map/bounds.ts` — pure `normalizeBounds` + `shouldLoadPins` + `isAtCap`.
- `web/lib/map/format.ts` — pure rating/vote/pill formatters.
- `web/lib/map/layers.ts` — pure MapLibre source/layer spec builders (tested).
- `web/lib/map/style.ts` — basemap style/flavor config (one swappable value) + pin asset URL map (dark-mode-ready, spec §5.4).
- `web/lib/map/log.ts` — `logMapError` structured client logger.
- `web/lib/fountains.ts` — typed pin/detail fetch wrappers over the public client.
- `web/components/map/MapBrowserLoader.tsx` — `"use client"` `dynamic(ssr:false)` loader.
- `web/components/map/MapBrowser.tsx` — the client map.
- `web/components/map/FountainsInViewList.tsx` — accessible DOM list (spec §7.4).
- `web/components/map/MapStates.tsx` — loading / empty / error / "zoom in" UI.
- `web/components/fountain/FountainDetail.tsx` — pure presentational detail content.
- `web/components/fountain/DetailOverlay.tsx` — `"use client"` overlay container.
- `web/app/fountains/[id]/page.tsx` — standalone SSR detail route.
- `web/app/@modal/(.)fountains/[id]/page.tsx` — intercepting overlay route.
- `web/app/@modal/default.tsx` — returns `null`.
- Tests co-located: `*.test.ts` (pure) / `*.test.tsx` (component).

**Web — modify:** `web/app/page.tsx`, `web/app/layout.tsx`, `web/vitest.config.ts`, `web/package.json`, `docs/style-guide.md`, `README.md`.

**Infra (Terraform — plan/validate locally only; apply via CI):** `infra/terraform/` (basemap Spaces bucket/CDN + CORS), `docs/setup/README.md` (owner runbook).

---

## Task 1: Backend — `ranking_score` on the pin payload (bbox + nearby)

Spec §4.1. The column is already on `Fountain` and returned by `FountainDetail`; surface it on `FountainPin` + both list serializers.

**Files:**
- Modify: `backend/app/schemas.py` (`FountainPin`), `backend/app/routers/fountains.py` (`fountains_in_bbox`, `nearby_fountains`)
- Test: `backend/tests/test_fountains_query.py` (the existing bbox/nearby tests — reuse its client fixture + seeding helpers from `backend/tests/conftest.py`)

**Interfaces:**
- Produces: `FountainPin.ranking_score: float | None` present in `GET /api/v1/fountains/bbox` and `GET /api/v1/fountains`.

- [ ] **Step 1: Note the existing pattern.** `test_fountains_query.py` uses a local `_add(client, lat, lng)` that POSTs a fountain and returns its id; `test_fountains_detail.py` shows POSTing with inline `ratings: [...]`. A fountain created **with** ≥1 rating gets a non-null `ranking_score` (recomputed on rating create, spec §8). Reuse this — no new fixtures.

- [ ] **Step 2: Write the failing tests** in `backend/tests/test_fountains_query.py` (concrete, using the real POST-with-inline-ratings pattern):

```python
async def _add_rated(client, lat, lng):
    resp = await client.post(
        "/api/v1/fountains",
        json={"location": {"latitude": lat, "longitude": lng},
              "ratings": [{"rating_type_id": 1, "stars": 5}]},
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_bbox_pin_includes_ranking_score(client):
    fid = await _add_rated(client, 37.7749, -122.4194)
    resp = await client.get(
        "/api/v1/fountains/bbox",
        params={"min_lat": 37.70, "min_lng": -122.50, "max_lat": 37.80, "max_lng": -122.40},
    )
    assert resp.status_code == 200
    pin = next(p for p in resp.json() if p["id"] == fid)
    assert "ranking_score" in pin and pin["ranking_score"] is not None


async def test_nearby_pin_includes_ranking_score(client):
    fid = await _add_rated(client, 37.7749, -122.4194)
    resp = await client.get(
        "/api/v1/fountains", params={"lat": 37.7749, "lng": -122.4194, "radius_m": 1000}
    )
    assert resp.status_code == 200
    pin = next(p for p in resp.json() if p["id"] == fid)
    assert "ranking_score" in pin and pin["ranking_score"] is not None
```

- [ ] **Step 3: Run to verify fail.** `cd backend && uv run pytest tests/test_fountains_query.py -k ranking_score -v` → FAIL (KeyError / not present).

- [ ] **Step 4: Add the schema field.** In `backend/app/schemas.py`, `FountainPin` (after `rating_count`):

```python
    ranking_score: float | None = None
```

- [ ] **Step 5: Select + populate in both serializers** (`backend/app/routers/fountains.py`). `nearby_fountains`: add `Fountain.ranking_score` to the `select(...)` (before `distance`), unpack `score`, set `ranking_score=score`:

```python
            select(
                Fountain.id, latitude_of(Fountain.location), longitude_of(Fountain.location),
                Fountain.is_working, Fountain.average_rating, Fountain.rating_count,
                Fountain.ranking_score, distance,
            )
            ...
    return [
        FountainPin(id=rid, location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
                    is_working=working, average_rating=avg, rating_count=count,
                    ranking_score=score, distance_m=float(dist))
        for (rid, rlat, rlng, working, avg, count, score, dist) in rows
    ]
```

`fountains_in_bbox`: add `Fountain.ranking_score` (after `rating_count`), unpack `score`, set `ranking_score=score`, keep `distance_m=None`:

```python
            select(
                Fountain.id, latitude_of(Fountain.location), longitude_of(Fountain.location),
                Fountain.is_working, Fountain.average_rating, Fountain.rating_count,
                Fountain.ranking_score,
            )
            ...
    return [
        FountainPin(id=rid, location=Coordinates(latitude=float(rlat), longitude=float(rlng)),
                    is_working=working, average_rating=avg, rating_count=count,
                    ranking_score=score, distance_m=None)
        for (rid, rlat, rlng, working, avg, count, score) in rows
    ]
```

- [ ] **Step 6: Run to verify pass + no regressions.** `cd backend && uv run pytest tests/test_fountains_query.py -v` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add backend/app/schemas.py backend/app/routers/fountains.py backend/tests/test_fountains_query.py
git commit -m "feat(backend): expose ranking_score on bbox + nearby pin payload"
```

---

## Task 2: Backend — order detail dimensions by `sort_order`

Spec §4.2. The serializer orders by `RatingType.id`; change to `sort_order`, and add it to `group_by`.

**Files:**
- Modify: `backend/app/routers/fountains.py` (`serialize_fountain_detail`)
- Test: `backend/tests/test_fountains_detail.py`

**Interfaces:**
- Produces: `GET /api/v1/fountains/{id}` returns `dimensions[]` ordered by `RatingType.sort_order`.

- [ ] **Step 1: Confirm `RatingType` field names** in `backend/app/models.py` (expect `id`, `name`, `description`, `sort_order`) and that the `session` fixture in `conftest.py` is writable.

- [ ] **Step 2: Write the failing test** in `backend/tests/test_fountains_detail.py`. The seed's id-order and sort_order coincide, so insert a probe type whose `sort_order` precedes the seeded ones but whose `id` is highest — it must appear **first** only if ordering is by `sort_order`:

```python
async def test_detail_dimensions_ordered_by_sort_order(client, session):
    from app.models import RatingType
    session.add(RatingType(id=99, name="Zzz", description="probe", sort_order=0))
    await session.commit()
    add = await client.post(
        "/api/v1/fountains", json={"location": {"latitude": 37.7749, "longitude": -122.4194}}
    )
    fid = add.json()["id"]
    resp = await client.get(f"/api/v1/fountains/{fid}")
    names = [d["name"] for d in resp.json()["dimensions"]]
    assert names[0] == "Zzz"  # sort_order 0 -> first (would be LAST if ordered by id)
```

(Adjust the `RatingType(...)` kwargs to the real column names from Step 1.)

- [ ] **Step 3: Run to verify it fails** (or, if seed coincides, confirm via the inserted out-of-order type). `cd backend && uv run pytest tests/test_fountains_detail.py -k sort_order -v`.

- [ ] **Step 4: Change the ordering** in `serialize_fountain_detail`:

```python
            .group_by(RatingType.id, RatingType.name, RatingType.sort_order)
            .order_by(RatingType.sort_order)
```

- [ ] **Step 5: Run to verify pass + no regressions.** `cd backend && uv run pytest tests/test_fountains_detail.py -v` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add backend/app/routers/fountains.py backend/tests/test_fountains_detail.py
git commit -m "fix(backend): order fountain detail dimensions by sort_order"
```

---

## Task 3: api-client — re-export schema types + regenerate

Spec §4. The package only exports `ApiClient`/`makeClient`; `schema.d.ts` exports `paths`/`components` but not via a usable subpath. Re-export them so web can derive types, then regenerate for `ranking_score`.

**Files:**
- Modify: `packages/api-client/src/index.ts`
- Regenerated: `packages/api-client/openapi.json`, `packages/api-client/src/schema.d.ts`

**Interfaces:**
- Produces: `import type { components, paths } from "@fountainrank/api-client"` resolves; `components["schemas"]["FountainPin"]` includes `ranking_score`.

- [ ] **Step 1: Re-export the generated types** from `packages/api-client/src/index.ts` (append):

```ts
export type { paths, components } from "./schema";
```

- [ ] **Step 2: Regenerate.** `./run.ps1 generate` (exports backend OpenAPI → runs `openapi-typescript`). Updates `openapi.json` + `src/schema.d.ts`.

- [ ] **Step 3: Verify the field is present.** Grep `packages/api-client/src/schema.d.ts` for `ranking_score`; confirm it's in the `FountainPin` schema as a nullable number.

- [ ] **Step 4: Run the api-client checks.** `./run.ps1 check -ApiClient` → lint + typecheck + test PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/api-client/src/index.ts packages/api-client/openapi.json packages/api-client/src/schema.d.ts
git commit -m "chore(api-client): re-export schema types; regenerate for ranking_score"
```

---

## Task 4: Web — add map + test dependencies and pin versions

Spec §9, §12.

**Files:** Modify `web/package.json`, `README.md`.

- [ ] **Step 1: Determine latest stable versions.** `pnpm view maplibre-gl version`, `pnpm view pmtiles version`, `pnpm view @testing-library/react version`, `pnpm view @testing-library/jest-dom version`, `pnpm view jsdom version`. Record exact resolved versions (sanity: `maplibre-gl` v5.x, `pmtiles` v4.x).

- [ ] **Step 2: Install.**

```bash
pnpm --filter web add maplibre-gl pmtiles
pnpm --filter web add -D @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Record** the exact resolved versions in `README.md` Software Versions (with the date checked).

- [ ] **Step 4: Verify.** `./run.ps1 check -Web -Fast` → PASS (no map code yet).

- [ ] **Step 5: Commit.**

```bash
git add web/package.json pnpm-lock.yaml README.md
git commit -m "build(web): add maplibre-gl, pmtiles, and component-test deps"
```

---

## Task 5: Web — vitest jsdom + Testing Library setup

Spec §12.

**Files:** Create `web/vitest.setup.ts`; modify `web/vitest.config.ts`.

**Interfaces:** `.test.tsx` files run; per-file `// @vitest-environment jsdom` opts into jsdom; jest-dom matchers available.

- [ ] **Step 1: Setup file** `web/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Update `web/vitest.config.ts`:**

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

- [ ] **Step 3: Smoke test** `web/lib/_setupcheck.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
describe("jsdom", () => {
  it("renders", () => { render(<p>hello</p>); expect(screen.getByText("hello")).toBeInTheDocument(); });
});
```

- [ ] **Step 4: Run + delete.** `pnpm --filter web exec vitest run lib/_setupcheck.test.tsx` → PASS; then `rm web/lib/_setupcheck.test.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add web/vitest.config.ts web/vitest.setup.ts
git commit -m "test(web): vitest jsdom + testing-library setup"
```

---

## Task 6: Web — map constants

**Files:** Create `web/lib/map/constants.ts`.

- [ ] **Step 1: Write the file.**

```ts
/** Thresholds + map tuning. Behavior is tested; values are tunable here. */
export const GOLD_THRESHOLD = 4; // ranking_score strictly greater -> gold (spec §7.2)
export const MAX_BBOX_RESULTS = 500; // pinned contract: mirrors backend settings.max_results (Task 9 test)
export const MIN_ZOOM = 10; // below this we don't fetch (spec §6.1)
export const PILL_MIN_ZOOM = 13; // rating pill appears at/above this zoom
export const DEBOUNCE_MS = 300;
export const GEOLOCATE_TIMEOUT_MS = 8000;
export const NEIGHBORHOOD_ZOOM = 14;
export const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]; // continental US [lng, lat]
export const DEFAULT_ZOOM = 3.5;
export const CLUSTER_RADIUS = 60;
export const CLUSTER_MAX_ZOOM = 14;
```

- [ ] **Step 2: Commit.** `git add web/lib/map/constants.ts && git commit -m "feat(web): map tuning constants"`

---

## Task 7: Web — pure pin icon/selection + GeoJSON helpers (TDD)

Spec §7.2. **Implement Task 8 (format) before this** so the `formatPill` import resolves.

**Files:** Create `web/lib/map/pins.ts`; Test `web/lib/map/pins.test.ts`.

**Interfaces:**
- Consumes: `GOLD_THRESHOLD`, `formatPill`, `FountainPin` type (from `web/lib/fountains.ts`, Task 10 — or accept a structural type to avoid a cycle; see below).
- Produces: `basePinIcon`, `selectedSwapIcon`, `pinsToFeatureCollection`, types `PinLike`, `PinProps`.

To avoid an import cycle with `fountains.ts`, `pins.ts` takes a **structural** pin type, not the generated type:

- [ ] **Step 1: Failing tests** `web/lib/map/pins.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { basePinIcon, selectedSwapIcon, pinsToFeatureCollection } from "./pins";
const mk = (is_working: boolean, ranking_score: number | null) => ({ is_working, ranking_score });

describe("basePinIcon", () => {
  it("broken beats gold", () => expect(basePinIcon(mk(false, 4.9))).toBe("pin-broken"));
  it("gold when working and score > 4", () => expect(basePinIcon(mk(true, 4.1))).toBe("pin-gold"));
  it("score exactly 4 not gold", () => expect(basePinIcon(mk(true, 4))).toBe("pin-standard"));
  it("null score not gold", () => expect(basePinIcon(mk(true, null))).toBe("pin-standard"));
});
describe("selectedSwapIcon (additive)", () => {
  it("working non-gold -> selected", () => expect(selectedSwapIcon(mk(true, 3.2))).toBe("pin-selected"));
  it("broken -> null (halo only)", () => expect(selectedSwapIcon(mk(false, 2))).toBeNull());
  it("gold -> null (halo only)", () => expect(selectedSwapIcon(mk(true, 4.6))).toBeNull());
});
describe("pinsToFeatureCollection", () => {
  it("maps lat/lng -> [lng,lat], computes icon + pill", () => {
    const fc = pinsToFeatureCollection([
      { id: "a", location: { latitude: 10, longitude: 20 }, is_working: true, average_rating: 4.6, rating_count: 9, ranking_score: 4.5 },
    ]);
    expect(fc.features[0].geometry.coordinates).toEqual([20, 10]);
    expect(fc.features[0].properties.icon).toBe("pin-gold");
    expect(fc.features[0].properties.pill).toBe("★ 4.6");
  });
  it("null average -> pill null", () => {
    const fc = pinsToFeatureCollection([
      { id: "b", location: { latitude: 1, longitude: 2 }, is_working: true, average_rating: null, rating_count: 0, ranking_score: null },
    ]);
    expect(fc.features[0].properties.pill).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter web exec vitest run lib/map/pins.test.ts`

- [ ] **Step 3: Implement** `web/lib/map/pins.ts`:

```ts
import { GOLD_THRESHOLD } from "./constants";
import { formatPill } from "./format";

export type PinLike = { is_working: boolean; ranking_score: number | null };
export type PinInput = PinLike & {
  id: string;
  location: { latitude: number; longitude: number };
  average_rating: number | null;
};
export type PinProps = {
  id: string; is_working: boolean; ranking_score: number | null;
  average_rating: number | null; icon: string; pill: string | null;
};

export function basePinIcon(p: PinLike): "pin-broken" | "pin-gold" | "pin-standard" {
  if (!p.is_working) return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  return "pin-standard";
}
export function selectedSwapIcon(p: PinLike): "pin-selected" | null {
  return p.is_working && !(p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD)
    ? "pin-selected" : null;
}
export function pinsToFeatureCollection(
  pins: PinInput[],
): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps> {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.location.longitude, p.location.latitude] },
      properties: {
        id: String(p.id), is_working: p.is_working, ranking_score: p.ranking_score ?? null,
        average_rating: p.average_rating ?? null, icon: basePinIcon(p),
        pill: formatPill(p.average_rating ?? null),
      },
    })),
  };
}
```

(`FountainPin` from the generated client is structurally assignable to `PinInput`; `MapBrowser` passes it directly.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git add web/lib/map/pins.ts web/lib/map/pins.test.ts && git commit -m "feat(web): pure pin icon/selection + geojson helpers"`

---

## Task 8: Web — pure rating/vote/pill formatters (TDD)

Spec §7.1, §8, §12.

**Files:** Create `web/lib/map/format.ts`; Test `web/lib/map/format.test.ts`.

**Interfaces:** `formatPill(avg|null): string|null`, `formatAverage(avg|null): string`, `formatVotes(n): string`, `formatDimension(avg|null, votes): string`, `formatDate(iso): string` ("Jun 2026").

- [ ] **Step 1: Failing tests** `web/lib/map/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatPill, formatAverage, formatVotes, formatDimension, formatDate } from "./format";
describe("formatPill", () => {
  it("rounds 1dp", () => expect(formatPill(4.26)).toBe("★ 4.3"));
  it("null -> null", () => expect(formatPill(null)).toBeNull());
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
describe("formatDate", () => {
  it("month + year (UTC)", () => expect(formatDate("2026-06-01T00:00:00Z")).toBe("Jun 2026"));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `web/lib/map/format.ts`:

```ts
const one = (n: number) => n.toFixed(1);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const formatPill = (avg: number | null) => (avg == null ? null : `★ ${one(avg)}`);
export const formatAverage = (avg: number | null) => (avg == null ? "Not yet rated" : one(avg));
export const formatVotes = (n: number) => `${n} ${n === 1 ? "rating" : "ratings"}`;
export const formatDimension = (avg: number | null, votes: number) =>
  avg == null ? "Not yet rated" : `★ ${one(avg)} (${votes})`;
export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git add web/lib/map/format.ts web/lib/map/format.test.ts && git commit -m "feat(web): null-safe rating/vote/pill formatters"`

---

## Task 9: Web — bounds normalization + fetch gating + cap pin (TDD)

Spec §6.1. Defends the strict bbox API.

**Files:** Create `web/lib/map/bounds.ts`; Tests `web/lib/map/bounds.test.ts`, `web/lib/map/constants.test.ts`; Backend test `backend/tests/test_config.py`.

**Interfaces:** `wrapLng`, `normalizeBounds(RawBounds): {skip:true}|{skip:false;params:BboxParams}`, `shouldLoadPins(zoom): boolean`, `isAtCap(count): boolean`, types `RawBounds`, `BboxParams`.

- [ ] **Step 1: Failing tests** `web/lib/map/bounds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wrapLng, normalizeBounds, shouldLoadPins, isAtCap } from "./bounds";
import { MAX_BBOX_RESULTS } from "./constants";
describe("wrapLng", () => {
  it("in-range", () => expect(wrapLng(20)).toBe(20));
  it("200 -> -160", () => expect(wrapLng(200)).toBe(-160));
  it("-200 -> 160", () => expect(wrapLng(-200)).toBe(160));
});
describe("normalizeBounds", () => {
  it("normal viewport", () => expect(normalizeBounds({ west: 10, south: 40, east: 12, north: 42 }))
    .toEqual({ skip: false, params: { min_lat: 40, min_lng: 10, max_lat: 42, max_lng: 12 } }));
  it("clamps latitude", () => expect(normalizeBounds({ west: 0, south: -120, east: 1, north: 95 }))
    .toEqual({ skip: false, params: { min_lat: -90, min_lng: 0, max_lat: 90, max_lng: 1 } }));
  it("wraps world-copy lng", () => expect(normalizeBounds({ west: 190, south: 0, east: 200, north: 1 }))
    .toEqual({ skip: false, params: { min_lat: 0, min_lng: -170, max_lat: 1, max_lng: -160 } }));
  it("skips antimeridian crossing", () => expect(normalizeBounds({ west: 170, south: 0, east: 190, north: 1 }))
    .toEqual({ skip: true }));
});
describe("shouldLoadPins", () => {
  it("below", () => expect(shouldLoadPins(9.9)).toBe(false));
  it("at", () => expect(shouldLoadPins(10)).toBe(true));
});
describe("isAtCap", () => {
  it("at", () => expect(isAtCap(MAX_BBOX_RESULTS)).toBe(true));
  it("below", () => expect(isAtCap(MAX_BBOX_RESULTS - 1)).toBe(false));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `web/lib/map/bounds.ts`:

```ts
import { MAX_BBOX_RESULTS, MIN_ZOOM } from "./constants";
export type RawBounds = { west: number; south: number; east: number; north: number };
export type BboxParams = { min_lat: number; min_lng: number; max_lat: number; max_lng: number };
const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;
export function normalizeBounds(b: RawBounds): { skip: true } | { skip: false; params: BboxParams } {
  const min_lat = clampLat(b.south), max_lat = clampLat(b.north);
  const min_lng = wrapLng(b.west), max_lng = wrapLng(b.east);
  if (min_lng > max_lng || min_lat > max_lat) return { skip: true }; // antimeridian/degenerate -> skip (spec §6.1)
  return { skip: false, params: { min_lat, min_lng, max_lat, max_lng } };
}
export const shouldLoadPins = (zoom: number) => zoom >= MIN_ZOOM;
export const isAtCap = (count: number) => count >= MAX_BBOX_RESULTS;
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Cap-constant pin test (pinned contract, not a cross-language source of truth).** The bbox response has no envelope and OpenAPI does not encode the limit, so this is a **pinned contract**: a web constant + a backend pin test asserting the same literal. If a deploy ever overrides `max_results` via env, the same value must be supplied to web. `web/lib/map/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_BBOX_RESULTS } from "./constants";
// Pinned contract: backend settings.max_results (backend/app/config.py). The backend test
// test_max_results_pinned asserts the backend value; keep these in sync (deploy-env overrides
// must set the same value for web).
describe("MAX_BBOX_RESULTS", () => {
  it("is the pinned backend default", () => expect(MAX_BBOX_RESULTS).toBe(500));
});
```

Backend, in `backend/tests/test_config.py`:

```python
def test_max_results_pinned():
    from app.config import Settings
    assert Settings().max_results == 500  # mirrored in web MAX_BBOX_RESULTS (web/lib/map/constants.ts)
```

- [ ] **Step 6: Run both.** `pnpm --filter web exec vitest run lib/map/bounds.test.ts lib/map/constants.test.ts` and `cd backend && uv run pytest tests/test_config.py -k max_results` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add web/lib/map/bounds.ts web/lib/map/bounds.test.ts web/lib/map/constants.test.ts backend/tests/test_config.py
git commit -m "feat(web): bounds normalization, fetch gating, cap-constant pin"
```

---

## Task 10: Web — fountains fetch wrappers, basemap config, client logger

Spec §5.2, §5.4, §6.2, §9, §10.

**Files:** Create `web/lib/fountains.ts`, `web/lib/map/style.ts`, `web/lib/map/log.ts`; Test `web/lib/fountains.test.ts`.

**Interfaces:**
- `FountainPin`, `FountainDetail`, `DimensionSummary` types re-exported from the generated `components`.
- `fetchBbox(params, requestId?): Promise<FountainPin[]>` (client; attaches `X-Request-ID` when given).
- `getFountainDetailServer(id, requestId): Promise<{ data?: FountainDetail; status: number }>` (server; attaches `X-Request-ID`).
- `BASEMAP` config + `PIN_ASSETS` map (`style.ts`).
- `logMapError(event, ctx)` (`log.ts`).

- [ ] **Step 1: Failing test** `web/lib/fountains.test.ts` (mock `./api`):

```ts
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
  it("queries bbox + returns data", async () => {
    expect(await fetchBbox({ min_lat: 1, min_lng: 2, max_lat: 3, max_lng: 4 })).toEqual([{ id: "a" }]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `web/lib/fountains.ts` (import types from the package root — Task 3 re-exported them):

```ts
import type { components } from "@fountainrank/api-client";
import { makeClient } from "@fountainrank/api-client";
import { getApiClient, resolveApiBaseUrl } from "./api";
import type { BboxParams } from "./map/bounds";

export type FountainPin = components["schemas"]["FountainPin"];
export type FountainDetail = components["schemas"]["FountainDetail"];
export type DimensionSummary = components["schemas"]["DimensionSummary"];

export async function fetchBbox(params: BboxParams, requestId?: string): Promise<FountainPin[]> {
  const client = requestId
    ? makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } })
    : getApiClient();
  const { data } = await client.GET("/api/v1/fountains/bbox", { params: { query: params } });
  return data ?? [];
}

export async function getFountainDetailServer(id: string, requestId: string) {
  const client = makeClient(resolveApiBaseUrl(), { headers: { "X-Request-ID": requestId } });
  const { data, response } = await client.GET("/api/v1/fountains/{fountain_id}", {
    params: { path: { fountain_id: id } },
  });
  return { data, status: response?.status ?? 0 };
}
```

(Verify `components["schemas"]["FountainPin"]` resolves after Task 3's re-export. If `openapi-typescript` emitted differently-named schema keys, use the exact key from `schema.d.ts`.)

- [ ] **Step 4: Implement** `web/lib/map/style.ts`:

```ts
// One swappable basemap config (dark-mode-ready, spec §5.4); URLs from NEXT_PUBLIC_* env.
// MapBrowser loads only `styleUrl`; the hosted Light style JSON embeds its source as
// `pmtiles://<pmtilesUrl>`. `pmtilesUrl` is the value the upload runbook (Task 20) writes
// into that style JSON's source — kept here so the two stay in one place.
export const BASEMAP = {
  flavor: "light" as const,
  styleUrl: process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL ?? "",
  pmtilesUrl: process.env.NEXT_PUBLIC_BASEMAP_PMTILES_URL ?? "",
};
export const PIN_ASSETS: Record<"pin-standard" | "pin-selected" | "pin-gold" | "pin-broken", string> = {
  "pin-standard": "/pins/pin-standard.png",
  "pin-selected": "/pins/pin-selected.png",
  "pin-gold": "/pins/pin-gold.png",
  "pin-broken": "/pins/pin-broken.png",
};
// Stretchable rating-pill background, loaded with 9-patch stretch metadata (icon-text-fit).
export const PILL_BG_ASSET = "/pins/pill-bg.png";
```

- [ ] **Step 5: Implement** `web/lib/map/log.ts` (structured client logger — no bare console noise, spec §10):

```ts
// Structured, public-path-only client logging (no secrets exist on the browse path).
export function logMapError(event: string, ctx: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console -- scoped client diagnostics for the public map
  console.error(JSON.stringify({ level: "error", area: "map", event, ...ctx }));
}
```

- [ ] **Step 6: Run + typecheck.** `pnpm --filter web exec vitest run lib/fountains.test.ts` then `./run.ps1 check -Web -Fast`.

- [ ] **Step 7: Commit.**

```bash
git add web/lib/fountains.ts web/lib/fountains.test.ts web/lib/map/style.ts web/lib/map/log.ts
git commit -m "feat(web): fountains fetch wrappers, basemap config, client logger"
```

---

## Task 11: Web — pin assets (export from the sheet)

Spec §7.3.

**Files:** Create `web/public/pins/{pin-standard,pin-selected,pin-gold,pin-broken,pill-bg}.png`. The four pins come from `docs/logos/pin-only-logo-sheet.png` (working=#3, selected=#1, gold=#4; broken=#3 + red slash composited).

- [ ] **Step 1: Export** four transparent pin PNGs at ~96 px tall, visual tip at bottom-center (for `icon-anchor: "bottom"`); composite the red slash into `pin-broken.png`.
- [ ] **Step 2: Create `pill-bg.png`** — a small white rounded-rectangle (e.g. 20×20 px, ~6 px corner radius, transparent outside) used as the stretchable rating-pill background. Note the pixel coordinates of its non-corner content box (e.g. 6–14 px) — Task 13 passes them as `stretchX`/`stretchY`/`content` to `addImage`.
- [ ] **Step 3: Verify legibility** of the pins on the light basemap at marker scale; add an outline/shadow if the spray washes out (manual visual check).
- [ ] **Step 4: Commit.** `git add web/public/pins/ && git commit -m "assets(web): pin variants + rating-pill background"`

---

## Task 12: Web — pure MapLibre source/layer spec builders (TDD)

Spec §7.1. Makes the GL config concrete + tested (not comments). These return plain spec objects consumed by `MapBrowser`.

**Files:** Create `web/lib/map/layers.ts`; Test `web/lib/map/layers.test.ts`.

**Interfaces:**
- `fountainsSource(): { type:"geojson"; cluster:true; clusterRadius:number; clusterMaxZoom:number; data: EmptyFC }`
- `clusterCircleLayer()`, `clusterCountLayer()`, `pinLayer()`, `pillLayer()`, `selectedHaloLayer()`, `selectedPinLayer()` — each returns a MapLibre layer spec object (typed `maplibregl.LayerSpecification` / `AddLayerObject`).
- `EMPTY_FC: GeoJSON.FeatureCollection` (for clearing the source).
- `SELECTED_ICON_EXPR` — the data-driven expression mirroring `selectedSwapIcon` (working & not-gold → `pin-selected`, else `['get','icon']`).

- [ ] **Step 1: Failing tests** `web/lib/map/layers.test.ts` (assert the correctness-bearing fields):

```ts
import { describe, expect, it } from "vitest";
import { fountainsSource, pinLayer, pillLayer, clusterCircleLayer, clusterCountLayer, selectedHaloLayer, selectedPinLayer } from "./layers";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, PILL_MIN_ZOOM } from "./constants";

describe("fountainsSource", () => {
  it("clusters", () => {
    const s = fountainsSource();
    expect(s.cluster).toBe(true);
    expect(s.clusterRadius).toBe(CLUSTER_RADIUS);
    expect(s.clusterMaxZoom).toBe(CLUSTER_MAX_ZOOM);
    expect(s.data).toEqual({ type: "FeatureCollection", features: [] });
  });
});
describe("pinLayer", () => {
  it("uses the per-feature icon and excludes clusters", () => {
    const l = pinLayer();
    expect(l.layout!["icon-image"]).toEqual(["get", "icon"]);
    expect(l.layout!["icon-anchor"]).toBe("bottom");
    expect(JSON.stringify(l.filter)).toContain("point_count"); // !has point_count
  });
});
describe("pillLayer", () => {
  it("is a zoom-gated icon-text-fit pill excluding null pills + clusters", () => {
    const l = pillLayer();
    expect(l.minzoom).toBe(PILL_MIN_ZOOM);
    expect(l.layout!["icon-image"]).toBe("pill-bg");
    expect(l.layout!["icon-text-fit"]).toBe("both");
    expect(l.layout!["text-field"]).toEqual(["get", "pill"]);
    expect(JSON.stringify(l.filter)).toContain("pill");
  });
});
describe("cluster layers", () => {
  it("count uses point_count_abbreviated", () => {
    expect(clusterCountLayer().layout!["text-field"]).toEqual(["get", "point_count_abbreviated"]);
    expect(JSON.stringify(clusterCircleLayer().filter)).toContain("point_count");
  });
});
describe("selected layers", () => {
  it("halo + pin filter by id and swap icon for working non-gold", () => {
    expect(JSON.stringify(selectedHaloLayer("abc").filter)).toContain("abc");
    const sp = selectedPinLayer("abc");
    expect(JSON.stringify(sp.layout!["icon-image"])).toContain("pin-selected");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `web/lib/map/layers.ts` (use real MapLibre expression syntax; verify exact types with Context7 for MapLibre 5.x):

```ts
import type {
  AddLayerObject, FilterSpecification, GeoJSONSourceSpecification,
} from "maplibre-gl";
import { CLUSTER_MAX_ZOOM, CLUSTER_RADIUS, GOLD_THRESHOLD, PILL_MIN_ZOOM } from "./constants";

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const notCluster: FilterSpecification = ["!", ["has", "point_count"]];
const isCluster: FilterSpecification = ["has", "point_count"];

export function fountainsSource(): GeoJSONSourceSpecification {
  return { type: "geojson", data: EMPTY_FC, cluster: true, clusterRadius: CLUSTER_RADIUS, clusterMaxZoom: CLUSTER_MAX_ZOOM };
}
export function clusterCircleLayer(): AddLayerObject {
  return { id: "clusters", type: "circle", source: "fountains", filter: isCluster,
    paint: { "circle-color": "#0C44A0", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28] } };
}
export function clusterCountLayer(): AddLayerObject {
  return { id: "cluster-count", type: "symbol", source: "fountains", filter: isCluster,
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 13, "text-font": ["Noto Sans Bold"] },
    paint: { "text-color": "#ffffff" } };
}
export function pinLayer(): AddLayerObject {
  return { id: "pins", type: "symbol", source: "fountains", filter: notCluster,
    layout: { "icon-image": ["get", "icon"], "icon-anchor": "bottom", "icon-size": 0.5, "icon-allow-overlap": true } };
}
export function pillLayer(): AddLayerObject {
  // A real pill: the "pill-bg" image stretches to fit the rating text (icon-text-fit), anchored
  // just below the pin. (spec §7.1)
  return { id: "pins-pill", type: "symbol", source: "fountains", minzoom: PILL_MIN_ZOOM,
    filter: ["all", notCluster, ["has", "pill"], ["!=", ["get", "pill"], null]],
    layout: {
      "icon-image": "pill-bg", "icon-text-fit": "both", "icon-text-fit-padding": [2, 6, 2, 6],
      "text-field": ["get", "pill"], "text-size": 12, "text-font": ["Noto Sans Bold"],
      "text-anchor": "top", "icon-anchor": "top", "text-offset": [0, 1.4],
      "icon-allow-overlap": true, "text-allow-overlap": true, "text-optional": false },
    paint: { "text-color": "#0A357E" } };
}
// Mirrors selectedSwapIcon: working & not-gold -> pin-selected, else the base icon.
export const SELECTED_ICON_EXPR = ["case",
  ["all", ["get", "is_working"], ["<=", ["coalesce", ["get", "ranking_score"], -1], GOLD_THRESHOLD]],
  "pin-selected", ["get", "icon"]] as const;
const byId = (id: string): FilterSpecification => ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], id]];
export function selectedHaloLayer(id: string): AddLayerObject {
  return { id: "selected-halo", type: "circle", source: "fountains", filter: byId(id),
    paint: { "circle-radius": 26, "circle-color": "#0C44A0", "circle-opacity": 0.18, "circle-translate": [0, -18] } };
}
export function selectedPinLayer(id: string): AddLayerObject {
  return { id: "selected-pin", type: "symbol", source: "fountains", filter: byId(id),
    layout: { "icon-image": SELECTED_ICON_EXPR as unknown as AddLayerObject["layout"] extends infer L ? any : never,
      "icon-anchor": "bottom", "icon-size": 0.56, "icon-allow-overlap": true } };
}
```

(If the `icon-image` expression typing is awkward, type the layer object as `AddLayerObject` and cast the expression; the test asserts its shape. Use a glyph font name present in the hosted style's glyph set — adjust `"Noto Sans Bold"` to a font the chosen Protomaps Light style ships.)

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git add web/lib/map/layers.ts web/lib/map/layers.test.ts && git commit -m "feat(web): pure MapLibre source/layer spec builders"`

---

## Task 13: Web — `MapBrowser` client component

Spec §5–§7. Wires the tested helpers; WebGL can't run headless, so verify manually. All decision logic lives in Tasks 7–9/12.

**Files:** Create `web/components/map/MapBrowser.tsx`, `MapBrowserLoader.tsx`, `MapStates.tsx`.

**Interfaces:**
- Consumes: `BASEMAP`, `PIN_ASSETS`, `fetchBbox`, `FountainPin`, `pinsToFeatureCollection`, layer builders + `EMPTY_FC`, `normalizeBounds`/`shouldLoadPins`/`isAtCap`, constants, `logMapError`, `FountainsInViewList`, `MapStates`.
- Produces: default-export `<MapBrowser />`; `<MapBrowserLoader />`.

- [ ] **Step 1: `MapBrowserLoader.tsx`** (only place `ssr:false` lives — spec §5.1):

```tsx
"use client";
import dynamic from "next/dynamic";
const MapBrowser = dynamic(() => import("./MapBrowser"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#e9efe7]" aria-hidden />,
});
export default function MapBrowserLoader() { return <MapBrowser />; }
```

- [ ] **Step 2: `MapStates.tsx`** — dumb presentational components (full markup, brand tokens):

```tsx
export function LoadingBar() {
  return <div role="status" aria-label="Loading fountains"
    className="absolute left-0 right-0 top-0 h-1 animate-pulse bg-[#0C44A0]" />;
}
export function ZoomInHint() {
  return <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
    <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow">
      🔍 Zoom in to see fountains</span></div>;
}
export function EmptyHint() {
  return <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
    <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-slate-700 shadow">
      No fountains mapped here yet.</span></div>;
}
export function CapHint() {
  return <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
    <span className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-slate-700 shadow">
      Lots of fountains here — zoom in to see them all.</span></div>;
}
export function ErrorToast({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-white px-4 py-2 text-sm shadow">
    <span className="text-slate-700">Couldn’t load fountains.</span>
    <button onClick={onRetry} className="font-semibold text-[#0C44A0] underline">Retry</button></div>;
}
```

- [ ] **Step 3: `MapBrowser.tsx`** — concrete (no undefined calls, no comment-only behavior):

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP, PIN_ASSETS, PILL_BG_ASSET } from "../../lib/map/style";
import { fetchBbox, type FountainPin } from "../../lib/fountains";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { normalizeBounds, shouldLoadPins, isAtCap } from "../../lib/map/bounds";
import {
  EMPTY_FC, fountainsSource, clusterCircleLayer, clusterCountLayer,
  pinLayer, pillLayer, selectedHaloLayer, selectedPinLayer,
} from "../../lib/map/layers";
import {
  DEBOUNCE_MS, DEFAULT_CENTER, DEFAULT_ZOOM, GEOLOCATE_TIMEOUT_MS, NEIGHBORHOOD_ZOOM,
} from "../../lib/map/constants";
import { logMapError } from "../../lib/map/log";
import { FountainsInViewList } from "./FountainsInViewList";
import { CapHint, EmptyHint, ErrorToast, LoadingBar, ZoomInHint } from "./MapStates";

type Status = "idle" | "loading" | "empty" | "error" | "belowZoom" | "capped";
const activeIdFromPath = (p: string | null) => p?.match(/^\/fountains\/([^/?#]+)/)?.[1] ?? "";

export default function MapBrowser() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [pins, setPins] = useState<FountainPin[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const activeId = activeIdFromPath(pathname);

  useEffect(() => {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const map = new maplibregl.Map({
      container: ref.current!, style: BASEMAP.styleUrl, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
      trackUserLocation: false, showUserLocation: true,
    }), "top-right");

    let timer: ReturnType<typeof setTimeout>;
    const onMoveEnd = () => { clearTimeout(timer); timer = setTimeout(() => void load(), DEBOUNCE_MS); };

    map.on("load", async () => {
      try {
        await Promise.all(Object.entries(PIN_ASSETS).map(async ([name, url]) => {
          const img = await map.loadImage(url);
          if (!map.hasImage(name)) map.addImage(name, img.data);
        }));
        // Stretchable rating-pill background (9-patch). Stretch/content coords match pill-bg.png
        // (Task 11 step 2 — adjust if the asset's content box differs).
        const pill = await map.loadImage(PILL_BG_ASSET);
        if (!map.hasImage("pill-bg"))
          map.addImage("pill-bg", pill.data, { stretchX: [[6, 14]], stretchY: [[6, 14]], content: [6, 6, 14, 14] });
      } catch (e) { logMapError("image-load-failed", { name: (e as Error).name }); }
      map.addSource("fountains", fountainsSource());
      [clusterCircleLayer(), clusterCountLayer(), pinLayer(), pillLayer(),
       selectedHaloLayer(""), selectedPinLayer("")].forEach((l) => map.addLayer(l));
      // cluster click -> expand
      map.on("click", "clusters", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
        const cid = f?.properties?.cluster_id;
        const src = map.getSource("fountains") as maplibregl.GeoJSONSource;
        if (cid != null) src.getClusterExpansionZoom(cid).then((z) =>
          map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z }));
      });
      // pin click -> open detail route (soft nav; map stays mounted)
      const openPin = (e: maplibregl.MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) router.push(`/fountains/${id}`);
      };
      map.on("click", "pins", openPin);
      map.on("click", "selected-pin", openPin);
      ["clusters", "pins", "selected-pin"].forEach((ly) => {
        map.on("mouseenter", ly, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", ly, () => (map.getCanvas().style.cursor = ""));
      });
      // geolocate on load (short timeout); fall back to the default view silently.
      navigator.geolocation?.getCurrentPosition(
        (pos) => map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: NEIGHBORHOOD_ZOOM }),
        () => { /* denied/unavailable: stay at default view */ },
        { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS },
      );
      map.on("moveend", onMoveEnd);
      void load();
    });

    async function load() {
      const m = mapRef.current; if (!m) return;
      const src = m.getSource("fountains") as maplibregl.GeoJSONSource | undefined;
      if (!shouldLoadPins(m.getZoom())) {
        src?.setData(EMPTY_FC); setPins([]); setStatus("belowZoom"); return; // clear stale pins (spec §6.1)
      }
      const b = m.getBounds();
      const norm = normalizeBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      if (norm.skip) return; // antimeridian/degenerate: keep prior pins
      setStatus("loading");
      try {
        const data = await fetchBbox(norm.params, crypto.randomUUID());
        setPins(data);
        src?.setData(pinsToFeatureCollection(data));
        setStatus(isAtCap(data.length) ? "capped" : data.length === 0 ? "empty" : "idle");
      } catch (e) {
        logMapError("bbox-fetch-failed", { name: (e as Error).name });
        setStatus("error");
      }
    }

    return () => {
      clearTimeout(timer);
      map.remove();
      maplibregl.removeProtocol("pmtiles");
      mapRef.current = null;
    };
  }, [router]);

  // Reflect the active route id on the selected layers (additive: halo always; icon swap via expr).
  useEffect(() => {
    const m = mapRef.current; if (!m || !m.getLayer?.("selected-halo")) return;
    const flt: maplibregl.FilterSpecification = ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], activeId]];
    m.setFilter("selected-halo", flt);
    m.setFilter("selected-pin", flt);
  }, [activeId, status]);

  const retry = () => mapRef.current?.fire("moveend");

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="h-full w-full" />
      {status === "loading" && <LoadingBar />}
      {status === "belowZoom" && <ZoomInHint />}
      {status === "empty" && <EmptyHint />}
      {status === "capped" && <CapHint />}
      {status === "error" && <ErrorToast onRetry={retry} />}
      <FountainsInViewList pins={pins} activeId={activeId} onOpen={(id) => router.push(`/fountains/${id}`)} />
    </div>
  );
}
```

(Confirm the exact MapLibre 5.x API shapes via Context7: `loadImage` returns `{ data }`; `GeoJSONSource.getClusterExpansionZoom` returns a Promise in v5; `setFilter`/`addProtocol`/`removeProtocol` signatures. Adjust the glyph font in `layers.ts` to one the chosen Protomaps Light style provides.)

- [ ] **Step 4: Manual verification** against a basemap + the live API (set `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_BASEMAP_*` in your shell — never write `.env`): geolocate-on-load + locate control; pins/clusters render; gold/broken icons; pill appears only at/above `PILL_MIN_ZOOM`; **zoom-out below `MIN_ZOOM` clears pins** and shows the hint; empty + error states; cluster click expands; pin click opens the overlay; selected pin shows halo + (for working non-gold) the #1 swap.

Run: `./run.ps1 web`

- [ ] **Step 5: Commit.** `git add web/components/map/ && git commit -m "feat(web): MapBrowser client map — pins, clustering, selection, states"`

---

## Task 14: Web — accessible "fountains in view" list

Spec §7.4 (a requirement). Keyboard/AT path to open any in-view fountain. Uses `fireEvent` (no extra dep).

**Files:** Create `web/components/map/FountainsInViewList.tsx`; Test `web/components/map/FountainsInViewList.test.tsx`.

**Interfaces:** `<FountainsInViewList pins activeId? onOpen />` — labelled list, each item a `<button>` opening the fountain; active item marked `aria-current`.

- [ ] **Step 1: Failing test** (uses `fireEvent`):

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FountainsInViewList } from "./FountainsInViewList";

const pins = [
  { id: "a", location: { latitude: 1, longitude: 2 }, is_working: true, average_rating: 4.6, rating_count: 9, ranking_score: 4.5 },
  { id: "b", location: { latitude: 3, longitude: 4 }, is_working: false, average_rating: 2.1, rating_count: 3, ranking_score: 2.0 },
] as any;

describe("FountainsInViewList", () => {
  it("renders one focusable button per fountain and opens on activate", () => {
    const onOpen = vi.fn();
    render(<FountainsInViewList pins={pins} onOpen={onOpen} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();
    fireEvent.click(buttons[0]); // native <button> => keyboard-operable (Enter/Space)
    expect(onOpen).toHaveBeenCalledWith("a");
  });
  it("marks the active item", () => {
    render(<FountainsInViewList pins={pins} activeId="b" onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /out of order/i })).toHaveAttribute("aria-current", "true");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `FountainsInViewList.tsx`:

```tsx
import type { FountainPin } from "../../lib/fountains";
import { basePinIcon } from "../../lib/map/pins";
import { formatAverage } from "../../lib/map/format";

export function FountainsInViewList({
  pins, activeId, onOpen,
}: { pins: FountainPin[]; activeId?: string; onOpen: (id: string) => void }) {
  if (pins.length === 0) return null;
  return (
    <nav aria-label="Fountains in view"
      className="absolute bottom-0 left-0 right-0 max-h-40 overflow-auto bg-white/95 p-2 shadow md:bottom-4 md:left-4 md:right-auto md:w-72 md:rounded-lg">
      <ul className="space-y-1">
        {pins.map((p) => {
          const status = p.is_working ? "Working" : "Out of order";
          return (
            <li key={p.id}>
              <button
                onClick={() => onOpen(String(p.id))}
                aria-current={String(p.id) === activeId ? "true" : undefined}
                className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0C44A0] aria-[current=true]:bg-[#0C44A0]/10">
                <span>{status}{basePinIcon(p) === "pin-gold" ? " · Top-rated" : ""}</span>
                <span className="text-slate-500">{formatAverage(p.average_rating ?? null)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.** `git add web/components/map/FountainsInViewList.tsx web/components/map/FountainsInViewList.test.tsx && git commit -m "feat(web): accessible fountains-in-view list"`

---

## Task 15: Web — fountain detail content + standalone route

Spec §3, §8. Presentational content (tested) + the SSR route with precise 404 AND non-404 error handling.

**Files:** Create `web/components/fountain/FountainDetail.tsx`, `web/components/fountain/ShareButton.tsx`, `web/app/fountains/[id]/page.tsx`; Test `web/components/fountain/FountainDetail.test.tsx`.

**Interfaces:** `<FountainDetail detail={FountainDetail} />` (server-renderable; embeds the `ShareButton` client island). Route renders it inside the standalone shell.

- [ ] **Step 1: Failing component tests** `FountainDetail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FountainDetail } from "./FountainDetail";
const base = {
  id: "a", location: { latitude: 1, longitude: 2 }, is_working: true, comments: null,
  average_rating: 4.3, rating_count: 128, ranking_score: 4.1,
  created_at: "2026-06-01T00:00:00Z", last_rated_at: "2026-06-17T00:00:00Z",
  dimensions: [
    { rating_type_id: 1, name: "Clarity", average_rating: 4.6, vote_count: 96 },
    { rating_type_id: 4, name: "Appearance", average_rating: null, vote_count: 0 },
  ],
} as any;
describe("FountainDetail", () => {
  it("working + overall + votes", () => {
    render(<FountainDetail detail={base} />);
    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(screen.getByText("128 ratings")).toBeInTheDocument();
  });
  it("out of order", () => {
    render(<FountainDetail detail={{ ...base, is_working: false }} />);
    expect(screen.getByText("Out of order")).toBeInTheDocument();
  });
  it("unrated overall + unrated dimension", () => {
    render(<FountainDetail detail={{ ...base, average_rating: null }} />);
    expect(screen.getAllByText("Not yet rated").length).toBeGreaterThan(0);
  });
  it("note only when present", () => {
    const { rerender } = render(<FountainDetail detail={base} />);
    expect(screen.queryByText("Cold and fast")).not.toBeInTheDocument();
    rerender(<FountainDetail detail={{ ...base, comments: "Cold and fast" }} />);
    expect(screen.getByText("Cold and fast")).toBeInTheDocument();
  });
  it("renders meta (added + last rated) and the Directions + Share actions", () => {
    render(<FountainDetail detail={base} />);
    expect(screen.getByText(/Added Jun 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last rated Jun 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** `FountainDetail.tsx` (full JSX; uses `formatAverage`/`formatVotes`/`formatDimension`):

```tsx
import type { FountainDetail as Detail } from "../../lib/fountains";
import { formatAverage, formatDate, formatDimension, formatVotes } from "../../lib/map/format";
import { ShareButton } from "./ShareButton";

export function FountainDetail({ detail }: { detail: Detail }) {
  const { latitude, longitude } = detail.location;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-[#0A357E]">Public drinking fountain</h1>
        <span className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
          detail.is_working ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
          {detail.is_working ? "Working" : "Out of order"}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold text-[#0A357E]">{formatAverage(detail.average_rating ?? null)}</span>
        {detail.average_rating != null && <span className="text-sm text-slate-500">· {formatVotes(detail.rating_count)}</span>}
      </div>
      <dl className="divide-y divide-slate-100 border-t border-slate-100">
        {detail.dimensions.map((d) => (
          <div key={d.rating_type_id} className="flex items-center justify-between py-2">
            <dt className="text-sm font-medium">{d.name}</dt>
            <dd className="text-sm text-slate-600">{formatDimension(d.average_rating ?? null, d.vote_count)}</dd>
          </div>
        ))}
      </dl>
      {detail.comments && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{detail.comments}</p>
      )}
      <p className="text-xs text-slate-400">
        Added {formatDate(detail.created_at)}
        {detail.last_rated_at ? ` · Last rated ${formatDate(detail.last_rated_at)}` : ""}
      </p>
      <div className="flex gap-2">
        <a href={dir} target="_blank" rel="noopener noreferrer"
          className="rounded-full bg-[#F2C200] px-4 py-2 text-sm font-bold text-[#0A357E]">Directions</a>
        <ShareButton />
      </div>
      <p className="text-xs text-slate-400">“Rate this fountain” arrives in Phase 3b.</p>
    </div>
  );
}
```

- [ ] **Step 3b: Implement the Share island** `web/components/fountain/ShareButton.tsx` (`"use client"`) — Web Share API with a clipboard fallback (copies the current `/fountains/[id]` URL):

```tsx
"use client";
export function ShareButton() {
  const onClick = async () => {
    try {
      if (navigator.share) await navigator.share({ url: window.location.href });
      else await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* user cancelled the share sheet — no-op */
    }
  };
  return (
    <button onClick={onClick}
      className="rounded-full border border-[#cdd6e6] bg-white px-4 py-2 text-sm font-bold text-[#0A357E]">
      Share
    </button>
  );
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Standalone route** `web/app/fountains/[id]/page.tsx` (no placeholders — full shell + 404 + non-404 error):

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFountainDetailServer } from "../../../lib/fountains";
import { log } from "../../../lib/server/log";
import { FountainDetail } from "../../../components/fountain/FountainDetail";

export const dynamic = "force-dynamic";
const shell = "mx-auto min-h-dvh max-w-2xl bg-white px-6 py-10";

export default async function FountainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const { data, status } = await getFountainDetailServer(id, requestId);

  if (status === 404) {
    log("info", "fountain not found", { requestId, id, status });
    notFound(); // renders not-found UI AND returns HTTP 404 (SEO/crawlers)
  }
  if (!data) {
    log("error", "failed to load fountain", { requestId, id, status });
    return (
      <main className={shell}>
        <Link href="/" className="text-sm text-[#0C44A0] underline">← Back to the map</Link>
        <h1 className="mt-6 text-lg font-bold text-[#0A357E]">Couldn’t load this fountain</h1>
        <p className="mt-2 text-slate-600">Please try again.</p>
      </main>
    );
  }
  return (
    <main className={shell}>
      <Link href="/" className="text-sm text-[#0C44A0] underline">← Back to the map</Link>
      <div className="mt-6"><FountainDetail detail={data} /></div>
    </main>
  );
}
```

- [ ] **Step 6: Manual verification.** `curl -i http://localhost:3020/fountains/<unknown-uuid>` → `404`. Point the API at a down/erroring backend (or a non-404 case) → the "Couldn’t load" shell renders (status logged). A valid id → full detail.

- [ ] **Step 7: Commit.** `git add web/components/fountain/FountainDetail.tsx web/components/fountain/ShareButton.tsx web/components/fountain/FountainDetail.test.tsx web/app/fountains/ && git commit -m "feat(web): fountain detail content + Share + standalone SSR route (404 + error shells)"`

---

## Task 16: Web — intercepting overlay route + `@modal` slot

Spec §3.

**Files:** Create `web/app/@modal/default.tsx`, `web/app/@modal/(.)fountains/[id]/page.tsx`, `web/components/fountain/DetailOverlay.tsx`; Modify `web/app/layout.tsx`.

- [ ] **Step 1: `@modal/default.tsx`:** `export default function Default() { return null; }`

- [ ] **Step 2: Add the slot to `layout.tsx`** (keep the existing metadata edit from Task 17 separate):

```tsx
export default function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return (<html lang="en"><body>{children}{modal}</body></html>);
}
```

- [ ] **Step 3: `DetailOverlay.tsx`** (`"use client"`): a `role="dialog"` `aria-label="Fountain detail"` container — backdrop + side panel (desktop) / bottom sheet (mobile); `router.back()` on close button, Escape, and backdrop click; focus the panel on mount. Renders `children`.

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
export function DetailOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    panel?.focus();
    const focusables = () => panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { router.back(); return; }
      if (e.key !== "Tab") return; // trap Tab within the dialog
      const els = focusables();
      if (els.length === 0) { e.preventDefault(); panel?.focus(); return; }
      const first = els[0], last = els[els.length - 1], active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prevFocus?.focus?.(); }; // restore focus
  }, [router]);
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={() => router.back()} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-label="Fountain detail"
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-2xl bg-white p-5 shadow-xl md:inset-y-0 md:left-auto md:right-0 md:w-96 md:rounded-none">
        <button onClick={() => router.back()} aria-label="Close"
          className="absolute right-4 top-4 h-7 w-7 rounded-full bg-slate-100 text-slate-600">×</button>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `@modal/(.)fountains/[id]/page.tsx`** (RSC): fetch detail; 404 → in-panel not-found (NOT `notFound()` — keep the map underneath); else render the detail in the overlay; non-404 error → in-panel error. Log with request id/status.

```tsx
import { getFountainDetailServer } from "../../../../lib/fountains";
import { log } from "../../../../lib/server/log";
import { FountainDetail } from "../../../../components/fountain/FountainDetail";
import { DetailOverlay } from "../../../../components/fountain/DetailOverlay";

export const dynamic = "force-dynamic";

export default async function FountainModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const { data, status } = await getFountainDetailServer(id, requestId);
  return (
    <DetailOverlay>
      {status === 404 ? (log("info", "fountain not found (overlay)", { requestId, id, status }),
        <p className="text-slate-600">Fountain not found.</p>)
      : !data ? (log("error", "failed to load fountain (overlay)", { requestId, id, status }),
        <p className="text-slate-600">Couldn’t load this fountain.</p>)
      : <FountainDetail detail={data} />}
    </DetailOverlay>
  );
}
```

(If inlining `log()` inside JSX reads awkwardly, lift it to a `const` before the `return`.)

- [ ] **Step 5: Manual verification.** From the map, tap a pin → overlay opens, map still mounted; Back/Escape/backdrop close; **Tab cycles only within the dialog (focus never reaches the map/page behind it), and focus returns to the triggering element on close**; refresh on `/fountains/[id]` → standalone page; unknown id soft-nav → in-panel not-found (map intact); unknown id hard-load → 404 page (Task 15).

- [ ] **Step 6: Commit.** `git add web/app/@modal web/app/layout.tsx web/components/fountain/DetailOverlay.tsx && git commit -m "feat(web): intercepting overlay route for fountain detail"`

---

## Task 17: Web — homepage hero + map, and metadata

Spec §2.4, §2.9, §9.

**Files:** Modify `web/app/page.tsx`, `web/app/layout.tsx`.

- [ ] **Step 1: Rewrite `web/app/page.tsx`** (RSC) — a `min-h-dvh` flex column: a brand-gradient hero band (`bg-gradient-to-b from-[#0A357E] via-[#0C44A0] to-[#0E4DA4]`) with the wordmark (`next/image`), a gold **Sign in** linking `/account`, the headline "Find a drinking fountain near you.", and the pitch; then a `flex-1` region holding `<MapBrowserLoader />`. Compact hero on mobile (smaller logo/headline). Keep Privacy/Terms footer links.

- [ ] **Step 2: Update metadata in `web/app/layout.tsx`** (alongside the `@modal` prop change):

```ts
const title = "FountainRank — Find drinking fountains near you";
const description =
  "A free, community map of public drinking fountains. See what's nearby, what's working, and how people rate it.";
```

- [ ] **Step 3: Verify.** `./run.ps1 check -Web` → PASS (full web check incl. `next build`; `run.ps1` restores build-mutated tracked files).

- [ ] **Step 4: Manual verification** of `/` desktop + mobile (hero proportion, map visible above the fold, Sign-in works).

- [ ] **Step 5: Commit.** `git add web/app/page.tsx web/app/layout.tsx && git commit -m "feat(web): homepage hero band + live map at / (and metadata)"`

---

## Task 18: Style guide — document the new map UI

Spec §11 (house rule).

**Files:** Modify `docs/style-guide.md`.

- [ ] **Step 1: Add entries** for: the homepage hero band on `/`; map controls (locate-me + zoom); pins (standard/selected/gold + broken-slash) + rating pill; cluster bubbles; the detail overlay (side panel + bottom sheet); the accessible fountains-in-view list; loading/empty/error/zoom-in states. Each: purpose, structure, states, accessibility, example.
- [ ] **Step 2: Commit.** `git add docs/style-guide.md && git commit -m "docs(style-guide): map shell, pins, clusters, detail overlay, states"`

---

## Task 19: Backend/API CORS — verify origins for the new browser caller

Spec §6.2. 3a is the first browser-origin API caller (sending `Origin` + `X-Request-ID`). CORS already exists (`backend/app/config.py` `cors_allow_origins`; `backend/app/main.py` `CORSMiddleware` with `allow_headers=["*"]`, `expose_headers=["X-Request-ID"]`). This task **pins origin correctness**, it does not redesign CORS.

**Files:** Possibly `backend/tests/test_config.py` (origin assertion); `docs/setup/README.md` / deploy docs (record origins). No `.env` writes.

- [ ] **Step 1: Confirm prod origins.** Verify `Settings().cors_allow_origins` includes `https://fountainrank.com` and `https://www.fountainrank.com` (it does by default). Add a guard test in `test_config.py`:

```python
def test_cors_allows_prod_web_origins():
    origins = set(Settings().cors_allow_origins)
    assert {"https://fountainrank.com", "https://www.fountainrank.com"} <= origins
```

- [ ] **Step 2: Preview/dev origins.** Determine whether the deploy introduces a preview origin (e.g. a staging host). If **none exists**, record that in the deploy docs (a one-line note). If one exists, add it via the deploy config that sets `CORS_ALLOW_ORIGINS` (GitHub Environment / k8s config — document the env var **name**, never write `.env`); the value is comma-separated per `config.py`'s parser.

- [ ] **Step 3: Smoke check (local first).** With the backend running (`./run.ps1 backend`) and `Origin: http://localhost:3020`:

```bash
# Preflight
curl -i -X OPTIONS 'http://localhost:3021/api/v1/fountains/bbox' \
  -H 'Origin: http://localhost:3020' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-request-id'
# Actual GET
curl -i 'http://localhost:3021/api/v1/fountains/bbox?min_lat=-90&min_lng=-180&max_lat=90&max_lng=180' \
  -H 'Origin: http://localhost:3020' -H 'X-Request-ID: smoke-1'
```

Expected: `Access-Control-Allow-Origin: http://localhost:3020` on both; the GET returns 200. Repeat against the deployed API from the prod web origin after deploy (owner/CI).

- [ ] **Step 4: Commit.** `git add backend/tests/test_config.py docs/setup/README.md && git commit -m "test(backend): pin CORS web origins; document API CORS verification"`

---

## Task 20: Infra — basemap Spaces/CDN + CORS/range (Terraform) + upload runbook

Spec §5.2, §6.2, §14. **Terraform-owned; plan/validate locally only; apply via CI.** Resolves the deferral noted in `infra/terraform/main.tf:220-226`.

**Prerequisite (owner, blocking for the deployed map — not for web unit tests/local dev):** the current `SPACES_ACCESS_KEY` is scoped to the TF-state bucket only and returns 403 creating buckets. Provision a **bucket-create-capable Spaces key** and add it as the CI secret used by the Terraform apply job (document the secret name in `claude_help/github-environments.md` / `docs/setup/README.md`). Until that key exists, the Terraform apply for the bucket cannot run — do **not** create the bucket out-of-band as a workaround unless the owner explicitly approves it as a temporary, documented fallback (and then import via CI, never local state mutation).

**Files:** Modify `infra/terraform/` (replace the Spaces deferral block with managed resources), `docs/setup/README.md`.

- [ ] **Step 1: Add the Terraform resources** (replacing the `# Spaces … DEFERRED` block): a `digitalocean_spaces_bucket` for the basemap, a CDN endpoint, and **CORS rules** allowing the web origins (`https://fountainrank.com`, `https://www.fountainrank.com`, plus any preview origin from Task 19), methods `GET`/`HEAD`, the `Range` request header, and exposing `Accept-Ranges`/`Content-Range`/`Content-Length`. Follow `claude_help/kubernetes-infra.md` + existing TF patterns (variables, tags, project membership).

- [ ] **Step 2: Validate locally (read-only).** `cd infra/terraform && terraform init -backend=false && terraform fmt -check && terraform validate` (read-only init is permitted by the infra runbook; `-backend=false` avoids touching remote state on a clean checkout). `terraform plan`/`apply` require the bucket-create-capable key + provider Spaces creds and run in **CI only** — never a local `apply`/`plan` against real state.

- [ ] **Step 3: Runbook** — add to `docs/setup/README.md`: the bucket-create-capable Spaces key prerequisite + CI secret name; the one-time owner upload of a Protomaps daily-build planet `.pmtiles` + the Light style JSON + glyphs + sprite to the bucket; and the `NEXT_PUBLIC_BASEMAP_STYLE_URL` / `NEXT_PUBLIC_BASEMAP_PMTILES_URL` env values the web app needs (names only; set via deploy config, not `.env`).

- [ ] **Step 4: Commit** (apply happens in CI on merge, once the key exists).

```bash
git add infra/terraform docs/setup/README.md
git commit -m "feat(infra): basemap Spaces/CDN with browser CORS + range; upload runbook"
```

---

## Task 21: Full local CI mirror, PR, Codex Loop B, merge

Spec §15. The gate.

- [ ] **Step 1: Run the full local CI mirror.** `./run.ps1 check` → backend (ruff/format/alembic check/pytest) + frontend (lint/prettier/typecheck/test) + web build + mobile checks all PASS. Fix any failure at the root cause; re-run.

- [ ] **Step 2: Open the PR.**

```bash
git push -u origin feat/3a-web-map-browsing
gh pr create --fill
```

- [ ] **Step 3: Get CI green** (`gh pr checks <N>` / `gh run view <id> --log-failed`). Fix + push until green.

- [ ] **Step 4: Codex Loop B** per `claude_help/codex-review-process.md`: invoke Codex in bypass mode (`sandbox: danger-full-access`, `approval-policy: never`, `cwd` = the derived WSL repo path), diff `origin/main...HEAD`, post findings on the PR + write `temp/codex-reviews/pr-<N>-review-1.md`. Address every finding (Codex + any other commenter — `gh pr view <N> --comments` AND `gh api repos/redducklabs/fountainrank/pulls/<N>/comments`), re-run `./run.ps1 check`, push, re-review. Loop until `VERDICT: APPROVED`.

- [ ] **Step 5: Squash-merge** once CI green AND Codex APPROVED AND all comments addressed: `gh pr merge <N> --squash`.

- [ ] **Step 6: Hand to the owner** for the gated `v*.*.*` deploy tag (never deploy locally). Confirm the bucket-create-capable Spaces key + Terraform apply + the `.pmtiles`/style upload + `NEXT_PUBLIC_BASEMAP_*` env landed via CI, then smoke-check the live map (pins load cross-origin per Task 19; tiles render cross-origin per Task 20).

---

## Self-review checklist (author)

- **Spec coverage:** hero+map+metadata (T17), basemap hosting+CDN CORS/range (T10,T20), geolocation (T13), bbox load+normalize+gate+cap (T9,T13), pins/clusters/states + layer specs (T7,T11,T12,T13), accessible list (T14), detail content+route+404+non-404 (T15), overlay+@modal map-stays-mounted (T16), ranking_score+sort_order backend+regen (T1,T2,T3), API CORS verify (T19), dark-mode hygiene swappable config (T6,T10), style guide (T18), logging/X-Request-ID (T10,T13,T15,T16), tests throughout. Every spec section maps to a task.
- **Placeholders:** removed — the standalone route, MapBrowser, and infra task are now concrete; pure-logic tasks carry full test+impl; GL/route behavior that can't run headless has explicit manual-verification steps.
- **Executability:** type import path fixed (T3 re-export → T10 import from package root); real backend test files used (`test_fountains_query.py`, `test_fountains_detail.py`, `test_config.py`); the Spaces credential constraint is an explicit owner prerequisite; `user-event` avoided (fireEvent).
- **Type consistency:** `FountainPin`/`FountainDetail`/`DimensionSummary` defined once in `web/lib/fountains.ts`; `BboxParams`/`RawBounds` in `bounds.ts`; `PinProps`/`PinInput` in `pins.ts`; layer ids (`fountains`,`clusters`,`cluster-count`,`pins`,`pins-pill`,`selected-halo`,`selected-pin`) and icon names (`pin-standard`/`pin-selected`/`pin-gold`/`pin-broken`) identical across `layers.ts`, `pins.ts`, `style.ts` (`PIN_ASSETS`), and T11 filenames.
