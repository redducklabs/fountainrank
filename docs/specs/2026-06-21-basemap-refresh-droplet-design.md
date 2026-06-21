# Basemap Refresh via Ephemeral Droplet (design spec)

**Date:** 2026-06-21
**Status:** Design approved in-conversation; pending Codex Loop A.
**Relationship:** Hardens the `basemap-upload` workflow shipped in #24/#25. The schedule (monthly cron), latest-build auto-discovery, change-detection marker, asset/style upload, and CDN smoke from #25 are kept; only the **~127 GB pmtiles transfer mechanism** changes.

---

## 1. Goal & why

The monthly basemap refresh streams the planet `.pmtiles` through the GitHub runner (`curl … | aws s3 cp -`). That stream is **not resumable**: the first production run failed at 59% (~76 GB) on a transient `curl (92) HTTP/2 stream … INTERNAL_ERROR` from Protomaps' CDN — not the time limit (it was running at ~61 MB/s). One blip discards the whole transfer.

**Definitive fix:** move the heavy transfer onto an **ephemeral, disk-backed DigitalOcean droplet in `sfo3`** (same region as the Spaces bucket), orchestrated by the existing scheduled workflow. The droplet **resumably** downloads the planet to local disk, then uploads it **intra-region** to Spaces with multipart (automatic per-part retry). This removes all three weaknesses: the GitHub 6-hour cap (the work runs on the droplet), the no-resume fragility (disk + `curl -C -` + file-based multipart), and slow cross-region transfer (intra-`sfo3`).

## 2. Locked decisions

- **Ephemeral droplet** (created + destroyed per run; no idle cost; ~$0.10–0.20/run) sized with enough disk for ~127 GB + headroom (`s-4vcpu-8gb`, 160 GB disk).
- **Credentials reach the droplet over SSH, in memory** — a throwaway keypair; the Spaces keys are passed over the encrypted SSH channel for the transfer session only; **never** in cloud-init/user-data or the droplet metadata service, and never on a command line.
- **Monthly cadence** (the existing `cron: "0 4 1 * *"`), transferring only when the source changed (the #25 `planet.pmtiles.meta` content-length marker).
- Reuse the #25 runner-side logic: auto-discover the latest `build.protomaps.com/YYYYMMDD.pmtiles`, the change-check, the style/fonts/sprites upload, and the CDN smoke. Only the in-runner stream step is replaced.

## 3. Architecture / flow (modified `basemap-upload` workflow)

Single Class-B job (`runs-on: ubuntu-latest`, `environment: production` — it handles the DO token + Spaces keys). `timeout-minutes: 150` (bounded; the transfer is ~40 min). Concurrency group unchanged (no overlapping refreshes).

1. **Configure aws-cli** (runner) — for the asset uploads, the marker read, and the smoke.
2. **Resolve source + change detection** (runner, unchanged from #25): auto-discover latest build (or honor an explicit `pmtiles_url`), HEAD for `SRC_LEN`, compare to the marker → `SKIP_STREAM`.
3. **Upload fonts/sprites** + **generate/upload style** (runner, unchanged, gated on `UPLOAD_ASSETS`). These are small + reliable on the runner.
4. **Transfer pmtiles via ephemeral droplet** (only if `SKIP_STREAM != 'true'`) — see §4.
5. **Stream skipped** note (if `SKIP_STREAM == 'true'`).
6. **Destroy the worker droplet** — cleanup step, `if: always()` (see §5).
7. **Smoke test** (runner, unchanged): a cross-origin `Range` request to the CDN expects 206 + range headers.

The marker (`planet.pmtiles.meta`) is written **by the droplet** immediately after a successful upload (same credential session), so it only advances when the upload truly succeeded; a failed transfer leaves the marker stale → the next run retries.

## 4. The droplet transfer (§4)

- **Create:** `doctl compute droplet create basemap-refresh-${{ github.run_id }} --region sfo3 --size s-4vcpu-8gb --image ubuntu-24-04-x64 --ssh-keys <ephemeral-key-id> --tag-name basemap-refresh --wait` (the run-id name + tag make cleanup deterministic). Capture the public IP.
- **SSH readiness:** poll SSH (`ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=…` until `true` succeeds), bounded by a retry loop.
- **Run the transfer over SSH** (the remote script arrives via the encrypted channel, e.g. `ssh … 'bash -s' <<SCRIPT`; the Spaces keys + `RESOLVED_URL`/`SRC_LEN` are interpolated into that here-doc by the runner shell so they travel over SSH, never via user-data/metadata/argv):
  - Install aws-cli on the droplet.
  - **Resumable download:** `curl -C - --retry 8 --retry-delay 15 --retry-all-errors -fL -o /root/planet.pmtiles "$URL"` (`-C -` resumes the partial file across retries; `--retry-all-errors` covers the HTTP/2 reset that failed us).
  - **Integrity check:** verify the downloaded size equals `SRC_LEN`; abort if not.
  - **Upload intra-region:** `aws s3 cp /root/planet.pmtiles s3://fountainrank-basemap/planet.pmtiles --acl public-read --content-type application/octet-stream --endpoint-url https://sfo3.digitaloceanspaces.com` (file-based multipart → automatic per-part retry; tuned `multipart_chunksize`).
  - **Write the marker:** `printf '%s' "$SRC_LEN" | aws s3 cp - s3://fountainrank-basemap/planet.pmtiles.meta --acl private …`.
- If any remote step fails, SSH returns non-zero → the workflow step fails → cleanup still runs (§5) → marker unchanged → next run retries.

## 5. Cleanup & no-leak guarantees (§5)

- **Ephemeral SSH key:** generated on the runner into the job temp; imported via `doctl compute ssh-key import`; **removed** in the cleanup step. The private key never leaves the runner.
- **Destroy the droplet:** an `if: always()` step destroys the droplet by name (`basemap-refresh-${{ github.run_id }}`) and removes the imported ssh-key — so a failed/cancelled/timed-out run never leaks a paid droplet or a stale key.
- **Defensive pre-clean:** before creating, destroy any stale `basemap-refresh-*` droplets tagged `basemap-refresh` (in case a prior run was hard-killed before its cleanup).
- **Job timeout** (`timeout-minutes: 150`) bounds a hung SSH session; the cleanup runs after a timeout.

## 6. Terraform: abort orphaned multipart uploads

The failed stream left an incomplete multipart upload (orphaned parts that aren't a visible object but accrue storage). Add an `AbortIncompleteMultipartUpload` lifecycle rule to the gated `digitalocean_spaces_bucket.basemap` (`abort_incomplete_multipart_upload_days = 7`) so failed transfers self-clean. Applied via the Terraform apply workflow (`manage_basemap_spaces=true`). This also cleans the existing orphan within the window.

## 7. Security

- **Class-B** job on GitHub-hosted `ubuntu-latest` + `environment: production` (blast-radius isolation; matches the Terraform apply + deploy jobs). `permissions: contents: read`.
- **Secrets never persisted:** Spaces keys travel only over the encrypted SSH channel into the remote process env — never in cloud-init/user-data, the droplet metadata service, argv, or logs. The DO token + Spaces keys are GitHub secrets (auto-masked in logs). The source URL is logged sanitized (strip userinfo + query) as in #24.
- **Public-read scope:** `--acl public-read` only on the intentionally public basemap objects; the marker is `private`.
- The worker droplet is single-tenant, short-lived, runs only our script, and is destroyed after.

## 8. Testing / verification

- No headless test exists for cloud orchestration; verification is a **manual `workflow_dispatch`** run (with an explicit small `pmtiles_url` extract to keep the first test cheap/fast) confirming: droplet create → SSH → resumable download → intra-region upload → marker → droplet destroyed → CDN smoke 206. Then a real run with the planet URL (or let the monthly cron do it).
- Cost note: each real run is a few cents (droplet for ~1 h). Logged, not silent.
- The runner-side helpers (resolve/skip/marker) keep working as in #25.

## 9. Out of scope

Photos bucket (Phase 4); switching to a regional extract (the workflow still accepts any `pmtiles_url`, but the planet is the default); any change to the web app or the basemap style/assets.
