# infra/terraform

Single-file (`main.tf`) DigitalOcean infrastructure for FountainRank: DOKS cluster,
Managed Postgres + PostGIS (app DB + a separate Logto DB), the LB-terminated Let's
Encrypt SAN cert, and DNS A records — with the cluster, DB, LB, and domain assigned
to the `FountainRank` DO project. **Not managed here:** the container registry (DO
multiple-registries feature is incompatible with the provider's legacy endpoint —
created out-of-band). The **basemap** Spaces bucket + CDN + CORS and the private
**photos** Spaces bucket are all managed here unconditionally (live prod infra; the old
`var.manage_basemap_spaces` / `var.manage_photos_spaces` count-gates were both removed —
see the checklist). See the pre-apply checklist below.

## 🔴 Local use is READ-ONLY

Per `claude_help/kubernetes-infra.md`, **never** run a state-mutating Terraform
command locally. Allowed locally:

```bash
terraform fmt -check
terraform init -backend=false   # download providers; NO backend/state access
terraform validate
```

`plan` (against the real backend), `apply`, `destroy`, `import`, and `state` run
**only in CI** (Phase 0f).

## State backend

S3-compatible, in the pre-existing `fountainrank-terraform-state` Spaces bucket
(sfo3). CI initializes with the Spaces keys exported as `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`:

```bash
terraform init   # backend config is in main.tf
```

## Inputs (CI)

`do_token`, `spaces_access_id`, `spaces_secret_key` — from the GitHub `production`
environment secrets (`DIGITALOCEAN_ACCESS_TOKEN`, `SPACES_ACCESS_KEY`,
`SPACES_SECRET_KEY`). All sizing/region/version inputs have minimal defaults.

## Pre-first-apply checklist (Phase 0f, in CI)

1. **Provider lock:** ✅ done (Phase 0f). `.terraform.lock.hcl` is committed with a
   multi-platform lock (`linux_amd64`, `darwin_arm64`, `windows_amd64`, `windows_386`),
   generated via `terraform providers lock -platform=...`. That command is registry-only
   (no backend/state/cloud access), so it is safe to run locally; CI `terraform init`
   verifies the lock. `windows_386` is included because the repo's local Terraform is the
   32-bit Windows build — omitting it would break local `init -backend=false`.
2. **Registry:** ✅ resolved — **NOT managed by Terraform.** The DO provider's
   `digitalocean_container_registry` uses the legacy `/v2/registry` endpoint, which returns
   `422 invalid subscription plan` on this account (it has multiple registries) — it can be
   neither created nor imported via Terraform. `fountainrank` is created out-of-band:
   `curl -X POST -H "Authorization: Bearer $DO_TOKEN" https://api.digitalocean.com/v2/registries -d '{"name":"fountainrank","subscription_tier_slug":"basic","region":"sfo3"}'`,
   and referenced everywhere by the `DO_REGISTRY` CI variable.
3. **Sizing:** ✅ reviewed — cheapest defaults (owner-approved 2026-06-18).
4. **🔴 DNSSEC:** must be **OFF** on `fountainrank.com` or DO refuses the LE cert
   (`422 certificate cannot be created when DNSSEC is enabled`). The DS record lived at the
   registrar (GoDaddy); it was removed 2026-06-18. Verify with
   `curl 'https://dns.google/resolve?name=fountainrank.com&type=DS'` → no `Answer`.
5. **Spaces buckets (basemap + photos):** ✅ live prod infra, both managed **unconditionally**.
   Each was originally count-gated (`var.manage_basemap_spaces` / `var.manage_photos_spaces`,
   default `false`) to defer creation until a bucket-create-capable Spaces key was wired; once a
   bucket is live in state that gate becomes a footgun (a default apply plans to DESTROY the live
   bucket). Basemap's gate was **removed 2026-07-04**; the **photos** gate was **removed 2026-07-20**
   after a full plan confirmed `.photos[0]` was in state and slated for destruction. Both removals
   used Terraform `moved` blocks (`.basemap[0]` / `.photos[0]` → unindexed) — a pure state refactor,
   zero destroy/recreate. The photos bucket additionally carries `lifecycle { prevent_destroy = true }`
   so any future plan-to-destroy is a loud apply-time error, not silent user-data loss. Every apply
   now manages both buckets plainly; no dispatch input is needed. Full basemap setup (upload + env +
   smoke) in `docs/setup/README.md` → "Basemap hosting".
6. **DNS:** the four A records (`@`/`www`/`api`/`auth`) are created here; the owner's
   email records (MX/DKIM/SPF/DMARC) are intentionally unmanaged.
7. **App DB SSL:** ✅ wired (Phase 0f). The backend passes `connect_args={"ssl": ctx}` when
   `DB_SSL_ROOT_CERT` is set (`backend/app/db.py`), and `infra/k8s/backend.yaml` mounts the CA
   from `fountainrank-secrets.database-ca.crt` at that path. The owner supplies the CA value
   as the `DATABASE_CA_CERT` production secret (`doctl databases get <id>` → CA cert) before the
   first deploy — without it, `alembic upgrade head` and `/readyz` fail on a TLS-required DB.
