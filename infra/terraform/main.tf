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
