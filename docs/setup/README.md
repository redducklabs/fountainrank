# External Setup & Credentials — Owner Runbook

This folder is the **operator runbook** for everything that must be created
outside the repo: cloud accounts, OAuth clients, DNS, email sending, and the
GitHub secrets that wire them into CI/CD. It is written so **Aron can work
through it independently** while implementation continues in parallel.

> **Source of truth:** spec §19 (External setup & registrations checklist) in
> `docs/specs/2026-06-16-architecture-and-foundation-design.md`, plus the
> `claude_help/oauth-sso.md`, `claude_help/email.md`,
> `claude_help/github-environments.md`, and `claude_help/kubernetes-infra.md`
> spokes. This runbook turns that checklist into click-by-click steps.

---

## 🔴 Golden rules (read once, never break)

- **No secret value ever goes in this repo.** Not in these docs, not in code,
  not in a committed `.env`. The repo references secret **names** only. Values
  live in **GitHub Environment secrets** and (at deploy time) Kubernetes
  secrets, or in Logto's own config.
- When a step produces a value, **record it in your own private store** (a
  password manager / secure note), then paste it into the destination listed in
  that guide's **Outputs to record** table — never into a file under
  `D:\repos\fountainrank`.
- Cloud-console UIs change. These guides describe the **stable conceptual
  steps and the exact outputs needed**; button labels may differ slightly from
  what you see. If a screen doesn't match, tell me what you see and I'll adjust.
- When you finish a guide, **hand me the "Outputs to record" values you're
  comfortable sharing** (IDs, names, domains — not raw secrets) so I can wire
  the config. For true secrets, you set them in GitHub/Logto yourself; I only
  need the **names** to exist.

---

## When each piece is actually needed (priority)

You do **not** have to do all of this at once. Order by what unblocks the next
milestone:

| Guide | Unblocks | Start now? |
|---|---|---|
| `01-digitalocean.md` | 0f CI/CD + first live deploy | ✅ Yes — account + API token are quick and gate everything cloud |
| `02-dns.md` | TLS cert issuance + email deliverability + auth subdomain | ✅ Yes — DNS + DMARC propagation is slow |
| `03-google-cloud.md` | Phase 2 auth (Google sign-in) **and** all auth email | ✅ Yes — OAuth consent verification + Workspace delegation are slow |
| `04-apple-and-app-stores.md` | Phase 2 auth (Apple sign-in) + store submission | ⚠️ Start the **paid enrollments** now (slow approval); the rest later |
| `05-github.md` | 0f CI/CD (every deploy job) | ✅ Repo security features now; secrets as each value lands |
| `06-logto.md` | Phase 2 auth end-to-end | ⏳ Later — needs Logto deployed (0e) and OAuth clients (03/04) first |

**Bottom line:** the highest-leverage things to start today are the **paid /
slow-approval** items — Apple Developer Program enrollment, Google Play Console
enrollment, Google Workspace domain-wide delegation, the OAuth consent screen,
and DNS/DMARC records — because they involve external review or propagation
delays that nothing in the codebase can shorten.

---

## Master secret inventory

Every credential the system consumes, what produces it, and its destination.
Names match `claude_help/github-environments.md`; some are finalized in plan 0f
(marked **TBD-0f**) and some only exist once Logto is deployed (**TBD-Logto**).

| Secret / value name | Produced in | Destination | Status |
|---|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | `01-digitalocean.md` | GitHub Env secret | ✅ set (`production`) — dedicated CI PAT (replaced bootstrap 2026-06-17) |
| `SPACES_ACCESS_KEY` / `SPACES_SECRET_KEY` | `01-digitalocean.md` | GitHub Env secret | ✅ set (`production`), scoped readwrite to TF-state bucket |
| `DO_REGISTRY` | `01-digitalocean.md` | GitHub Env **variable** | ✅ set (`fountainrank`) |
| `DO_REGION` | `01-digitalocean.md` | GitHub Env **variable** | ✅ set (`sfo3`) |
| `CLUSTER_NAME` | `01-digitalocean.md` / Terraform | GitHub Env **variable** | TBD-0f |
| `DATABASE_URL` | DO Managed Postgres (Terraform) | GitHub Env secret | TBD (first deploy) |
| `LOGTO_DB_URL` | DO Managed Postgres (Logto DB) | GitHub Env secret | TBD (first deploy) |
| `DATABASE_CA_CERT` | DO Managed Postgres CA PEM (`doctl databases get`) | GitHub Env secret → mounted `database-ca.crt` | TBD (first deploy) — backend asyncpg verify-full TLS |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `03-google-cloud.md` | GitHub Env secret | Ready to create |
| `GOOGLE_WORKSPACE_DOMAIN` | `03-google-cloud.md` | GitHub Env **variable** | Ready to create |
| `GOOGLE_DELEGATED_USER` | `03-google-cloud.md` | GitHub Env **variable** | Ready to create |
| `FROM_EMAIL` | `02-dns.md` / `03-google-cloud.md` | GitHub Env **variable** | Ready to create |
| `LOGTO_EMAIL_WEBHOOK_TOKEN` | self-generated random (≥32 chars) | GitHub Env **secret** + Logto HTTP email connector auth token | Ready to create |
| `BASE_URL` | decided per environment | GitHub Env **variable** | TBD-0f |
| Google OAuth client id/secret (web/iOS/Android) | `03-google-cloud.md` | **Logto** Google connector | Ready to create |
| Apple Services ID / Team ID / Key ID / `.p8` key | `04-apple-and-app-stores.md` | **Logto** Apple connector | Ready to create |
| `LOGTO_ENDPOINT` / `LOGTO_APP_ID` / `LOGTO_APP_SECRET` (web) | `06-logto.md` | GitHub Env secret + web config | TBD-Logto |
| Logto native app id, M2M app id/secret | `06-logto.md` | mobile config / backend | TBD-Logto |

> **Variable vs. secret:** non-sensitive identifiers (region, cluster name,
> registry name, sending domain, base URL) are GitHub **variables**; anything
> that grants access (tokens, passwords, connection strings, private keys, the
> service-account JSON) is a **secret**.

---

## Progress checklist

Tick these off as you go (edit this file, or just tell me and I'll update it):

- [x] **DigitalOcean** — account, API token, Spaces keys, registry name, TF-state bucket, `production` env secrets/vars (`01`) — done 2026-06-17 (region `sfo3`)
- [ ] **DNS** — domain control confirmed; apex/www/api/auth records planned; SPF/DKIM/DMARC (`02`)
- [ ] **Google Cloud** — project, OAuth consent screen, web/iOS/Android OAuth clients (`03`)
- [ ] **Google Workspace** — service account + domain-wide delegation for Gmail sending (`03`)
- [ ] **Apple** — Developer Program enrolled; App ID; Sign in with Apple (Services ID + key) (`04`)
- [ ] **Google Play** — Console account enrolled (`04`)
- [x] **GitHub** — security features enabled (secret scanning + push protection, Dependabot alerts/updates, vulnerability alerts — confirmed 2026-06-18); CI/security workflows landed (0f). Remaining: set the first-deploy secret values `DATABASE_URL`/`LOGTO_DB_URL`/`DATABASE_CA_CERT` in the `production` env (`05`)
- [ ] **Logto** — app registrations + connectors (after Logto is deployed) (`06`)

---

## API CORS for the web map

The backend (`backend/app/config.py`) ships a default `cors_allow_origins` list of
`["https://fountainrank.com", "https://www.fountainrank.com", "http://localhost:3020"]`.
Phase 3a makes the web map the first browser-origin API caller, so these origins
must be correct before going live.

**No separate preview/staging deploy exists in this repo.** If a preview origin is
ever needed (e.g. `https://preview.fountainrank.com`), add it by setting the
`CORS_ALLOW_ORIGINS` GitHub Environment variable (or k8s `ConfigMap` entry) to a
comma-separated list of all allowed origins, for example:

```
CORS_ALLOW_ORIGINS=https://fountainrank.com,https://www.fountainrank.com,https://preview.fountainrank.com
```

The config parser also accepts a JSON array. Never write this value to a `.env` file;
set it as a GitHub Environment **variable** (not a secret — it is not sensitive).

**Post-deploy smoke procedure (owner/CI)** — run these after every backend deploy to
confirm CORS is wired correctly:

```bash
# Preflight (replace api.fountainrank.com with the actual API URL)
curl -i -X OPTIONS 'https://api.fountainrank.com/api/v1/fountains/bbox' \
  -H 'Origin: https://fountainrank.com' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-request-id'
# Expected: 200 or 204 with Access-Control-Allow-Origin: https://fountainrank.com

# Actual GET (use a small REGIONAL bbox — a whole-globe bbox currently 500s, see issue #20)
curl -i 'https://api.fountainrank.com/api/v1/fountains/bbox?min_lat=37.70&min_lng=-122.52&max_lat=37.81&max_lng=-122.36' \
  -H 'Origin: https://fountainrank.com' -H 'X-Request-ID: smoke-1'
# Expected: 200 with Access-Control-Allow-Origin: https://fountainrank.com
```

Local equivalent (requires backend running on port 3021):

```bash
curl -i -X OPTIONS 'http://localhost:3021/api/v1/fountains/bbox' \
  -H 'Origin: http://localhost:3020' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: x-request-id'

curl -i 'http://localhost:3021/api/v1/fountains/bbox?min_lat=37.70&min_lng=-122.52&max_lat=37.81&max_lng=-122.36' \
  -H 'Origin: http://localhost:3020' -H 'X-Request-ID: smoke-1'
```

---

## Basemap hosting (Protomaps planet on Spaces + CDN) — Phase 3a

The web map renders a self-hosted Protomaps **Light** basemap. Terraform manages the bucket +
CDN + CORS (gated behind `var.manage_basemap_spaces`); the upload runs via the
**`basemap-upload`** GitHub Actions workflow.

**Status (2026-06-21):**

- ✅ **Bucket + CDN + CORS provisioned** (Terraform apply with `manage_basemap_spaces=true`):
  bucket `fountainrank-basemap` (sfo3, public-read; CORS: GET/HEAD, `Range` allowed,
  `Accept-Ranges`/`Content-Range`/`Content-Length`/`ETag` exposed, origins = the web origins).
  **CDN `fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com`.**
- ✅ **Web env wired** — `deploy.yml` (and the security-audit scan build) pass
  `NEXT_PUBLIC_BASEMAP_STYLE_URL=https://<cdn>/style.light.json` as a Docker build-arg (inlined
  into the web client bundle at _build_ time — Next bakes `NEXT_PUBLIC_*` during `next build`).
  The planet itself is **not** a build-arg: it's served as z/x/y tiles by the go-pmtiles **tile
  server** (`fountainrank.com/tiles`), referenced from inside `style.light.json`.
- ⏳ **Remaining: upload the basemap data** (below), then tag the release.

**Serving.** The planet is served by a **go-pmtiles tile server** in DOKS (`infra/k8s/basemap-tiles.yaml`)
that range-reads `planet.pmtiles` from Spaces server-side and serves z/x/y vector tiles + TileJSON at
`fountainrank.com/tiles/` (the browser uses **no** client-side pmtiles library). Design:
`docs/specs/2026-06-21-basemap-tile-server-design.md`.

**Upload + monthly refresh (the `basemap-upload` workflow).** It uploads (public-read): the
**style** (`style.light.json`, generated for the Light flavor — its source is the tile-server
TileJSON; glyphs/sprite on the CDN), the **fonts** (`fonts/{fontstack}/{range}.pbf`), the
**sprites**, and the **planet** to `planet.pmtiles` via an **ephemeral sfo3 droplet** (resumable
download + intra-region upload; verified **range-readable** before the run succeeds).

- **Runs monthly** (cron `0 4 1 * *`) to keep the basemap current: it **auto-discovers the
  latest** Protomaps daily build (`https://build.protomaps.com/YYYYMMDD.pmtiles`) and **skips
  the ~127 GB stream when the source is unchanged** (it compares the source `Content-Length`
  to a `planet.pmtiles.meta` marker it writes after each upload).
- **On demand:** Actions → **basemap-upload** — leave `pmtiles_url` blank to auto-discover the
  latest (or pass an explicit URL, e.g. a regional extract for a quick first pass), set
  `upload_assets` (default true), and `force` to re-stream even if unchanged.
- The ~127 GB transfer runs on the ephemeral droplet (resumable download + intra-region upload);
  the marker only advances after the object verifies **range-readable**, so a failed/partial
  upload retries instead of leaving a broken object. Do **not** hotlink Protomaps — we copy to our own bucket.

Manual fallback (from a machine with the create-capable Spaces key + aws-cli at
`https://sfo3.digitaloceanspaces.com`): `aws s3 cp <file> s3://fountainrank-basemap/<key>
--acl public-read --endpoint-url …` for `planet.pmtiles`, `style.light.json`, `fonts/…`,
`sprites/…` (same keys as above).

**Smoke check** — confirm the tile server serves TileJSON + a tile, and that go-pmtiles can
range-read the origin it depends on:
```bash
curl -s  https://fountainrank.com/tiles/planet.json | head      # valid TileJSON; tiles[] under /tiles/planet/{z}/{x}/{y}.mvt
curl -sI https://fountainrank.com/tiles/planet/0/0/0.mvt | head -1   # 200 (vector tile)
curl -sI -r 0-99 'https://fountainrank-basemap.sfo3.digitaloceanspaces.com/planet.pmtiles' | head -1  # 206 (origin range go-pmtiles reads)
```
Then load `https://fountainrank.com/` and confirm tiles render (pins appear once fountain
data exists).

**Pin assets** are already committed (`web/public/pins/*.png`, derived from
`docs/logos/512-pin.png` via `scripts/gen-pin-assets.py`) — swap for bespoke art anytime
(referenced by name in `web/lib/map/style.ts`, no code change).

---

## How this connects to the build

- **0e (infra Terraform)** consumes the DigitalOcean and DNS outputs.
- **0f (CI/CD)** consumes the GitHub secrets/variables.
- **Phase 2 (auth)** consumes the Google/Apple OAuth outputs and the Logto
  registrations.
- The Gmail service account + Workspace delegation powers **all** transactional
  email (Logto magic link/verification, and any future app email).
