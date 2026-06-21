# Basemap Refresh via Ephemeral Droplet (design spec)

**Date:** 2026-06-21
**Status:** Draft; pending Codex Loop A.
**Relationship:** Hardens the `basemap-upload` workflow shipped in #24/#25. The monthly schedule, latest-build auto-discovery, change-detection marker, asset/style upload, and CDN smoke from #25 are kept; only the **~127 GB pmtiles transfer mechanism** changes, plus a CDN purge, a Terraform lifecycle rule, and a janitor workflow.

---

## 1. Goal & precise scope of the fix

The monthly refresh streams the planet `.pmtiles` through the GitHub runner (`curl … | aws s3 cp -`). That is **not resumable**: the first production run died at 59% (~76 GB) on a transient `curl (92) HTTP/2 stream … INTERNAL_ERROR` from Protomaps' CDN (it was at ~61 MB/s — not the time limit), discarding the whole transfer.

**Fix:** run the transfer on an **ephemeral, disk-backed DigitalOcean droplet in `sfo3`** (same region as the bucket), orchestrated by the existing workflow. What this **does** fix: (a) a transient source reset mid-transfer is now retried in place via `curl -C -` on the droplet's disk instead of restarting from zero; (b) the upload is **intra-region** Spaces multipart with automatic per-part retry; (c) the 127 GB never has to fit the runner's ~14 GB disk.

**What it does NOT do (precise):** the orchestrating GitHub job still **waits synchronously** on the SSH session, so the run is still bounded by the GitHub Actions job timeout — it is **not** decoupled from the runner. Resumability is **within a single run/droplet** (the `curl -C -` retry loop); if the whole run fails/cancels, the droplet is destroyed and the next run starts from byte zero (the marker isn't advanced, so it retries). No completed/served partial object results (`planet.pmtiles` is only replaced by a complete multipart upload); any **incomplete** multipart parts from a failed transfer are aborted by the §7 lifecycle rule. This is an acceptable, large improvement over the non-resumable stream; full cross-run resume is out of scope.

## 2. Locked decisions

- **Ephemeral droplet** per run (created + destroyed; no idle cost), sized `s-4vcpu-8gb` (160 GiB SSD; a preflight `df` check gates the download — §4).
- **Credentials reach the droplet over SSH, in process memory only** (§5) — never in cloud-init/user-data, the metadata service, argv, a disk file (`~/.aws` creds), or logs.
- **Monthly** transfer (`cron: "0 4 1 * *"`), only when the source changed (the #25 content-length marker).
- A **separate daily janitor** workflow reaps any stale `basemap-refresh`-tagged droplet (§6) — leak insurance, since in-run cleanup is best-effort, not a hard guarantee.
- Reuse the #25 runner-side logic (resolve/skip/marker, asset+style upload, smoke); only the in-runner stream step is replaced + a CDN purge added.

## 3. Architecture / flow (`basemap-upload` workflow, modified)

One Class-B job (`runs-on: ubuntu-latest`, `environment: production`, `permissions: contents: read`, a bounded `timeout-minutes`). It needs both the DO token and the Spaces keys: install/auth **doctl via `digitalocean/action-doctl@v2.5.2`** with `DIGITALOCEAN_ACCESS_TOKEN` (the same pattern as `deploy.yml`), and configure aws-cli for Spaces (as #25). Concurrency group unchanged (no overlapping refreshes).

1. **Configure** doctl + aws-cli (runner).
2. **Resolve source + change detection** (runner, unchanged from #25): auto-discover the latest build (or an explicit, **validated** `pmtiles_url` — §9), HEAD for `SRC_LEN`, compare to the marker → `SKIP_STREAM`.
3. **Upload fonts/sprites** + **generate/upload style** (runner, unchanged, gated on `UPLOAD_ASSETS`).
4. **Transfer pmtiles via ephemeral droplet** — only if `SKIP_STREAM != 'true'` (§4–§5).
5. **CDN purge** — after a successful pmtiles (and/or asset) replacement, flush the overwritten objects from the CDN so the refreshed data serves immediately instead of waiting out the 24 h TTL (§8).
6. **Stream-skipped** note (if `SKIP_STREAM == 'true'`).
7. **Destroy the worker** — `if: always()`, by captured ID (§6).
8. **Smoke** — origin-side verify of the new object + the existing CDN range check (§8).

The change marker (`planet.pmtiles.meta`) is written **by the runner after a successful upload AND CDN purge** (steps 5→7 below: transfer → purge → record marker), so it only advances once the basemap is both uploaded and served fresh; a failed transfer or purge leaves it stale → next run retries. (The CDN purge also runs on asset-only refreshes, gated on `SKIP_STREAM != true OR UPLOAD_ASSETS == true`.)

## 4. The droplet transfer

- **Create:** `doctl compute droplet create basemap-refresh-${RUN_ID} --region sfo3 --size s-4vcpu-8gb --image ubuntu-24-04-x64 --ssh-keys <ephemeral-key-id> --tag-name basemap-refresh --wait --format ID,PublicIPv4 --no-header`. **Capture the droplet ID and public IP immediately** (for IP-restricted SSH and ID-based cleanup).
- **SSH readiness:** poll `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root@<IP> true` in a bounded retry loop.
- **Remote script** (run over SSH — see §5 for the exact safe invocation). The script:
  1. Installs **AWS CLI v2** (pinned, via the official installer zip — Ubuntu 24.04 has no apt `awscli` package); configures **non-secret** aws settings (placeholder region, `s3.endpoint_url`, `s3.multipart_chunksize 64MB`, `s3.multipart_threshold 64MB`) via `aws configure set` — credentials are **NOT** written to `~/.aws`; they are exported into the process env only.
  2. **Preflight `df`:** compute available bytes on the download filesystem; require `>= SRC_LEN + 10 GiB` margin; **fail before download** if insufficient (accounts for GiB-vs-GB + OS/package overhead; flags future planet growth early).
  3. **Resumable download:** `curl -C - --retry 8 --retry-delay 15 --retry-all-errors -fL -o /root/planet.pmtiles "$URL"` (`-C -` resumes the partial file across retries; covers the HTTP/2 reset).
  4. **Integrity:** verify the downloaded byte count equals `SRC_LEN`; abort otherwise. (Content-Length detects truncation, not a same-length content swap; Protomaps publishes no strong planet checksum we rely on — documented limitation.) The skip **marker stays the bare content-length** (consistent with the #25 resolve/skip read) — no ETag is stored in it; any ETag is used only for the post-upload origin verify logging in §8, not the change-detection marker.
  5. **Upload intra-region:** `aws s3 cp /root/planet.pmtiles s3://fountainrank-basemap/planet.pmtiles --acl public-read --content-type application/octet-stream --endpoint-url https://sfo3.digitaloceanspaces.com` (file-based multipart → automatic per-part retry).
- The droplet does **not** write the change marker. The runner writes it (§8) only after the CDN purge succeeds, so a failed purge can't strand a stale CDN behind an advanced marker.
- Any remote failure → SSH returns non-zero → the step fails → cleanup still runs (§6) → marker unchanged → next run retries.

## 5. Credentials + SSH (the security crux — concrete pattern, not an example)

**Required pattern (binding):**
- Secrets enter the **runner** only as job-level `env:` from `${{ secrets.* }}`. The transfer step's shell body references them only as `$AWS_ACCESS_KEY_ID` / `$AWS_SECRET_ACCESS_KEY` — **never** `${{ secrets.* }}` inside a `run:` body (which GitHub writes to the runner's temp script file on disk).
- The **remote script is a static, single-quoted here-doc** (`<<'REMOTE'`) — no runner-side interpolation into the script body, so neither secrets nor operator input become remote shell syntax.
- Dynamic inputs (`URL`, `SRC_LEN`, the two keys) are sent to the remote **as data**, not code: the runner emits an `export VAR=<value>` prelude built with `printf %q` (safe shell-quoting) from its env vars, piped over the **encrypted SSH stdin** ahead of the static script (`{ printf 'export AWS_ACCESS_KEY_ID=%q\n…' "$AWS_ACCESS_KEY_ID" …; cat remote.sh; } | ssh … 'bash -s'`). Secrets thus travel only over the SSH channel into the remote **process environment** — not argv, not user-data/metadata, not a disk file.
- The remote script uses **no `set -x`**, no `env` dump, no `aws --debug`; aws-cli reads credentials from the exported env (no `aws configure set` of the keys). It `unset`s the key vars before any step that could print env.
- Logs: only a **sanitized** source URL is echoed (strip userinfo + query, as #24); GitHub secret-masking is a backstop, not the primary control.

**SSH host-key trust (conscious tradeoff):** the droplet is created fresh with a per-run keypair, so `StrictHostKeyChecking=accept-new` is trust-on-first-use — a first-connection MITM could in theory capture the prelude. Mitigations + why accepted: DO does not expose the host key before boot; we connect only to the **captured droplet IP** with a **per-run** key, immediately after we created the droplet, from a GitHub-hosted runner. The residual first-connect MITM risk is accepted and documented (DO offers no pre-boot host-key pin). The private key stays on the runner (job temp) and the imported DO ssh-key is removed in cleanup.

## 6. Cleanup — eventual, not a hard guarantee

In-run cleanup is **best-effort**: an `if: always()` step destroys the droplet **by the captured ID** and removes the imported ssh-key by **captured ID/fingerprint** (idempotent; ID-based, not name-based). A **defensive pre-clean** destroys any stale `basemap-refresh`-tagged droplet before creating a new one.

Because `always()` does **not** cover runner-VM loss, a doctl/API outage during cleanup, or a hard-kill before the cleanup step, a leak is still possible. So a **separate daily janitor workflow** (`basemap-janitor.yml`, Class-B, `schedule` daily) destroys any stale `basemap-refresh`-tagged **droplet** whose creation age exceeds a stale threshold (well beyond a normal run), **and** removes any stale imported DO **SSH keys** named `basemap-refresh-*` (a hard-killed run can leak the imported key too). This bounds any leak to ~a day rather than ~a month. The spec claims **eventual cleanup**, not "no leak."

## 7. Terraform: abort orphaned multipart uploads

Add an inline lifecycle rule to the count-gated `digitalocean_spaces_bucket.basemap` (verified valid against the pinned provider 2.90):

```hcl
lifecycle_rule {
  id                                     = "abort-incomplete-mpu"
  enabled                                = true
  abort_incomplete_multipart_upload_days = 7
}
```

It self-cleans incomplete multipart uploads from failed transfers (including the orphan the #25 failure left, within the window). Applied via the Terraform apply workflow with `manage_basemap_spaces=true` (never by hand).

## 8. Freshness: CDN purge + origin-side verify

The CDN caches objects for the Terraform TTL (86400 s), and refreshes overwrite the same keys, so a plain CDN smoke can pass against stale cached content and users would see the old map for up to a day. After a successful replacement, **purge the overwritten objects from the CDN** — `doctl compute cdn flush <cdn-id> --files planet.pmtiles[,style.light.json,…]` (resolve `<cdn-id>` via `doctl compute cdn list` filtered to the basemap origin). Verification: an **origin-side** HEAD/range against Spaces directly (proves the new object landed) **plus** the CDN range smoke (proves serving) — recording the object's `Content-Length`/`ETag`.

## 9. Operator input validation (the droplet fetches it with prod creds in env)

A manual `pmtiles_url` is now fetched by a privileged droplet. Validate it on the runner before use: **`https://` scheme only**, reject userinfo (`user:pass@`), reject control characters, and reject private/loopback/link-local/metadata targets (e.g. `169.254.*`, `127.*`, `10.*`, `192.168.*`, `*.internal`). Auto-discovered builds are always the fixed `https://build.protomaps.com/…` host. Only the sanitized URL is logged.

**Redirects:** the remote download uses `curl -L`, so validating only the initial URL is insufficient — a redirect could point at a private/metadata target. Constrain the download with `--proto '=https' --max-redirs 2` (https-only at every hop, bounded). Note the blast radius is small regardless: the Spaces keys live only in the droplet's process env (§5), **not** in its metadata service, so an SSRF-via-redirect to `169.254.169.254` cannot exfiltrate them; the redirect bounds are defense-in-depth.

## 10. Testing / verification

No headless test exists for cloud orchestration. Verification is a **manual `workflow_dispatch`** run with a **small explicit `pmtiles_url` extract** (cheap/fast first pass) confirming the full path: doctl create → SSH (accept-new) → preflight `df` → resumable download → integrity → intra-region upload → marker → CDN purge → droplet+key destroyed (ID-based) → origin + CDN smoke. Then a real planet run (or the monthly cron). The janitor is exercised by leaving a tagged test droplet and confirming the daily run reaps it. The runner-side helpers (resolve/skip/marker) keep working as in #25.

## 11. Out of scope

Photos bucket (Phase 4); cross-run/checkpointed resume or a persistent worker; switching to a regional extract (the workflow still accepts any validated `pmtiles_url`); any change to the web app or the basemap style/assets beyond the CDN purge.
