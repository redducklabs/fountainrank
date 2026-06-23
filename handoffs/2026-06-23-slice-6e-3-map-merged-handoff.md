# Handoff — Mobile slice 6e-3 (map + public discovery) merged; NEXT = 6e-4 (fountain detail) (2026-06-23)

> **This supersedes** `handoffs/2026-06-23-mobile-store-readiness-and-6e-3-next-handoff.md` as the resume point. 6e-3 (the MapLibre map) is merged. The next slice is **6e-4 (fountain detail + public reads)**.

## TL;DR — what to do next

1. **Immediate next action: build slice 6e-4 (fountain detail + public reads).** Flow: write `docs/plans/2026-06-23-mobile-6e-4-*.md` → **Codex Loop A** → branch → implement (TDD) → CI green + **Codex Loop B** + comments addressed → squash-merge. 6e-4 fills in `app/fountains/[id].tsx` (currently a placeholder) using `GET /api/v1/fountains/{id}` (`FountainDetail`): rating summary, dimensions, operational status, access attributes, placement, notes, last-verified — unknowns shown honestly; refresh/retry; preserve map context on back. **Claude-actionable to CI-green** (no auth, no native-only deps → 6e-4 tops out at **Local CI** proof; it does NOT need a device).
2. **6e-3's map render is still UNVERIFIED on a device (owner-gated).** Code + helpers are CI-green, but the actual MapLibre render has only been proven by `tsc`/lint/`expo-doctor`/unit tests + `expo config --type prebuild` — **never on a device** (no Mac → EAS dev-client). The first owner-gated dev-client/EAS build is the proof. Do not claim the map "renders/works" until observed on device.
3. **The app no longer runs in Expo Go** (6e-3 added the MapLibre native dep + config plugin → CNG/prebuild). Generated `mobile/ios/` + `mobile/android/` are git-ignored.

**Latest `main`:** this handoff doc sits on top of `0975b6d` — `feat(mobile): map + public discovery ... (#69)` (the 6e-3 merge). So `git log` shows the handoff commit first, then `0975b6d`.

---

## Current state (verified 2026-06-23)

**Merged to `main` this session:**

- **PR #69** (`0975b6d`) — **slice 6e-3 map + public discovery**. Plan: `docs/plans/2026-06-23-mobile-6e-3-map-and-public-discovery.md` (Codex-approved, Loop A round 2). **67 mobile unit tests across 7 `mobile/lib` test files** (added bounds/pins/filters + config map cases). CI green; Codex PR review `VERDICT: APPROVED` (round 2). Squash-merged.

Local `main` == `origin/main`, tree clean (top commits: this handoff doc, then `0975b6d` #69). Post-merge CI/CodeQL/security: green.

**What 6e-3 shipped (build 6e-4 on top of this):**

- **Pure, unit-tested map helpers** in `mobile/lib/map/` (zero RN/Expo imports, Vitest node) mirroring the merged web map (`web/lib/map/*`):
  - `constants.ts` — `MIN_ZOOM 10`, `MAX_BBOX_RESULTS 500`, `GOLD_THRESHOLD 4`, `PILL_MIN_ZOOM 13`, `NEIGHBORHOOD_ZOOM 14`, `DEFAULT_CENTER [-98.5,39.8]`, `DEFAULT_ZOOM 3.5`, `CLUSTER_RADIUS 60`, `CLUSTER_MAX_ZOOM 14`.
  - `bounds.ts` — `RawBounds`, `BboxParams`, `wrapLng`, `normalizeBounds` (clamp lat / wrap lng / **skip** antimeridian+degenerate), `shouldLoadPins`, `isAtCap`.
  - `format.ts` — `formatPill` (★ N.N; 6e-4 can extend with the web `format.ts` detail helpers).
  - `pins.ts` — `PinLike`/`PinInput`/`PinProps`, `basePinIcon` (broken if `!is_working || current_status==="not_working"`; gold if `ranking_score>4`; else standard), `pinsToFeatureCollection`. **`ranking_score`/`current_status` are optional so `FountainPin[]` is directly assignable to `PinInput[]`** (no per-pin normalization).
  - `filters.ts` — `FountainFilters` (`workingNow`/`bottleFiller`/`wheelchairReachable`/`minRating`), `DEFAULT_FILTERS`, `buildBboxQuery` (omits inactive filters; typed against the generated `/api/v1/fountains/bbox` query), `fountainsQueryKey`, `hasActiveFilters`.
- **Config:** `mobile/lib/config.ts` gained optional `basemapStyleUrl?` + `isMapConfigured(config)` (mirrors the `logtoAppId`/`isAuthConfigured` pattern). `app.config.ts` `extra.basemapStyleUrl` defaults to the web's DO-Spaces Protomaps "light" style, overridable via `EXPO_PUBLIC_BASEMAP_STYLE_URL`.
- **Shell** (untested — `tsc`/ESLint/`expo-doctor` only):
  - `components/map/FountainMap.tsx` — the MapLibre map.
  - `components/map/MapFilters.tsx` — filter chip row.
  - `hooks/useForegroundLocation.ts` — non-blocking when-in-use location (`expo-location`).
  - `app/(tabs)/index.tsx` — the wired Map screen: TanStack Query keyed on viewport+filters, `resolveViewState`-based overlay (loading/offline/error/empty/belowZoom/capped), locate button, pin→`/fountains/[id]`.
- **Native:** `@maplibre/maplibre-react-native@11.3.4` + `expo-location@~56.0.18` + the MapLibre Expo config plugin (in `app.config.ts` `plugins`). Pin assets in `mobile/assets/pins/` (standard/gold/broken, copied from `web/public/pins/`). `mobile/ios/`+`mobile/android/` git-ignored.

---

## 🔑 MapLibre RN v11.3.4 API facts (learned this slice — saves the next agent a research loop)

The installed `@maplibre/maplibre-react-native@11.3.4` API differs sharply from older rnmapbox-style docs/examples. **Verify against the installed `.d.ts` before writing map code; the file is `tsc`-gated.** What 6e-3 confirmed:

- Map component is **`Map`** (not `MapView`); ref type **`MapRef`**; style URL prop is **`mapStyle`**; ornament toggles are **`logo`**/**`attribution`** (booleans). `MapRef` exposes `getCenter()`/`getZoom()`/`queryRenderedFeatures()` — **NO `getVisibleBounds()`**.
- Viewport bounds come from the **`onRegionDidChange`** event: `e.nativeEvent` is a `ViewStateChangeEvent` with `center`, `zoom`, and **`bounds: [west, south, east, north]`** (`LngLatBounds` is a flat `[w,s,e,n]` tuple; `LngLat` is `[lng, lat]`).
- GeoJSON source is **`GeoJSONSource`** (not `ShapeSource`); data prop is **`data`** (not `shape`); cluster props `cluster`/`clusterRadius`/`clusterMaxZoom`; `onPress` → `e.nativeEvent.features`; ref `GeoJSONSourceRef.getClusterExpansionZoom(clusterId)`.
- Layers use the single **`Layer`** component with `type` + modern **`paint`/`layout`** (style-spec **snake_case** keys — identical to web `layers.ts`; the legacy camelCase `style` prop is deprecated → removed in v12). Pass `source="fountains"` explicitly. Expression arrays type-check **without** casts (unlike web's maplibre-gl which needed `as unknown as`).
- **`Camera`** uses **`initialViewState={{ center, zoom }}`** (not `defaultSettings`/`centerCoordinate`); ref **`CameraRef`** with **`flyTo`/`fitBounds`/`zoomTo`/`jumpTo`/`easeTo`** (NO `setCamera`).
- **`Images`** takes `images={{ name: require(...) }}`. **`UserLocation`** has **no `visible` prop** — render it conditionally (it auto-tracks once mounted).
- `expo-location` SDK-correct version is **`~56.0.18`** (Expo 56 unified versioning — NOT a standalone `19.x`). Always read `node_modules/.pnpm/expo@*/node_modules/expo/bundledNativeModules.json`.

---

## Standing constraints — every future mobile slice must respect these

1. **No dev-auth seam, ever (§14):** all API reads go through the existing `createApiClient` facade (`mobile/lib/api.ts`); never a raw `makeClient`; never an `X-Dev-*` header. 6e-3's bbox reads are public (no `Authorization`). 6e-4 detail reads are the same (public).
2. **Auth-unavailable mode (§21):** `logtoAppId?`/`isAuthConfigured` unchanged; no signed-in UI until 6e-9. 6e-4 is public-read only.
3. **Proof-level honesty (§21):** PR/handoff wording bounded by the strongest proof reached. 6e-4 = **Local CI**. 6e-3's map render = **Native build** (owner-gated, still unverified). Never claim a device behavior CI didn't prove.
4. **MapLibre + Expo Go ended (6e-3).** Native folders stay out of git. Map render verified only on dev-client/EAS (owner-gated).
5. **API contract is method-accurate** vs `packages/api-client/src/schema.d.ts`. 6e-4 read: `GET /api/v1/fountains/{id}` → `FountainDetail` (`id`, `location`, `is_working`, `comments`, `average_rating`, `rating_count`, `ranking_score`, `created_at`, `last_rated_at`, `current_status?`, `last_verified_at?`, `placement_note?`, `dimensions: DimensionSummary[]`, `attributes: AttributeConsensusOut[]`). Also `GET /rating-types`, `/attribute-types` if needed for labels. Notes list: `GET /fountains/{id}/notes` (list/create only — no edit/delete).
6. **Mirror the web detail UI** (`web/components/fountain/DetailOverlay.tsx`/`FountainDetail.tsx`/`StatusBlock.tsx`/`AttributeList.tsx`/`NotesList.tsx`) + web `lib/map/format.ts` (`statusDisplay`, `attributeDisplay`, `formatDimension`, `formatRelativeTime`, `conditionStatusLabel`, etc.) — extend `mobile/lib/map/format.ts` (or a new `mobile/lib/detail/*`) with the pure formatters as **unit-tested helpers**; the detail screen is the shell.
7. **No Mac → EAS** (free tier; re-verify quota at 6e-10). EAS project linked (`red-duck-labs/fountainrank`, projectId committed).
8. **Process:** branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → **squash-merge**. Codex Loop A on every plan, Loop B on every PR (bypass mode; cwd `/mnt/d/repos/fountainrank`; repo-relative paths). No AI attribution; no time estimates; Conventional Commits. Handoffs commit **directly to main**.

---

## Gotchas (read before local mobile work)

- **🔑 CLEAN reinstall before any `expo prebuild`/`eas`/`expo config` command AND after every Codex (WSL) run.** `rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install`. Confirmed again this slice: Codex's WSL reruns got stuck in pnpm restore (the same dirty-store issue), and a clean reinstall was needed before each local `run.ps1 check`. Memory: `fountainrank-mobile-clean-reinstall-before-eas-prebuild`.
- **Adding a mobile dep:** add to `mobile/package.json` with the SDK-correct version from `bundledNativeModules.json`, `CI=true pnpm install --no-frozen-lockfile`, commit `pnpm-lock.yaml` in the **same** task. `@maplibre/...` is covered by the existing `expo.doctor.reactNativeDirectoryCheck.listUnknownPackages: false` block. **Land a new `@types/*` dep in the same commit as the first code that references it** (kept intermediate commits green for `@types/geojson`).
- **The mobile check does NOT run Prettier.** `pnpm exec prettier --write` touched `mobile/**` before the full `./run.ps1 check`; format `docs/**`/`handoffs/**` explicitly (outside the format:check glob).
- **`generate` runs before scoped mobile checks** (needs backend `uv`); a regenerated `packages/api-client/src/schema.d.ts` is usually a no-op diff — don't stage it accidentally.
- **Trivy diff check** did NOT trip on #69 (the lockfile diff was smaller than the big mobile PRs); the false-positive mechanism (`.trivyignore` with justification) remains available if a future big-lockfile PR trips it. Memory: `fountainrank-trivy-false-positive-large-mobile-prs`.
- **Windows backslash file-tool paths; Git Bash forward slashes; run.ps1 via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 <args>`.** Commands run from the repo root. Codex MCP `cwd` = `/mnt/d/repos/fountainrank` (derived).

---

## Resume commands

```bash
# ground state — expect the top commits to be this handoff doc + `... (#69)` (0975b6d); clean tree
git -C /d/repos/fountainrank log --oneline -4 origin/main
git -C /d/repos/fountainrank status --short

# CLEAN reinstall (before any prebuild/eas command, and after any Codex run):
rm -rf node_modules web/node_modules mobile/node_modules packages/*/node_modules && CI=true pnpm install

# local CI mirror:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check            # full
powershell.exe -NoProfile -ExecutionPolicy Bypass -File run.ps1 check -Mobile     # mobile only
pnpm --filter mobile exec expo config --type prebuild                            # verify config plugins resolve (exit 0)
```

## Key artifacts & pointers

- **6e-3 plan (APPROVED):** `docs/plans/2026-06-23-mobile-6e-3-map-and-public-discovery.md`. **Umbrella spec (APPROVED):** `docs/specs/2026-06-23-mobile-store-testing-distribution-design.md` (§15 Phase 4 = 6e-4 detail; §18 slice table; §21 proof levels). **Map stack architecture:** `docs/specs/2026-06-16-architecture-and-foundation-design.md` + `docs/design/architecture.md`.
- **Web detail to mirror for 6e-4:** `web/components/fountain/*`, `web/lib/fountains.ts` (`getFountainDetailServer(id, requestId)` + `getFountainNotesServer(id, requestId)` — note the mobile client uses `createApiClient().GET("/api/v1/fountains/{id}")` directly, not these server helpers), `web/lib/map/format.ts` (detail formatters).
- **Process:** `claude_help/development-process.md`, `testing-ci.md`, `codex-review-process.md`, `github-cli.md`.
- **Prior handoffs:** `handoffs/2026-06-23-mobile-store-readiness-and-6e-3-next-handoff.md`, `2026-06-23-slice-6e-2-app-shell-merged-handoff.md`.
- **Memories (auto-load):** `fountainrank-bundle-id-confirmed`, `fountainrank-mobile-clean-reinstall-before-eas-prebuild`, `fountainrank-trivy-false-positive-large-mobile-prs`, `fountainrank-deploy-is-manual-dispatch`.
- **Slice table (epic):** 6e-1 ✅(#66) · 6e-2 ✅(#67) · 6e-3 ✅(#69) · **6e-4 ◀ NEXT** (detail + public reads) · 6e-5 auth · 6e-6 contribs · 6e-7 add-fountain · 6e-8 store meta+icon/splash (EAS project ✅) · 6e-9 auth/OAuth records · 6e-10 device RC + store builds.
