# infra/terraform

Single-file (`main.tf`) DigitalOcean infrastructure for FountainRank: DOKS cluster,
Managed Postgres + PostGIS (app DB + a separate Logto DB), app Spaces buckets +
CDN, the LB-terminated Let's Encrypt SAN cert, DNS A records, and the container
registry — all assigned to the `FountainRank` DO project.

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
2. **Registry:** the shared RDL account uses DO's multiple-registries feature. Confirm
   `fountainrank` does not already exist; `terraform import digitalocean_container_registry.main fountainrank` if it does.
3. **Sizing:** review `node_*` / `db_*` defaults for cost.
4. **DNS:** the four A records (`@`/`www`/`api`/`auth`) are created here; the owner's
   email records (MX/DKIM/SPF/DMARC) are intentionally unmanaged.
5. **🔴 App DB SSL (BLOCKING before deploy/migrations):** DO Managed Postgres requires
   TLS and asyncpg rejects libpq `?sslmode=`. Before the first deploy the backend MUST
   pass `connect_args={"ssl": ctx}` to `create_async_engine`. Concrete approach: take
   DigitalOcean's DB CA cert (`doctl databases get <id>` / console), mount it as a k8s
   secret, build an `ssl.SSLContext` from it (verify-full), and pass it via `connect_args`.
   Without this, `alembic upgrade head` and the backend's `/readyz` will fail on first
   deploy. (This is a backend code change owned by Phase 0f, not by the infra skeleton.)
