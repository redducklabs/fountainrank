# Basemap Refresh via Ephemeral Droplet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the ~127 GB basemap pmtiles transfer off the GitHub runner onto an ephemeral, disk-backed, intra-region (`sfo3`) DigitalOcean droplet — resumable download + intra-region multipart upload — orchestrated by the existing monthly `basemap-upload` workflow, plus a daily janitor and a Terraform lifecycle rule.

**Architecture:** The runner keeps the #25 resolve/skip/marker + asset/style upload + smoke; the in-runner `curl | aws s3 cp -` stream is replaced by: provision an ephemeral droplet (captured ID/IP, tagged), run the transfer over SSH (creds passed as a `printf %q` env-prelude over stdin into a static remote script — never user-data/argv/disk), purge the CDN, destroy the droplet by ID (`always()`). A separate daily `basemap-janitor` reaps leaks. Terraform gains an abort-incomplete-multipart lifecycle rule.

**Tech Stack:** GitHub Actions, `digitalocean/action-doctl@v2.5.2`, `doctl`, aws-cli (DO Spaces S3), SSH, Terraform (DO provider 2.90), `@protomaps/basemaps@5.7.2` (existing).

**Spec:** `docs/specs/2026-06-21-basemap-refresh-droplet-design.md` (Codex Loop A APPROVED). Read it for rationale; this plan carries the exact code + verification per task.

## Global Constraints

- **Secrets never persisted:** Spaces keys enter the runner only as job `env:` from `${{ secrets.* }}`; shell bodies reference `$AWS_ACCESS_KEY_ID`/`$AWS_SECRET_ACCESS_KEY` (NOT `${{ secrets.* }}` inside a `run:` body). They reach the droplet only via a `printf %q` export-prelude piped over SSH stdin into a **static single-quoted** remote script — never argv, user-data/metadata, `~/.aws`, or logs. No `set -x`, no `env` dump, no `aws --debug`. Only sanitized URLs are logged.
- **Class B:** every job handles secrets → `runs-on: ubuntu-latest` + `environment: production` + `permissions: contents: read` (matches `terraform.yml`/`deploy.yml`).
- **IaC read-only locally:** the Terraform change is applied only via the Terraform apply workflow (`manage_basemap_spaces=true`), never by hand; local is `init -backend=false`/`fmt`/`validate`.
- **Eventual cleanup, not a guarantee:** in-run cleanup is best-effort `if: always()` by captured ID; the daily janitor is the leak backstop.
- **Conventional Commits; NO AI attribution; NO time estimates** anywhere (incl. comments).
- **Verification reality:** cloud orchestration has no headless unit test. Per-task gates are: `terraform validate` (Task 1), YAML parse + a careful read of the embedded shell (Tasks 2–3). End-to-end is a **post-merge manual `workflow_dispatch`** with a small extract URL (in the implementation task list, not a code test).
- **Object-key conventions (must match the web build + #25):** `planet.pmtiles`, `planet.pmtiles.meta` (bare content-length), `style.light.json`, `fonts/…`, `sprites/v4/light`. Bucket `s3://fountainrank-basemap`, endpoint `https://sfo3.digitaloceanspaces.com`, CDN `fountainrank-basemap.sfo3.cdn.digitaloceanspaces.com`.

---

## File structure

- **Modify** `infra/terraform/main.tf` — add an inline `lifecycle_rule` to the gated `digitalocean_spaces_bucket.basemap` (Task 1).
- **Modify** `.github/workflows/basemap-upload.yml` — add doctl setup + URL validation; replace the in-runner stream step with the ephemeral-droplet transfer + CDN purge + ID-based `always()` cleanup; add a job `timeout-minutes` (Task 2).
- **Create** `.github/workflows/basemap-janitor.yml` — daily reaper of stale `basemap-refresh` droplets + orphaned imported SSH keys (Task 3).

---

## Task 1: Terraform — abort orphaned multipart uploads

Spec §7. Verified valid against provider 2.90.

**Files:** Modify `infra/terraform/main.tf` (`digitalocean_spaces_bucket.basemap`).

- [ ] **Step 1: Add the lifecycle rule.** In the `resource "digitalocean_spaces_bucket" "basemap"` block (the count-gated one), add after the `acl` line:

```hcl
  lifecycle_rule {
    id                                     = "abort-incomplete-mpu"
    enabled                                = true
    abort_incomplete_multipart_upload_days = 7
  }
```

- [ ] **Step 2: Validate (read-only).**

Run: `cd infra/terraform && terraform init -backend=false && terraform fmt -check && terraform validate`
Expected: `Success! The configuration is valid.` and fmt clean.

- [ ] **Step 3: Commit.**

```bash
git add infra/terraform/main.tf
git commit -m "feat(infra): abort orphaned multipart uploads on the basemap bucket"
```

(Apply happens later via the Terraform apply workflow with `manage_basemap_spaces=true` — task #9, not here.)

---

## Task 2: `basemap-upload` — ephemeral-droplet transfer

Spec §3–§9. Replaces the in-runner stream with the droplet pipeline. Keeps the #25 resolve/skip/marker, asset/style upload, and smoke.

**Files:** Modify `.github/workflows/basemap-upload.yml`.

**Interfaces (env propagated via `$GITHUB_ENV` across steps):** `RESOLVED_URL`, `SRC_LEN`, `SKIP_STREAM` (from the existing resolve step); `DROPLET_ID`, `DROPLET_IP`, `SSH_KEY_ID` (new, from provision).

- [ ] **Step 1: Add a job timeout + doctl setup.** On the `upload` job, add `timeout-minutes: 150` (under the `runs-on`/`environment` keys). Add a doctl-install step as the **first** step (before "Configure aws-cli"):

```yaml
      - name: Install doctl
        uses: digitalocean/action-doctl@v2.5.2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
```

- [ ] **Step 2a: Validate the resolved URL** — in the existing "Resolve source build + change detection" step, immediately after `URL` is finalized (after the auto-discover block, before computing `SRC_LEN`), insert a **real** validator (https-only; no userinfo; resolves ALL A/AAAA answers and rejects any private/loopback/link-local/reserved/multicast/unspecified address — IPv4 and IPv6; emits the host + a validated public IP to pin the later fetch against DNS-rebinding):

```bash
          # The pmtiles_url is fetched by a privileged droplet. Validate with real URL parsing
          # + DNS resolution; reject non-public targets (SSRF). Auto-discovered builds are the
          # fixed build.protomaps.com host but go through the same check.
          if ! VALIDATED=$(python3 - "$URL" <<'PY'
          import sys, socket, ipaddress
          from urllib.parse import urlparse
          raw = sys.argv[1]
          # Reject control chars (incl. newlines) BEFORE the URL is written to $GITHUB_ENV (env injection).
          if any(ord(c) < 0x20 or ord(c) == 0x7f for c in raw): sys.exit("control characters in URL")
          u = urlparse(raw)
          if u.scheme != "https": sys.exit("must be https")
          if u.username or u.password: sys.exit("userinfo not allowed")
          # Only the default https port — the later download pins --resolve host:443:ip, so a
          # non-443 port would otherwise bypass the pin.
          if u.port not in (None, 443): sys.exit("only port 443 allowed")
          host = u.hostname
          if not host: sys.exit("no host")
          ips = {i[4][0] for i in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}
          if not ips: sys.exit("no resolution")
          for ip in ips:
              a = ipaddress.ip_address(ip)
              if a.is_private or a.is_loopback or a.is_link_local or a.is_reserved or a.is_multicast or a.is_unspecified:
                  sys.exit(f"non-public address {ip}")
          print(host, sorted(ips)[0])
          PY
          ); then echo "::error::pmtiles_url failed validation"; exit 1; fi
          SRC_HOST=${VALIDATED%% *}; SRC_IP=${VALIDATED##* }
          { echo "SRC_HOST=$SRC_HOST"; echo "SRC_IP=$SRC_IP"; } >> "$GITHUB_ENV"
```

- [ ] **Step 2b: Validate `SRC_LEN` is decimal** — in the same step, immediately after the existing `SRC_LEN=$(curl -sfI … | awk '{print $2}')` line, insert:

```bash
          case "$SRC_LEN" in ''|*[!0-9]*) echo "::error::source Content-Length not numeric: '$SRC_LEN'"; exit 1 ;; esac
```

- [ ] **Step 3: Replace the stream step with droplet provisioning.** Delete the entire existing `- name: Stream PMTiles to DO Spaces` step and insert these three steps in its place.

Provision:

```yaml
      - name: Provision worker droplet
        if: ${{ env.SKIP_STREAM != 'true' }}
        run: |
          set -euo pipefail
          mkdir -p "$HOME/.ssh"
          # Per-run ephemeral SSH key; the private key stays on the runner.
          ssh-keygen -t ed25519 -N '' -f "$HOME/.ssh/basemap_refresh" -C "basemap-refresh-${GITHUB_RUN_ID}" >/dev/null
          KEY_ID=$(doctl compute ssh-key import "basemap-refresh-${GITHUB_RUN_ID}" \
            --public-key-file "$HOME/.ssh/basemap_refresh.pub" --format ID --no-header)
          echo "SSH_KEY_ID=$KEY_ID" >> "$GITHUB_ENV"
          # Defensive pre-clean: destroy any stale tagged droplets from a prior crashed run.
          for id in $(doctl compute droplet list --tag-name basemap-refresh --format ID --no-header); do
            doctl compute droplet delete "$id" --force || true
          done
          ID=$(doctl compute droplet create "basemap-refresh-${GITHUB_RUN_ID}" \
            --region sfo3 --size s-4vcpu-8gb --image ubuntu-24-04-x64 \
            --ssh-keys "$KEY_ID" --tag-name basemap-refresh --wait --format ID --no-header)
          echo "DROPLET_ID=$ID" >> "$GITHUB_ENV"
          IP=$(doctl compute droplet get "$ID" --format PublicIPv4 --no-header)
          echo "DROPLET_IP=$IP" >> "$GITHUB_ENV"
          echo "Provisioned droplet $ID ($IP)."
```

Transfer (the security-critical step — copy verbatim; secrets via `$VAR`, never `${{ secrets.* }}` here):

```yaml
      - name: Transfer pmtiles on the droplet
        if: ${{ env.SKIP_STREAM != 'true' }}
        run: |
          set -euo pipefail
          SSH="ssh -i $HOME/.ssh/basemap_refresh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 root@${DROPLET_IP}"
          # Wait for SSH (cloud-init/boot).
          ready=""
          for i in $(seq 1 40); do if $SSH true 2>/dev/null; then ready=1; break; fi; sleep 10; done
          if [ -z "$ready" ]; then echo "::error::droplet SSH never became ready"; exit 1; fi
          # Secrets + dynamic inputs travel as a printf %q export-prelude over the encrypted
          # SSH stdin (not argv/file/log), ahead of a STATIC single-quoted remote script.
          {
            printf 'export AWS_ACCESS_KEY_ID=%q\n' "$AWS_ACCESS_KEY_ID"
            printf 'export AWS_SECRET_ACCESS_KEY=%q\n' "$AWS_SECRET_ACCESS_KEY"
            printf 'export SRC_URL=%q\n'  "$RESOLVED_URL"
            printf 'export SRC_HOST=%q\n' "$SRC_HOST"
            printf 'export SRC_IP=%q\n'   "$SRC_IP"
            printf 'export SRC_LEN=%q\n'  "$SRC_LEN"
            printf 'export ENDPOINT=%q\n' "$ENDPOINT"
            printf 'export BUCKET=%q\n'   "$BUCKET"
            cat <<'REMOTE'
          set -euo pipefail
          export DEBIAN_FRONTEND=noninteractive
          apt-get update -qq && apt-get install -yqq awscli curl >/dev/null
          aws configure set default.region us-east-1
          aws configure set default.s3.endpoint_url "$ENDPOINT"
          aws configure set default.s3.multipart_chunksize 64MB
          aws configure set default.s3.multipart_threshold 64MB
          # Preflight disk: require SRC_LEN + 10 GiB free (GiB vs GB + OS/package overhead).
          avail=$(df -B1 --output=avail /root | tail -1 | tr -d ' ')
          need=$(( SRC_LEN + 10 * 1024 * 1024 * 1024 ))
          if [ "$avail" -lt "$need" ]; then echo "insufficient disk: avail=$avail need=$need" >&2; exit 1; fi
          # Resumable, https-only, NO redirects, IP pinned to the runner-validated address
          # (closes redirect-bypass + DNS-rebinding between validation and fetch).
          curl -C - --retry 8 --retry-delay 15 --retry-all-errors --proto '=https' --max-redirs 0 \
            --resolve "${SRC_HOST}:443:${SRC_IP}" -fL -o /root/planet.pmtiles "$SRC_URL"
          # Integrity (truncation): size must equal the source content-length.
          got=$(stat -c %s /root/planet.pmtiles)
          if [ "$got" != "$SRC_LEN" ]; then echo "size mismatch: got=$got want=$SRC_LEN" >&2; exit 1; fi
          # Intra-region multipart upload (automatic per-part retry).
          aws s3 cp /root/planet.pmtiles "${BUCKET}/planet.pmtiles" \
            --acl public-read --content-type application/octet-stream --endpoint-url "$ENDPOINT"
          # Marker = bare content-length (matches the #25 skip read). Written only on success.
          printf '%s' "$SRC_LEN" | aws s3 cp - "${BUCKET}/planet.pmtiles.meta" \
            --acl private --content-type text/plain --endpoint-url "$ENDPOINT"
          unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
          echo "droplet transfer + marker complete"
          REMOTE
          } | $SSH 'bash -s'
```

CDN purge:

```yaml
      - name: Purge CDN for refreshed objects
        if: ${{ env.SKIP_STREAM != 'true' }}
        run: |
          set -euo pipefail
          CDN_ID=$(doctl compute cdn list --format ID,Origin --no-header | grep 'fountainrank-basemap' | awk '{print $1}' | head -1)
          if [ -z "$CDN_ID" ]; then echo "::warning::basemap CDN not found; skipping purge"; exit 0; fi
          # doctl cdn flush --files takes ABSOLUTE object paths (leading slash); no --files = flush all.
          if [ "${UPLOAD_ASSETS}" = "true" ]; then
            doctl compute cdn flush "$CDN_ID" # assets + pmtiles refreshed → flush entire cache
          else
            doctl compute cdn flush "$CDN_ID" --files /planet.pmtiles
          fi
          echo "CDN purged."
```

- [ ] **Step 4: Add the always-run cleanup** — insert after the "Source unchanged — stream skipped" step (and before the smoke), so it runs regardless of success/failure/cancel. (Residual: if `doctl create --wait` creates the droplet but exits non-zero before printing the ID, `DROPLET_ID` is unset and this step can't delete it — the daily janitor in Task 3 is the backstop that reaps it by age.)

```yaml
      - name: Destroy worker droplet + key
        if: ${{ always() }}
        run: |
          if [ -n "${DROPLET_ID:-}" ]; then doctl compute droplet delete "$DROPLET_ID" --force || true; fi
          if [ -n "${SSH_KEY_ID:-}" ]; then doctl compute ssh-key delete "$SSH_KEY_ID" --force || true; fi
```

- [ ] **Step 5: Augment the smoke** with an origin-side check (the CDN smoke can hit cached content). Replace the smoke step's body so it FIRST verifies the object at the **origin** (Spaces), then the CDN:

```yaml
      - name: Smoke test — origin + CDN
        run: |
          set -o pipefail
          echo "Origin HEAD (Spaces)…"
          aws s3api head-object --bucket fountainrank-basemap --key planet.pmtiles \
            --endpoint-url "$ENDPOINT" --query 'ContentLength' --output text
          echo "CDN range probe…"
          HEADERS=$(curl -s -o /dev/null -D - -H 'Origin: https://fountainrank.com' -H 'Range: bytes=0-99' "https://${CDN_HOST}/planet.pmtiles")
          printf '%s\n' "$HEADERS" | grep -iE '^HTTP/|^accept-ranges:|^content-range:|^content-length:|^access-control-allow-origin:'
          printf '%s' "$HEADERS" | grep -q "^HTTP/.*206" || { echo "::error::CDN did not return 206"; exit 1; }
          echo "Smoke PASSED."
```

- [ ] **Step 6: Verify YAML + review.**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/basemap-upload.yml'))" && echo "YAML OK"`
Then re-read the diff: confirm no `${{ secrets.* }}` appears inside any `run:` body; the remote here-doc is `<<'REMOTE'` (single-quoted/static); `set -x` absent; cleanup is `if: always()` and ID-based; `timeout-minutes` set.

- [ ] **Step 7: Commit.**

```bash
git add .github/workflows/basemap-upload.yml
git commit -m "ci: transfer basemap pmtiles via ephemeral sfo3 droplet (resumable, intra-region) + CDN purge"
```

---

## Task 3: `basemap-janitor` — daily leak reaper

Spec §6.

**Files:** Create `.github/workflows/basemap-janitor.yml`.

- [ ] **Step 1: Create the workflow.**

```yaml
name: Basemap Janitor

# Daily backstop: reap leaked ephemeral basemap-refresh workers (a basemap-upload run
# hard-killed before its in-run cleanup). Droplets are reaped by age; imported SSH keys
# are reaped only when their matching droplet no longer exists (so an in-flight run's key
# is never pulled out from under it).

on:
  schedule:
    - cron: "30 5 * * *" # daily
  workflow_dispatch:

permissions:
  contents: read

jobs:
  reap:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 10
    steps:
      - name: Install doctl
        uses: digitalocean/action-doctl@v2.5.2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      - name: Reap stale basemap-refresh droplets + orphaned keys
        env:
          STALE_SECONDS: "21600" # 6h — well beyond a normal run
        run: |
          set -euo pipefail
          # doctl droplet --format has NO creation-time column → use JSON + created_at.
          dj=$(doctl compute droplet list --tag-name basemap-refresh -o json)
          # Reap droplets older than STALE_SECONDS.
          stale_ids=$(python3 - "$dj" <<'PY'
          import sys, json, os
          from datetime import datetime, timezone
          now = datetime.now(timezone.utc); stale = int(os.environ["STALE_SECONDS"])
          for d in (json.loads(sys.argv[1] or "[]") or []):
              c = datetime.fromisoformat(d["created_at"].replace("Z", "+00:00"))
              if (now - c).total_seconds() > stale:
                  print(d["id"])
          PY
          )
          for id in $stale_ids; do echo "reaping droplet $id"; doctl compute droplet delete "$id" --force || true; done
          # NON-stale (in-flight/recent) droplet names — their keys must be protected.
          live_names=$(python3 - "$dj" <<'PY'
          import sys, json, os
          from datetime import datetime, timezone
          now = datetime.now(timezone.utc); stale = int(os.environ["STALE_SECONDS"])
          for d in (json.loads(sys.argv[1] or "[]") or []):
              c = datetime.fromisoformat(d["created_at"].replace("Z", "+00:00"))
              if (now - c).total_seconds() <= stale:
                  print(d["name"])
          PY
          )
          # Reap imported keys named basemap-refresh-* with NO matching non-stale droplet (orphans).
          doctl compute ssh-key list --format ID,Name --no-header | awk '$2 ~ /^basemap-refresh-/ {print $1" "$2}' | while read -r kid kname; do
            if ! printf '%s\n' "$live_names" | grep -qx "$kname"; then
              echo "reaping orphaned ssh-key $kname ($kid)"
              doctl compute ssh-key delete "$kid" --force || true
            fi
          done
```

- [ ] **Step 2: Verify YAML.**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/basemap-janitor.yml'))" && echo "YAML OK"`

- [ ] **Step 3: Commit.**

```bash
git add .github/workflows/basemap-janitor.yml
git commit -m "ci: daily basemap-janitor to reap leaked refresh droplets + orphaned keys"
```

---

## Post-implementation (in the implementation task, after merge — not a code task here)

1. Apply the Terraform lifecycle rule: dispatch the **Terraform** workflow with `action=apply` + `manage_basemap_spaces=true`.
2. **End-to-end verify** the droplet path: dispatch **basemap-upload** with a small explicit `pmtiles_url` extract (cheap/fast), confirming create → SSH → preflight → resumable download → integrity → intra-region upload → marker → CDN purge → origin+CDN smoke → droplet+key destroyed. Then a real planet run (or let the monthly cron do it).
3. Confirm the janitor: dispatch **basemap-janitor** once and confirm it no-ops cleanly (no stale resources).

---

## Self-review checklist (author)

- **Spec coverage:** §1–§3 flow (T2), §4 droplet transfer incl. preflight/resume/integrity/upload/marker (T2 step 3), §5 creds-over-SSH static-script pattern (T2 step 3, verbatim), §6 ID-based always() cleanup (T2 step 4) + daily janitor incl. orphan-key safety (T3), §7 TF lifecycle (T1), §8 CDN purge + origin-side smoke (T2 steps 3/5), §9 URL validation (T2 step 2), doctl setup (T2 step 1). All covered.
- **Placeholders:** none — full YAML/HCL/shell given; verification is `terraform validate` + YAML parse + post-merge manual dispatch (cloud orchestration has no headless test, stated explicitly).
- **Consistency:** object keys (`planet.pmtiles`/`.meta`/`style.light.json`/`fonts`/`sprites/v4/light`), bucket/endpoint/CDN host, and env names (`RESOLVED_URL`/`SRC_LEN`/`SKIP_STREAM`/`DROPLET_ID`/`DROPLET_IP`/`SSH_KEY_ID`/`UPLOAD_ASSETS`) match across tasks and #25; the `basemap-refresh` tag + `basemap-refresh-${run_id}` naming are consistent between provision (T2), cleanup (T2), and the janitor (T3).
