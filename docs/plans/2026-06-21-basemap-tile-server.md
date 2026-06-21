# Basemap Tile Server (go-pmtiles) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Serve the whole Protomaps planet reliably via a `go-pmtiles serve` tile server in DOKS (z/x/y vector tiles + TileJSON, CDN/Firefox-friendly), reading the public `planet.pmtiles` from DO Spaces over server-side HTTP range — replacing the fragile client-side `pmtiles://` range-against-CDN approach.

**Spec:** `docs/specs/2026-06-21-basemap-tile-server-design.md` (Codex Loop A APPROVED). Read it for rationale.

**Architecture:** go-pmtiles (`protomaps/go-pmtiles:v1.30.3`) Deployment+Service in DOKS reads `https://fountainrank-basemap.sfo3.digitaloceanspaces.com/planet.pmtiles` (public, **no creds**) and serves `/planet.json` + `/planet/{z}/{x}/{y}.mvt`, exposed at `fountainrank.com/tiles/` via a **separate** Ingress (regex `/tiles`→rewrite). MapLibre uses a vector source via that TileJSON (drops the client pmtiles lib).

## Global Constraints

- **No credentials** for go-pmtiles (public object, HTTP-bucket read). Do NOT reuse the upload write-key; create no new secret.
- **Separate `basemap-tiles` Ingress object** — never add the regex/rewrite/cache annotations to the shared `fountainrank-ingress` (object-scoped; would break web/API/auth/healthz).
- **Range-GET verification** (`aws s3api get-object --range bytes=0-99`, total from `ContentRange` == `SRC_LEN`) is the success/skip criterion everywhere — never `HEAD`/marker/size-only (that masked the `NoSuchKey` break).
- **Release ordering (cutover gate):** Phase 1 (verify+re-upload) → Phase 2 (tile server deployed+preflighted) → Phase 3 (web/style cutover). Never flip the web/style to TileJSON before a verified object + a live tile server.
- Class-B for secret jobs; squash-merge; Conventional Commits; **NO AI attribution; NO time estimates**; IaC via CI (k8s via `deploy.yml` envsubst, never by hand); `pmtiles` object key conventions unchanged.
- **Verification reality:** local web/pnpm toolchain can't run in this Windows/Git-Bash checkout — CI `workspace-js` + `terraform validate` + the post-deploy curl/Chromium checks are the gates. Web edits must be Prettier-formatted (`format:check` is in `workspace-js`).

---

## File structure

- **Modify** `.github/workflows/basemap-upload.yml` — range-GET verify helper at all gates (Phase 1); style-gen source → TileJSON (Phase 3).
- **Create** `infra/k8s/basemap-tiles.yaml` — go-pmtiles Deployment + Service + the separate `basemap-tiles` Ingress (Phase 2).
- **Modify** `.github/workflows/deploy.yml` — add `basemap-tiles` to the workload `envsubst` loop; drop the now-unused `NEXT_PUBLIC_BASEMAP_PMTILES_URL` web build-arg (Phase 2/3).
- **Modify** `web/components/map/MapBrowser.tsx`, `web/lib/map/style.ts`, `web/Dockerfile`, `.github/workflows/security-audit.yml` — drop the pmtiles client **usage** + the unused pmtiles build-arg (Phase 3). (The `pmtiles` **dependency** stays in `web/package.json` — Task 4 Step 3.)
- **Modify** `docs/design/architecture.md`, `docs/specs/2026-06-16-architecture-and-foundation-design.md`, `docs/setup/README.md` — note the tile-server serving (Phase 3).

---

## Phase 1 — Verify + re-upload (URGENT: unbreaks the current map)

### Task 1: Range-GET verification in `basemap-upload.yml`

The current object is `NoSuchKey`-broken and every skip/verify is `HEAD`/marker/size-only. Add a range-GET probe at every gate. (The probe checks the response **`ContentRange`** metadata — `bytes 0-99/<total>` — and compares `${cr##*/}` (the `<total>`) to `SRC_LEN`; it does NOT trust the downloaded body length or a `HEAD` `ContentLength`. That distinction is the whole point: a `HEAD`-200 / `GET`-`NoSuchKey` object fails this probe.)

**Files:** Modify `.github/workflows/basemap-upload.yml`.

- [ ] **Step 1: Runner resolve — prove the live object range-reads, not just the marker.** In "Resolve source build + change detection", change the skip so `SKIP_STREAM=true` requires BOTH the marker match AND a successful origin range-GET whose total == `SRC_LEN`. Insert before the `SKIP=...` line:

```bash
          # The marker can be stale/lying (HEAD-200 but GET-NoSuchKey). Prove the live object
          # actually range-reads with the right total before skipping.
          LIVE_OK=""
          if cr=$(aws s3api get-object --bucket fountainrank-basemap --key planet.pmtiles \
                    --range bytes=0-99 --endpoint-url "$ENDPOINT" /dev/null \
                    --query 'ContentRange' --output text 2>/dev/null); then
            # cr looks like "bytes 0-99/<total>"
            if [ "${cr##*/}" = "$SRC_LEN" ]; then LIVE_OK=1; fi
          fi
```

Then change the skip condition to also require `LIVE_OK`:

```bash
          SKIP=false
          if [ "$FORCE" != "true" ] && [ -n "$LAST_LEN" ] && [ "$SRC_LEN" = "$LAST_LEN" ] && [ -n "$LIVE_OK" ]; then SKIP=true; fi
```

- [ ] **Step 2: Droplet idempotency skip — range-GET, not head-object.** In the droplet remote script, replace the existing `existing=$(aws s3api head-object … ContentLength …)` idempotency check with a range-GET total check:

```bash
          existing=$(aws s3api get-object --bucket fountainrank-basemap --key planet.pmtiles \
            --range bytes=0-99 --endpoint-url "$ENDPOINT" /dev/null \
            --query 'ContentRange' --output text 2>/dev/null || echo "")
          if [ "${existing##*/}" = "$SRC_LEN" ]; then
            echo "planet.pmtiles already present + range-readable with the correct total; skipping download+upload."
          else
```

- [ ] **Step 3: Post-upload verify — range-GET, not head-object.** Replace the `remote_len=$(aws s3api head-object … ContentLength …)` verify loop with a range-GET total check:

```bash
            remote_len=""
            for v in 1 2 3 4 5 6; do
              cr=$(aws s3api get-object --bucket fountainrank-basemap --key planet.pmtiles \
                --range bytes=0-99 --endpoint-url "$ENDPOINT" /dev/null \
                --query 'ContentRange' --output text 2>/dev/null || echo "")
              remote_len="${cr##*/}"
              [ "$remote_len" = "$SRC_LEN" ] && break
              echo "waiting for object to be range-readable (got '${remote_len:-none}')…" >&2; sleep 15
            done
            if [ "$remote_len" != "$SRC_LEN" ]; then echo "upload verify failed (not range-readable): '${remote_len:-none}' want=$SRC_LEN" >&2; exit 1; fi
            echo "upload verified: planet.pmtiles range-readable, total ${remote_len} bytes"
```

- [ ] **Step 4: Smoke — add an origin range-read.** In the smoke step, before the CDN probe, add an origin range check (go-pmtiles reads the origin):

```bash
          echo "Origin range probe (go-pmtiles reads this path) …"
          ostatus=$(curl -s -o /dev/null -w '%{http_code}' -m 30 -r 0-99 "https://fountainrank-basemap.sfo3.digitaloceanspaces.com/planet.pmtiles")
          [ "$ostatus" = "206" ] || { echo "::error::origin range probe expected 206, got $ostatus"; exit 1; }
```

- [ ] **Step 5: Verify + commit.**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/basemap-upload.yml'))" && echo OK`
Then `bash -n` each `run:` body (extract via python3, as in prior PRs); confirm no `${{ }}` in run bodies.
```bash
git add .github/workflows/basemap-upload.yml
git commit -m "fix(ci): verify planet.pmtiles is range-READABLE (get-object --range), not just HEAD size, at every gate"
```

**After merge (operational):** dispatch `basemap-upload` with `force=true`. Confirm the origin range probe returns `206` (`curl -r 0-99 https://fountainrank-basemap.sfo3.digitaloceanspaces.com/planet.pmtiles`). This re-uploads a durable object and **unbreaks the current map** (the deployed pmtiles-client web works again against a valid object).

---

## Phase 2 — go-pmtiles tile server

### Task 2: `infra/k8s/basemap-tiles.yaml` (Deployment + Service + Ingress) + deploy loop

**Files:** Create `infra/k8s/basemap-tiles.yaml`; modify `.github/workflows/deploy.yml`.

- [ ] **Step 1: Create the manifest.** (Models backend.yaml's small-cluster rollout. Public image → no `imagePullSecrets`. No credentials.)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: basemap-tiles
  namespace: ${NAMESPACE}
  labels: { app: basemap-tiles, component: basemap-tiles }
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxSurge: 0, maxUnavailable: 1 }
  selector:
    matchLabels: { app: basemap-tiles }
  template:
    metadata:
      labels: { app: basemap-tiles, component: basemap-tiles }
    spec:
      containers:
        - name: go-pmtiles
          image: protomaps/go-pmtiles:v1.30.3
          args:
            - serve
            - "/"
            - "--bucket=https://fountainrank-basemap.sfo3.digitaloceanspaces.com"
            - "--public-url=https://${DOMAIN}/tiles"
            - "--port=8080"
            # CORS is needed: www.${DOMAIN} is also served by the web ingress, but TileJSON
            # points at the apex (${DOMAIN}/tiles) — so a www visitor's tile fetches are
            # cross-origin. go-pmtiles' --cors sets ACAO for these; tiles from the apex itself
            # are same-origin (the header is harmless there).
            - "--cors=https://${DOMAIN},https://www.${DOMAIN}"
          ports:
            - containerPort: 8080
          resources:
            requests: { memory: "256Mi", cpu: "50m" }
            limits: { memory: "512Mi", cpu: "500m" }
          startupProbe:
            httpGet: { path: /planet.json, port: 8080 }
            initialDelaySeconds: 3
            periodSeconds: 5
            failureThreshold: 30
          livenessProbe:
            httpGet: { path: /, port: 8080 }
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            # /planet.json forces go-pmtiles to range-read the archive header from Spaces —
            # catches a missing/broken object or bad bucket URL (not just "process up").
            httpGet: { path: /planet.json, port: 8080 }
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 3
---
apiVersion: v1
kind: Service
metadata:
  name: basemap-tiles-service
  namespace: ${NAMESPACE}
  labels: { app: basemap-tiles }
spec:
  selector: { app: basemap-tiles }
  ports:
    - { port: 80, targetPort: 8080, protocol: TCP }
  type: ClusterIP
---
# SEPARATE Ingress — regex + rewrite + cache annotations are object-scoped, so they must NOT
# live on the shared fountainrank-ingress. Serves fountainrank.com/tiles/* (same-origin).
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: basemap-tiles
  namespace: ${NAMESPACE}
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /$2
    nginx.ingress.kubernetes.io/use-forwarded-headers: "true"
    # No Cache-Control snippet: ingress-nginx snippet annotations are disabled in this cluster
    # (allow-snippet-annotations=false; the Helm install does not enable them). go-pmtiles sets
    # ETag on tiles + TileJSON, so browsers revalidate (304). Adding max-age belongs to a future
    # edge cache (Cloudflare) or an allowed global add-headers ConfigMap — out of scope here.
  labels: { app: basemap-tiles }
spec:
  ingressClassName: nginx
  rules:
    - host: ${DOMAIN}
      http:
        paths:
          - path: /tiles(/|$)(.*)
            pathType: ImplementationSpecific
            backend:
              service:
                name: basemap-tiles-service
                port: { number: 80 }
```

- [ ] **Step 2: Add to the deploy workload loop.** In `.github/workflows/deploy.yml`, add `basemap-tiles` to the loop:

```bash
          for f in backend web logto ingress basemap-tiles; do
            envsubst < "infra/k8s/$f.yaml" | kubectl apply -f -
          done
```

And add a rollout wait (after the existing waits): `kubectl -n "$NAMESPACE" rollout status deploy/basemap-tiles --timeout=120s`.

- [ ] **Step 3: Verify + commit.**

Render (manifests have `${...}` placeholders) then schema-validate per the infra guidance:
`NAMESPACE=fountainrank DOMAIN=fountainrank.com envsubst < infra/k8s/basemap-tiles.yaml | kubeconform -strict -ignore-missing-schemas -`
(fallback if kubeconform is unavailable: pipe the same envsubst output to `python3 -c "import yaml,sys; list(yaml.safe_load_all(sys.stdin)); print('OK')"`).
```bash
git add infra/k8s/basemap-tiles.yaml .github/workflows/deploy.yml
git commit -m "feat(infra): go-pmtiles tile server (DOKS) serving fountainrank.com/tiles from the public planet pmtiles"
```

**After merge (operational, before Phase 3):** trigger a deploy; then **preflight** (do NOT proceed to Phase 3 until these pass):
```bash
curl -s https://fountainrank.com/tiles/planet.json        # valid TileJSON; tiles[] == https://fountainrank.com/tiles/planet/{z}/{x}/{y}.mvt
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://fountainrank.com/tiles/planet/0/0/0.mvt   # 200, vector-tile
curl -s -o /dev/null -w '%{http_code}\n' https://fountainrank.com/        # 200 (web still routes — shared ingress intact)
curl -s -o /dev/null -w '%{http_code}\n' https://fountainrank.com/healthz # 200 (healthz intact)
```

---

## Phase 3 — Cut the web over to the tile server

### Task 3: Style generation → TileJSON source

**Files:** Modify `.github/workflows/basemap-upload.yml` (the `style.light.json` node generator).

- [ ] **Step 1: Change the source from `pmtiles://` to the TileJSON URL.** Add `SITE_HOST` to that workflow step's `env:` (`SITE_HOST: fountainrank.com`, alongside the existing `CDN_HOST`). In the node heredoc, add `const SITE_HOST = process.env.SITE_HOST;` near `const CDN_HOST = …`, and set the `protomaps` source (glyphs + sprite still use `CDN_HOST`):

```js
            sources: {
              protomaps: {
                type: "vector",
                url: `https://${SITE_HOST}/tiles/planet.json`,
                attribution:
                  '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
              },
            },
```

- [ ] **Step 2: Verify + commit.** YAML parse + `bash -n` the style step; confirm the generated JSON would reference `/tiles/planet.json`.
```bash
git add .github/workflows/basemap-upload.yml
git commit -m "ci: basemap style source → go-pmtiles TileJSON (https://fountainrank.com/tiles/planet.json)"
```

### Task 4: Web — drop the client pmtiles library

**Files:** Modify `web/components/map/MapBrowser.tsx`, `web/lib/map/style.ts`, `web/Dockerfile`, `.github/workflows/deploy.yml`, `.github/workflows/security-audit.yml`. (NOT `web/package.json` — see Step 3.)

- [ ] **Step 1: MapBrowser.** Remove `import { Protocol } from "pmtiles";` and the `addProtocol("pmtiles", …)` / `removeProtocol("pmtiles")` calls (the style now uses a normal vector TileJSON source MapLibre fetches natively). Keep the WebGL2 pre-check / `powerPreference` / `UnsupportedHint`.
- [ ] **Step 2: style.ts.** Remove the now-unused `pmtilesUrl` field (the style JSON carries the source). Keep `styleUrl`.
- [ ] **Step 3: Leave the `pmtiles` dependency in place.** Do NOT edit `web/package.json` / `pnpm-lock.yaml`: removing the dep needs a `pnpm install` to update the lockfile, which can't run in this Windows/Git-Bash checkout (and CI uses `--frozen-lockfile`, so package.json/lockfile drift fails). After Step 1 the package is unused (tree-shaken from the client bundle). Removing the dep + regenerating the lockfile is a follow-up requiring a working pnpm install.
- [ ] **Step 4: Build-args.** Remove the unused `NEXT_PUBLIC_BASEMAP_PMTILES_URL` ARG/ENV from `web/Dockerfile` and the `--build-arg NEXT_PUBLIC_BASEMAP_PMTILES_URL=…` from `deploy.yml` + `security-audit.yml`. (Keep `NEXT_PUBLIC_BASEMAP_STYLE_URL`.)
- [ ] **Step 5: Prettier + verify + commit.** Run Prettier on the changed web files (`node node_modules/.pnpm/prettier@3.8.4/node_modules/prettier/bin/prettier.cjs --write web/components/map/MapBrowser.tsx web/lib/map/style.ts`). Confirm no remaining `addProtocol`/`Protocol`-from-pmtiles import, `pmtiles://`, or `NEXT_PUBLIC_BASEMAP_PMTILES_URL` references via grep — scope to runtime usage/imports/build-args; the `pmtiles` dep intentionally remains in `package.json`/`pnpm-lock.yaml`, so don't flag that.
```bash
git add web/components/map/MapBrowser.tsx web/lib/map/style.ts web/Dockerfile .github/workflows/deploy.yml .github/workflows/security-audit.yml
git commit -m "feat(web): consume go-pmtiles TileJSON vector source; drop the client-side pmtiles usage + unused build-arg"
```

### Task 5: Standing-doc updates

**Files:** Modify `docs/design/architecture.md`, `docs/specs/2026-06-16-architecture-and-foundation-design.md`, `docs/setup/README.md`.

- [ ] **Step 1:** Update the basemap-serving description from "MapLibre + client-side pmtiles range against the CDN" to "go-pmtiles tile server at fountainrank.com/tiles serving z/x/y from the planet pmtiles on Spaces". Commit `docs: …`.

**After merge (operational cutover):** dispatch `basemap-upload` (regenerates `style.light.json` with the TileJSON source) → trigger a deploy (new web, pmtiles client dropped) → verify the map renders (Chromium: `…/tiles/planet/{z}/{x}/{y}.mvt` 200s, no `pmtiles://`, container height > 0, zero console errors).

---

## Self-review (author)

- **Spec coverage:** §3.1 verify (Task 1), §3.2 Deployment incl. readiness=/planet.json + 1-replica rollout (Task 2), §3.3 separate Ingress + ETag-based caching (no ingress Cache-Control snippet) (Task 2), §3.4 web (Task 4), §3.5 style-gen (Task 3), §4 cutover ordering (phases + operational gates), §6 no-creds (Task 2 has no secret), §7 tests (preflight + Chromium), §8 stale docs (Task 5). Covered.
- **Placeholders:** none — exact YAML/shell/JS given; verification is YAML-parse/`bash -n`/envsubst-then-parse + post-deploy curl/Chromium (cloud orchestration has no headless unit test, stated).
- **Consistency:** `fountainrank.com/tiles/planet.json` + `/tiles/planet/{z}/{x}/{y}.mvt`, the `basemap-tiles` names (Deployment/Service/Ingress), and the range-GET `ContentRange` total check are consistent across tasks and the spec.
- **Ordering:** Phase 1 unbreaks on the current approach (valid object) before any cutover; Phase 2 deploys+preflights the server; Phase 3 flips style+web only after. The deploy gate (readiness=/planet.json) backstops a missing object.
