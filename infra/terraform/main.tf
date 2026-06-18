# FountainRank infrastructure — DigitalOcean. Single-file template reused from the
# TherapyLink pattern, with the spec §15 divergences: DO Managed Postgres + PostGIS
# (not in-cluster Postgres), self-hosted Logto, and LB-managed Let's Encrypt TLS
# (no cert-manager).
#
# 🔴 APPLY ONLY FROM CI. Locally this is read-only: `terraform init -backend=false`
#    then `validate`/`fmt`. Never `plan` against the real backend, never apply/destroy/
#    import/state. See claude_help/kubernetes-infra.md.
#
# First applied 2026-06-18 (Phase 0f). State of the prerequisites:
#   (a) multi-platform provider lock (.terraform.lock.hcl) — committed. ✅
#   (b) container registry — NOT managed by Terraform (provider uses the legacy
#       single-registry endpoint, incompatible with this account's multiple registries);
#       `fountainrank` is created out-of-band via /v2/registries. See below. ✅
#   (c) sizing/cost reviewed (cheapest defaults, owner-approved). ✅
#   (d) Spaces buckets deferred (scoped key can't create them) — see below.
#   (e) 🔴 DNSSEC must be OFF on the domain or DO refuses the LE cert (422) — the
#       owner removed the GoDaddy DS record on 2026-06-18.

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
# Container Registry — NOT managed by Terraform on this account.
# ---------------------------------------------------------------------------
# The shared RDL account uses DO's "multiple registries" feature. The DO Terraform
# provider's `digitalocean_container_registry` resource still targets the LEGACY
# single-registry endpoint (`POST /v2/registry`), which returns 422 "invalid
# subscription plan" on a multiple-registries account — so Terraform cannot create
# or import it. The `fountainrank` registry is created out-of-band via the
# `/v2/registries` API (see infra/terraform/README.md) and referenced everywhere by
# the `DO_REGISTRY` CI variable. `var.registry_name` is retained for documentation.

# ---------------------------------------------------------------------------
# Spaces — photos + pmtiles basemap: DEFERRED (not managed here yet).
# ---------------------------------------------------------------------------
# These buckets are only needed in Phase 3 (pmtiles basemap) / Phase 4 (photos), and
# the current `SPACES_ACCESS_KEY` is scoped to only the TF-state bucket (it returns
# 403 AccessDenied when creating new buckets). They will be added back with a
# bucket-create-capable key (or created out-of-band) when those phases land. The
# TF-state bucket is NOT managed here either.

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
# assign the cluster, DB, LB, and the (pre-existing) domain — but NOT the container
# registry or certificate (account/region-scoped, not project-assignable), and NOT
# the Spaces buckets (deferred — see above). Assigning the domain only GROUPS it
# under the project; it does not manage or alter its DNS records.
# ---------------------------------------------------------------------------
resource "digitalocean_project_resources" "main" {
  project = data.digitalocean_project.main.id
  resources = [
    digitalocean_kubernetes_cluster.main.urn,
    digitalocean_database_cluster.postgres.urn,
    digitalocean_loadbalancer.main.urn,
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

# NOTE: registry endpoint, Spaces bucket names, and the CDN endpoint outputs were
# removed — the registry is managed out-of-band and the buckets are deferred (see above).
# The registry endpoint is `registry.digitalocean.com/${DO_REGISTRY}` (a CI variable).

output "certificate_id" {
  value = digitalocean_certificate.main.id
}
