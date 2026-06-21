# Basemap Tile Server (go-pmtiles in DOKS) — design spec

**Date:** 2026-06-21
**Status:** Draft; architecture approved in-conversation (research-backed); pending Codex Loop A.

## 1. Goal & why

Serve the **whole Protomaps planet** reliably, regionally (only viewed tiles), and CDN/Firefox-friendly — on the infrastructure we already run (DOKS + DO Spaces).

**What's wrong now (root cause).** We deviated from the canonical Protomaps production pattern: we serve the **public 127 GB `planet.pmtiles`** via **client-side `pmtiles://` HTTP range requests straight off the CDN**. Consequences, all observed:
- The DO CDN can't edge-cache a 127 GB object (`cf-cache-status: BYPASS`) → range requests passthrough, no caching.
- The 127 GB multipart upload to DO Spaces is fragile (`CompleteMultipartUpload "already in progress"`), and the resulting object is currently **broken**: `HEAD` 200 but `GET`/range → `NoSuchKey` (data not retrievable) — the basemap is down for all browsers.
- Client-side pmtiles range/decoding is the source of the Firefox+PMTiles range bugs (the gzip/range class, e.g. PMTiles #582/#584).

**The standard fix** ([Protomaps deploy docs](https://docs.protomaps.com/deploy/)): a **`pmtiles serve` tile server** ([`protomaps/go-pmtiles`](https://hub.docker.com/r/protomaps/go-pmtiles), official Docker image) range-reads the planet **server-side** and serves normal **`z/x/y` vector tiles** + TileJSON. The **CDN/edge caches the small tile responses** (not the 127 GB object); MapLibre consumes a normal tile source (**no client-side pmtiles library**, eliminating the PMTiles+Firefox range class). DigitalOcean Spaces with a custom S3 endpoint is supported ([cloud-storage docs](https://docs.protomaps.com/pmtiles/cloud-storage)).

**Out of scope for "Firefox WebGL2":** MapLibre requires WebGL2 regardless of hosting. The owner's specific Firefox can't create a WebGL2 context (a hardware-acceleration / anti-fingerprinting setting on that machine — verify at `get.webgl.org/webgl2`). The graceful `UnsupportedHint` (already shipped) is the correct behavior there. This spec does not add a non-WebGL renderer.

## 2. Architecture

```
Browser (MapLibre, vector source via TileJSON)
   │  GET https://fountainrank.com/tiles/planet/{z}/{x}/{y}.mvt   (same-origin → no CORS)
   ▼
DO LB (TLS) → ingress-nginx (host fountainrank.com, path /tiles → rewrite)
   ▼
go-pmtiles `serve` (DOKS Deployment+Service)
   │  S3 GET byte-ranges (server-side)
   ▼
DO Spaces  s3://fountainrank-basemap/planet.pmtiles
```

- **go-pmtiles** runs `pmtiles serve / --bucket "s3://fountainrank-basemap?endpoint=https://sfo3.digitaloceanspaces.com&region=auto&use_path_style=true" --public-url https://fountainrank.com/tiles --port 8080`, with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (a **read-only** Spaces key) from a k8s Secret. Pin image `protomaps/go-pmtiles:v1.30.3`.
- **Path, not subdomain.** Serving under `fountainrank.com/tiles/` reuses the existing LB cert + DNS (a `tiles.` subdomain would need a new DNS record + an LB-cert change), and is **same-origin** with the web app → **no CORS** for tiles. Ingress adds a `/tiles(/|$)(.*)` path rule → go-pmtiles service with `rewrite-target: /$2`, taking precedence over the `/` → web rule.
- **Glyphs, sprites, and the style JSON stay on the public CDN** (small, cacheable, already working). Only the planet **tiles** move to go-pmtiles. The style's `sources.protomaps` changes from `pmtiles://…/planet.pmtiles` to the go-pmtiles **TileJSON** URL.
- **Bucket stays public-read** (the small assets are still served from the CDN; nobody hits `planet.pmtiles` directly anymore). Making the bucket private is deferred (it would require relocating the public assets) — noted, not done here.

## 3. Components & changes

1. **Fix + re-upload the planet (prerequisite).** The current `planet.pmtiles` is broken (`GET → NoSuchKey`). Enhance the `basemap-upload` workflow:
   - Replace the `HEAD`-size idempotency-skip with a **range-GET** check (`aws s3api get-object --range bytes=0-99` succeeds AND the object's total size == `SRC_LEN`); a broken/absent object → don't skip → re-upload. `force` still always re-uploads.
   - Replace the post-upload `HEAD`-size verify with the **range-GET** verify (retrieve a small range back; confirm success + total size == `SRC_LEN`). This catches a failed/partial multipart completion that leaves a non-retrievable object.
   - Re-run it (with `force`) to replace the broken object with a verified one.
2. **go-pmtiles Deployment + Service** (`infra/k8s/basemap-tiles.yaml`): the pinned image, the `serve` args, the Spaces creds Secret, modest resources (LRU cache default 64 MB + range reads — ~256–512 MB RAM, low CPU), a `/` HTTP readiness probe (e.g. the TileJSON path), 1–2 replicas.
3. **Ingress** (`infra/k8s/ingress.yaml`): add the `/tiles` path rule on the `fountainrank.com` host → `basemap-tiles-service`, with `nginx.ingress.kubernetes.io/rewrite-target` + `Cache-Control` for tiles (so browsers/any future edge cache them). Deploy workflow renders it (existing `envsubst` flow).
4. **Web** (`web/components/map/MapBrowser.tsx`, `web/lib/map/style.ts`): drop the `pmtiles` client import + `addProtocol`/`removeProtocol`/`Protocol`; point the basemap style source at the go-pmtiles **TileJSON** (`https://fountainrank.com/tiles/planet.json`) as a `type: "vector"` source. The WebGL2 pre-check / powerPreference / graceful guard stay. (Remove the now-unused `pmtiles` dependency.)
5. **Style generation** (`basemap-upload` workflow's `style.light.json`): change the `protomaps` source from `pmtiles://…/planet.pmtiles` to the TileJSON/tiles URL. Glyphs + sprite still point at the CDN. (MapLibre + go-pmtiles z/x/y is consumed without the pmtiles client.)

## 4. Caching

- go-pmtiles keeps an LRU of the pmtiles header/directory (cheap repeat tile lookups); tile data is small S3 range reads.
- Set `Cache-Control` on tile responses so browsers cache them; a planet refresh changes tile contents but the URL is stable — use a moderate max-age (and the monthly refresh is infrequent).
- **No edge CDN fronts the DOKS ingress today** (the main site is served directly). An edge cache (e.g. Cloudflare in front of `fountainrank.com`, or an in-cluster `proxy_cache`) is a **future optimization**, not required for correctness — go-pmtiles serves tiles fast directly. Documented as a follow-up.

## 5. Security

- The go-pmtiles Spaces credentials are a **read-only** key in a k8s Secret (created imperatively in the deploy job like the other secrets), never committed. go-pmtiles reads server-side; the browser never sees Spaces creds.
- Same-origin tiles (`fountainrank.com/tiles`) need no CORS. The CDN-hosted style/glyphs/sprite keep their existing CORS.
- No public range serving of the 127 GB object anymore (the attack/abuse surface of a public huge object behind range requests is gone from the hot path).

## 6. Testing / verification

- **Re-upload:** the workflow's range-GET verify must pass (object retrievable + correct size); confirm with `aws s3api get-object --range`.
- **Tile server:** after deploy, `curl https://fountainrank.com/tiles/planet.json` returns valid TileJSON; `curl https://fountainrank.com/tiles/planet/0/0/0.mvt` returns `200` with `Content-Type: application/vnd.mapbox-vector-tile` (or the archive's type) and non-empty body; a mid-zoom US tile returns data.
- **Browser (Chromium, headless):** the map renders; network shows `…/tiles/planet/{z}/{x}/{y}.mvt` `200`s (not `pmtiles://`); container height > 0; zero console errors. (Owner confirms Firefox separately, contingent on WebGL2 on that machine.)
- CI green + Codex Loop A (spec + plan) + Loop B (PRs).

## 7. Out of scope

A non-WebGL raster fallback (separate decision); making the bucket private + relocating public assets; an edge CDN in front of the ingress (future perf); OSM fountain ingestion (separate spec).
