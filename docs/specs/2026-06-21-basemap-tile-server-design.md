# Basemap Tile Server (go-pmtiles in DOKS) — design spec

**Date:** 2026-06-21
**Status:** Draft; architecture approved in-conversation (research-backed); Codex Loop A in progress (review-1 → this revision).

## 1. Goal & why

Serve the **whole Protomaps planet** reliably, regionally (only viewed tiles), and CDN/Firefox-friendly — on infrastructure we already run (DOKS + DO Spaces).

**Root cause of the current breakage.** We deviated from the canonical Protomaps production pattern: we serve the **public 127 GB `planet.pmtiles`** via **client-side `pmtiles://` HTTP range requests straight off the CDN**. Observed consequences:
- The DO CDN can't edge-cache a 127 GB object (`cf-cache-status: BYPASS`) → no caching.
- The 127 GB multipart upload is fragile (`CompleteMultipartUpload "already in progress"`) and the object is currently **broken**: `HEAD` 200 but `GET`/range → `NoSuchKey` — basemap down for all browsers. (Our verification only checked `HEAD` size, so it missed this.)
- Client-side pmtiles range/decoding is the source of the Firefox+PMTiles range bug class (PMTiles #582/#584).

**Fix** ([Protomaps deploy docs](https://docs.protomaps.com/deploy/)): a **`pmtiles serve` tile server** ([`protomaps/go-pmtiles`](https://hub.docker.com/r/protomaps/go-pmtiles)) range-reads the planet **server-side** and serves **`z/x/y` vector tiles** + TileJSON. The CDN/edge caches the **small tile responses**; MapLibre uses a normal vector source (**no client-side pmtiles library** → the Firefox range class is gone).

**Firefox WebGL2 is out of scope:** MapLibre requires WebGL2 regardless of hosting. The owner's Firefox can't create a WebGL2 context (a hardware-acceleration / anti-fingerprinting setting on that machine — verify at `get.webgl.org/webgl2`). The graceful `UnsupportedHint` already shipped is correct there.

## 2. Architecture

```
Browser (MapLibre, vector source via TileJSON, same-origin → no CORS)
   │  GET https://fountainrank.com/tiles/planet.json  and  /tiles/planet/{z}/{x}/{y}.mvt
   ▼
DO LB (TLS) → ingress-nginx
   │   SEPARATE Ingress object: host fountainrank.com, regex path /tiles → rewrite → basemap-tiles-service
   ▼
go-pmtiles `serve` (DOKS Deployment+Service, no credentials)
   │  HTTP GET byte-ranges (server-side) of the PUBLIC object
   ▼
https://fountainrank-basemap.sfo3.digitaloceanspaces.com/planet.pmtiles  (public-read, DO Spaces origin)
```

- **Credentialless read.** go-pmtiles v1.30.3 has an `HTTPBucket` (`OpenBucket` routes `http`-prefixed bucket URLs to it — verified in source), so `--bucket=https://fountainrank-basemap.sfo3.digitaloceanspaces.com` range-reads the already-public `planet.pmtiles` server-side with **no AWS/Spaces credentials, no k8s Secret, no read-only-key owner step**. Point it at the **Spaces origin** (not the `.cdn.` host) to avoid CDN cold-edge behavior on server-side reads.
- **Command:** `pmtiles serve / --bucket=https://fountainrank-basemap.sfo3.digitaloceanspaces.com --public-url=https://fountainrank.com/tiles --port=8080`. The TILESET is `planet` (from `planet.pmtiles`): TileJSON at `/planet.json`, tiles at `/planet/{z}/{x}/{y}.mvt`; `--public-url` makes the TileJSON `tiles` array emit `https://fountainrank.com/tiles/planet/{z}/{x}/{y}.mvt`.
- **Path, not subdomain, on a SEPARATE Ingress.** Serving under `fountainrank.com/tiles/` reuses the existing LB cert + DNS (a `tiles.` subdomain would need a new DNS record + an LB-cert change) and is **same-origin** (no CORS). The regex rewrite annotation is **Ingress-object-scoped**, so it goes on its **own** `basemap-tiles` Ingress object — the shared `fountainrank-ingress` is left untouched.
- **Only the planet tiles move.** Glyphs, sprites, and `style.light.json` stay on the public CDN (small, cacheable, working). The bucket stays public-read.

## 3. Components & changes

### 3.1 Make the planet object durable + verified (prerequisite, blocks everything)

The current object is broken (`GET → NoSuchKey`) and every existing skip/verify is `HEAD`/marker/size-only — which cannot detect a non-retrievable object. Harden `basemap-upload.yml` with a **range-GET** probe used at every decision point:

- **Range-GET helper (origin, authenticated):** `aws s3api get-object --bucket fountainrank-basemap --key planet.pmtiles --range bytes=0-99 …` → must succeed AND its `ContentRange` total must equal `SRC_LEN`. (Not the 100-byte response length — the **total** from `bytes 0-99/<total>`.)
- **Runner skip:** set `SKIP_STREAM=true` only when the marker matches **AND** the range-GET helper proves the live object range-reads with total == `SRC_LEN`. A `NoSuchKey`/mismatch → do not skip.
- **Droplet idempotency skip:** replace the `head-object` size check with the range-GET helper (same condition).
- **Post-upload verify:** replace the `head-object` size verify with the range-GET helper.
- **Smoke:** add an **origin range-read** (since go-pmtiles reads the Spaces origin), in addition to the existing CDN range probe.
- Then **re-run `basemap-upload` with `force=true`** to replace the broken object with a verified one.

### 3.2 go-pmtiles Deployment + Service (`infra/k8s/basemap-tiles.yaml`)

- Pinned image `protomaps/go-pmtiles:v1.30.3`, the `serve` command/args above, `--port 8080`, **no env credentials**.
- **Readiness probe hits `/planet.json`** (forces go-pmtiles to range-read the archive header/metadata from Spaces → catches a bad bucket URL / missing or broken object). **Liveness can be `/`** (cheap 204). A **startup probe** with a generous budget covers a slow first Spaces read.
- **1 replica** for the MVP on the small cluster, with the same rollout shape as backend/web (`maxSurge: 0`, `maxUnavailable: 1`) — accepts brief unavailability on rollout (tiles are non-critical relative to the API; the tradeoff is stated). Modest resources (LRU default 64 MB + range reads → request ~256 MB / limit ~512 MB RAM, low CPU).

### 3.3 Ingress (`infra/k8s/ingress.yaml` — NEW separate object)

A **new** `basemap-tiles` Ingress (NOT edits to `fountainrank-ingress`), host `fountainrank.com`, with its own annotations:
- `nginx.ingress.kubernetes.io/use-regex: "true"`, path `/tiles(/|$)(.*)` `pathType: ImplementationSpecific`, `nginx.ingress.kubernetes.io/rewrite-target: /$2` → `basemap-tiles-service`.
- **`Cache-Control` scoped to this object only** (via a response-header annotation): moderate cache on tiles, short/revalidate on TileJSON. Because it's a separate Ingress, the web/API/auth/healthz routes cannot inherit tile cache headers or the rewrite.
- Rendered by the existing `deploy.yml` `envsubst` flow.

### 3.4 Web (`web/components/map/MapBrowser.tsx`, `web/lib/map/style.ts`)

- Remove the `pmtiles` client: drop `import { Protocol } from "pmtiles"` + `addProtocol`/`removeProtocol`. Remove the `pmtiles` dependency from `web/package.json`.
- Point the basemap style `sources.protomaps` at the go-pmtiles **TileJSON** (`{ type: "vector", url: "https://fountainrank.com/tiles/planet.json" }`).
- Keep the WebGL2 pre-check / `powerPreference: 'default'` / graceful `UnsupportedHint`.

### 3.5 Style generation (`basemap-upload.yml` `style.light.json`)

Change the `protomaps` source from `pmtiles://…/planet.pmtiles` to the TileJSON URL (`https://fountainrank.com/tiles/planet.json`). Glyphs + sprite stay on the CDN.

## 4. Release ordering (cutover gate)

A broken cutover (web/style points at the tile server before a verified object + running server exist) shows a blank map. Required order:
1. Merge the `basemap-upload` range-GET verification fix; **run it with `force=true`**; confirm the origin range-read verify passes (object retrievable, total == `SRC_LEN`).
2. Deploy go-pmtiles + its Ingress; **preflight** `GET https://fountainrank.com/tiles/planet.json` (valid TileJSON) and one real tile **before** switching the web.
3. Only then switch `style.light.json` + the web build to the TileJSON source. go-pmtiles **readiness = `/planet.json`** is the backstop: if the object is missing/broken, the pod never becomes Ready and the rollout surfaces it rather than silently serving a dead map.

If bundled into fewer PRs, the deploy must not flip the web/style source until step 1+2 are verified (a manual gate is acceptable given owner-triggered deploys).

## 5. Caching

- go-pmtiles keeps an LRU of the pmtiles header/directory; tile data is small origin range reads.
- `Cache-Control` is set on the **tile Ingress only** (§3.3); browsers (and any future edge cache) cache tiles. TileJSON: short/revalidate; tiles: moderate max-age (planet refreshes monthly, URLs stable).
- **No edge CDN fronts the DOKS ingress today** (the main site is served directly). An edge cache (Cloudflare in front of `fountainrank.com`, or an in-cluster `proxy_cache`) is a **future optimization**, not required — go-pmtiles serves tiles fast directly.

## 6. Security

- **No credentials**: go-pmtiles reads the public object over HTTP range; no Spaces key, no k8s Secret. (We do **not** reuse the upload workflow's write-capable key.)
- Same-origin tiles need no CORS; the CDN-hosted style/glyphs/sprite keep their existing CORS.
- The application **no longer directs browsers to range-read the 127 GB object**; the public `planet.pmtiles` URL remains reachable directly, but it's out of the hot path. **Follow-up (out of scope here):** make `planet.pmtiles` private (go-pmtiles → `s3://` + a dedicated read-only key) and/or move public glyph/sprite/style assets under a separate public prefix, so the archive can be private.

## 7. Testing / verification

- **Re-upload:** the workflow's origin range-GET verify passes (retrievable, total == `SRC_LEN`).
- **Tile server (post-deploy, before web cutover):** `GET https://fountainrank.com/tiles/planet.json` → valid TileJSON whose `tiles` array contains exactly `https://fountainrank.com/tiles/planet/{z}/{x}/{y}.mvt`; fetch one URL from that array → `200`, non-empty, vector-tile content-type. Confirm `Cache-Control` present on `/tiles/planet/{z}/{x}/{y}.mvt` and **absent** on `/` (web) and `/healthz` (rewrite/cache isolation holds). Confirm `/`, `/healthz`, `api.${DOMAIN}/` still route correctly (shared ingress untouched).
- **Browser (Chromium, headless):** map renders; network shows `…/tiles/planet/{z}/{x}/{y}.mvt` `200`s (no `pmtiles://`); map container height > 0; zero console errors.
- CI green + Codex Loop A (spec + plan) + Loop B (PRs). Owner confirms Firefox separately (contingent on WebGL2 on that machine).

## 8. Standing-doc updates

The plan must update or flag now-stale references to "MapLibre + client-side pmtiles on DO Spaces/CDN" in `docs/design/architecture.md`, `docs/specs/2026-06-16-architecture-and-foundation-design.md`, and `docs/setup/README.md`.

## 9. Out of scope

A non-WebGL raster fallback; making the bucket private + relocating public assets; an edge CDN in front of the ingress (future perf); OSM fountain ingestion (separate spec).
