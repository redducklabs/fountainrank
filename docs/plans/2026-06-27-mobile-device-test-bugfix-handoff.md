# Mobile device-test bug-fix handoff (2026-06-27)

**Source:** an owner device-test pass on 2026-06-27 (real iOS + Android builds). Screenshots in
`temp/debugging/WhatsApp Image 2026-06-27 at 2.23.12 PM*.jpeg` and `…2.41.31 PM.jpeg`.

**Purpose:** a self-contained worklist + priority order so this can be picked up in a fresh session
without the originating conversation. Every item below is grounded in the current code (verified
file:line); the full root-cause write-up, evidence, and acceptance criteria live in the linked GitHub
issue. This doc summarizes and **sequences** them.

> Two of these were already "closed as fixed" (#85, #88) but the user-visible symptom never went away —
> the prior PRs implemented the prescribed change without verifying the symptom on a device. They are
> **reopened**. Treat the lesson as a hard rule for this pass: **a fix is not done until the original
> symptom is reproduced and then confirmed gone on a physical device.**

---

## 🟢 RESUME HERE — current state (updated 2026-06-28, clustering session)

> **✅ RELEASED as `v0.9.0` (2026-06-28).** The mobile map is fixed AND clustering is implemented; PR #111 is
> squash-merged to `main` (commit `1fdc61e`) and tag `v0.9.0` shipped to Play internal + TestFlight. The owner
> chose to release **before** the real-hardware device-test, so the device-test checklist below is now a
> **POST-release verification** to run before promoting to production. This section is the newest; everything
> below it is background/history.

### What shipped to the branch — PR #111 `fix/85-map-render-clustering`

- **#85 map render fix** (`cluster={false}` + `Noto Sans Regular` glyph) + **maplibre-react-native 11.3.6** bump.
- **JS clustering via `supercluster`** (the "NEXT TASK" section below — now DONE):
  - new pure `mobile/lib/map/cluster.ts` (`buildClusterIndex` / `clustersForViewport`) + `cluster.test.ts` (5 tests).
  - wired into `mobile/app/(tabs)/index.tsx` (build the index from the bbox query; recompute visible
    clusters/points on data + viewport change; `keepPreviousData` ⇒ no flicker) and
    `mobile/components/map/FountainMap.tsx` (`onClusterPress` → JS `getClusterExpansionZoom`; the dead native
    cluster path + the obsolete #85 instrumentation removed; the missing-image dev warning ignores empty ids).
  - `radius` / `maxZoom` = `CLUSTER_RADIUS` / `CLUSTER_MAX_ZOOM` (web parity).
- The branch also carries a small unrelated CI fix (`.github/workflows/basemap-janitor.yml`) and this handoff doc.

### Gate status — all green

- **Local:** `tsc` 0, `eslint` 0, **208 vitest** (5 new), Prettier clean, expo-doctor (on CI) green.
- **Emulator:** cluster bubbles with counts at low zoom; tapping a cluster flies in + breaks it apart and
  re-clusters on pan; individual pins with icons/pills at high zoom. Owner eyeballed it: "looks great."
- **CI on PR #111:** all checks pass (backend, workspace-js, mobile-doctor, CodeQL, pip/pnpm-audit, trivy-fs;
  Trivy + image-scan skip as normal for PRs).
- **Codex:** `VERDICT: APPROVED` (artifact `temp/codex-reviews/pr-111-review-1.md`, gitignored; verdict also
  posted as a PR comment). No open PR comments.

### Release — `v0.9.0` shipped (2026-06-28)

- **PR #111 squash-merged** → `main` `1fdc61e fix(mobile): render map pins and cluster them in JS (#85)`.
- **Tag `v0.9.0` pushed** → `mobile-store-release.yml` run **28335243636** → **SUCCEEDED** (release-notes +
  Android Play-internal submit + iOS App Store Connect submit all green).
  - **Android:** auto-published to the Play **internal** testing track (`releaseStatus: completed`, #110).
  - **iOS:** submitted to **TestFlight**; "What to Test" is NOT auto-set on non-Enterprise EAS (#109) — paste
    from the run's job summary in App Store Connect.
- (An earlier test build from the branch — run 28331761609 — also succeeded; superseded by v0.9.0.)
- `appVersionSource: remote` + `autoIncrement` ⇒ EAS owns the build version/number; the git tag is the marker.

### ➡️ Next steps (post-release)

1. **Install the `v0.9.0` build** from TestFlight + Play internal on **both iOS + Android real hardware**.
2. **Run the device-test checklist below** — every fix is hardware-unverified (released on emulator + CI +
   Codex confidence only). This is the verification that was deferred from before-merge to after-release.
3. **If all pass:** promote to production when ready — the Play **production** track and an App Store release
   are **manual console steps** (CI stops at the internal / TestFlight tracks).
4. **If anything fails:** fix-forward on a new branch → local mobile checks → Codex review loop to
   `VERDICT: APPROVED` → CI green → squash-merge → bump the tag (`v0.9.1`) to re-release.

### Device-test checklist (both iOS + Android)

- **#85 + clustering (headline):** pins/clusters render on BOTH platforms; cluster bubbles with counts at city
  zoom; tap a cluster → flies in + breaks apart; individual pins + rating pills at street zoom.
- **#88:** signed-in, the Points chip + Account show real points, not 0.
- **#103:** Apple sign-in shows the real name + initial, not an opaque id.
- **#97:** (iOS, location denied/approximate) can enter Add, place a pin, **Next** enables.
- **#98:** a draft pin appears immediately on entering Add.
- **#99:** the draft pin reads as distinct (larger + translucent).
- **#100:** "Use current location" recenters; target frames above the sheet (tune `ADD_SHEET_CAMERA_PADDING=260` if needed).
- **#101:** no empty/capped banner over the Add panel while adding.
- **#102:** the new pin is tappable right after adding.
- **#104:** (iOS) the **+** FAB doesn't overlap the attribution "ⓘ"; controls clear the home indicator.
- **#105:** the compass is clear of the top filter chips (first confirm a compass even shows under the new arch).

### New-machine local-env caveats

- The pnpm `nodeLinker: hoisted` workaround is **local-only** (`git update-index --skip-worktree pnpm-workspace.yaml`);
  the committed `pnpm-workspace.yaml` has no hoisted, so CI is fine, but a fresh Windows box doing LOCAL Android
  builds must re-apply it (see the dev-loop notes in the "#85 RESOLVED" section below). For just merging + releasing
  (all via CI / `gh`) nothing local is needed.
- `expo-doctor`'s "duplicate react" failure occurs only under the local hoisted linker; CI (isolated linker) passes — ignore it locally.
- Out of scope / tracked: web has the same latent `Noto Sans Bold` glyph-404 in `web/lib/map/layers.ts` — a separate web fix.

---

## ✅ #85 RESOLVED — READ THIS FIRST (updated 2026-06-28, overnight session)

> **The map blocker is root-caused and a fix is verified on-device (emulator) and green on all local
> checks (typecheck / lint / 203 tests). Everything in the older "CURRENT STATE" / "BLOCKER" sections
> below is SUPERSEDED — several of those theories were WRONG (see "What the prior investigation got
> wrong"). Do not act on them.**

### The real root cause (proven with native logging on a development build)

**Native clustering is broken on this stack — Expo 56 / RN 0.85.3 / @maplibre/maplibre-react-native
11.3.6 on the New Architecture (Fabric).** Two distinct failures, both isolated on-device:
1. A **clustered** `<GeoJSONSource>` renders **nothing below `clusterMaxZoom`** — cluster generation
   produces no renderable features (verified at z9 with 360 fountains baked in: zero cluster circles).
2. A **clustered** source **never repaints on a `setGeoJson()` data update** — so even the unclustered
   points above `clusterMaxZoom` never appear after the bbox fetch resolves.
3. A **non-clustered** source renders **and** updates correctly — initial load, on pan, at every zoom.

The data path is fine: native `Log` instrumentation (added to `MLRNGeoJSONSource` / `MLRNSource` /
`MLRNGeoJSONSourceManager`, then reverted) showed `setData(...)` → `setGeoJson(fullData)` being called
with `sourceNull=false willApply=true` on every update. **The prior "data never reaches the native
source under Fabric" conclusion was wrong** — the data reaches native; a *clustered* source just won't
render/refresh it.

### The fix (committed in the working tree on this branch; verified on-device)

In `mobile/components/map/FountainMap.tsx`:
1. **`cluster={false}`** on the `fountains` `<GeoJSONSource>` — bypass the broken native clustering.
   Pins then render on first load, update on pan, and show at all zooms. (Verified: 12 pins downtown SD;
   pan to Sherman Heights correctly swaps to that area's 2 pins; clean build with all diagnostics
   stripped renders the real pins.)
2. **`text-font: ["Noto Sans Bold"] → ["Noto Sans Regular"]`** (cluster-count + pins-pill layers). The
   basemap glyph CDN serves **only** `Noto Sans Regular` (`Bold` 404s — confirmed: Regular `0-255.pbf`
   = HTTP 200, Bold = 404), so the Bold labels never drew. **`web/lib/map/layers.ts` has the same
   latent `Noto Sans Bold` gap — fix it there separately (web bug, out of scope for this mobile PR).**

### Trade-off + recommended follow-up (NEEDS OWNER DECISION)

`cluster={false}` means **no clustering at low zoom** — individual pins (capped at `MAX_BBOX_RESULTS=500`)
instead of cluster bubbles. Functional and fine at neighborhood zoom (where users look for a fountain);
busy at city zoom. **Recommended follow-up: do clustering in JS with `supercluster`**, feeding the
non-clustered source. The existing `clusters` / `cluster-count` layers already expect supercluster-shaped
output (`point_count`, `point_count_abbreviated`, `cluster_id`), so it's a contained change — but
`supercluster` is **not currently a dependency** (would need adding; deferred so the owner can weigh the
new dep / approach). The cluster layers + cluster-tap handler are left **inert** for that follow-up.

### What the prior investigation got wrong (and why)

**The dev loop was silently broken, so prior "fixes" never reached the device.** Metro was running from
the **repo root** (`D:\repos\fountainrank`) instead of `mobile/`, in **CI mode (no file watcher)**, so it
served **stale JS** — a full app reload still loaded old code. That is the real reason "the prescribed
change was implemented but the symptom never went away": the changes were never bundled. Fixing the dev
loop (below) was the unlock.

### Working dev loop (emulator, zero EAS credits) — now reliable

- **Metro:** run from `mobile/` — `cd mobile && CI=1 npm_config_verify_deps_before_run=false pnpm exec
  expo start --port 8081`. CI mode is needed for headless but **disables the file watcher**, so **restart
  Metro after every JS edit** (a plain restart — no `-c` — re-crawls and picks up changes fast). Helper:
  `scratchpad/metro.sh` (kills the 8081 listener + starts fresh).
- **Local Android build:** `JAVA_HOME` / `ANDROID_HOME` are **not** inherited into Git Bash — export them:
  `JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.19.10-hotspot"`, `ANDROID_HOME="/d/Android/Sdk"`. Build:
  `mobile/android/gradlew -p mobile/android :app:assembleDebug -PreactNativeArchitectures=x86_64` (~13s
  incremental). Native (Kotlin/patch-package) changes need a rebuild; JS only needs a Metro restart.
- **Emulator:** `adb -s emulator-5554`; per-boot default route fix may be needed; `adb emu geo fix
  -117.162 32.715` (downtown San Diego — 360+ fountains). **Location centering is flaky on the emulator**
  (`getCurrentPositionAsync` often doesn't return, so the app stays on the continental-US default) — for
  testing, temporarily point `DEFAULT_CENTER/ZOOM` at San Diego, or improve robustness with a
  `getLastKnownPositionAsync` fallback (real devices are unaffected; this is a separate, optional item).

### Current git state + branch hygiene for the PR

The verified fix is committed on **`debug/map-pin-diagnostics`** as **`4720a6b`** ("fix(mobile): render
map pins by disabling broken native clustering (#85)") — it contains the `FountainMap.tsx` fix, the
MAP_DEBUG strip (`index.tsx`), the `newArchEnabled` no-op removal (`app.config.ts`), and this handoff
update. **Not pushed, not a PR, not merged.** The working tree is clean.

For the PR, the only change that matters vs `main` is **`FountainMap.tsx` (cluster=false + glyph)** plus the
kept maplibre **11.3.6** bump (`package.json` + lockfile, already committed earlier on this branch).
**Exclude** the unrelated cruft this branch accumulated in earlier commits: `eas.json`
(`completed`→`draft`, which *reverts* merged PR #110) and the `README.md` release-notes rewrite. Cleanest
path: a fresh `fix/85-map-pins-render` branch off `main` with just the FountainMap fix + the 11.3.6 bump,
then CI green + Codex `VERDICT: APPROVED` + the owner's on-device verification on **real hardware** before
merge (the device-verification rule). NB: cluster=false alone is shippable; if you'd rather land the map
fix **with** clustering, do the supercluster work below first and ship them together.

---

## ✅ DONE — clustering reintroduced in JS via `supercluster` (PR #111, 2026-06-28)

> **Implemented, verified on the emulator, CI-green, Codex-approved.** See "RESUME HERE" at the top for
> live status. The plan below was followed as written; it is kept as the implementation reference.

**Goal:** restore the low-zoom clustering UX that `cluster={false}` removed, **without** native clustering
(broken on this stack — see the resolved section). Compute clusters in JS with `supercluster` and feed them
to the **same non-clustered `<GeoJSONSource>`** (which renders + updates correctly).

**Why it's a small, contained change:** the layers in `FountainMap.tsx` already expect supercluster-shaped
features — `clusters` (circle, `filter ["has","point_count"]`), `cluster-count` (symbol,
`["get","point_count_abbreviated"]`), `pins` (symbol, `filter ["!",["has","point_count"]]`), `pins-pill`.
Supercluster emits exactly those props (`cluster`, `cluster_id`, `point_count`, `point_count_abbreviated`)
on cluster features and **preserves the original `properties`** (`id`/`icon`/`pill`) on leaf points. So the
layers stay as-is — only the *data pipeline* and the *cluster-tap handler* change.

### Data flow today (after the #85 fix) — exact integration points
- `mobile/app/(tabs)/index.tsx`: `pinsQuery` (bbox query, ≤ `MAX_BBOX_RESULTS=500`, `placeholderData:
  keepPreviousData`) returns `{pins: FountainPin[], truncated}`. Then `index.tsx:~240`:
  `const featureCollection = useMemo(() => pinsToFeatureCollection(pinsQuery.data?.pins ?? []),
  [pinsQuery.data])`, passed to `<FountainMap featureCollection=… onRegionChange={setRegionDebounced} />`.
  State: `region = {bounds: RawBounds, zoom} | null` (debounced 250 ms); `zoom = region?.zoom ?? DEFAULT_ZOOM`.
- `mobile/lib/map/pins.ts`: `pinsToFeatureCollection(pins): FeatureCollection<Point, PinProps>` where
  `PinProps = {id, is_working, ranking_score, average_rating, icon, pill}`.
- `mobile/lib/map/constants.ts`: `CLUSTER_RADIUS=60`, `CLUSTER_MAX_ZOOM=14`, `PILL_MIN_ZOOM=13`.
- `mobile/components/map/FountainMap.tsx`: source `id="fountains" cluster={false}`. The source `onPress`
  currently expands clusters via the **native** `sourceRef.current.getClusterExpansionZoom(props.cluster_id)`
  — **this must move to the JS index** (clusters will no longer be native).

### Steps
1. **Add deps in `mobile/`:** `supercluster` + `@types/supercluster`. (Neither is present today — confirmed.)
   It's pure JS (no native module / config plugin) so autolinking/prebuild are unaffected; but the pnpm
   `hoisted` linker on this box can need a clean reinstall — see [[fountainrank-mobile-clean-reinstall-before-eas-prebuild]]
   and the dev-loop notes above. EAS builds use `--frozen-lockfile`, so commit the updated lockfile.
2. **New pure module `mobile/lib/map/cluster.ts`** (mirror `pins.ts`; add `cluster.test.ts`):
   - `buildClusterIndex(pins: PinInput[])`: `new Supercluster({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM })`
     then `index.load(pinsToFeatureCollection(pins).features)` (Point features carrying `PinProps`).
   - `clustersForViewport(index, bounds: RawBounds, zoom: number): GeoJSON.FeatureCollection`:
     `{ type:"FeatureCollection", features: index.getClusters([bounds.west, bounds.south, bounds.east,
     bounds.north], Math.floor(zoom)) }`.
3. **In `index.tsx`** replace the `featureCollection` memo:
   `const clusterIndex = useMemo(() => buildClusterIndex(pinsQuery.data?.pins ?? []), [pinsQuery.data])`
   then `const featureCollection = useMemo(() => region ? clustersForViewport(clusterIndex, region.bounds,
   region.zoom) : pinsToFeatureCollection([]), [clusterIndex, region])`. (Recomputes on pan/zoom AND on new
   data; `keepPreviousData` keeps the index stable between fetches → no flicker.)
4. **Cluster tap → JS expansion.** Add `onClusterPress?: (clusterId: number, center: LngLat) => void` to
   `FountainMapProps`. In the source `onPress`, when `props.cluster` is truthy, call
   `onClusterPress(props.cluster_id, {lng,lat})` (drop the native `getClusterExpansionZoom` branch). In
   `index.tsx`: `onClusterPress={(id, center) => setFlyTo({ center, zoom: clusterIndex.getClusterExpansionZoom(id) })}`
   (supercluster's version is **synchronous**, returns a number — simpler than the native Promise).
5. **Keep `cluster={false}`** on the source — that's what makes updates render. Do NOT re-enable native `cluster`.

### Gotchas (all verified this session)
- **Integer-zoom boundary.** `getClusters(bbox, Math.floor(zoom))`. With `maxZoom: 14`, points cluster at
  tile-zoom ≤14 and are individual at ≥15 — so individual pins appear at **map zoom ≥15, not 14**. If you
  want individual pins + their pills (`PILL_MIN_ZOOM=13`) at z14, set supercluster `maxZoom: 13`. Pick to
  match `web` (maplibre-gl built-in clustering uses the same `CLUSTER_MAX_ZOOM`).
- **bbox order is `[west, south, east, north]`** (lng,lat,lng,lat); `RawBounds` already has those keys.
- **Leaf `properties` are preserved** (icon/pill/id survive). Cluster features have no `pill`, and the
  `pins-pill` layer's `["!=", ["get","pill"], null]` filter already excludes them.
- **No remount/`key` hack.** The non-clustered source updates correctly via `setGeoJson` (verified by
  panning). The earlier `key`-remount idea is a DEAD END: a constant source id makes the native
  unmount/remount race and reuse the stale source (see resolved section).
- **500-cap interaction:** clustering runs on the bbox-capped subset (≤500); the "capped" banner already
  warns at extreme zoom-out. Matches current behavior — acceptable.

### Verify on device (use the emulator dev loop in the resolved section)
At **z9** you should now see blue cluster bubbles **with counts** (none rendered before the #85 fix); at
**z15+** individual pins; tapping a cluster flies in and breaks it apart; panning re-clusters the new area.
Then `cd mobile && CI=true npm_config_verify_deps_before_run=false pnpm exec tsc --noEmit && … eslint . &&
… vitest run` (add `cluster.test.ts`). This can ship **in the same PR** as the #85 fix (then the source is
clustered end-to-end) or as a follow-up PR on top.

---

## ⚠️ SUPERSEDED — earlier theories (kept for history; do NOT act on these)

## ⚠️ CURRENT STATE — (updated 2026-06-27, late session)

> 🔴 **CORRECTION (2026-06-28): the old-architecture candidate fix described below is INVALID — abandon it.**
> Expo SDK 55+ / React Native 0.82+ **removed the ability to disable the New Architecture**, and this app is
> **SDK 56 / RN 0.85.3**. Per the Expo New Architecture guide: *"the New Architecture is always enabled and
> cannot be disabled … Any `newArchEnabled: false` setting in your app config will be ignored."* Confirmed
> locally: a fresh `expo prebuild` writes `newArchEnabled=true` to `android/gradle.properties` straight from
> the very `app.config.ts` that says `false`; `@expo/prebuild-config` never maps the field; the RN 0.85
> template hardcodes `=true`. **Therefore EAS build `28313869077` was a NEW-arch build (the flag was silently
> ignored), NOT an old-arch build** — installing it does not test the old architecture, and the map will be
> broken exactly as before. #85 must be fixed **within** the new architecture: either a
> maplibre-react-native GeoJSONSource/Fabric workaround (already on the latest **11.3.6** — no upstream fix to
> bump to) **or** the native-marker fallback (`PointAnnotation`/`MarkerView` + JS clustering, which bypass
> `GeoJSONSource`). The `newArchEnabled: false` line in `app.config.ts` is a no-op and should be removed.
> **A local Android emulator + Logcat dev loop is now set up on the Windows host** (JDK 17 + Android SDK at
> `D:\Android\Sdk`, AVD `fountainrank`) so #85 can be reproduced and fixed locally without EAS build credits.

### 🟢 LOCAL EMULATOR DEV LOOP + LIVE #85 REPRO (2026-06-28) — CONTINUE HERE

**A local build/run loop (zero EAS credits) is fully working.** Machine-specific recipe + gotchas are in agent
memory `fountainrank-local-android-build-windows`; essentials:
- **Toolchain:** JDK 17, Android SDK `D:\Android\Sdk` (env vars persisted at user scope), AVD `fountainrank`
  (Pixel 7, API 35 google_apis x86_64).
- **pnpm MAX_PATH fix (MANDATORY):** Windows' 260-char `MAX_PATH` truncates the deep
  `node_modules/.pnpm/react-native-screens@<hash>/...` CMake/ninja paths → `ninja: error: manifest
  'build.ninja' still dirty after 100 tries`. Fix = flatten node_modules with **`nodeLinker: hoisted`** in
  **`pnpm-workspace.yaml`** (pnpm 11 reads pnpm-native settings there, NOT `.npmrc`), kept local-only via
  `git update-index --skip-worktree pnpm-workspace.yaml`. After switching: nuke `node_modules` + `CI=true pnpm
  install`, then clear `mobile/android/{.gradle,build,app/build}` + `.cxx` (they cache old `.pnpm` autolink paths).
- **Build:** `mobile/android/gradlew -p mobile/android :app:assembleDebug -PreactNativeArchitectures=x86_64`
  (x86_64-only = emulator ABI, ~4× faster; first build auto-pulls API 36 + build-tools 36 + NDK 27).
- **Emulator network (per boot — this Hyper-V/WSL/Docker host breaks it):** cold boot comes up with NO default
  route → no internet AND can't reach Metro. Fix: `adb root && adb shell ip route add default via 10.0.2.2 dev wlan0`.
- **Metro/run:** the debug app loads JS from **`10.0.2.2:8081`** (emulator→host loopback), NOT localhost —
  `adb reverse` is irrelevant. Run Metro with `CI=1 pnpm exec expo start --port 8081` (background; plain
  `expo start` does NOT serve headless). 8081 is free here (owner's other services are on **8001** = Docker/WSL).
  `adb install -r <apk>`; `adb shell pm grant com.redducklabs.fountainrank android.permission.ACCESS_FINE_LOCATION`;
  `adb emu geo fix -117.15 32.73` (San Diego — **362 fountains**; SF/Seattle/Portland/LA/NYC have **0**).

**Live #85 repro (DECISIVE):** over San Diego at z9–10 the bbox query returns 67–362 fountains and they reach
the JS `featureCollection` (overlay `fc:N`), but **NOTHING renders.** Proven with a **magenta ground-truth
`<Layer type="circle">`** that paints EVERY source feature (no icons/glyphs/cluster filters) → still nothing.
So the data does not reach the *rendered* native source.
- The **basemap (MapView/Camera) renders fine** → the failure is specific to `GeoJSONSource` + child `<Layer>`s.
- Fabric **codegen DID generate** `MLRNGeoJSONSourceManagerDelegate` (so the `data` JSON string IS forwarded to
  native); the `Could not find generated setter for MLRN…Manager` Logcat warnings are **benign Paper-interop noise**.
- The native source throws `java.lang.IllegalStateException: "Source is not yet loaded"` from `getData()` **even
  after the map renders** → the source/layers appear to **never attach to the loaded style under Fabric** → data
  never applies. (That throw is async/native — a JS `try/catch` can't catch it — so it crash-loops dev → blank screen.)
- **NOT a version dead-end:** maplibre-react-native **11.3.6 targets RN 0.85.3 exactly** (its devDep) and
  peer-supports RN ≥0.80 / Expo ≥54. So this is likely a **usage/structure/build issue or a maplibre bug we can
  patch**, not an inherent incompatibility.
- **Confirmed secondary bug (real fix, but NOT sufficient alone):** glyph 404 — the basemap CDN serves only
  **`Noto Sans Regular`**, but `FountainMap.tsx:216,246` ship `text-font: ["Noto Sans Bold"]` (PR #106 used the
  wrong name) → `…/fonts/Noto%20Sans%20Bold/0-255.pbf` 404 → cluster-count + pill labels never draw. Change to
  `Noto Sans Regular`. (Won't render pins while the source data still doesn't reach native.)

**⚠️ Working-tree DEBUG edits IN PLACE on `debug/map-pin-diagnostics` (revert before landing any real fix):**
1. `mobile/components/map/FountainMap.tsx` — (a) added a `debug-all-points` **magenta circle `<Layer>`**
   (ground-truth probe); (b) the `onNativeFeatureCount` **getData poll is DISABLED** (replaced with
   `onNativeFeatureCount(-1)`) because native `getData()` crash-loops dev with the `IllegalStateException` above.
2. `mobile/lib/map/constants.ts` — `DEFAULT_CENTER`/`DEFAULT_ZOOM` temporarily set to San Diego / `9` so the app
   opens on fountains above the zoom gate. **Revert to `[-98.5, 39.8]` / `3.5`.**

**Next debugging steps (fix #85 WITHIN Fabric):**
1. **Minimal repro** — a standalone `<MapView>` + a hardcoded 2-feature `<GeoJSONSource data={…}>` + ONE sibling
   `<Layer type="circle">`. Renders → the bug is FountainMap's structure (layers-as-children / clustering /
   source-id / `<Images>`); doesn't → maplibre source rendering is broken on this build → `patch-package`/upstream.
2. Try **layers as siblings** of the source (not nested children) and **`cluster={false}`** to isolate.
3. If maplibre-native: inspect the Kotlin `MLRNGeoJSONSource` style-attach lifecycle under Fabric.
4. Re-add a SAFE `nat` measurement (guard `getData` behind the map's `onDidFinishLoadingMap`, or use
   `querySourceFeatures`) — the overlay's current `nat:-1` is just the disabled poll, not a real measurement.

The batches below were implemented and **merged to `main`**, then store builds went to TestFlight / Play
internal for owner device-testing. Device testing surfaced **one blocker that supersedes everything: the
map renders only a random subset of fountains (often none), on BOTH platforms, while web renders all of
them.** Most other fixes can't be meaningfully verified until the map renders. The active investigation and
the candidate fix are below.

### Merged to `main` (all via branch → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge)

- **PR #106** — the device-test bugfixes (Batches 1–4: #88, #103, #85-partial, #97/#98/#100/#101/#102/#99,
  #104/#105) **+** the bundled store release-notes CI job. The squash used `Refs` (not `Fixes`), so the
  **GitHub issues remain OPEN** on purpose (device-verification rule).
- **PR #107** — hardened `mobile-store-release.yml` release-notes (lists `feat:`/`fix:` + `(#NN)` commits;
  no longer fails on a range with no PR refs).
- **PR #108** — added `appleTeamId: "VPQ79Y3WQ7"` to `submit.production.ios` in `eas.json`. (Was a *wrong*
  hypothesis for the iOS submit failure but is correct, non-secret config; kept.)
- **PR #109** — removed `--what-to-test` from the iOS `eas build --auto-submit`. EAS hosted submission's
  TestFlight changelog is **Enterprise-plan only** ("Changelog submission is currently available for
  Enterprise plan only") and was failing every iOS submit. iOS now submits **without** auto-notes.
- **PR #110** — Android `submit.production.android.releaseStatus` `draft` → **`completed`** so internal-test
  releases **auto-publish** on upload (no Play Console step). EAS doesn't carry Android release-note text.

Released `v0.8.1` early in the session; iOS/Android build numbers have since incremented via several
`workflow_dispatch` test builds. **Those store builds contain the bugfixes but the broken map (below).**

### Device-verification status (original device-test issues)

- **#88 points** — ✅ **verified** on device (Points chip showed 128).
- **#85 map render** — ❌ **broken** (the blocker — see below). The glyph fix is in but is moot until pins render.
- **#103, #97, #98, #99, #100, #101, #102, #104, #105** — **not verified**; the add-flow + ornament issues
  can't be exercised while the map shows no pins. Re-verify all of these once the map renders.

### 🔴 THE BLOCKER — #85 map shows only a random subset of fountains (works on web)

A multi-build on-device debugging session. A `MAP_DEBUG` overlay (on branch `debug/map-pin-diagnostics`)
shows per-frame: `z<zoom> en:<Y/N> <queryStatus>/<fetchStatus> pins:<N> fc:<N> nat:<N>` + the queried bbox,
where `pins` = bbox-query count, `fc` = JS featureCollection count, **`nat` = the NATIVE source's real count**
(`sourceRef.current.getData().features.length`, polled ~600–900 ms after each data change).

**RULED OUT (with on-device evidence):**
1. **Data** — pulled the broken (home) area *and* a working area from the public bbox API; byte-identical
   structure, valid coordinates, identical to what web renders. Not the data/backend.
2. **bbox query / JS transform** — `pins:N` always equals `fc:N`. Query + `pinsToFeatureCollection` are fine.
3. **Zoom / clusterMaxZoom boundary** — first theory (`nat:0` at z14 == clusterMaxZoom == landing zoom), but
   owner proved `nat:0` at **any** zoom over the same spot. Not zoom. (Tried clusterMaxZoom 14→20; reverted.)
4. **Clustering** — `cluster={false}` → still `nat:0`. Not clustering.
5. **Icons** — plain circle pins (no icon image, no data-driven lookups) → still `nat:0`, nothing renders.
   Not the pin PNGs / `<Images>` registration.
6. **maplibre version** — bumped 11.3.4 → **11.3.6** (fixes a Fabric "stale map child indexes" bug #1596 +
   an iOS image-loading crash). **No change to the map.** (Lockfile bumped on the debug branch; harmless, kept.)
7. **Remount / self-heal** — remount-the-source-on-data-change and self-heal-on-`nat:0` (bounded retries)
   did NOT fix it; on 11.3.4 the remount churn caused a **Points→0** regression (fixed by reverting). All reverted.

**DEFINITIVE FINDING:** with the simplest possible config (`cluster={false}` + plain circle pins) the overlay
reads e.g. `pins:16 fc:16 nat:0` and nothing draws. The `data` prop on maplibre-react-native's
`<GeoJSONSource>` **is not reaching the native map source under React Native's NEW ARCHITECTURE (Fabric)** on
this stack (Expo 56 / RN 0.85.3 / @maplibre/maplibre-react-native 11.3.6). Web (maplibre-gl) has no such issue.

**CANDIDATE FIX — IN FLIGHT at handoff time:** `newArchEnabled: false` in `mobile/app.config.ts` (pin the app
to the **old architecture / "Paper"** renderer). maplibre-react-native ships mature old-arch ViewManagers
(`MLRNMapViewManager.kt`, etc.) alongside its Fabric components, so it supports old arch, where its GeoJSON
rendering has been stable for years.
- Build **run `28313869077`** (branch `debug/map-pin-diagnostics`): the **iOS build + TestFlight submit
  SUCCEEDED** with newArch off — so **RN 0.85 *does* support the old architecture** (the build does not fail);
  Android was still building at handoff. **NEXT: install that build and check whether the map renders** (the
  overlay `nat` should now match `fc`).
- If old arch renders the map → SOLVED. If not → fall back to rendering fountains as individual native markers
  (`<MarkerView>`/`<PointAnnotation>`, which bypass the GeoJSON source) with clustering done in JS.

### The debug branch `debug/map-pin-diagnostics` — DO NOT merge as-is

Off `main` (after #107). Contains: the `MAP_DEBUG` overlay (`index.tsx`), the `onNativeFeatureCount` `getData`
poll + `onDidFailLoadingMap`/`Images onImageMissing` warns (`FountainMap.tsx`), maplibre **11.3.6** (lockfile),
**`newArchEnabled: false`**, and the real map config restored (cluster + icon pins, clusterMaxZoom 14). The
`MAP_DEBUG` overlay and all `console.*` instrumentation **must be stripped before landing the fix on `main`.**

### How to resume (fresh session)

1. Read this file + `claude_help/codex-review-process.md` + `claude_help/testing-ci.md` + `CLAUDE.md`.
2. `gh run view 28313869077` for the old-arch build result; have the owner install it and **test if the map
   renders under the old architecture** (the decisive question).
3. **If it renders:** new branch off `main` → `newArchEnabled: false` (+ keep maplibre 11.3.6) → **strip all
   diagnostics** → PR → CI + Codex → squash-merge → re-release (tag `v0.8.x` or `workflow_dispatch`). Then
   re-verify the add-flow + ornament issues (#97–#105) now that the map works.
4. **If it does NOT render:** pivot to native-marker rendering (above).

### Local env gotchas

- Local pnpm/node_modules is **inconsistent on the debug branch** (lockfile 11.3.6 via `--lockfile-only`,
  node_modules still 11.3.4) — `pnpm exec` may fail its deps check there; `main` is consistent at 11.3.4. A
  clean reinstall fixes local tooling; EAS builds do a fresh `--frozen-lockfile` install so they're unaffected.
  Use `CI=true npm_config_verify_deps_before_run=false pnpm exec <cmd>` for local checks.
- ASC API keys (`temp/AuthKey_*.p8`) + Play service-account JSON (`temp/keys/*.json`) are already in the EAS
  credentials service (not in git).

---

## Working rules for this pass (do not skip)

- **Process gate (per `CLAUDE.md`):** branch → PR → **CI green AND Codex `VERDICT: APPROVED` AND every PR
  comment addressed** → **squash-merge**. One task at a time, Conventional Commits, frequent commits.
- **Read the spokes before touching code:** `claude_help/development-process.md`, `claude_help/testing-ci.md`,
  and `claude_help/codex-review-process.md`. For auth work also `claude_help/oauth-sso.md`.
- **On-device verification is mandatory** for every issue here (that is the whole reason this list exists).
  Reproduce the original symptom first, then prove it gone. Note the platform(s) verified in the PR.
- **No AI attribution in commits/PRs. No time estimates.** (Project + global rules.)
- New UI elements (e.g. the distinct draft pin) must be documented in `docs/style-guide.md`.

---

## Priority order (recommended execution sequence)

Ordered to front-load **confirmed, low-surface, high-visibility** fixes, then the **fully-broken core
flows**, then polish — and **batched by shared code** so PRs do not collide (the add-fountain issues all
live in the same two files). Severity key: **P0** = core flow broken, **P1** = core flow badly degraded,
**P2** = visible polish/cosmetic, **P3** = minor / other codebase.

### Batch 1 — Auth & API correctness (small, confirmed, high payoff) → do first

| # | Sev | Problem | Confirmed root cause | Key files | Fix direction |
|---|-----|---------|----------------------|-----------|---------------|
| **#88** | P0 | Points always show **0** for a signed-in user (map chip + Account). | `isAuthenticatedApiRequest` is an **exact** match on `/api/v1/me`, so `GET /api/v1/me/contributions` (and `/me/badges`) carry **no bearer token** → backend 401 → query errors → `?? 0`. The PR #92 focus-refetch fix was applied but is irrelevant (it refetches a doomed request). | `mobile/lib/api.ts:80-85` (+ `:119-131`); test gap in `mobile/lib/api.test.ts` | Broaden the gate to the authenticated `GET /api/v1/me/*` subtree (boundary-safe prefix or allowlist incl. `contributions`,`badges`). Add api.test.ts cases for both paths. **Smallest change, highest visible payoff — start here.** |
| **#103** | P1 | Apple account shows an opaque id (`4zsznfwtd8cx`) as the name + avatar initial. | Mobile never calls `POST /api/v1/me/sync` (the web #62 fix) and requests **no scopes**, so the backend first-seen fallback `display_name = sub` (`backend/app/auth.py:116-119`) is shown raw by `GET /api/v1/me`. | `mobile/app/(tabs)/account.tsx:187-193`, `mobile/lib/auth/config.ts:22-30`, `mobile/lib/api.ts:93` (stale comment); backend `routers/users.py:120-146`, `userinfo.py:124-128` | After native sign-in, POST `/me/sync` with the Logto access token (mobile analog of web `syncProfile`); request `profile`/`email` scopes in the Logto native config. |

### Batch 2 — Map rendering (Android map is entirely empty) → highest impact

| # | Sev | Problem | Root cause | Key files | Fix direction |
|---|-----|---------|------------|-----------|---------------|
| **#85** (reopened) | P0 | **Android: no fountains EVER.** iOS: none until you zoom in/out repeatedly; even then not all. | Multiple: (1) **zoom gate** `MIN_ZOOM=8` vs initial camera `DEFAULT_ZOOM=3.5` + `region` starts null → query disabled until zoom 8 is crossed (only auto-crossed when location is granted). (2) **Android-only total failure is native** (no JS platform branch in the map) — leading theory: the post-fetch `data` prop never reaches the native `GeoJSONSource` under Fabric. (3) **Confirmed glyph-404:** `cluster-count`/`pins-pill` omit `text-font` → MapLibre requests `Open Sans`/`Arial Unicode` which the basemap CDN 404s (only `Noto Sans Regular` served) → labels never draw. (4) The #85 "keep last non-empty FC" guard was never implemented. | `mobile/components/map/FountainMap.tsx`, `mobile/lib/map/constants.ts:5,10`, `mobile/app/(tabs)/index.tsx` (bbox query + `featureCollection`) | Order: fix glyph `text-font` → `["Noto Sans Regular"]`; wire `onImageMissing`/`onDidFailLoadingMap` + log `featureCollection.features.length`; **run Android Logcat** to confirm/deny the native data-propagation theory and fix it; revisit the zoom gate so a populated viewport loads without manual zoom (incl. location-denied); add the last-non-empty guard. Biggest/riskiest — needs a physical Android device. |

### Batch 3 — Add-fountain flow (one coordinated effort; all in `index.tsx` + `FountainMap.tsx` + `lib/add-fountain/*`)

Do these together (1–2 PRs) to avoid merge conflicts. #97 is the blocker; the rest compound it.

| # | Sev | Problem | Root cause | Fix direction |
|---|-----|---------|------------|---------------|
| **#97** | P0 | **iOS user can't add a fountain at all.** | Placement hard-gated on `zoom >= PLACE_MIN_ZOOM(16)` (`placement.ts:73-79`), but the camera auto-zooms to 16 **only when a precise fix exists** (`index.tsx:245-254`). Location denied/approximate → stuck < 16 → taps silently rejected, **Next** never enables. | On add-entry without a precise fix, auto-zoom to placement zoom anyway (best location or viewport center); make rejection feedback visible + actionable; reconsider the hard `accuracy<=1000m` rule. |
| **#102** | P1 | After adding (Android), the new pin can't be tapped. | Success branch never clears the draft (`index.tsx:407-413`; reducer `state.ts:77-78`); the larger, **no-`onPress`** draft layer (`FountainMap.tsx:176-188`) sits on top of the real pin and absorbs the tap. | Call `resetAddDraft()` / clear `pin` on add success; optionally only render the draft layer in add mode. (Confirmed, tiny.) |
| **#101** | P1 | "No fountains in this area" badge shows while adding, over the Add button. | `MapOverlay` rendered with no add-mode guard (`index.tsx:433-438`, msgs `:844-850`); both anchor bottom. | Suppress the empty/capped/below-zoom banner while `addMode`. (Tiny.) |
| **#100** | P1 | "Use current location" doesn't recenter; placement target sits at geometric center, **hidden under the sheet**. | `onUseCurrentLocation` does no camera move (`index.tsx:346-359`); the only `flyTo` has no `padding`/`contentInset` (`FountainMap.tsx:64-71,90`); sheet covers ~62% (`styles.addPanel`). | Recenter on "Use current location"; apply a bottom `contentInset`/`padding` (≈ sheet height) so the target frames above the sheet. |
| **#98** | P2 | No starter pin dropped on add-entry. | `initialAddFountainState.pin=null` (`state.ts:25-33`); entry sets bound only, never `dropPin` (`index.tsx:183-197,245-254`). | On entry, drop a draft pin at the user's location (fallback: viewport center). |
| **#99** | P2 | Draft pin looks identical to real pins. | Draft layer reuses `icon-image:"pin-standard"` (`FountainMap.tsx:176-188`); no draft asset exists. | Add `pin-draft.png` (grayscale/distinct), register, point the draft layer at it. Document in `docs/style-guide.md`. |

### Batch 4 — Native map ornaments / overlays (shared: `FountainMap.tsx` ornaments + `index.tsx` overlay layout) → one PR

| # | Sev | Problem | Root cause | Fix direction |
|---|-----|---------|------------|---------------|
| **#104** | P2 | "+" FAB overlaps the attribution/info "ⓘ" on iOS. | Both anchored bottom-right; attribution defaults bottom-right both platforms (`FountainMap.tsx:74-78`), FAB at `index.tsx:312-325`; map screen isn't a SafeAreaView. | Move attribution to free bottom-left via `attributionPosition`; add safe-area insets to FAB/recenter. |
| **#105** | P2 | Compass hidden under the top filter chips. | Compass default top-right under the full-width chip bar (`index.tsx:290-292` `filterBar` `top:8,left:0,right:0`); no `compassPosition` set. **Caveat:** in `@maplibre/maplibre-react-native@11.3.4` the compass defaults to *disabled* under New Arch — confirm which build showed it before fixing. | Set `compassPosition` clear of the chips (or constrain the chip bar); confirm `compass` is enabled in the shipped build. |

---

## Out of scope for this device-test pass (track, don't bundle)

These are real open issues but in different codebases / lower urgency — keep them off the mobile bugfix PRs.

- **Web (mobile-viewport) bugs:** **#74** attribution overlaps the "Fountains in view" list (`web/components/map/FountainsInViewList.tsx`); **#53** empty-state pill wraps/breaks on narrow viewports (`web/components/map/MapStates.tsx`). P3.
- **Backend:** **#20** bbox endpoint returns 500 on a whole-globe envelope (PostGIS geography edge case). P3 — only triggers at extreme zoom-out; relevant to map robustness.
- **CI/chore:** **#95** track pnpm 11 audit hang workaround.
- **Enhancement backlog (not bugs):** **#93** mobile store automation, plus discovery/moderation/feature tickets (#65, #44, #43, #42, #41, #40, #39, #38, #19, #18, #13, #12, #11, #10, #48). Not part of this pass.

---

## Linear quick-reference (recommended order)

1. **#88** points token-gate (quick win)
2. **#103** Apple `/me/sync` + scopes
3. **#85** map rendering / Android-empty (needs Android device + Logcat)
4. **#97** iOS can't-add (add-flow blocker) →
5. **#102** clear draft on success →
6. **#101** hide badge in add →
7. **#100** recenter + keep target visible →
8. **#98** seed draft pin →
9. **#99** distinct draft pin (+ style-guide)
10. **#104** + / attribution overlap →
11. **#105** compass under chips

Issues 4–9 share `mobile/app/(tabs)/index.tsx` + `mobile/components/map/FountainMap.tsx` heavily — sequence
them on the same branch (or rebase each on the prior) to avoid conflicts. 10–11 share the ornament config —
one PR.

## Where the evidence lives
Each issue body has the full root-cause analysis with verified file:line, fix direction, and acceptance
criteria. Pull them with `gh issue view <N> --repo redducklabs/fountainrank`. Reopened context for #85/#88
is in their latest comments.

---

## Implementation status — per-issue reference (all merged via PR #106)

> ⚠️ This table is the per-issue *what-changed* reference. For the **live state** (what's merged, what's
> device-verified, and the #85 map blocker that supersedes the rest) see **CURRENT STATE — READ THIS FIRST**
> at the top of this file. Everything below shipped to `main` via PR #106 (squash, `Refs` — issues stay open).

| # | Status | What changed | Verify on device |
|---|--------|--------------|------------------|
| #88 | Code-complete | Auth gate broadened to the `GET /api/v1/me/*` subtree (boundary-safe) + `api.test.ts`. | Signed-in user sees real points on the map chip + Account. |
| #103 | Code-complete | `email`+`profile` Logto scopes; best-effort `POST /me/sync` after sign-in (new `lib/auth/sync`). | Apple sign-in shows the real name + initial, not an opaque id. |
| #85 | **BLOCKER — superseded** | Glyph `text-font: ["Noto Sans Bold"]` shipped, but the real cause is deeper: the native `GeoJSONSource` gets no data under the new architecture. | **See "🔴 THE BLOCKER" in CURRENT STATE at the top.** Candidate fix in flight: `newArchEnabled: false` (old-arch renderer). |
| #97 | Code-complete | Add-entry always flies to placement zoom and seeds a pin at user/viewport-center; below-zoom taps now say "zoom in". | Location-denied user can enter add mode, place, and Next enables. |
| #98 | Code-complete | Draft pin seeded on add-entry. | A pin appears immediately on entry. |
| #100 | Code-complete | "Use current location" recenters; flyTo bottom padding frames above the sheet (`ADD_SHEET_CAMERA_PADDING`). | Target frames above the sheet; **tune the padding constant** to the panel height. |
| #101 | Code-complete | Empty/capped/below-zoom banner suppressed while adding. | No banner over the Add button / panel while adding. |
| #102 | Code-complete | Draft layer renders only in add mode. | New pin is tappable right after adding. |
| #99 | Code-complete | Draft pin distinct (larger + translucent `icon-opacity`); documented in `docs/style-guide.md`. | Draft reads as distinct; owner may still prefer a dedicated grayscale `pin-draft.png`. |
| #104 | Code-complete | Attribution → bottom-left; FAB + locate lifted by the bottom safe-area inset. | "i" no longer under the +, controls clear the home indicator. |
| #105 | **Open (code set)** | `compassPosition` placed below the filter chips. | First confirm the compass is even enabled under the new arch; if so, confirm it's clear of the chips. |

Release-notes CI (`mobile-store-release.yml` PR-list notes + Play draft) is bundled on this branch as its
first commit per the owner's request.
