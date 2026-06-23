# Mobile slice 6e-3 — map + public discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 6e-2 map _placeholder_ with the real **MapLibre React Native** map — Protomaps basemap, viewport-driven fountain pins (working/broken/gold/rated) from the production `bbox` API, non-blocking foreground location, basic filters, and pin→detail navigation — all green on the local CI mirror, with the actual map _render_ left to an owner-gated native build.

**Architecture:** The 6e-1/6e-2 split holds: **pure, unit-tested modules** in `mobile/lib/map/` with **zero RN/Expo imports** (run under Vitest `node`) carry all the logic — bounds normalization, pin→GeoJSON mapping, icon/pill selection, filter→query building, query keys, zoom/cap thresholds — mirroring the web map's already-shipped, already-reviewed helpers (`web/lib/map/*`). A **thin, untested shell** (the `FountainMap`/`MapFilters` components, the `useForegroundLocation` hook, the Map screen) wires those helpers to MapLibre RN and TanStack Query and is covered by `tsc` + ESLint + `expo-doctor`. This slice **adds the MapLibre RN native dependency and its Expo config plugin, ending Expo Go** (CNG/prebuild from here on).

**Tech Stack:** Expo SDK 56, React Native 0.85, React 19.2, TypeScript 6 (strict), Expo Router, `@tanstack/react-query@5.101.0`, `@fountainrank/api-client` (openapi-fetch), **`@maplibre/maplibre-react-native@11.3.4`** (new), **`expo-location`** (new, SDK-pinned), Vitest 4.1.9 (node env), Turbo, pnpm workspace.

**Spec:** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (Codex-approved umbrella). This plan implements **slice 6e-3** from spec §18, realizing **§15 Phase 3** (MapLibre RN map, foreground location non-blocking when denied, Protomaps basemap, bbox/nearby pins + pin states, pin→detail nav, filters backed by existing API params) and honoring **§14** (no dev-auth seam — reuse `createApiClient`), **§20** (MapLibre CNG/prebuild, native folders out of git, foreground-only location, HTTPS-only, no ATS/cleartext), and **§21** (proof level = **Local CI** for code; the map _render_ is **Native build** = owner-gated). Read §15 Phase 3, §18 (6e-3 row), §20, §21 before starting.

**Reference (mirror, do not reinvent):** the web map is already built, reviewed, and merged. Mirror its pure helpers nearly verbatim — `web/lib/map/bounds.ts`, `web/lib/map/pins.ts`, `web/lib/map/format.ts`, `web/lib/map/constants.ts`, `web/lib/map/layers.ts` — adapting only the rendering layer (maplibre-gl JS → MapLibre RN components). The basemap **style URL** is the same one the web deploy uses.

## Global Constraints

- **No AI attribution** in commits/PRs; **no time estimates** anywhere. Conventional Commits; frequent commits; one task at a time; **squash-merge** only.
- **All shell commands below run from the repo root** and use **repo-relative paths** — no absolute repo root is hard-coded. If a shell's cwd has drifted, `cd` back to the repo root first.
- **Claude Code runs on Windows:** file tools use backslash paths (`...\mobile\...`); the Bash tool is Git Bash (forward slashes). Run the task runner as `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>` (no `pwsh`). Any path handed to **Codex** in a review prompt must be **repo-relative**; the Codex MCP `cwd` is **derived** from the current repo root (`D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`), never hard-coded.
- **🔑 CLEAN reinstall before any `expo prebuild`/`eas`/`expo config` command and after every Codex (WSL) run.** Incremental Expo dep installs leave the config-plugin `@expo/*` symlinks inconsistent under pnpm → `expo config`/prebuild fail with _"Unable to resolve a valid config plugin"_ even though typecheck/doctor pass. Recover from Git Bash: `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. This **will** bite in Task 6 (adding MapLibre + verifying prebuild config). Verify with `pnpm --filter mobile exec expo config --type prebuild` (exit 0; resolved `plugins` include `expo-router` and `@maplibre/maplibre-react-native`).
- **Lockfile discipline:** CI installs with `--frozen-lockfile`. After ANY `mobile/package.json` dependency change, run `CI=true pnpm install --no-frozen-lockfile` (still `CI=true` to skip the interactive deps-purge prompt), then commit the updated `pnpm-lock.yaml` in the **same** task. A stale lockfile fails CI.
- **`git add` is atomic:** a non-matching pathspec aborts the whole `git add`, silently leaving an incomplete commit. Stage only existing paths; verify each commit with `git show --stat HEAD`.
- **Scoped mobile Turbo checks run `generate` first** (needs backend `uv`). If a scoped mobile check fails _inside `generate`_, run `uv sync` in `backend/` (or `./run.ps1 bootstrap`) — that's a backend-deps problem, not a Vitest failure.
- **The mobile check does NOT run Prettier.** After hand-writing mobile `.ts`/`.tsx`, run `pnpm exec prettier --write` on the touched files before the **full** `./run.ps1 check`; format touched `docs/**` files **explicitly** (they are outside the `{web,mobile,packages}/**` format:check glob). Keep wrapped lines that begin with `+ ` off (Prettier reads a leading `+ ` in markdown as a bullet).
- **expo-doctor version-checks Expo deps.** Use SDK-correct versions from `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json` rather than `expo install` (which hits the frozen-lockfile/no-TTY edges in this workspace). `@maplibre/maplibre-react-native` and `@tanstack/react-query` are not Expo modules — they are covered by the existing `expo.doctor.reactNativeDirectoryCheck.listUnknownPackages: false` block in `mobile/package.json`.
- **Local mirror gates the PR:** `./run.ps1 check` (backend + workspace-js + web build + mobile) must be green before the PR. Mid-loop, scope to mobile: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile` (lint + typecheck + vitest + expo-doctor); add `-Fast` to skip expo-doctor for quick inner loops. Per-mobile-file test: `pnpm --filter mobile exec vitest run lib/map/<file>.test.ts`.

**Security / standards (spec §14, §20, §21) — binding:**

- **No dev-auth seam on mobile, ever (§14).** All fountain reads go through the existing `createApiClient` facade from `mobile/lib/api.ts`, which strips `X-Dev-*` at the network boundary. Do **not** construct a raw `openapi-fetch`/`makeClient` client in the map code, and never set an `X-Dev-*` header. The bbox/detail reads are **public** (no auth required) — no `Authorization` header is sent in this slice.
- **Auth-unavailable mode unchanged (§21).** 6e-3 adds **no** auth code and **no** signed-in actions. Map + pins + detail nav are all public reads. `isAuthConfigured` is untouched.
- **HTTPS-only (§20).** The basemap style URL and all API calls are `https://`. Reuse `requireHttpsUrl` for the new basemap URL config. No iOS ATS exception, no Android cleartext.
- **No token/PII logging (§20/§14).** The map logs nothing sensitive. Do not log full API payloads or precise user coordinates; a coarse "located / denied / unavailable" status is the most that may be logged.
- **CNG / native folders out of git (§20).** This slice introduces `npx expo prebuild`. The generated `mobile/ios/` and `mobile/android/` projects **must not** be committed (Task 6 adds them to `.gitignore`). Map render is verifiable only on a **dev-client or EAS build** — never in CI, never in Expo Go.
- **Foreground-only location (§20).** Use `expo-location`'s **when-in-use** permission only; never request background location. Denial must **not** block manual map browsing.
- **Proof level = Local CI (§21).** This slice's gate is type-check + lint + `expo-doctor` + unit tests. CI does **not** run Metro, a device, or the map render. **PR and handoff wording must say "compiles, lints, type-checks, unit-tested; map render pending an owner-gated native build" — never "the map renders / works."** The map render is the owner-gated **Native build** proof level.

**Scope boundaries (deferred, consistent with spec §18 — not deviations):**

- **App icon / splash** → **6e-8** (owner decision 2026-06-23: 6e-3 stays map-only; the launcher icon does not appear in map screenshots and §18 places finalized icon/splash in 6e-8). Do **not** add `icon`/`splash` to `app.config.ts` here.
- **Fountain _detail_ reads** (rating summary, dimensions, status, attributes, notes) → **6e-4.** 6e-3 only navigates to the existing detail placeholder route with the fountain `id`.
- **Selected-pin highlight on the map** is a web side-panel affordance; mobile navigates _away_ to a detail screen on tap, so a persistent on-map "selected" halo is **out of scope** for 6e-3 (tap → navigate is the requirement). The `selectedHaloLayer`/`selectedPinLayer` web layers are intentionally not ported.
- **Rating-pill 9-patch background** (`pill-bg` sprite + `icon-text-fit`) is **not** ported. The pill renders as a `SymbolLayer` text label with a white text-halo at `PILL_MIN_ZOOM` — simpler on RN, no 9-patch asset. The pure `formatPill` text is identical to web.
- **Auth, contributions, add-fountain** → 6e-5 … 6e-7.
- **Clustering** IS in scope (mirrors web) — it is part of "public discovery" at low zoom.

---

## File Structure

**Pure, unit-tested modules (`mobile/lib/map/`, zero RN/Expo imports — Vitest `node` env):**

- `mobile/lib/map/constants.ts` (**create**) — map thresholds/tuning needed by this slice (subset of web's). (Task 3)
- `mobile/lib/map/bounds.ts` (**create**) — `RawBounds`, `BboxParams`, `clampLat`, `wrapLng`, `normalizeBounds`, `shouldLoadPins`, `isAtCap` — copied from web. (Task 3)
- `mobile/lib/map/bounds.test.ts` (**create**). (Task 3)
- `mobile/lib/map/format.ts` (**create**) — `formatPill` only (6e-4 extends for detail). (Task 4)
- `mobile/lib/map/pins.ts` (**create**) — `PinLike`, `PinInput`, `PinProps`, `basePinIcon`, `pinsToFeatureCollection`. (Task 4)
- `mobile/lib/map/pins.test.ts` (**create**). (Task 4)
- `mobile/lib/map/filters.ts` (**create**) — `FountainFilters`, `DEFAULT_FILTERS`, `buildBboxQuery`, `fountainsQueryKey`, `hasActiveFilters`. (Task 5)
- `mobile/lib/map/filters.test.ts` (**create**). (Task 5)
- `mobile/lib/config.ts` (**modify**) — add optional `basemapStyleUrl?` + `isMapConfigured(config)`. (Task 2)
- `mobile/lib/config.test.ts` (**modify**) — add `basemapStyleUrl` parse cases + `isMapConfigured` cases. (Task 2)

**Untested shell (RN components / hook / route — `tsc`/ESLint/doctor covered):**

- `mobile/components/map/FountainMap.tsx` (**create**) — MapLibre RN `MapView`+`Camera`+`ShapeSource`(cluster)+layers+`Images`+`UserLocation`. (Task 7)
- `mobile/components/map/MapFilters.tsx` (**create**) — filter toggles. (Task 8)
- `mobile/hooks/useForegroundLocation.ts` (**create**) — non-blocking `expo-location` permission. (Task 9)
- `mobile/app/(tabs)/index.tsx` (**replace** the placeholder) — Map screen wiring. (Task 9)

**Config / assets / wiring / docs:**

- `mobile/package.json` (**modify**) — add `@types/geojson` (dev, if absent) in **Task 4** (same commit as `pins.ts`); add `@maplibre/maplibre-react-native@11.3.4` + `expo-location` (SDK-pinned) in **Task 6**; `pnpm-lock.yaml` updated by each install.
- `mobile/app.config.ts` (**modify**) — add the MapLibre config plugin to `plugins`; add `extra.basemapStyleUrl`. (Tasks 2 + 6)
- `.gitignore` (**modify**) — ignore `mobile/ios/` + `mobile/android/` (CNG). (Task 6)
- `mobile/assets/pins/pin-standard.png`, `pin-gold.png`, `pin-broken.png` (**create** — copied from `web/public/pins/`). (Task 6)
- `mobile/README.md` (**modify**) — Expo Go ends; dev-client/EAS to view the map; `EXPO_PUBLIC_BASEMAP_STYLE_URL`; native SDK versions. (Task 10)
- `docs/style-guide.md` (**modify**) — Mobile: Map screen, fountain pins, filter controls, map overlays. (Task 10)
- `docs/plans/2026-06-23-mobile-6e-3-map-and-public-discovery.md` — this plan (committed in Task 1).

No backend, no `api-client`, no web changes. No CI workflow change (CI's `workspace-js` job already runs `turbo run lint typecheck test`; `run.ps1 check -Mobile` runs `test`).

**Interface summary (names later tasks rely on):**

- `mobile/lib/map/bounds.ts`: `type RawBounds = { west; south; east; north }`; `type BboxParams = { min_lat; min_lng; max_lat; max_lng }`; `normalizeBounds(b: RawBounds): { skip: true } | { skip: false; params: BboxParams }`; `shouldLoadPins(zoom: number): boolean`; `isAtCap(count: number): boolean`.
- `mobile/lib/map/pins.ts`: `type PinLike = { is_working: boolean; ranking_score?: number | null; current_status?: string | null }` (`ranking_score`/`current_status` optional to match the generated `FountainPin`, so `FountainPin[]` is directly assignable to `PinInput[]`); `type PinInput`; `type PinProps`; `basePinIcon(p: PinLike): "pin-broken" | "pin-gold" | "pin-standard"`; `pinsToFeatureCollection(pins: PinInput[]): GeoJSON.FeatureCollection<GeoJSON.Point, PinProps>`.
- `mobile/lib/map/filters.ts`: `type FountainFilters = { workingNow: boolean; bottleFiller: boolean; wheelchairReachable: boolean; minRating: number | null }`; `DEFAULT_FILTERS`; `buildBboxQuery(params: BboxParams, filters: FountainFilters): BboxQuery`; `fountainsQueryKey(params: BboxParams, filters: FountainFilters): unknown[]`; `hasActiveFilters(filters: FountainFilters): boolean`.
- `mobile/lib/config.ts`: `MobileConfig` gains `basemapStyleUrl?: string`; `isMapConfigured(config: MobileConfig): boolean`.

---

### Task 1: Branch + land this plan

**Files:**

- Add (already on disk, untracked): `docs/plans/2026-06-23-mobile-6e-3-map-and-public-discovery.md`

- [ ] **Step 1: Create the branch** off up-to-date `main`:

```bash
git fetch origin
git switch -c feat/mobile-6e-3-map origin/main
```

- [ ] **Step 2: Format + commit the plan** (it rides this PR):

```bash
pnpm exec prettier --write docs/plans/2026-06-23-mobile-6e-3-map-and-public-discovery.md
git add docs/plans/2026-06-23-mobile-6e-3-map-and-public-discovery.md
git commit -m "docs(mobile): add slice 6e-3 (map + public discovery) implementation plan"
git show --stat HEAD
```

Expected: one file committed.

---

### Task 2: Map runtime config — `basemapStyleUrl` + `isMapConfigured`

**Files:**

- Modify: `mobile/lib/config.ts`
- Modify: `mobile/lib/config.test.ts`
- Modify: `mobile/app.config.ts` (add `extra.basemapStyleUrl`)

**Interfaces:**

- Consumes: existing `requireHttpsUrl`, `parseMobileConfig`, `MobileConfig` in `mobile/lib/config.ts`.
- Produces: `MobileConfig.basemapStyleUrl?: string`; `isMapConfigured(config: MobileConfig): boolean`. The Map screen (Task 9) consumes both.

**Rationale:** Mirror the optional-field + guard pattern already used for `logtoAppId` (spec §21 honest-degradation style). The basemap URL is **public config** (committed default, env override) — not a secret. A production default ships so the owner's dev build works out of the box; if it is ever absent/blank, the _map screen_ shows an honest "map unavailable" state instead of crashing the whole app.

- [ ] **Step 1: Write failing tests** — append to `mobile/lib/config.test.ts`:

```typescript
describe("basemapStyleUrl", () => {
  it("omits basemapStyleUrl when absent (map-unavailable mode)", () => {
    expect("basemapStyleUrl" in parseMobileConfig(VALID)).toBe(false);
  });

  it("parses a present https basemapStyleUrl", () => {
    const withMap = { ...VALID, basemapStyleUrl: "https://cdn.example.com/style.light.json" };
    expect(parseMobileConfig(withMap).basemapStyleUrl).toBe(
      "https://cdn.example.com/style.light.json",
    );
  });

  it("accepts a basemapStyleUrl with a cache-busting query string", () => {
    const withMap = { ...VALID, basemapStyleUrl: "https://cdn.example.com/style.light.json?v=3" };
    expect(parseMobileConfig(withMap).basemapStyleUrl).toBe(
      "https://cdn.example.com/style.light.json?v=3",
    );
  });

  it("rejects a non-https basemapStyleUrl", () => {
    expect(() =>
      parseMobileConfig({ ...VALID, basemapStyleUrl: "http://cdn.example.com/style.json" }),
    ).toThrow(/https/);
  });

  it("rejects a present-but-empty basemapStyleUrl", () => {
    expect(() => parseMobileConfig({ ...VALID, basemapStyleUrl: "" })).toThrow(/https/);
  });
});

describe("isMapConfigured", () => {
  it("is false when basemapStyleUrl is absent", () => {
    expect(isMapConfigured(parseMobileConfig(VALID))).toBe(false);
  });

  it("is true when a basemapStyleUrl is present", () => {
    const withMap = { ...VALID, basemapStyleUrl: "https://cdn.example.com/style.light.json" };
    expect(isMapConfigured(parseMobileConfig(withMap))).toBe(true);
  });
});
```

Also add `isMapConfigured` to the import line at the top of the test file:

```typescript
import { isAuthConfigured, isMapConfigured, parseMobileConfig } from "./config";
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter mobile exec vitest run lib/config.test.ts`
Expected: FAIL — `isMapConfigured` is not exported / `basemapStyleUrl` not parsed.

- [ ] **Step 3: Implement** — in `mobile/lib/config.ts`:

Add the field to the type:

```typescript
export type MobileConfig = {
  apiBaseUrl: string;
  logtoEndpoint: string;
  logtoAudience: string;
  authCallbackScheme: string;
  logtoAppId?: string;
  basemapStyleUrl?: string;
};
```

In `parseMobileConfig`, after the `logtoAppId` block and before `return config;`:

```typescript
// basemapStyleUrl is optional: when absent/blank the map screen shows an
// honest "map unavailable" state instead of crashing the app (spec section 21
// honest-degradation). Present: a valid https URL (a cache-busting query
// string is allowed). It is public config — a committed default ships in
// app.config.ts, overridable via EXPO_PUBLIC_BASEMAP_STYLE_URL.
if (e.basemapStyleUrl !== undefined) {
  config.basemapStyleUrl = requireHttpsUrl(e.basemapStyleUrl, "basemapStyleUrl");
}
```

Add the predicate after `isAuthConfigured`:

```typescript
/** True only when a basemap style URL is configured. When false, the map screen
 * renders an honest "map unavailable" state rather than crashing. */
export function isMapConfigured(config: MobileConfig): boolean {
  return typeof config.basemapStyleUrl === "string" && config.basemapStyleUrl.length > 0;
}
```

- [ ] **Step 4: Wire the default in `mobile/app.config.ts`** — add to the `extra` object (after `authCallbackScheme`, before `eas`):

```typescript
    // Public basemap style (Protomaps "light" on the DO Spaces CDN) — the same
    // style the web client uses (see deploy.yml NEXT_PUBLIC_BASEMAP_STYLE_URL).
    // Public, non-secret; overridable per build via EXPO_PUBLIC_BASEMAP_STYLE_URL.
    basemapStyleUrl:
      process.env.EXPO_PUBLIC_BASEMAP_STYLE_URL ??
      "https://fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com/style.light.json",
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm --filter mobile exec vitest run lib/config.test.ts`
Expected: PASS (all cases, including the new `basemapStyleUrl` + `isMapConfigured` blocks).

- [ ] **Step 6: Format + commit**

```bash
pnpm exec prettier --write mobile/lib/config.ts mobile/lib/config.test.ts mobile/app.config.ts
git add mobile/lib/config.ts mobile/lib/config.test.ts mobile/app.config.ts
git commit -m "feat(mobile): add optional basemapStyleUrl config + isMapConfigured guard"
git show --stat HEAD
```

---

### Task 3: Map constants + bounds helpers

**Files:**

- Create: `mobile/lib/map/constants.ts`
- Create: `mobile/lib/map/bounds.ts`
- Test: `mobile/lib/map/bounds.test.ts`

**Interfaces:**

- Produces: `RawBounds`, `BboxParams`, `wrapLng`, `normalizeBounds`, `shouldLoadPins`, `isAtCap` (Tasks 5, 7, 9 consume these); constants `MIN_ZOOM`, `MAX_BBOX_RESULTS`, `GOLD_THRESHOLD`, `PILL_MIN_ZOOM`, `DEFAULT_CENTER`, `DEFAULT_ZOOM`, `CLUSTER_RADIUS`, `CLUSTER_MAX_ZOOM`, `NEIGHBORHOOD_ZOOM` (Tasks 4, 7, 9 consume these).

- [ ] **Step 1: Create `mobile/lib/map/constants.ts`** (subset of `web/lib/map/constants.ts`, values identical):

```typescript
/** Map thresholds + tuning for slice 6e-3. Values mirror web/lib/map/constants.ts
 *  so mobile and web behave identically; behavior is tested in bounds/pins tests. */
export const GOLD_THRESHOLD = 4; // ranking_score strictly greater -> gold (spec section 7.2)
export const MAX_BBOX_RESULTS = 500; // pinned contract: mirrors backend settings.max_results
export const MIN_ZOOM = 10; // below this we don't fetch pins
export const PILL_MIN_ZOOM = 13; // rating pill appears at/above this zoom
export const NEIGHBORHOOD_ZOOM = 14; // fly-to zoom after locating the user
export const DEFAULT_CENTER: [number, number] = [-98.5, 39.8]; // continental US [lng, lat]
export const DEFAULT_ZOOM = 3.5;
export const CLUSTER_RADIUS = 60;
export const CLUSTER_MAX_ZOOM = 14;
```

- [ ] **Step 2: Write failing tests** — `mobile/lib/map/bounds.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { isAtCap, normalizeBounds, shouldLoadPins, wrapLng } from "./bounds";

describe("wrapLng", () => {
  it("leaves in-range longitudes unchanged", () => {
    expect(wrapLng(-98.5)).toBeCloseTo(-98.5);
    expect(wrapLng(179)).toBeCloseTo(179);
  });
  it("wraps longitudes past +/-180", () => {
    expect(wrapLng(181)).toBeCloseTo(-179);
    expect(wrapLng(-181)).toBeCloseTo(179);
  });
});

describe("normalizeBounds", () => {
  it("returns clamped/wrapped params for a normal viewport", () => {
    const r = normalizeBounds({ west: -98, south: 39, east: -97, north: 40 });
    expect(r).toEqual({
      skip: false,
      params: { min_lat: 39, min_lng: -98, max_lat: 40, max_lng: -97 },
    });
  });
  it("clamps latitude to [-90, 90]", () => {
    const r = normalizeBounds({ west: -10, south: -100, east: 10, north: 100 });
    expect(r).toEqual({
      skip: false,
      params: { min_lat: -90, min_lng: -10, max_lat: 90, max_lng: 10 },
    });
  });
  it("skips a degenerate/antimeridian viewport where min_lng > max_lng", () => {
    expect(normalizeBounds({ west: 179, south: 0, east: -179, north: 1 })).toEqual({ skip: true });
  });
});

describe("shouldLoadPins", () => {
  it("is false below MIN_ZOOM and true at/above it", () => {
    expect(shouldLoadPins(9.99)).toBe(false);
    expect(shouldLoadPins(10)).toBe(true);
    expect(shouldLoadPins(15)).toBe(true);
  });
});

describe("isAtCap", () => {
  it("is true only at/above MAX_BBOX_RESULTS", () => {
    expect(isAtCap(499)).toBe(false);
    expect(isAtCap(500)).toBe(true);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm --filter mobile exec vitest run lib/map/bounds.test.ts`
Expected: FAIL — `./bounds` does not exist.

- [ ] **Step 4: Create `mobile/lib/map/bounds.ts`** (copied verbatim from `web/lib/map/bounds.ts`):

```typescript
import { MAX_BBOX_RESULTS, MIN_ZOOM } from "./constants";

export type RawBounds = { west: number; south: number; east: number; north: number };
export type BboxParams = { min_lat: number; min_lng: number; max_lat: number; max_lng: number };

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

export function normalizeBounds(
  b: RawBounds,
): { skip: true } | { skip: false; params: BboxParams } {
  const min_lat = clampLat(b.south),
    max_lat = clampLat(b.north);
  const min_lng = wrapLng(b.west),
    max_lng = wrapLng(b.east);
  if (min_lng > max_lng || min_lat > max_lat) return { skip: true }; // antimeridian/degenerate -> skip
  return { skip: false, params: { min_lat, min_lng, max_lat, max_lng } };
}

export const shouldLoadPins = (zoom: number) => zoom >= MIN_ZOOM;
export const isAtCap = (count: number) => count >= MAX_BBOX_RESULTS;
```

- [ ] **Step 5: Run tests to confirm pass**

Run: `pnpm --filter mobile exec vitest run lib/map/bounds.test.ts`
Expected: PASS.

- [ ] **Step 6: Format + commit**

```bash
pnpm exec prettier --write mobile/lib/map/constants.ts mobile/lib/map/bounds.ts mobile/lib/map/bounds.test.ts
git add mobile/lib/map/constants.ts mobile/lib/map/bounds.ts mobile/lib/map/bounds.test.ts
git commit -m "feat(mobile): add map constants + bounds helpers (mirrors web)"
git show --stat HEAD
```

---

### Task 4: Pin feature mapping (icon/pill selection + GeoJSON)

**Files:**

- Modify: `mobile/package.json` (add `@types/geojson` dev dep) + `pnpm-lock.yaml`
- Create: `mobile/lib/map/format.ts`
- Create: `mobile/lib/map/pins.ts`
- Test: `mobile/lib/map/pins.test.ts`

**Interfaces:**

- Consumes: `GOLD_THRESHOLD` from `./constants`.
- Produces: `formatPill(avg: number | null): string | null`; `PinLike`, `PinInput`, `PinProps`; `basePinIcon(p: PinLike)`; `pinsToFeatureCollection(pins: PinInput[])`. The Map screen (Task 9) passes the API `FountainPin[]` **directly** as `PinInput[]` (assignable now that `ranking_score`/`current_status` are optional) → feature collection; `FountainMap` (Task 7) reads `properties.icon`/`properties.pill`.

This task installs `@types/geojson` (a MapLibre RN peer; `pins.ts` references `GeoJSON.*`) **before** creating `pins.ts`, so the very commit that introduces the `GeoJSON.*` references also lands the types — every intermediate commit stays green under a scoped `tsc`.

**Note on `current_status`:** web's `basePinIcon` keys on `is_working` + `ranking_score` only. The `FountainPin` contract also exposes `current_status` (`ok` / `degraded` / `not_working` / `reported_issue`). Spec Phase 3.5 asks for working/broken/degraded/rated states "where the API exposes the data," so 6e-3 treats `current_status === "not_working"` as broken too (a fountain can read `is_working: true` while a fresh report flips `current_status`). We do **not** add a dedicated `degraded` pin asset (web has none); `degraded`/`reported_issue` keep the standard/gold icon and are surfaced honestly on the detail screen in 6e-4.

- [ ] **Step 1: Add the `@types/geojson` dev dependency.** In `mobile/package.json` `devDependencies`, add (only if absent):

```json
    "@types/geojson": "^7946.0.0",
```

Then install + refresh the lockfile (from the repo root, Git Bash):

```bash
CI=true pnpm install --no-frozen-lockfile
```

Expected: completes; `pnpm-lock.yaml` updated. (This is the version MapLibre RN peers; web already uses `@types/geojson`.)

- [ ] **Step 2: Create `mobile/lib/map/format.ts`** (minimal — `formatPill` only; 6e-4 extends):

```typescript
const one = (n: number) => n.toFixed(1);

/** Map rating pill label, e.g. "★ 4.2"; null when unrated (no pill drawn). */
export const formatPill = (avg: number | null) => (avg == null ? null : `★ ${one(avg)}`);
```

- [ ] **Step 3: Write failing tests** — `mobile/lib/map/pins.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { basePinIcon, pinsToFeatureCollection } from "./pins";

describe("basePinIcon", () => {
  it("is pin-broken when not working", () => {
    expect(basePinIcon({ is_working: false, ranking_score: 5 })).toBe("pin-broken");
  });
  it("is pin-broken when current_status is not_working even if is_working is true", () => {
    expect(basePinIcon({ is_working: true, ranking_score: 5, current_status: "not_working" })).toBe(
      "pin-broken",
    );
  });
  it("is pin-gold when working and ranking_score strictly exceeds the threshold", () => {
    expect(basePinIcon({ is_working: true, ranking_score: 4.1 })).toBe("pin-gold");
  });
  it("is pin-standard at exactly the gold threshold (strictly-greater rule)", () => {
    expect(basePinIcon({ is_working: true, ranking_score: 4 })).toBe("pin-standard");
  });
  it("is pin-standard when working with a null ranking_score", () => {
    expect(basePinIcon({ is_working: true, ranking_score: null })).toBe("pin-standard");
  });
});

describe("pinsToFeatureCollection", () => {
  it("maps location to [lng, lat] GeoJSON points with derived icon + pill", () => {
    const fc = pinsToFeatureCollection([
      {
        id: "a1",
        location: { latitude: 39.5, longitude: -98.2 },
        is_working: true,
        average_rating: 4.25,
        ranking_score: 4.5,
        rating_count: 7,
      },
    ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: "Point", coordinates: [-98.2, 39.5] });
    expect(f.properties.id).toBe("a1");
    expect(f.properties.icon).toBe("pin-gold");
    expect(f.properties.pill).toBe("★ 4.2");
  });

  it("emits a null pill for an unrated fountain and pin-standard icon", () => {
    const fc = pinsToFeatureCollection([
      {
        id: "b2",
        location: { latitude: 1, longitude: 2 },
        is_working: true,
        average_rating: null,
        ranking_score: null,
      },
    ]);
    expect(fc.features[0].properties.pill).toBeNull();
    expect(fc.features[0].properties.icon).toBe("pin-standard");
  });
});
```

- [ ] **Step 4: Run to confirm failure**

Run: `pnpm --filter mobile exec vitest run lib/map/pins.test.ts`
Expected: FAIL — `./pins` does not exist.

- [ ] **Step 5: Create `mobile/lib/map/pins.ts`** (adapted from `web/lib/map/pins.ts`, with `current_status` handling):

```typescript
/// <reference types="@types/geojson" />
import { GOLD_THRESHOLD } from "./constants";
import { formatPill } from "./format";

// ranking_score / current_status are OPTIONAL to match the generated
// `FountainPin` (both are `?: ... | null` there). Keeping them optional means a
// `FountainPin[]` from the API is directly assignable to `PinInput[]` with no
// per-pin normalization at the call site — normalization (`?? null`) is
// centralized in `pinsToFeatureCollection` below.
export type PinLike = {
  is_working: boolean;
  ranking_score?: number | null;
  current_status?: string | null;
};
export type PinInput = PinLike & {
  id: string;
  location: { latitude: number; longitude: number };
  average_rating: number | null;
  rating_count?: number;
};
export type PinProps = {
  id: string;
  is_working: boolean;
  ranking_score: number | null;
  average_rating: number | null;
  icon: string;
  pill: string | null;
};

export function basePinIcon(p: PinLike): "pin-broken" | "pin-gold" | "pin-standard" {
  if (!p.is_working || p.current_status === "not_working") return "pin-broken";
  if (p.ranking_score != null && p.ranking_score > GOLD_THRESHOLD) return "pin-gold";
  return "pin-standard";
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

- [ ] **Step 6: Run tests to confirm pass**

Run: `pnpm --filter mobile exec vitest run lib/map/pins.test.ts`
Expected: PASS. (`@types/geojson` was installed in Step 1, so `GeoJSON.*` resolves under `tsc`; under Vitest the types are erased anyway.)

- [ ] **Step 7: Format + commit** (the `@types/geojson` dep lands in this same commit as the code that needs it):

```bash
pnpm exec prettier --write mobile/lib/map/format.ts mobile/lib/map/pins.ts mobile/lib/map/pins.test.ts
git add mobile/package.json pnpm-lock.yaml mobile/lib/map/format.ts mobile/lib/map/pins.ts mobile/lib/map/pins.test.ts
git commit -m "feat(mobile): add pin icon/pill mapping to GeoJSON (mirrors web)"
git show --stat HEAD
```

---

### Task 5: Filters — state + bbox query + query key builders

**Files:**

- Create: `mobile/lib/map/filters.ts`
- Test: `mobile/lib/map/filters.test.ts`

**Interfaces:**

- Consumes: `BboxParams` from `./bounds`; the bbox query type from the generated client (`paths["/api/v1/fountains/bbox"]["get"]["parameters"]["query"]`).
- Produces: `FountainFilters`, `DEFAULT_FILTERS`, `buildBboxQuery(params, filters): BboxQuery`, `fountainsQueryKey(params, filters): unknown[]`, `hasActiveFilters(filters): boolean`. The Map screen (Task 9) builds the TanStack Query key + the `client.GET` query; `MapFilters` (Task 8) edits `FountainFilters`.

**Design:** `buildBboxQuery` always includes the four bbox coords and **omits** inactive filters (false booleans / null `minRating`) so the API is not over-constrained. The filter subset is the "basic" set the spec asks for (working-now, two common attributes, minimum rating); the typed query still type-checks against the full generated parameter set, so adding more later is additive. `min_rating_count` is intentionally not exposed in the basic UI.

- [ ] **Step 1: Write failing tests** — `mobile/lib/map/filters.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { paths } from "@fountainrank/api-client";

import { buildBboxQuery, DEFAULT_FILTERS, fountainsQueryKey, hasActiveFilters } from "./filters";

const BOUNDS = { min_lat: 39, min_lng: -98, max_lat: 40, max_lng: -97 };

// Type-only contract guard (checked by `tsc`, not at runtime): the builder's
// output MUST be a valid query for GET /api/v1/fountains/bbox per the generated
// OpenAPI contract. If someone loosens buildBboxQuery to emit an unknown key,
// this line fails the typecheck.
const _bboxQueryContract: NonNullable<
  paths["/api/v1/fountains/bbox"]["get"]["parameters"]["query"]
> = buildBboxQuery(BOUNDS, DEFAULT_FILTERS);
void _bboxQueryContract;

describe("DEFAULT_FILTERS", () => {
  it("is all-off / no minimum rating", () => {
    expect(DEFAULT_FILTERS).toEqual({
      workingNow: false,
      bottleFiller: false,
      wheelchairReachable: false,
      minRating: null,
    });
  });
});

describe("buildBboxQuery", () => {
  it("returns only the bbox coords when no filter is active", () => {
    expect(buildBboxQuery(BOUNDS, DEFAULT_FILTERS)).toEqual(BOUNDS);
  });
  it("adds working_now only when workingNow is true", () => {
    expect(buildBboxQuery(BOUNDS, { ...DEFAULT_FILTERS, workingNow: true })).toEqual({
      ...BOUNDS,
      working_now: true,
    });
  });
  it("adds attribute filters when toggled on", () => {
    expect(
      buildBboxQuery(BOUNDS, {
        ...DEFAULT_FILTERS,
        bottleFiller: true,
        wheelchairReachable: true,
      }),
    ).toEqual({ ...BOUNDS, bottle_filler: true, wheelchair_reachable: true });
  });
  it("adds min_rating only when minRating is non-null", () => {
    expect(buildBboxQuery(BOUNDS, { ...DEFAULT_FILTERS, minRating: 3 })).toEqual({
      ...BOUNDS,
      min_rating: 3,
    });
    expect(buildBboxQuery(BOUNDS, { ...DEFAULT_FILTERS, minRating: null })).toEqual(BOUNDS);
  });
});

describe("fountainsQueryKey", () => {
  it("is stable for identical inputs and changes when bounds or filters change", () => {
    const k1 = fountainsQueryKey(BOUNDS, DEFAULT_FILTERS);
    const k2 = fountainsQueryKey(BOUNDS, DEFAULT_FILTERS);
    expect(k1).toEqual(k2);
    const k3 = fountainsQueryKey(BOUNDS, { ...DEFAULT_FILTERS, workingNow: true });
    expect(k3).not.toEqual(k1);
    const k4 = fountainsQueryKey({ ...BOUNDS, max_lat: 41 }, DEFAULT_FILTERS);
    expect(k4).not.toEqual(k1);
  });
  it("starts with the fountains/bbox namespace", () => {
    expect(fountainsQueryKey(BOUNDS, DEFAULT_FILTERS).slice(0, 2)).toEqual(["fountains", "bbox"]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for defaults and true when any filter is active", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, workingNow: true })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, minRating: 2 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter mobile exec vitest run lib/map/filters.test.ts`
Expected: FAIL — `./filters` does not exist.

- [ ] **Step 3: Create `mobile/lib/map/filters.ts`:**

```typescript
import type { paths } from "@fountainrank/api-client";

import type { BboxParams } from "./bounds";

/** Typed query parameters for GET /api/v1/fountains/bbox (generated contract). */
type BboxQuery = NonNullable<paths["/api/v1/fountains/bbox"]["get"]["parameters"]["query"]>;

/** Basic public-discovery filters (spec Phase 3.7). A small, owner-facing subset
 *  of the API's filter parameters; the typed query stays compatible with the full
 *  generated set, so more filters can be added later without a contract change. */
export type FountainFilters = {
  workingNow: boolean;
  bottleFiller: boolean;
  wheelchairReachable: boolean;
  minRating: number | null;
};

export const DEFAULT_FILTERS: FountainFilters = {
  workingNow: false,
  bottleFiller: false,
  wheelchairReachable: false,
  minRating: null,
};

/** Merge the viewport bbox with only the *active* filters (omit false/null so the
 *  backend is not over-constrained). The result is the `query` for client.GET. */
export function buildBboxQuery(params: BboxParams, filters: FountainFilters): BboxQuery {
  const query: BboxQuery = { ...params };
  if (filters.workingNow) query.working_now = true;
  if (filters.bottleFiller) query.bottle_filler = true;
  if (filters.wheelchairReachable) query.wheelchair_reachable = true;
  if (filters.minRating != null) query.min_rating = filters.minRating;
  return query;
}

/** Stable TanStack Query key for a viewport + filter combination. */
export function fountainsQueryKey(params: BboxParams, filters: FountainFilters): unknown[] {
  return ["fountains", "bbox", params, filters];
}

export function hasActiveFilters(filters: FountainFilters): boolean {
  return (
    filters.workingNow ||
    filters.bottleFiller ||
    filters.wheelchairReachable ||
    filters.minRating != null
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pnpm --filter mobile exec vitest run lib/map/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Format + commit**

```bash
pnpm exec prettier --write mobile/lib/map/filters.ts mobile/lib/map/filters.test.ts
git add mobile/lib/map/filters.ts mobile/lib/map/filters.test.ts
git commit -m "feat(mobile): add fountain filter state + bbox query/key builders"
git show --stat HEAD
```

---

### Task 6: Native deps + MapLibre config plugin + CNG gitignore + pin assets

This is the **CNG / Expo-Go-ending** task — one logical deliverable: "the app now depends on MapLibre RN and builds via prebuild." No unit test; the gate is a clean reinstall + `expo config --type prebuild` resolving the plugins + `expo-doctor` green.

**Files:**

- Modify: `mobile/package.json` (deps) + `pnpm-lock.yaml` (by install)
- Modify: `mobile/app.config.ts` (add the MapLibre plugin to `plugins`)
- Modify: `.gitignore` (ignore `mobile/ios/`, `mobile/android/`)
- Create: `mobile/assets/pins/pin-standard.png`, `pin-gold.png`, `pin-broken.png` (copied from `web/public/pins/`)

- [ ] **Step 1: Determine the SDK-correct `expo-location` version** from the bundled list (do not guess):

```bash
grep '"expo-location"' node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json
```

Expected: a line like `"expo-location": "~19.0.x"`. Use that exact version string in Step 2. (If `node_modules` is missing/dirty, run the clean reinstall from Global Constraints first.)

- [ ] **Step 2: Add the dependencies to `mobile/package.json`.** In `dependencies`, add (keep the block alphabetized; `@maplibre/...` sorts before `@tanstack/...`):

```json
    "@maplibre/maplibre-react-native": "11.3.4",
    "expo-location": "<paste the ~version from Step 1>",
```

(`@types/geojson` was already added in Task 4, where `pins.ts` first references `GeoJSON.*`; it is also a MapLibre RN peer, so nothing more is needed here.)

- [ ] **Step 3: Install + refresh the lockfile** (from the repo root, Git Bash):

```bash
CI=true pnpm install --no-frozen-lockfile
```

Expected: completes; `pnpm-lock.yaml` updated.

- [ ] **Step 4: Add the MapLibre config plugin** to `mobile/app.config.ts` — change the `plugins` array:

```typescript
  plugins: ["expo-router", "@maplibre/maplibre-react-native"],
```

Leave the existing `ios.infoPlist.NSLocationWhenInUseUsageDescription` and `android.permissions` (added in 6e-1) as the source of the location permission declarations — do **not** also add the `expo-location` config plugin (it would duplicate the usage string and risk a prebuild conflict). The `expo-location` JS API works at runtime against the already-declared foreground permissions.

- [ ] **Step 5: Ignore the CNG-generated native folders** — append to `.gitignore`:

```gitignore

# Expo CNG / prebuild output (generated by `npx expo prebuild`; never committed — slice 6e-3)
mobile/ios/
mobile/android/
```

- [ ] **Step 6: Copy the three pin assets** from web into `mobile/assets/pins/` (Git Bash):

```bash
mkdir -p mobile/assets/pins
cp web/public/pins/pin-standard.png web/public/pins/pin-gold.png web/public/pins/pin-broken.png mobile/assets/pins/
ls -1 mobile/assets/pins/
```

Expected: `pin-broken.png`, `pin-gold.png`, `pin-standard.png`. (We do **not** copy `pin-selected.png` or `pill-bg.png` — see Scope boundaries.)

- [ ] **Step 7: CLEAN reinstall, then verify the config plugins resolve** (this is where the dirty-store gotcha bites):

```bash
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install
pnpm --filter mobile exec expo config --type prebuild
```

Expected: `expo config` exits 0 and the printed `plugins` include both `expo-router` and `@maplibre/maplibre-react-native`. If it fails with _"Unable to resolve a valid config plugin"_, re-run the clean reinstall (it is the symlink-consistency issue, not a code error).

- [ ] **Step 8: Run `expo-doctor`** (verifies the new deps' SDK compatibility):

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```

Expected: lint + typecheck + vitest + `expo-doctor` all green. (`@types/geojson` was installed in Task 4, so `mobile/lib/map/pins.ts` type-checks. `@maplibre/maplibre-react-native` is unknown to the React Native Directory check but is covered by the existing `listUnknownPackages: false` block.)

- [ ] **Step 9: Record the native SDK targets** — confirm the Expo SDK 56 defaults satisfy MapLibre RN 11.3.4's minimums and note them for the README (Task 10):
  - MapLibre RN 11.3.4 requires roughly **Android `minSdkVersion` 21+** and **iOS deployment target 12+** (well below Expo 56 defaults).
  - Expo SDK 56 defaults (Android `minSdk`/`compileSdk`/`targetSdk`, iOS deployment target) **exceed** those, so **no `expo-build-properties` override is needed**. Confirm the exact default values from the `expo config --type prebuild` output (the `android`/`ios` blocks) and carry them into the README in Task 10. If MapLibre RN's installed `README`/peer metadata states a higher floor than an Expo 56 default, add an `expo-build-properties` plugin entry to raise it (otherwise leave defaults).

- [ ] **Step 10: Commit** (stage only existing paths; `mobile/ios|android` are now ignored so nothing native is staged):

```bash
git add mobile/package.json pnpm-lock.yaml mobile/app.config.ts .gitignore mobile/assets/pins/pin-standard.png mobile/assets/pins/pin-gold.png mobile/assets/pins/pin-broken.png
git commit -m "build(mobile): add MapLibre RN + expo-location, config plugin, CNG gitignore, pin assets"
git show --stat HEAD
```

Expected: 6 files + the 3 PNGs staged; **no** `mobile/ios/` or `mobile/android/` entries.

---

### Task 7: `FountainMap` component (MapLibre RN shell)

**Files:**

- Create: `mobile/components/map/FountainMap.tsx`

**Interfaces:**

- Consumes: `RawBounds` from `lib/map/bounds`; `DEFAULT_CENTER`, `DEFAULT_ZOOM`, `NEIGHBORHOOD_ZOOM`, `CLUSTER_RADIUS`, `CLUSTER_MAX_ZOOM`, `PILL_MIN_ZOOM` from `lib/map/constants`; a `GeoJSON.FeatureCollection<GeoJSON.Point, PinProps>`.
- Produces: a `<FountainMap>` component with props
  `{ styleUrl: string; featureCollection: GeoJSON.FeatureCollection; userCoords?: { latitude: number; longitude: number } | null; recenterKey?: number; showUserLocation: boolean; onRegionChange: (bounds: RawBounds, zoom: number) => void; onPinPress: (id: string) => void }`. The first view is the continental-US default; when `userCoords` first becomes non-null (or `recenterKey` changes via the screen's locate button), a `Camera`-ref effect flies to the user — this is how the spec's "center on current location" (§5) is met reliably even though `coords` arrive _after_ first render. Denial leaves `userCoords` null and the effect no-ops (non-blocking).

**Proof:** shell — `tsc` + ESLint + `expo-doctor` (no Vitest; it imports RN/Expo).

**⚠️ Verify exports against the installed package.** The component/prop names below follow the `@maplibre/maplibre-react-native@11.3.4` v11 API (Context7 + the v11 migration notes): `MapView` with a `mapStyle` prop; `Camera` with `center`/`zoom`; `ShapeSource` with `cluster`/`clusterRadius`/`clusterMaxZoom` + `onPress`; `CircleLayer`/`SymbolLayer`; `Images`; `UserLocation`; the imperative map-ref methods `getVisibleBounds()` and `getZoom()`. Before writing, open `node_modules/.pnpm/@maplibre+maplibre-react-native@11.3.4/node_modules/@maplibre/maplibre-react-native/lib/typescript/` (or the package's `index.d.ts`) and confirm the exact export and prop names. Because this file is type-checked, any mismatch fails `tsc` immediately — fix to match the installed types. Use the **imperative ref** approach for region reads (below) rather than depending on the exact `onRegionDidChange` event payload shape, which varies across versions.

- [ ] **Step 1: Write the component** — `mobile/components/map/FountainMap.tsx`:

```tsx
import {
  Camera,
  type CameraRef,
  CircleLayer,
  Images,
  MapView,
  type MapViewRef,
  ShapeSource,
  SymbolLayer,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";

import type { RawBounds } from "../../lib/map/bounds";
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  NEIGHBORHOOD_ZOOM,
  PILL_MIN_ZOOM,
} from "../../lib/map/constants";
import { colors } from "../../theme";

const PIN_IMAGES = {
  "pin-standard": require("../../assets/pins/pin-standard.png"),
  "pin-gold": require("../../assets/pins/pin-gold.png"),
  "pin-broken": require("../../assets/pins/pin-broken.png"),
};

type FountainMapProps = {
  styleUrl: string;
  featureCollection: GeoJSON.FeatureCollection;
  userCoords?: { latitude: number; longitude: number } | null;
  /** Bump from the screen's locate button to re-center on the user on demand. */
  recenterKey?: number;
  showUserLocation: boolean;
  onRegionChange: (bounds: RawBounds, zoom: number) => void;
  onPinPress: (id: string) => void;
};

export function FountainMap({
  styleUrl,
  featureCollection,
  userCoords,
  recenterKey = 0,
  showUserLocation,
  onRegionChange,
  onPinPress,
}: FountainMapProps) {
  const mapRef = useRef<MapViewRef>(null);
  const cameraRef = useRef<CameraRef>(null);

  // Center on the user when coords FIRST arrive (they resolve after first render,
  // so a static initial center cannot do this) and again whenever the screen's
  // locate button bumps `recenterKey`. No coords -> no-op (denial is non-blocking).
  useEffect(() => {
    if (!userCoords) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [userCoords.longitude, userCoords.latitude],
      zoomLevel: NEIGHBORHOOD_ZOOM,
      animationDuration: 600,
    });
  }, [userCoords, recenterKey]);

  async function handleRegionDidChange() {
    const map = mapRef.current;
    if (!map) return;
    // getVisibleBounds() returns [[neLng, neLat], [swLng, swLat]].
    const [[neLng, neLat], [swLng, swLat]] = await map.getVisibleBounds();
    const zoom = await map.getZoom();
    onRegionChange({ west: swLng, south: swLat, east: neLng, north: neLat }, zoom);
  }

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      mapStyle={styleUrl}
      onRegionDidChange={handleRegionDidChange}
      logoEnabled={false}
      attributionEnabled
    >
      <Camera
        ref={cameraRef}
        defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }}
      />
      <Images images={PIN_IMAGES} />

      <ShapeSource
        id="fountains"
        shape={featureCollection}
        cluster
        clusterRadius={CLUSTER_RADIUS}
        clusterMaxZoom={CLUSTER_MAX_ZOOM}
        onPress={(e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const props = feature.properties ?? {};
          if (props.point_count != null) {
            // Cluster: zoom in toward the cluster centroid (via the Camera ref).
            const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
            cameraRef.current?.setCamera({
              centerCoordinate: [lng, lat],
              zoomLevel: Math.min(CLUSTER_MAX_ZOOM + 2, 18),
              animationDuration: 500,
            });
            return;
          }
          if (typeof props.id === "string") onPinPress(props.id);
        }}
      >
        <CircleLayer
          id="clusters"
          filter={["has", "point_count"]}
          style={{
            circleColor: "#0C44A0",
            circleStrokeColor: "#ffffff",
            circleStrokeWidth: 3,
            circleRadius: ["step", ["get", "point_count"], 16, 10, 22, 50, 28],
          }}
        />
        <SymbolLayer
          id="cluster-count"
          filter={["has", "point_count"]}
          style={{
            textField: ["get", "point_count_abbreviated"],
            textSize: 13,
            textColor: "#ffffff",
          }}
        />
        <SymbolLayer
          id="pins"
          filter={["!", ["has", "point_count"]]}
          style={{
            iconImage: ["get", "icon"],
            iconAnchor: "bottom",
            iconSize: 0.5,
            iconAllowOverlap: true,
          }}
        />
        <SymbolLayer
          id="pins-pill"
          minZoomLevel={PILL_MIN_ZOOM}
          // `has` only checks existence and EVERY feature has a `pill` key (null for
          // unrated). Mirror the web layer's non-null predicate so unrated pins draw
          // no pill (avoids a bogus/`null` textField).
          filter={["all", ["!", ["has", "point_count"]], ["!=", ["get", "pill"], null]]}
          style={{
            textField: ["get", "pill"],
            textSize: 12,
            textAnchor: "top",
            textOffset: [0, 1.2],
            textColor: colors.brandBlue,
            textHaloColor: "#ffffff",
            textHaloWidth: 1.5,
            textAllowOverlap: true,
          }}
        />
      </ShapeSource>

      {showUserLocation ? <UserLocation visible /> : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
```

> Implementer notes (resolve against installed types in this order; the file is `tsc`-gated):
>
> - Component name: if v11 exports `Map` instead of `MapView`, rename the import + JSX. The ref type may be `MapViewRef` or `MapRef`.
> - Style props: MapLibre RN style props may be **camelCase** (as above) or expect a nested `style={{...}}`. If `tsc` rejects the style object, match the installed `…LayerStyle` types.
> - Camera initial view: v11 may use `initialViewState={{ center, zoom }}` instead of `defaultSettings={{ centerCoordinate, zoomLevel }}`. Use whichever the installed `CameraProps` declares (keep `DEFAULT_CENTER`/`DEFAULT_ZOOM` as the first view).
> - `Camera` recenter: `cameraRef.current.setCamera({ centerCoordinate, zoomLevel, animationDuration })` is the imperative method on the **Camera** ref (`CameraRef`); if v11 names it `flyTo`/`moveTo` or nests the args differently, match the installed `CameraRef` type. The recenter effect + the cluster-zoom both use it.
> - `getVisibleBounds()`/`getZoom()` are imperative methods on the **MapView** ref; confirm their names/signatures. Prefer the documented zoom getter over deriving zoom from bounds.

- [ ] **Step 2: Type-check + lint + format**

```bash
pnpm exec prettier --write mobile/components/map/FountainMap.tsx
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```

Expected: lint + typecheck green (no Vitest impact). Resolve any MapLibre RN type mismatches against the installed package per the notes above.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/map/FountainMap.tsx
git commit -m "feat(mobile): add FountainMap MapLibre RN component (shell)"
git show --stat HEAD
```

---

### Task 8: `MapFilters` component (shell)

**Files:**

- Create: `mobile/components/map/MapFilters.tsx`

**Interfaces:**

- Consumes: `FountainFilters` from `lib/map/filters`; theme tokens.
- Produces: a `<MapFilters>` component with props `{ filters: FountainFilters; onChange: (next: FountainFilters) => void }`. The Map screen (Task 9) owns the filter state and passes `filters`/`onChange`.

**Proof:** shell — `tsc` + ESLint.

**Design:** a compact horizontal row of toggle chips (working-now, bottle filler, wheelchair reachable) plus a minimum-rating stepper (null → 3 → 4 → null cycle for "basic" per spec). Pure RN (`Pressable`/`Text`/`View`), no new deps. Each chip flips one field and calls `onChange` with the next `FountainFilters`. Document the chip in the style guide (Task 10).

- [ ] **Step 1: Write the component** — `mobile/components/map/MapFilters.tsx`:

```tsx
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import type { FountainFilters } from "../../lib/map/filters";
import { colors, spacing, typography } from "../../theme";

type MapFiltersProps = {
  filters: FountainFilters;
  onChange: (next: FountainFilters) => void;
};

// Basic minimum-rating cycle: off -> 3+ -> 4+ -> off.
function nextMinRating(current: number | null): number | null {
  if (current == null) return 3;
  if (current === 3) return 4;
  return null;
}

export function MapFilters({ filters, onChange }: MapFiltersProps) {
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chip("Working now", filters.workingNow, () =>
        onChange({ ...filters, workingNow: !filters.workingNow }),
      )}
      {chip("Bottle filler", filters.bottleFiller, () =>
        onChange({ ...filters, bottleFiller: !filters.bottleFiller }),
      )}
      {chip("Wheelchair", filters.wheelchairReachable, () =>
        onChange({ ...filters, wheelchairReachable: !filters.wheelchairReachable }),
      )}
      {chip(
        filters.minRating == null ? "Any rating" : `${filters.minRating}★+`,
        filters.minRating != null,
        () => onChange({ ...filters, minRating: nextMinRating(filters.minRating) }),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  chipText: { ...typography.meta, color: colors.text },
  chipTextActive: { color: colors.onBrand },
});
```

- [ ] **Step 2: Type-check + lint + format**

```bash
pnpm exec prettier --write mobile/components/map/MapFilters.tsx
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile -Fast
```

Expected: green.

- [ ] **Step 3: Commit**

```bash
git add mobile/components/map/MapFilters.tsx
git commit -m "feat(mobile): add MapFilters chip row (shell)"
git show --stat HEAD
```

---

### Task 9: Foreground location hook + Map screen wiring

**Files:**

- Create: `mobile/hooks/useForegroundLocation.ts`
- Replace: `mobile/app/(tabs)/index.tsx`

**Interfaces:**

- Consumes: `useForegroundLocation` (this task); `FountainMap` (Task 7); `MapFilters` (Task 8); `useApi()` provider + `unwrap` (`mobile/lib/api`); `isMapConfigured` (`mobile/lib/config`); `normalizeBounds`/`shouldLoadPins`/`isAtCap`/`RawBounds` (`lib/map/bounds`); `pinsToFeatureCollection` (`lib/map/pins`); `DEFAULT_FILTERS`/`buildBboxQuery`/`fountainsQueryKey`/`FountainFilters` (`lib/map/filters`); `DEFAULT_ZOOM` (`lib/map/constants`); `resolveViewState`/`ViewState` (`lib/view-state`); `components["schemas"]["FountainPin"]` from `@fountainrank/api-client`; `ScreenContainer` (unavailable branch).
- Produces: the functional Map tab.

**State handling (why not `QueryStateView`):** the map must stay **visible** while pins load/fail (it's a live canvas, not content that gets replaced), so this screen does **not** wrap content in `QueryStateView`. Instead it reuses the same shared classifier — `resolveViewState` (`lib/view-state.ts`, tested in 6e-2) — to derive loading/offline/error/empty/ready, then renders a non-blocking banner overlay (plus map-specific `belowZoom`/`capped` notes the resolver doesn't model). This keeps the offline-vs-error logic single-sourced and drift-free.

**Proof:** shell — `tsc` + ESLint + `expo-doctor`. The logic it depends on is covered by Tasks 3–5 unit tests. **The map render itself is NOT proven by CI** (owner-gated native build).

- [ ] **Step 1: Write the location hook** — `mobile/hooks/useForegroundLocation.ts`:

```typescript
import * as Location from "expo-location";
import { useEffect, useState } from "react";

export type LocationStatus = "idle" | "locating" | "granted" | "denied" | "unavailable";

export type ForegroundLocation = {
  status: LocationStatus;
  coords: { latitude: number; longitude: number } | null;
};

/**
 * Request foreground (when-in-use) location once on mount and, if granted, fetch
 * a single current position. NON-BLOCKING: denial or failure leaves the map fully
 * usable (status reflects it; coords stay null). No background location, ever
 * (spec section 20). Never logs coordinates.
 */
export function useForegroundLocation(): ForegroundLocation {
  const [state, setState] = useState<ForegroundLocation>({ status: "idle", coords: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setState({ status: "locating", coords: null });
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== "granted") {
          setState({ status: "denied", coords: null });
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        setState({
          status: "granted",
          coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
        });
      } catch {
        if (!cancelled) setState({ status: "unavailable", coords: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
```

- [ ] **Step 2: Replace the Map screen** — `mobile/app/(tabs)/index.tsx` (full file):

```tsx
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { components } from "@fountainrank/api-client";

import { FountainMap } from "../../components/map/FountainMap";
import { MapFilters } from "../../components/map/MapFilters";
import { ScreenContainer } from "../../components/ScreenContainer";
import { useForegroundLocation } from "../../hooks/useForegroundLocation";
import { unwrap } from "../../lib/api";
import { isMapConfigured } from "../../lib/config";
import { isAtCap, normalizeBounds, type RawBounds, shouldLoadPins } from "../../lib/map/bounds";
import { DEFAULT_ZOOM } from "../../lib/map/constants";
import {
  buildBboxQuery,
  DEFAULT_FILTERS,
  type FountainFilters,
  fountainsQueryKey,
} from "../../lib/map/filters";
import { pinsToFeatureCollection } from "../../lib/map/pins";
import { resolveViewState, type ViewState } from "../../lib/view-state";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

type FountainPin = components["schemas"]["FountainPin"];

export default function MapScreen() {
  const { client, config } = useApi();
  const router = useRouter();
  const location = useForegroundLocation();

  const [filters, setFilters] = useState<FountainFilters>(DEFAULT_FILTERS);
  const [region, setRegion] = useState<{ bounds: RawBounds; zoom: number } | null>(null);
  const [recenterKey, setRecenterKey] = useState(0);

  const norm = region ? normalizeBounds(region.bounds) : null;
  const params = norm && !norm.skip ? norm.params : null;
  const zoom = region?.zoom ?? DEFAULT_ZOOM;
  const enabled = isMapConfigured(config) && params != null && shouldLoadPins(zoom);

  const pinsQuery = useQuery({
    queryKey: params ? fountainsQueryKey(params, filters) : ["fountains", "bbox", "idle"],
    enabled,
    queryFn: async (): Promise<FountainPin[]> =>
      unwrap(
        await client.GET("/api/v1/fountains/bbox", {
          params: { query: buildBboxQuery(params!, filters) },
        }),
      ),
  });

  // FountainPin[] is directly assignable to PinInput[] (ranking_score/current_status
  // are optional), so no per-pin normalization is needed at the call site.
  const featureCollection = useMemo(
    () => pinsToFeatureCollection(pinsQuery.data ?? []),
    [pinsQuery.data],
  );

  // Honest "map unavailable" state when no basemap style URL is configured.
  if (!isMapConfigured(config)) {
    return (
      <ScreenContainer includeTopInset>
        <View style={styles.centered}>
          <Text style={styles.title}>Map unavailable</Text>
          <Text style={styles.note}>The map is not configured for this build.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const belowZoom = region != null && !shouldLoadPins(zoom);
  const capped = pinsQuery.data != null && isAtCap(pinsQuery.data.length);
  // Reuse the shared resolver so offline-vs-error classification stays single-sourced.
  // isLoading (= isPending && isFetching) is true only on the FIRST load, so a
  // background refetch doesn't flash the spinner.
  const viewState: ViewState = resolveViewState({
    isLoading: enabled && pinsQuery.isLoading,
    isError: pinsQuery.isError,
    error: pinsQuery.error,
    isEmpty: (pinsQuery.data?.length ?? 0) === 0,
  });

  return (
    <View style={styles.fill}>
      <FountainMap
        styleUrl={config.basemapStyleUrl!}
        featureCollection={featureCollection}
        userCoords={location.coords}
        recenterKey={recenterKey}
        showUserLocation={location.status === "granted"}
        onRegionChange={(bounds, z) => setRegion({ bounds, zoom: z })}
        onPinPress={(id) => router.push(`/fountains/${id}`)}
      />

      <View style={styles.filterBar} pointerEvents="box-none">
        <MapFilters filters={filters} onChange={setFilters} />
      </View>

      {location.coords ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Center on my location"
          onPress={() => setRecenterKey((k) => k + 1)}
          style={styles.locate}
        >
          <Text style={styles.locateGlyph}>◎</Text>
        </Pressable>
      ) : null}

      <MapOverlay
        belowZoom={belowZoom}
        viewState={viewState}
        capped={capped}
        onRetry={() => void pinsQuery.refetch()}
      />
    </View>
  );
}

function MapOverlay(props: {
  belowZoom: boolean;
  viewState: ViewState;
  capped: boolean;
  onRetry: () => void;
}) {
  const loading = props.viewState === "loading";
  const retryable = props.viewState === "offline" || props.viewState === "error";

  let message: string | null = null;
  if (props.belowZoom) message = "Zoom in to see fountains";
  else if (props.viewState === "offline") message = "You appear to be offline";
  else if (props.viewState === "error") message = "Couldn't load fountains";
  else if (props.viewState === "empty") message = "No fountains in this area";
  else if (props.viewState === "ready" && props.capped)
    message = "Showing the first 500 — zoom in for more";

  if (!loading && message == null) return null;

  return (
    <View style={styles.banner} pointerEvents="box-none">
      {loading ? <ActivityIndicator color={colors.brandBlue} /> : null}
      {message ? (
        <Text style={styles.bannerText} onPress={retryable ? props.onRetry : undefined}>
          {message}
          {retryable ? " — tap to retry" : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  filterBar: { position: "absolute", top: spacing.sm, left: 0, right: 0 },
  locate: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.lg + 56,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  locateGlyph: { ...typography.heading, color: colors.brandBlue },
  banner: {
    position: "absolute",
    bottom: spacing.lg,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerText: { ...typography.meta, color: colors.text },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
});
```

> Implementer notes:
>
> - Confirm `useApi()` returns `{ client, config }` (the 6e-2 `ApiProvider`); if its shape differs, adapt the destructuring. `config` is the parsed `MobileConfig`.
> - `client.GET("/api/v1/fountains/bbox", { params: { query } })` returns the openapi-fetch result; `unwrap` yields `FountainPin[]` or throws `ApiError(status)`. A network failure has no `.status` → `resolveViewState` classifies it as `offline`; an `ApiError` with a numeric status → `error`.
> - **Center-on-location:** the screen passes `userCoords`/`recenterKey` to `FountainMap`, which flies the camera there when coords first arrive and again when the locate button bumps `recenterKey`. The locate button only renders once `location.coords` exists; denial leaves the map at the default view (non-blocking) — satisfying spec §5 "center on current location."
> - The Map screen renders the map full-bleed (no `ScreenContainer` padding) with overlays; only the "map unavailable" branch uses `ScreenContainer`.
> - The `◎` locate glyph is a placeholder; if an `@expo/vector-icons` glyph (already a 6e-2 dep) reads better, use one — keep it a `tsc`/lint-clean shell detail.

- [ ] **Step 3: Type-check + lint + format**

```bash
pnpm exec prettier --write mobile/hooks/useForegroundLocation.ts "mobile/app/(tabs)/index.tsx"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile
```

Expected: lint + typecheck + vitest + expo-doctor green. (Resolve any `useApi()` shape or MapLibre type mismatches.)

- [ ] **Step 4: Commit**

```bash
git add mobile/hooks/useForegroundLocation.ts "mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): wire map screen — bbox pins, filters, location, pin->detail nav"
git show --stat HEAD
```

---

### Task 10: Docs (README + style guide) + full local CI mirror

**Files:**

- Modify: `mobile/README.md`
- Modify: `docs/style-guide.md`

- [ ] **Step 1: Update `mobile/README.md`** — add a "Map (slice 6e-3)" subsection capturing:
  - 6e-3 adds `@maplibre/maplibre-react-native@11.3.4` + its Expo config plugin → **CNG/prebuild**; **the app no longer runs in Expo Go**. To see the map, build a **dev client** or an **EAS build** (`eas build --profile development`), then run Metro against it. CI does not render the map.
  - `EXPO_PUBLIC_BASEMAP_STYLE_URL` (public; defaults to the DO Spaces Protomaps "light" style the web app uses) and `EXPO_PUBLIC_API_BASE_URL` are the runtime inputs.
  - The native SDK targets confirmed in Task 6 Step 9 (Android `minSdk`/`compileSdk`/`targetSdk`, iOS deployment target) and that they satisfy MapLibre RN 11.3.4's minimums.
  - The clean-reinstall-before-prebuild gotcha (one line, link to the constraint).

- [ ] **Step 2: Update `docs/style-guide.md`** — under _Mobile (React Native)_, document the new UI elements (per the CLAUDE.md style-guide rule): **Map screen** (full-bleed MapLibre map), **fountain pins** (standard/gold/broken icon semantics + rating pill at zoom ≥ 13), **filter chips** (`MapFilters` — toggle + min-rating cycle, active = brand-blue fill), and **map overlay banner** (loading/offline/error/empty/capped/zoom-in states). Keep it consistent with the existing mobile component entries.

- [ ] **Step 3: Format the docs explicitly** (outside the format:check glob, so do it by hand):

```bash
pnpm exec prettier --write mobile/README.md docs/style-guide.md
```

- [ ] **Step 4: Run the FULL local CI mirror** (must be green before the PR):

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check
```

Expected: backend + workspace-js + web build + mobile (lint + typecheck + vitest + expo-doctor) all green. If a scoped mobile check fails _inside `generate`_, run `uv sync` in `backend/` and re-run.

- [ ] **Step 5: Commit**

```bash
git add mobile/README.md docs/style-guide.md
git commit -m "docs(mobile): document map slice 6e-3 (README + style guide)"
git show --stat HEAD
```

---

## After the tasks — PR + Codex Loop B

1. Push the branch and open the PR (`gh pr create`), targeting `main`. PR body: what shipped (the four pure modules + tested helpers, MapLibre RN dep + CNG, FountainMap/MapFilters/location/screen shell), the **proof level** (Local CI green; **map render pending an owner-gated native build** — do NOT claim the map renders), and the Expo-Go-ends note. No AI attribution; no time estimates.
2. Get **CI green** first (watch with `gh pr checks`/`gh run watch`). Watch for the **Trivy false-positive** on the big `pnpm-lock.yaml` diff (image-scan skips on PRs → pre-existing alerts read as "new"); if it trips, verify the alerts are pre-existing (`git show origin/main:pnpm-lock.yaml | grep -c "<pkg>@<ver>"`) and suppress in `.trivyignore` with justification + revisit, per the documented mechanism.
3. Run **Codex Loop B** (bypass mode; cwd `/mnt/d/repos/fountainrank`; repo-relative paths) — address every finding + any other reviewer/bot comment; loop to `VERDICT: APPROVED`.
4. **Squash-merge** once CI is green AND Codex `VERDICT: APPROVED` AND every PR comment addressed.
5. Update the handoff doc (commit directly to `main`): record 6e-3 merged, that the map render is still owner-gated (next proof = dev-client/EAS build), and set **NEXT = 6e-4** (fountain detail + public reads).

## Self-review checklist (done while writing)

- **Spec coverage (§15 Phase 3):** MapLibre RN + config plugin + CNG → Task 6; foreground location non-blocking → Task 9 (`useForegroundLocation`); Protomaps basemap → Tasks 2 (URL) + 7 (`mapStyle`); bbox pins → Tasks 4/5/9; pin states working/broken/gold/rated → Task 4 (`basePinIcon` incl. `current_status`); pin→detail nav → Task 9 (`router.push`); filters → Tasks 5/8/9. §20 native config (CNG out of git, foreground-only, HTTPS-only) → Task 6 + constraints. §21 proof wording → constraints + PR section.
- **Placeholder scan:** every code step has complete code; no TBD/TODO.
- **Type consistency:** `RawBounds`/`BboxParams`/`FountainFilters`/`PinInput`/`PinProps` names are used identically across Tasks 3–9; `buildBboxQuery`/`fountainsQueryKey`/`pinsToFeatureCollection`/`normalizeBounds`/`shouldLoadPins`/`isAtCap`/`isMapConfigured` signatures match their definitions.
- **Known residual risk (flagged, not hidden):** the exact `@maplibre/maplibre-react-native@11.3.4` export/prop/ref names are verified against the installed package at Task 7 (the file is `tsc`-gated, so a mismatch fails the build and is corrected then) — this is the one place the plan cannot be 100% verbatim without the package on disk.
