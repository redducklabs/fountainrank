# Phase 0e — Infra Terraform Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the infrastructure-as-code skeleton — a single-file Terraform config (`infra/terraform/main.tf`) for the DOKS cluster, Managed Postgres+PostGIS (app DB + a separate Logto DB), app Spaces buckets + CDN, the LB-terminated Let's Encrypt SAN cert, DNS A records, and the container registry, all assigned to the `FountainRank` DO project — plus the `envsubst`-templated Kubernetes manifests (`infra/k8s/`) for backend/web/Logto/ingress/secrets, and the deferred backend Dockerfile hardening (non-root `USER` + `HEALTHCHECK`). Everything is **validate-clean locally (read-only)**; it is **planned and applied only in CI** (Phase 0f) — there is no local `terraform plan`.

**Architecture:** Reuse TherapyLink's proven single-file DO Terraform template with the three deliberate divergences from the spec (§15): **DO Managed Postgres + PostGIS** instead of in-cluster Postgres, **self-hosted Logto**, and **LB-managed Let's Encrypt TLS** (no cert-manager). State lives in the pre-existing `fountainrank-terraform-state` Spaces bucket (sfo3, S3 backend; backend-config supplied by CI). The K8s manifests are raw YAML with `${VAR}` placeholders substituted by `envsubst` in CI (matching house style) — namespace, backend Deployment/Service, web Deployment/Service, Logto Deployment/Service, the ingress-nginx install note, the ingress routes (+ a tiny `healthz-service` for the LB health check), and placeholder Secret templates populated at deploy time from GitHub Environment secrets. Local verification is **static**: `terraform fmt -check` + `init -backend=false` + `validate` for Terraform; `envsubst` rendering + **`kubeconform`** (cluster-independent schema validation) for the manifests; `docker build` + a running-container health probe for the Dockerfile. (`kubectl apply --dry-run=client` is **not** used — in this environment it tries to fetch OpenAPI from the live cluster, so it is neither offline nor cluster-free.)

**Tech Stack:** Terraform ≥1.6 (local v1.12.2) · `digitalocean/digitalocean` provider `~> 2.0` · DOKS (k8s 1.33–1.36) · DO Managed Postgres 17 · DO Spaces (S3 backend + app buckets + CDN) · DO LB + Let's Encrypt SAN cert · ingress-nginx (Helm-installed in CI, NodePort 30080/30443) · `svhd/logto:1.40.1` · `envsubst` + `kubeconform` for manifest rendering/validation · the existing backend image (`python:3.13-slim-trixie` + uv).

## Global Constraints

- Repo `redducklabs/fountainrank` (public). **Phase 0 → commit directly to `main`** (no CI/PR gate yet; CI lands in 0f). Conventional Commits. **No AI attribution in commits/PRs. No time estimates anywhere.** Public repo — **never commit secrets or `.env` files.**
- **Windows host:** use **backslash paths** with Read/Write/Edit tools (`D:\repos\fountainrank\...`). The Bash tool is Git Bash (forward-slash, `/d/repos/fountainrank/...`).
- **🔴 Local IaC is READ-ONLY (hard rule — `claude_help/kubernetes-infra.md`).** Locally you may run only `terraform fmt`, `terraform init -backend=false`, `terraform validate`. **NEVER** run `terraform plan` against the real backend, nor `apply`/`destroy`/`import`/`state`. **NEVER** run `kubectl apply`/`helm upgrade` against a cluster. All applies/deploys happen in CI (Phase 0f). **Do not use `kubectl apply --dry-run=client` as a local check** — in this environment it reaches out to the live cluster for OpenAPI and is neither offline nor cluster-free (and the kubeconfig points at a real DO cluster). Validate manifests with `kubeconform` (schema-only, cluster-independent) + an `envsubst` placeholder-substitution check instead.
- **Pinned/verified values (copy exactly — confirmed live 2026-06-17):** region `sfo3`; DO project `FountainRank` (exists; id `be84b91e-aae6-4555-9f02-114bceda6b53`); state bucket `fountainrank-terraform-state` (sfo3, exists — **NOT** a Terraform-managed resource); registry name `fountainrank` (`DO_REGISTRY`); domain `fountainrank.com` (DO-managed, NS delegated); Logto image `svhd/logto:1.40.1`; Managed Postgres engine `pg` v`17`. DOKS offers `1.33.x`–`1.36.x`. Minimal PG slug `db-s-1vcpu-1gb` (single-node only).
- **DNS reality (verified read-only):** `fountainrank.com` already has SOA/NS + the owner's **email/verification records** (Google site-verification TXT, `smtp.google.com` MX, `google._domainkey` DKIM). The four app **A records (`@`/`www`/`api`/`auth`) do not exist yet.** Terraform **adds the four A records** and **must not touch** the existing email records. SPF/DMARC and the Logto connectors/secrets are **out of scope** here (Phase 2 email/auth).
- **Skeleton, never applied.** Every resource below is desired-state only. Reconciliation with the live account (provider lock, possible `fountainrank` registry pre-existence, final sizing) happens at the first CI apply in 0f — see each task's pre-apply notes.
- **IaC verification ≠ runtime TDD.** There is no "failing test first" for declarative infra. The honest analog used in every task is **static validation run to green** (`terraform validate`; `kubeconform` + an envsubst placeholder check; a container health probe). Each task ends with a direct-to-`main` commit; the final task pushes.

## Decisions (owner-approved / verified 2026-06-17 — keep these)

- **DNS = DigitalOcean-managed (Option A).** Owner confirmed nameservers are delegated to DO and the domain + email records already exist. Terraform references the domain via a `data "digitalocean_domain"` source and **creates the four A records**; it leaves the email records alone. No DNS is created by hand (the A records need the not-yet-existing LB IP, and hand-mutating cloud state is forbidden — they materialize at the 0f apply).
- **Sizing = minimal / cheapest** (owner choice). DOKS `s-2vcpu-2gb`, autoscale **1–3**; Managed Postgres **single-node `db-s-1vcpu-1gb`**. Exposed as variables; tune the defaults before the first apply.
- **Single-file `main.tf`** (spec §15: "reuses TherapyLink's proven single-file Terraform DO template"). Variables + data sources + resources + outputs all live in one file, matching the template.
- **Registry tier `basic`** (not `starter`): the walking skeleton needs ≥2 repos (`fountainrank-backend`, `fountainrank-web`); `starter` allows only one.
- **PostGIS is enabled by the app's Alembic migration** (`0001_enable_postgis`) at deploy time, not by Terraform — DO has no Terraform-native "enable extension" resource and the managed admin user has rights.
- **App-side DB SSL is an explicit Phase 0f pre-deploy gate (NOT deferred to Phase 1).** DO Managed Postgres requires TLS and `asyncpg` rejects libpq `?sslmode=` (see `backend/app/config.py`). Phase 0f is the *first* cloud deploy (build/push → `kubectl apply` → `alembic upgrade head` → rollout gated on the backend's DB-touching `/readyz`), so the backend **must** send `connect_args={"ssl": ...}` before that deploy or migrations + readiness fail. It is out of scope for this infra-skeleton phase (it is exercised/testable only against the real Managed PG), but it is recorded as a **blocking Phase 0f prerequisite** in `infra/terraform/README.md` with the concrete approach: source DigitalOcean's CA cert (from the DB cluster / `doctl databases get`), mount it as a secret, and build an `ssl.SSLContext` from it (verify-full) passed via `create_async_engine(..., connect_args={"ssl": ctx})`. **This plan does not change backend DB code.**
- **Secrets are created imperatively by CI — never bulk-applied from committed YAML.** `infra/k8s/secrets.yaml` and `registry-secret.yaml` are **documentation/reference only** (they record the key contract); they are **excluded from the `envsubst | kubectl apply` manifest loop**. CI creates/updates them from GitHub Environment secrets + the Terraform DB outputs, e.g. `kubectl create secret generic fountainrank-secrets -n "$NAMESPACE" --from-literal=database-url="$DATABASE_URL" --from-literal=logto-db-url="$LOGTO_DB_URL" --dry-run=client -o yaml | kubectl apply -f -`, and `doctl registry kubernetes-manifest fountainrank --name regcred --namespace "$NAMESPACE" | kubectl apply -f -`. **Required 0f secret keys:** `fountainrank-secrets.database-url` (app DB) **and** `fountainrank-secrets.logto-db-url` (Logto's `logto` DB URL) — both because `backend.yaml` and `logto.yaml` are in the 0f apply set. This avoids the empty-value-overwrite hazard and keeps secret values off disk / out of `envsubst`.
- **ingress-nginx is Helm-installed (config via Helm `--set controller.config.*`), not via committed YAML.** `infra/k8s/ingress-nginx.yaml` documents the exact Helm command (NodePort 30080/30443 + forwarded-header config) and is **not** part of the `kubectl apply` loop — a standalone `nginx-configuration` ConfigMap would be orphaned by the stock chart.
- **Logto on managed PG is topology-only here, but it deploys in 0f.** The skeleton declares the separate `logto` database + a Logto Deployment/Service/Ingress. Because `logto.yaml` is in the 0f apply set, the `fountainrank-secrets.logto-db-url` secret (Logto's URL to the `logto` DB, with `sslmode=require`) is a **required 0f secret** — not Phase 2. What is **Phase 2**: connectors (Google/Apple/email), app registrations, admin-endpoint exposure, and seed/migrate-lifecycle refinement. (Logto has no "app secret" env var — its OIDC keys live in the DB after seed.)

---

### Task 1: Backend Dockerfile — non-root `USER` + `HEALTHCHECK`

Closes the item deferred out of Phase 0b ("required before the backend image ships"). This is the one locally-runnable, end-to-end-testable piece of 0e (build + run + observe health).

**Files:**
- Modify: `D:\repos\fountainrank\backend\Dockerfile` (runtime stage only)

**Interfaces:**
- Consumes: existing multi-stage Dockerfile (`base` → `deps` → `runtime`); the app serves `GET /healthz` (DB-free, returns `{"status":"ok"}`) on container port `8000`; the venv `python` is on `PATH` (`/app/.venv/bin`).
- Produces (relied on by Task 3 + Phase 0f): an image that runs as **non-root uid 1000** and reports Docker health via `/healthz`. The k8s manifests still use HTTP probes (k8s ignores Docker `HEALTHCHECK`), so this mainly hardens local/compose + Trivy posture.

- [ ] **Step 1: Read the current Dockerfile**

Read `D:\repos\fountainrank\backend\Dockerfile`. The runtime stage today is:

```dockerfile
FROM base AS runtime
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Rewrite the runtime stage with a non-root user + HEALTHCHECK**

Replace the runtime stage (from `FROM base AS runtime` to end of file) with:

```dockerfile
FROM base AS runtime
# Run as a non-root user (defense in depth; satisfies Trivy/CIS image policies).
# uid/gid 1000 — created before COPY so files land owned by the runtime user.
RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid app --home-dir /app --no-create-home app
COPY --from=deps --chown=app:app /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
COPY --chown=app:app app ./app
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app alembic.ini ./
USER app
EXPOSE 8000
# Liveness for Docker/compose. k8s uses its own HTTP probes (it ignores this).
# python (no curl in slim) hits the DB-free /healthz; any failure raises -> exit 1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3).status == 200 else 1)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Build the image (verify build succeeds as non-root)**

Run (Git Bash):
```bash
docker build -t fountainrank-backend:0e-hardening /d/repos/fountainrank/backend
```
Expected: build completes successfully (uv sync + COPY --chown succeed).

- [ ] **Step 4: Verify the container runs as non-root**

Run:
```bash
docker run --rm fountainrank-backend:0e-hardening id
```
Expected: `uid=1000(app) gid=1000(app) groups=1000(app)`.

- [ ] **Step 5: Verify the HEALTHCHECK reports healthy (no DB needed — `/healthz` is DB-free)**

Poll until healthy with a deadline (the healthcheck has `start-period=20s`/`interval=30s`, so a fixed short `sleep` can still show `starting`):
```bash
docker run -d --name fr-hc -p 8099:8000 fountainrank-backend:0e-hardening
for i in $(seq 1 24); do
  s=$(docker inspect --format '{{.State.Health.Status}}' fr-hc)
  echo "health=$s"; [ "$s" = "healthy" ] && break; sleep 5
done
curl -fsS http://localhost:8099/healthz; echo
docker rm -f fr-hc
```
Expected: `health=...` converges to `healthy` within the loop, then `{"status":"ok"}`.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile
git commit -m "build(backend): run image as non-root + add /healthz HEALTHCHECK"
```

---

### Task 2: Terraform skeleton (`infra/terraform/main.tf`)

**Files:**
- Create: `D:\repos\fountainrank\infra\terraform\main.tf`
- Create: `D:\repos\fountainrank\infra\terraform\README.md`
- Modify: `D:\repos\fountainrank\.gitignore` (append a Terraform block)

**Interfaces:**
- Consumes: the live DO account (`FountainRank` project, `fountainrank.com` domain, `fountainrank-terraform-state` bucket) — all referenced, not created; CI-supplied vars `do_token` / `spaces_access_id` / `spaces_secret_key`.
- Produces (relied on by Task 3 + Phase 0f): resource names + outputs that the manifests and deploy workflow consume — cluster `fountainrank-production-cluster`; registry endpoint `registry.digitalocean.com/fountainrank`; outputs `cluster_id`, `database_uri` (sensitive), `loadbalancer_ip`, `registry_endpoint`, `photos_bucket`, `pmtiles_bucket`, `pmtiles_cdn_endpoint`, `certificate_id`. SAN cert covers `fountainrank.com`, `www.`, `api.`, `auth.`.

- [ ] **Step 1: Write `infra/terraform/main.tf`**

`D:\repos\fountainrank\infra\terraform\main.tf`:

```hcl
# FountainRank infrastructure — DigitalOcean. Single-file template reused from the
# TherapyLink pattern, with the spec §15 divergences: DO Managed Postgres + PostGIS
# (not in-cluster Postgres), self-hosted Logto, and LB-managed Let's Encrypt TLS
# (no cert-manager).
#
# 🔴 APPLY ONLY FROM CI. Locally this is read-only: `terraform init -backend=false`
#    then `validate`/`fmt`. Never `plan` against the real backend, never apply/destroy/
#    import/state. See claude_help/kubernetes-infra.md.
#
# Phase 0e SKELETON — never applied. Before the first apply (Phase 0f, in CI):
#   (a) generate + commit a multi-platform provider lock (.terraform.lock.hcl);
#   (b) the shared RDL account uses DO's multiple-registries feature — confirm the
#       `fountainrank` registry does not already exist and `terraform import` it if it does;
#   (c) review every size/count default for cost.

terraform {
  required_version = ">= 1.6"

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }

  # S3-compatible state in DO Spaces. The bucket `fountainrank-terraform-state` (sfo3)
  # already exists. CI passes credentials via AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
  # (the Spaces keys). Locally use `terraform init -backend=false` (no state access).
  backend "s3" {
    bucket                      = "fountainrank-terraform-state"
    key                         = "fountainrank/terraform.tfstate"
    region                      = "us-east-1" # placeholder; ignored by Spaces
    endpoints                   = { s3 = "https://sfo3.digitaloceanspaces.com" }
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

provider "digitalocean" {
  token             = var.do_token
  spaces_access_id  = var.spaces_access_id
  spaces_secret_key = var.spaces_secret_key
}

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------
variable "do_token" {
  description = "DigitalOcean API token (CI secret DIGITALOCEAN_ACCESS_TOKEN)."
  type        = string
  sensitive   = true
}

variable "spaces_access_id" {
  description = "DigitalOcean Spaces access key (CI secret SPACES_ACCESS_KEY)."
  type        = string
  sensitive   = true
}

variable "spaces_secret_key" {
  description = "DigitalOcean Spaces secret key (CI secret SPACES_SECRET_KEY)."
  type        = string
  sensitive   = true
}

variable "project_name" {
  description = "Short name used in resource names and tags."
  type        = string
  default     = "fountainrank"
}

variable "environment" {
  description = "Environment label (the FountainRank DO project is a Production env)."
  type        = string
  default     = "production"
}

variable "region" {
  description = "Single DO region for cluster + DB + Spaces + LB (matches DO_REGION)."
  type        = string
  default     = "sfo3"
}

variable "domain" {
  description = "Apex domain — already DO-managed (NS delegated to DigitalOcean)."
  type        = string
  default     = "fountainrank.com"
}

variable "registry_name" {
  description = "Globally-unique DO Container Registry name (matches DO_REGISTRY)."
  type        = string
  default     = "fountainrank"
}

variable "kubernetes_version_prefix" {
  description = "DOKS version prefix; the latest matching patch is selected. DO offers 1.33-1.36."
  type        = string
  default     = "1.34."
}

variable "node_size" {
  description = "DOKS worker node size (minimal default; tune before first apply)."
  type        = string
  default     = "s-2vcpu-2gb"
}

variable "node_min" {
  description = "Autoscale floor for the worker pool."
  type        = number
  default     = 1
}

variable "node_max" {
  description = "Autoscale ceiling for the worker pool."
  type        = number
  default     = 3
}

variable "db_size" {
  description = "Managed Postgres size (minimal single-node default; tune before first apply)."
  type        = string
  default     = "db-s-1vcpu-1gb"
}

variable "db_node_count" {
  description = "Managed Postgres node count (db-s-1vcpu-1gb supports only 1)."
  type        = number
  default     = 1
}

# ---------------------------------------------------------------------------
# Data sources — pre-existing, owner-created (NOT managed here)
# ---------------------------------------------------------------------------
data "digitalocean_kubernetes_versions" "selected" {
  version_prefix = var.kubernetes_version_prefix
}

# The FountainRank project already exists (created during the DO bootstrap).
data "digitalocean_project" "main" {
  name = "FountainRank"
}

# Domain is already DO-managed. We add A records below; the owner's existing email
# records (MX / Google site-verification / DKIM, and any future SPF/DMARC) are NOT
# managed here.
data "digitalocean_domain" "main" {
  name = var.domain
}

# ---------------------------------------------------------------------------
# Kubernetes (DOKS)
# ---------------------------------------------------------------------------
resource "digitalocean_kubernetes_cluster" "main" {
  name         = "${var.project_name}-${var.environment}-cluster"
  region       = var.region
  version      = data.digitalocean_kubernetes_versions.selected.latest_version
  auto_upgrade = false

  node_pool {
    name       = "worker-pool"
    size       = var.node_size
    auto_scale = true
    min_nodes  = var.node_min
    max_nodes  = var.node_max
  }

  tags = [var.project_name, var.environment, "kubernetes"]
}

# ---------------------------------------------------------------------------
# Managed Postgres — PostGIS app DB + a separate Logto DB in the same cluster
# ---------------------------------------------------------------------------
resource "digitalocean_database_cluster" "postgres" {
  name       = "${var.project_name}-${var.environment}-db"
  engine     = "pg"
  version    = "17"
  size       = var.db_size
  region     = var.region
  node_count = var.db_node_count

  tags = [var.project_name, var.environment]
}

# Application database. PostGIS is enabled inside it by the backend's Alembic
# migration 0001_enable_postgis at deploy time (DO admin user has rights); DO has
# no Terraform-native "enable extension" resource.
resource "digitalocean_database_db" "app" {
  cluster_id = digitalocean_database_cluster.postgres.id
  name       = var.project_name
}

# Separate database for self-hosted Logto (mirrors the local-dev topology: a
# separate database in the same cluster). The Logto DB user/connection specifics
# (and the seed/migrate lifecycle on managed PG) are finalized in Phase 2.
resource "digitalocean_database_db" "logto" {
  cluster_id = digitalocean_database_cluster.postgres.id
  name       = "logto"
}

# ---------------------------------------------------------------------------
# Container Registry
# ---------------------------------------------------------------------------
# NOTE: the shared RDL account uses DO's multiple-registries feature. Before first
# apply, confirm `fountainrank` does not already exist; `terraform import` it if it does.
resource "digitalocean_container_registry" "main" {
  name                   = var.registry_name
  subscription_tier_slug = "basic" # >=2 repos (backend, web); starter allows only 1
  region                 = var.region
}

# ---------------------------------------------------------------------------
# Spaces — photos + pmtiles basemap (the TF-state bucket is NOT managed here)
# ---------------------------------------------------------------------------
resource "digitalocean_spaces_bucket" "photos" {
  name   = "${var.project_name}-photos"
  region = var.region
  acl    = "private" # served via signed URLs / CDN; not publicly listable

  lifecycle {
    prevent_destroy = true # user-generated content — never let an apply destroy it
  }
}

resource "digitalocean_spaces_bucket" "pmtiles" {
  name   = "${var.project_name}-pmtiles"
  region = var.region
  acl    = "public-read" # the Protomaps basemap is public, fetched directly by clients
}

# CDN in front of the public basemap bucket (lower latency; no per-load map cost).
resource "digitalocean_cdn" "pmtiles" {
  origin = digitalocean_spaces_bucket.pmtiles.bucket_domain_name
  ttl    = 3600
}

# ---------------------------------------------------------------------------
# TLS — LB-terminated Let's Encrypt SAN cert (apex / www / api / auth)
# ---------------------------------------------------------------------------
resource "digitalocean_certificate" "main" {
  name = "${var.project_name}-${var.environment}-cert"
  type = "lets_encrypt"
  domains = [
    var.domain,
    "www.${var.domain}",
    "api.${var.domain}",
    "auth.${var.domain}",
  ]

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Load Balancer — targets DOKS nodes; ingress-nginx listens on NodePorts 30080/30443
# ---------------------------------------------------------------------------
resource "digitalocean_loadbalancer" "main" {
  name   = "${var.project_name}-${var.environment}-lb"
  region = var.region
  size   = "lb-small"

  forwarding_rule {
    entry_protocol  = "http"
    entry_port      = 80
    target_protocol = "http"
    target_port     = 30080 # ingress-nginx HTTP NodePort
  }

  forwarding_rule {
    entry_protocol   = "https"
    entry_port       = 443
    target_protocol  = "https"
    target_port      = 30443 # ingress-nginx HTTPS NodePort
    certificate_name = digitalocean_certificate.main.name
  }

  healthcheck {
    protocol                 = "https"
    port                     = 30443
    path                     = "/healthz"
    check_interval_seconds   = 10
    response_timeout_seconds = 5
    healthy_threshold        = 3
    unhealthy_threshold      = 3
  }

  droplet_tag = "k8s:${digitalocean_kubernetes_cluster.main.id}"
}

# ---------------------------------------------------------------------------
# DNS A records — apex / www / api / auth -> LB IP. Email records are untouched.
# ---------------------------------------------------------------------------
resource "digitalocean_record" "apex" {
  domain = data.digitalocean_domain.main.id
  type   = "A"
  name   = "@"
  value  = digitalocean_loadbalancer.main.ip
  ttl    = 300
}

resource "digitalocean_record" "www" {
  domain = data.digitalocean_domain.main.id
  type   = "A"
  name   = "www"
  value  = digitalocean_loadbalancer.main.ip
  ttl    = 300
}

resource "digitalocean_record" "api" {
  domain = data.digitalocean_domain.main.id
  type   = "A"
  name   = "api"
  value  = digitalocean_loadbalancer.main.ip
  ttl    = 300
}

resource "digitalocean_record" "auth" {
  domain = data.digitalocean_domain.main.id
  type   = "A"
  name   = "auth"
  value  = digitalocean_loadbalancer.main.ip
  ttl    = 300
}

# ---------------------------------------------------------------------------
# Assign resources to the FountainRank DO project.
# DO project-resource supported URN types are: app, database, domain, droplet,
# floating IP, Kubernetes cluster, load balancer, Spaces bucket, volume. So we
# assign the cluster, DB, LB, both buckets, and the (pre-existing) domain — but
# NOT the container registry or certificate (account/region-scoped, not
# project-assignable). Assigning the domain only GROUPS it under the project; it
# does not manage or alter its DNS records.
# ---------------------------------------------------------------------------
resource "digitalocean_project_resources" "main" {
  project = data.digitalocean_project.main.id
  resources = [
    digitalocean_kubernetes_cluster.main.urn,
    digitalocean_database_cluster.postgres.urn,
    digitalocean_loadbalancer.main.urn,
    digitalocean_spaces_bucket.photos.urn,
    digitalocean_spaces_bucket.pmtiles.urn,
    data.digitalocean_domain.main.urn,
  ]
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
output "cluster_id" {
  description = "DOKS cluster UUID (used by the deploy workflow + kubectl context)."
  value       = digitalocean_kubernetes_cluster.main.id
}

output "cluster_name" {
  value = digitalocean_kubernetes_cluster.main.name
}

output "cluster_endpoint" {
  value     = digitalocean_kubernetes_cluster.main.endpoint
  sensitive = true
}

output "database_host" {
  value     = digitalocean_database_cluster.postgres.host
  sensitive = true
}

output "database_port" {
  value = digitalocean_database_cluster.postgres.port
}

output "database_uri" {
  description = "Default-DB connection URI (sensitive). App/Logto URLs derive from this."
  value       = digitalocean_database_cluster.postgres.uri
  sensitive   = true
}

output "loadbalancer_ip" {
  description = "LB public IP — the target of the four A records."
  value       = digitalocean_loadbalancer.main.ip
}

output "registry_endpoint" {
  value = digitalocean_container_registry.main.endpoint
}

output "photos_bucket" {
  value = digitalocean_spaces_bucket.photos.name
}

output "pmtiles_bucket" {
  value = digitalocean_spaces_bucket.pmtiles.name
}

output "pmtiles_cdn_endpoint" {
  value = digitalocean_cdn.pmtiles.endpoint
}

output "certificate_id" {
  value = digitalocean_certificate.main.id
}
```

- [ ] **Step 2: Append a Terraform block to `.gitignore`**

Read `D:\repos\fountainrank\.gitignore`, then append (do not duplicate existing lines):

```gitignore

# Terraform (infra/terraform) — never commit state, provider binaries, or tfvars.
infra/terraform/.terraform/
infra/terraform/*.tfstate
infra/terraform/*.tfstate.*
infra/terraform/*.tfvars
infra/terraform/*.tfvars.json
infra/terraform/*.tfplan
infra/terraform/crash.log
infra/terraform/crash.*.log
# Lock file: a LOCAL `init -backend=false` writes a single-platform (Windows) lock.
# Do NOT commit that — CI generates and commits the authoritative MULTI-platform lock
# in Phase 0f (`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64
# -platform=windows_amd64`). Un-ignore + commit it then.
infra/terraform/.terraform.lock.hcl
```

- [ ] **Step 3: `terraform fmt -check` (style)**

Run (Git Bash):
```bash
cd /d/repos/fountainrank/infra/terraform && terraform fmt -check -diff
```
Expected: no diff, exit 0. (If it reports a diff, run `terraform fmt` to fix, then re-run.)

- [ ] **Step 4: `terraform init -backend=false` (download the provider, no state access)**

Run:
```bash
cd /d/repos/fountainrank/infra/terraform && terraform init -backend=false
```
Expected: "Terraform has been successfully initialized!"; the `digitalocean` provider (`~> 2.0`) is installed. **No backend/state contact** (read-only).

- [ ] **Step 5: `terraform validate` (config + provider-schema check)**

Run:
```bash
cd /d/repos/fountainrank/infra/terraform && terraform validate
```
Expected: "Success! The configuration is valid." (validate is offline — it does not query DO; data sources are only read at plan/apply, which we never run locally.)

> **No provider lock is generated or committed in 0e.** Generating a multi-platform
> lock requires `terraform providers lock`, which is **outside** the local read-only
> ceiling (`fmt` / `init -backend=false` / `validate`). The single-platform lock that a
> local `init -backend=false` writes is gitignored (Step 2) and must not be committed.
> CI generates and commits the authoritative multi-platform lock in Phase 0f.

- [ ] **Step 6: Write `infra/terraform/README.md`**

`D:\repos\fountainrank\infra\terraform\README.md`:

````markdown
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

1. **Provider lock:** generate + commit the multi-platform lock in CI
   (`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=windows_amd64`),
   then un-ignore `.terraform.lock.hcl`. (It is gitignored until then — a local
   `init -backend=false` writes only a Windows-platform lock, which must not be committed.)
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
````

- [ ] **Step 7: Commit**

```bash
# NOTE: .terraform.lock.hcl is gitignored in 0e (see Step 2) — do not add it.
git add infra/terraform/main.tf infra/terraform/README.md .gitignore
git status --short   # confirm no .terraform/ or .terraform.lock.hcl is staged
git commit -m "feat(infra): add DigitalOcean Terraform skeleton (DOKS, managed PG, Spaces, LB, DNS, registry)"
```

---

### Task 3: Kubernetes manifests (`infra/k8s/`)

`envsubst`-templated raw YAML (house style). Placeholders substituted in CI:
`${NAMESPACE}`, `${ENVIRONMENT}`, `${IMAGE_TAG}`, `${REGISTRY}` (`registry.digitalocean.com/fountainrank`), `${DOMAIN}` (`fountainrank.com`).

**Files:**
- Create: `D:\repos\fountainrank\infra\k8s\namespace.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\secrets.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\registry-secret.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\backend.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\web.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\logto.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\ingress-nginx.yaml`
- Create: `D:\repos\fountainrank\infra\k8s\ingress.yaml`
- Create: `D:\repos\fountainrank\infra\README.md`

**Interfaces:**
- Consumes (from Task 2 + 0f): registry path `${REGISTRY}/fountainrank-backend` + `${REGISTRY}/fountainrank-web`; the `fountainrank-secrets` Opaque secret + `regcred` dockerconfig secret (populated by CI); ingress-nginx installed via Helm on NodePorts 30080/30443; the LB health check hitting `/healthz`.
- Produces (relied on by Phase 0f deploy workflow): Deployments `fountainrank-backend` / `fountainrank-web` / `logto`; Services `*-service`; the Ingress routing `api.`→backend, `auth.`→logto, apex/`www`→web, and a hostless `/healthz`→`healthz-service`; the required-0f secret-key contract `fountainrank-secrets.database-url` **and** `fountainrank-secrets.logto-db-url`; pull secret `regcred` (matches `imagePullSecrets`).

- [ ] **Step 1: `namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
  labels:
    name: ${NAMESPACE}
    app: fountainrank
    environment: ${ENVIRONMENT}
```

- [ ] **Step 2: `secrets.yaml` (📄 REFERENCE ONLY — documents the key contract; NOT applied)**

> **This file is never `kubectl apply`-ed.** Applying it would create/overwrite
> `fountainrank-secrets` with empty values and break (or erase) the real secret. It is
> committed only to document the key contract. **Phase 0f creates the secret imperatively**
> from GitHub Environment secrets + the Terraform DB outputs, with **both required keys**
> (`database-url` for the backend AND `logto-db-url` for Logto — both pods are in the 0f
> apply set), e.g.
> `kubectl create secret generic fountainrank-secrets -n "$NAMESPACE" --from-literal=database-url="$DATABASE_URL" --from-literal=logto-db-url="$LOGTO_DB_URL" --dry-run=client -o yaml | kubectl apply -f -`.
> It is **excluded from the `envsubst | kubectl apply` manifest loop** (see Step 9 / the deploy flow).

```yaml
# 📄 REFERENCE ONLY — NOT part of the kubectl apply manifest loop. Documents the key
# contract for `fountainrank-secrets`. CI creates this secret imperatively from the
# GitHub `production` environment secrets at deploy time (Phase 0f). DO NOT commit real
# values, and DO NOT `kubectl apply` this file (it would overwrite real values with empties).
apiVersion: v1
kind: Secret
metadata:
  name: fountainrank-secrets
  namespace: ${NAMESPACE}
  labels:
    app: fountainrank
type: Opaque
stringData:
  # REQUIRED in Phase 0f. Async SQLAlchemy URL to the Managed Postgres app DB
  # (postgresql+asyncpg://...). NOTE: asyncpg rejects libpq ?sslmode= — Managed-Postgres
  # SSL is applied in-app via connect_args (a BLOCKING Phase 0f pre-deploy change; see
  # infra/terraform/README.md).
  database-url: ""
  # REQUIRED in Phase 0f (logto.yaml is in the 0f apply set, so this must be present and
  # non-empty or the Logto pod crash-loops). Logto's libpq URL to its own `logto` database
  # in the same managed cluster, derived from the Terraform DB outputs — e.g.
  # postgres://<user>:<pass>@<host>:<port>/logto?sslmode=require (Managed Postgres needs SSL).
  # Logto's OIDC signing keys are generated + stored in the DB on seed, so there is no
  # separate "app secret" env var. Connectors / app registrations are Phase 2.
  logto-db-url: ""
```

- [ ] **Step 3: `registry-secret.yaml` (📄 REFERENCE ONLY — documents the pull secret; NOT applied)**

> **Never `kubectl apply`-ed.** An empty `.dockerconfigjson` is not a usable pull secret and
> would clobber a real `regcred`. **Phase 0f creates it imperatively.** The generated Secret
> name MUST equal the `imagePullSecrets[].name` the Deployments use (`regcred`), and the
> registry MUST be named explicitly (the shared account has multiple registries — in `doctl
> registry kubernetes-manifest`, `--name` is the *Secret* name, not the registry):
> `doctl registry kubernetes-manifest fountainrank --name regcred --namespace "$NAMESPACE" | kubectl apply -f -`.
> **Excluded from the `envsubst | kubectl apply` manifest loop.**

```yaml
# 📄 REFERENCE ONLY — NOT part of the kubectl apply manifest loop. Documents the DO
# Container Registry pull secret named `regcred` (matches imagePullSecrets in the
# Deployments). CI creates it imperatively, naming both the registry and the secret:
#   doctl registry kubernetes-manifest fountainrank --name regcred \
#     --namespace "$NAMESPACE" | kubectl apply -f -
# DO NOT commit real credentials, and DO NOT `kubectl apply` this empty placeholder.
apiVersion: v1
kind: Secret
metadata:
  name: regcred
  namespace: ${NAMESPACE}
  labels:
    app: fountainrank
type: kubernetes.io/dockerconfigjson
data:
  .dockerconfigjson: ""
```

- [ ] **Step 4: `backend.yaml` (Deployment + Service)**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fountainrank-backend
  namespace: ${NAMESPACE}
  labels:
    app: fountainrank-backend
    component: backend
spec:
  replicas: 1
  # Recreate-in-place on a small cluster: a single 256Mi pod can't surge alongside
  # its predecessor when no node has the headroom, so the default RollingUpdate
  # deadlocks (FailedScheduling). maxSurge 0 / maxUnavailable 1 tears the old pod
  # down first. The deploy gates on `kubectl rollout status` (not `wait --for=available`).
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: fountainrank-backend
  template:
    metadata:
      labels:
        app: fountainrank-backend
        component: backend
    spec:
      imagePullSecrets:
        - name: regcred
      containers:
        - name: backend
          image: ${REGISTRY}/fountainrank-backend:${IMAGE_TAG}
          ports:
            - containerPort: 8000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: database-url
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          startupProbe:
            httpGet:
              path: /healthz
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 30
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8000
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            # /readyz runs a PostGIS query — gates traffic on real DB connectivity.
            httpGet:
              path: /readyz
              port: 8000
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
---
apiVersion: v1
kind: Service
metadata:
  name: fountainrank-backend-service
  namespace: ${NAMESPACE}
  labels:
    app: fountainrank-backend
spec:
  selector:
    app: fountainrank-backend
  ports:
    - port: 80
      targetPort: 8000
      protocol: TCP
  type: ClusterIP
```

- [ ] **Step 5: `web.yaml` (Deployment + Service)**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fountainrank-web
  namespace: ${NAMESPACE}
  labels:
    app: fountainrank-web
    component: web
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: fountainrank-web
  template:
    metadata:
      labels:
        app: fountainrank-web
        component: web
    spec:
      imagePullSecrets:
        - name: regcred
      containers:
        - name: web
          # The web image + its Dockerfile land in Phase 0f.
          image: ${REGISTRY}/fountainrank-web:${IMAGE_TAG}
          ports:
            - containerPort: 3000
          env:
            # NOTE: NEXT_PUBLIC_* is inlined at BUILD time, not read at runtime. The
            # real value must be passed as a build arg when the web image is built
            # (Phase 0f). This runtime env only helps server-side reads.
            - name: NEXT_PUBLIC_API_BASE_URL
              value: "https://api.${DOMAIN}"
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
---
apiVersion: v1
kind: Service
metadata:
  name: fountainrank-web-service
  namespace: ${NAMESPACE}
  labels:
    app: fountainrank-web
spec:
  selector:
    app: fountainrank-web
  ports:
    - port: 80
      targetPort: 3000
      protocol: TCP
  type: ClusterIP
```

- [ ] **Step 6: `logto.yaml` (Deployment + Service — topology only; Phase 2 finalizes auth)**

```yaml
# Self-hosted Logto. This manifest is in the Phase 0f apply set, so a healthy topology
# requires the `fountainrank-secrets.logto-db-url` secret (Logto's URL to its own `logto`
# DB) to be present + non-empty at deploy time — it is a REQUIRED Phase 0f secret. What
# stays Phase 2: connectors (Google/Apple/email), app registrations, admin-endpoint
# exposure, and any seed/migrate-lifecycle refinement. ENDPOINT must be the real public
# URL in prod (an unset/incorrect ENDPOINT 500s — logto-io/logto#6755).
apiVersion: apps/v1
kind: Deployment
metadata:
  name: logto
  namespace: ${NAMESPACE}
  labels:
    app: logto
    component: auth
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: logto
  template:
    metadata:
      labels:
        app: logto
        component: auth
    spec:
      containers:
        - name: logto
          image: svhd/logto:1.40.1
          command: ["sh", "-c", "npm run cli db seed -- --swe && npm start"]
          ports:
            - containerPort: 3001 # app/OIDC
            - containerPort: 3002 # admin
          env:
            - name: DB_URL
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: logto-db-url
            - name: ENDPOINT
              value: "https://auth.${DOMAIN}"
            - name: PORT
              value: "3001"
            - name: ADMIN_PORT
              value: "3002"
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          readinessProbe:
            tcpSocket:
              port: 3001
            initialDelaySeconds: 20
            periodSeconds: 10
            failureThreshold: 6
          livenessProbe:
            tcpSocket:
              port: 3001
            initialDelaySeconds: 40
            periodSeconds: 15
            failureThreshold: 4
---
apiVersion: v1
kind: Service
metadata:
  name: logto-service
  namespace: ${NAMESPACE}
  labels:
    app: logto
spec:
  selector:
    app: logto
  ports:
    - name: app
      port: 80
      targetPort: 3001
      protocol: TCP
  type: ClusterIP
```

- [ ] **Step 7: `ingress-nginx.yaml` (📄 documentation of the Helm install — NOT applied)**

> ingress-nginx is installed by **Helm** in the Phase 0f deploy workflow, **not** by
> `kubectl apply`. This file is committed documentation of the exact command (so the
> install is reviewable + reproducible). It contains **no Kubernetes objects** — a
> standalone `nginx-configuration` ConfigMap would be orphaned (the stock chart manages
> its own ConfigMap via `controller.config.*`), so the forwarded-header settings are
> passed as Helm `--set controller.config.*` values instead. `--create-namespace`
> creates the `ingress-nginx` namespace. NodePorts are pinned to match the Terraform
> LB forwarding rules (30080 http / 30443 https). **Excluded from the apply loop.**

```yaml
# ingress-nginx is installed via Helm in the Phase 0f deploy workflow (NOT via kubectl
# apply). NodePorts are pinned to the Terraform LB forwarding rules (30080/30443), and
# forwarded-header behavior is set via controller.config.* (the chart's own ConfigMap):
#
#   helm upgrade --install ingress-nginx ingress-nginx \
#     --repo https://kubernetes.github.io/ingress-nginx \
#     --namespace ingress-nginx --create-namespace \
#     --set controller.service.type=NodePort \
#     --set controller.service.nodePorts.http=30080 \
#     --set controller.service.nodePorts.https=30443 \
#     --set controller.config.use-forwarded-headers="true" \
#     --set controller.config.compute-full-forwarded-for="true" \
#     --set controller.config.use-proxy-protocol="false"
```

- [ ] **Step 8: `ingress.yaml` (host routes + healthz-service for the LB health check)**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: fountainrank-ingress
  namespace: ${NAMESPACE}
  annotations:
    # TLS is terminated at the DO Load Balancer; force https via X-Forwarded-Proto.
    nginx.ingress.kubernetes.io/use-forwarded-headers: "true"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "25m"
  labels:
    app: fountainrank
spec:
  ingressClassName: nginx
  # No TLS section — the DO Load Balancer holds the Let's Encrypt cert.
  rules:
    # Hostless rule — matches any Host NOT matched by the host rules below. The DO LB
    # health-checks https NodePort 30443 path /healthz with a Host that is NOT one of our
    # app hostnames (it uses the node/LB target), so /healthz must resolve host-independently
    # to a 200, or the LB marks every node unhealthy before any app traffic works.
    - http:
        paths:
          - path: /healthz
            pathType: Prefix
            backend:
              service:
                name: healthz-service
                port:
                  number: 80
    - host: api.${DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: fountainrank-backend-service
                port:
                  number: 80
    - host: auth.${DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: logto-service
                port:
                  number: 80
    - host: ${DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: fountainrank-web-service
                port:
                  number: 80
    - host: www.${DOMAIN}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: fountainrank-web-service
                port:
                  number: 80
---
# Tiny always-200 /healthz target for the LB health check (host-independent;
# the LB probes https NodePort 30443 path /healthz regardless of Host header).
apiVersion: v1
kind: Service
metadata:
  name: healthz-service
  namespace: ${NAMESPACE}
  labels:
    app: healthz
spec:
  selector:
    app: healthz
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
  type: ClusterIP
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: healthz
  namespace: ${NAMESPACE}
  labels:
    app: healthz
spec:
  replicas: 1
  selector:
    matchLabels:
      app: healthz
  template:
    metadata:
      labels:
        app: healthz
    spec:
      containers:
        - name: healthz
          image: nginx:alpine
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: healthz-config
              mountPath: /etc/nginx/conf.d/default.conf
              subPath: nginx.conf
          resources:
            requests:
              memory: "16Mi"
              cpu: "10m"
            limits:
              memory: "32Mi"
              cpu: "50m"
      volumes:
        - name: healthz-config
          configMap:
            name: healthz-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: healthz-config
  namespace: ${NAMESPACE}
data:
  nginx.conf: |
    server {
        listen 8080;
        server_name _;
        location /healthz {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
        location / {
            return 404;
        }
    }
```

- [ ] **Step 9: Validate every manifest renders + is schema-valid (cluster-independent)**

Do **not** use `kubectl apply --dry-run=client` — in this environment it reaches the live
cluster for OpenAPI (the kubeconfig points at a real DO cluster) and is neither offline nor
cluster-free. Use a placeholder-substitution check (always works) + **`kubeconform`** schema
validation (cluster-independent).

First ensure `kubeconform` is available (it is not installed by default):
```bash
command -v kubeconform || go install github.com/yannh/kubeconform/cmd/kubeconform@latest
# (or download the release binary from github.com/yannh/kubeconform/releases and put it on PATH)
```

Then render + validate:
```bash
cd /d/repos/fountainrank/infra/k8s
export NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test \
       REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com
for f in namespace.yaml secrets.yaml registry-secret.yaml backend.yaml web.yaml logto.yaml ingress-nginx.yaml ingress.yaml; do
  echo "== $f =="
  rendered="$(envsubst < "$f")"
  # 1) every placeholder must be substituted (no '${' left)
  echo "$rendered" | grep -q '\${' && { echo "FAILED: unsubstituted placeholder in $f"; break; }
  # 2) schema-valid (ingress-nginx.yaml renders to zero objects — that's fine)
  echo "$rendered" | kubeconform -strict -summary -kubernetes-version 1.34.0 - \
    || { echo "FAILED schema: $f"; break; }
done
```
Expected: no unsubstituted placeholders; `kubeconform` reports all resources valid (0 errors)
for each file. (`kubeconform` validates against bundled/remote JSON schemas — it never
contacts a cluster.) **If `kubeconform` cannot be installed locally**, the placeholder check is
the mandatory local gate and the authoritative schema validation is the Phase 0f CI step —
say so explicitly, do not silently skip it.

> **Apply set vs. reference/Helm-only:** the Phase 0f `envsubst | kubectl apply` loop applies
> **only** `namespace.yaml`, `backend.yaml`, `web.yaml`, `logto.yaml`, `ingress.yaml`.
> `secrets.yaml` + `registry-secret.yaml` are reference-only (CI creates those secrets
> imperatively); `ingress-nginx.yaml` is Helm-install documentation (no objects).

- [ ] **Step 10: Write `infra/README.md`**

`D:\repos\fountainrank\infra\README.md`:

````markdown
# infra

Infrastructure-as-code for FountainRank. **Applies happen only in CI** (Phase 0f);
locally everything here is read-only / dry-run (see `claude_help/kubernetes-infra.md`).

- **`terraform/`** — single-file DO config (DOKS, Managed Postgres + PostGIS + a
  separate Logto DB, Spaces photos/pmtiles + CDN, LB + LE SAN cert, DNS A records,
  registry), assigned to the `FountainRank` project. See `terraform/README.md`.
- **`k8s/`** — raw YAML templated with `envsubst` (substituted in CI). The deploy
  **`kubectl apply` set** is `namespace.yaml`, `backend.yaml`, `web.yaml`, `logto.yaml`,
  `ingress.yaml`. The rest are **not** applied directly:
  - `secrets.yaml` + `registry-secret.yaml` — 📄 reference only (document the key
    contract). CI creates these secrets **imperatively** from GitHub Environment secrets +
    the Terraform DB outputs. Required keys in `fountainrank-secrets`: `database-url` (app)
    and `logto-db-url` (Logto). E.g.
    `kubectl create secret generic fountainrank-secrets -n "$NAMESPACE" --from-literal=database-url="$DATABASE_URL" --from-literal=logto-db-url="$LOGTO_DB_URL" --dry-run=client -o yaml | kubectl apply -f -`
    and `doctl registry kubernetes-manifest fountainrank --name regcred --namespace "$NAMESPACE" | kubectl apply -f -`
    (the Secret name `regcred` must match `imagePullSecrets`). Applying the committed
    placeholders would overwrite real secrets with empties.
  - `ingress-nginx.yaml` — 📄 documents the **Helm** install command (NodePort 30080/30443
    + `controller.config.*`); ingress-nginx is Helm-installed, not `kubectl apply`-ed.

## envsubst variables

| Variable | Example | Source |
|---|---|---|
| `${NAMESPACE}` | `fountainrank` | deploy workflow |
| `${ENVIRONMENT}` | `production` | deploy workflow |
| `${IMAGE_TAG}` | git SHA | build job |
| `${REGISTRY}` | `registry.digitalocean.com/fountainrank` | `DO_REGISTRY` |
| `${DOMAIN}` | `fountainrank.com` | deploy workflow |

## Deploy flow (CI, Phase 0f)

`doctl auth` → `doctl kubernetes cluster kubeconfig save <cluster>` →
`helm upgrade --install ingress-nginx … (NodePort 30080/30443)` → create secrets
imperatively (`fountainrank-secrets`, `regcred`) → `envsubst < manifest | kubectl apply -f -`
for the apply set → `kubectl rollout status`. Migrations run via `kubectl exec` into the
backend pod (`alembic upgrade head`).

## Local validation (read-only — never apply)

```bash
# Terraform
cd terraform && terraform fmt -check && terraform init -backend=false && terraform validate
# k8s manifests — placeholder check + kubeconform (NOT kubectl dry-run, which hits the cluster)
cd k8s && export NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test \
  REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com
for f in *.yaml; do
  r="$(envsubst < "$f")"
  echo "$r" | grep -q '\${' && echo "UNSUBSTITUTED in $f"
  echo "$r" | kubeconform -strict -summary -kubernetes-version 1.34.0 -
done
```
````

- [ ] **Step 11: Commit**

```bash
git add infra/k8s infra/README.md
git commit -m "feat(infra): add envsubst k8s manifests (backend, web, logto, ingress, secrets)"
```

---

### Task 4: Documentation + push

**Files:**
- Modify: `D:\repos\fountainrank\README.md` (add infra rows to Software Versions + a short Infrastructure note)
- Modify: `D:\repos\fountainrank\claude_help\kubernetes-infra.md` (add the read-only local-validate workflow + pre-apply checklist pointer)

**Interfaces:**
- Consumes: the files created in Tasks 1–3.
- Produces: docs that let a fresh instance run the read-only checks and understand the 0e deliverables; `origin/main` updated.

- [ ] **Step 1: Add infra rows to the README Software Versions table**

In `D:\repos\fountainrank\README.md`, in the Software Versions table (after the `ruff` row, before the `(full pins)` row), add:

```markdown
| Terraform | 1.12.2 (pin `>= 1.6`) | 2026-06-17 |
| DigitalOcean TF provider | `~> 2.0` | 2026-06-17 |
| DOKS (Kubernetes) | 1.34.x (DO offers 1.33–1.36) | 2026-06-17 |
| Logto (self-hosted) | 1.40.1 | 2026-06-17 |
```

- [ ] **Step 2: Add a short Infrastructure subsection to the README**

In `D:\repos\fountainrank\README.md`, after the "Getting started" section and before "Contributing & security", add:

```markdown
## Infrastructure

Infrastructure-as-code lives in [`infra/`](infra/README.md): Terraform for the
DigitalOcean stack (DOKS, Managed Postgres + PostGIS, Spaces, Load Balancer +
Let's Encrypt TLS, DNS, registry) and `envsubst`-templated Kubernetes manifests.
**Applies and deploys happen only in CI** — locally these are read-only
(`terraform validate`; `envsubst` + `kubeconform` for manifests). See
[`claude_help/kubernetes-infra.md`](claude_help/kubernetes-infra.md).
```

- [ ] **Step 3: Add the read-only local workflow to the infra spoke**

In `D:\repos\fountainrank\claude_help\kubernetes-infra.md`, under the "Hard safety rules" section's first bullet (local Terraform read-only), append a short paragraph documenting the exact local commands and pointing at the `infra/terraform/README.md` pre-apply checklist:

```markdown

**Local read-only commands (the only ones allowed locally):**
`terraform fmt -check`, `terraform init -backend=false`, `terraform validate`
(Terraform); for k8s manifests, render with `envsubst` and validate with
`kubeconform` (cluster-independent) — **not** `kubectl apply --dry-run=client`, which
in this environment reaches the live cluster for OpenAPI. The first-apply
reconciliation steps (provider lock, registry import, sizing, the blocking
asyncpg-SSL backend change) are in `infra/terraform/README.md`.
```

- [ ] **Step 4: Verify the full read-only suite one more time, then commit**

```bash
cd /d/repos/fountainrank/infra/terraform && terraform fmt -check && terraform validate && echo "TF OK"
cd /d/repos/fountainrank/infra/k8s && export NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com
for f in *.yaml; do r="$(envsubst < "$f")"; echo "$r" | grep -q '\${' && echo "UNSUBST $f"; echo "$r" | kubeconform -strict -summary -kubernetes-version 1.34.0 - >/dev/null && echo "OK $f" || echo "FAIL $f"; done
git -C /d/repos/fountainrank add README.md claude_help/kubernetes-infra.md
git -C /d/repos/fountainrank commit -m "docs: document the infra skeleton + read-only local IaC workflow"
```

- [ ] **Step 5: Push the milestone**

```bash
git -C /d/repos/fountainrank push origin main
```
Expected: all Phase 0e commits land on `origin/main`.

---

## Self-Review (run by the plan author before handoff to Codex)

1. **Spec §15 coverage:**
   - `digitalocean_project` assignment → Task 2 `digitalocean_project_resources`. ✓
   - DOKS cluster → Task 2. ✓
   - Managed Postgres + PostGIS + separate Logto DB → Task 2 (`database_cluster` + two `database_db`; PostGIS via Alembic, noted). ✓
   - Spaces (photos + pmtiles; state bucket excluded) + CDN → Task 2. ✓
   - LB + LE SAN cert (apex/www/api/auth) → Task 2. ✓
   - DNS records → Task 2 (four A records; email records untouched). ✓
   - Registry → Task 2. ✓
   - State in Spaces (S3 backend) → Task 2 backend block. ✓
   - k8s: namespace, backend, web, Logto (Deploy/Service/Ingress route), ingress-nginx, ingress routes, secrets from env → Task 3. ✓
   - Deferred Dockerfile non-root USER + HEALTHCHECK → Task 1. ✓
2. **Placeholder scan:** every code/HCL/YAML block is complete and literal; verification commands have expected output. No "TBD"/"add error handling"/"similar to Task N". ✓
3. **Name consistency:** `fountainrank-secrets` keys `database-url` (consumed in `backend.yaml`) and `logto-db-url` (consumed in `logto.yaml`) are both documented as required-0f keys in the secret body, the Step 2 header example, the Decisions bullets, and `infra/README.md`; the `regcred` pull secret name matches `imagePullSecrets[].name` in both Deployments and the `doctl … --name regcred` command; registry path `${REGISTRY}/fountainrank-backend` + `-web` consistent across backend/web manifests and the README versions/registry note; NodePorts 30080/30443 match the Terraform LB rules and the ingress-nginx Helm note. ✓
4. **Hard-rule compliance:** no `apply`/`plan`-against-backend/`kubectl apply`/`providers lock`/`import`; local ceiling is `fmt`/`init -backend=false`/`validate` (Terraform) + `envsubst`+`kubeconform` (manifests); no secrets/.env committed (the secret manifests are reference-only and excluded from the apply loop); the provider lock is gitignored in 0e and generated in CI; direct-to-main commits. ✓
5. **Codex review-1 fixes folded in:** secret manifests are reference-only/imperative (BLOCKER); `/healthz` is a hostless Ingress rule for the LB health check (MAJOR); `kubeconform`/placeholder-check replaces the non-offline `kubectl --dry-run=client` (MAJOR); asyncpg-SSL is an explicit blocking Phase 0f pre-deploy gate, not Phase 1 (MAJOR); `providers lock` removed from local steps, lock gitignored until CI (MAJOR); domain URN added to project assignment (MINOR); ingress-nginx config moved to Helm `controller.config.*`, orphan ConfigMap dropped (MINOR); "plan-clean locally" wording removed (MINOR); Dockerfile health check polled with a deadline (NIT). ✓
6. **Codex review-2 fixes folded in:** the `regcred` pull secret is created with `doctl registry kubernetes-manifest fountainrank --name regcred --namespace "$NAMESPACE"` so the Secret name matches `imagePullSecrets` and the registry is explicit (MAJOR); `logto-db-url` is reclassified as a **required Phase 0f secret** (logto.yaml is in the 0f apply set), the bogus `logto-app-secret` placeholder is removed (Logto keeps OIDC keys in the DB), and the secret/Decisions/README/logto-comment all state both `database-url` + `logto-db-url` are required 0f keys (MAJOR). ✓
