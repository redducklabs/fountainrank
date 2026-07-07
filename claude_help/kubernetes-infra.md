# Kubernetes & Infrastructure

FountainRank runs on **DigitalOcean Kubernetes (DOKS)**, provisioned with
Terraform and deployed via GitHub Actions. See spec §15 for the full design.

## Hard safety rules

- **Local Terraform is READ-ONLY:** `init`, `validate`, `fmt`, `plan` only.
  **NEVER** run `apply`, `destroy`, `import`, or `state` against real
  infrastructure locally. All applies happen in CI.

  **Local read-only commands (the only ones allowed locally):**
  `terraform fmt -check`, `terraform init -backend=false`, `terraform validate`, and
  `terraform providers lock -platform=...` (Terraform). `providers lock` only contacts
  the provider registry — no backend/state/cloud access — so it is read-only against
  infrastructure and safe locally (it is how the committed multi-platform
  `.terraform.lock.hcl` is generated). For k8s manifests, render with `envsubst` and
  validate with `kubeconform` (cluster-independent) — **not** `kubectl apply
  --dry-run=client`, which in this environment reaches the live cluster for OpenAPI. The first-apply
  reconciliation steps (provider lock, registry import, sizing, the blocking
  asyncpg-SSL backend change) are in `infra/terraform/README.md`.

- **NEVER** run `kubectl apply` / `helm upgrade` against a cluster by hand.
  Deployment is CI-only (idempotent, represents desired state).
- **ALWAYS** verify context before any kubectl read:
  1. `kubectl config current-context`
  2. `kubectl config use-context do-<region>-<cluster-name>`
  3. `kubectl config current-context` (confirm)
  Never use `--set-current-context` (it changes context globally).
- Resource removal to unblock CI is the only exception, and must be confirmed
  with the user first, followed by an IaC update.

## Layout

- `infra/terraform/` — DigitalOcean provider; provisions the DOKS cluster, the
  **Managed Postgres cluster (with PostGIS, plus a separate database for Logto)**,
  a Spaces bucket (photos + `pmtiles` + Terraform state), the Load Balancer with
  an **LB-terminated Let's Encrypt certificate**, DNS records, and the container
  registry. State is stored in DO Spaces (S3 backend).
- `infra/k8s/` — raw YAML templated with `envsubst` (substituted in CI): the
  backend, the web app, **Logto** (its own Deployment + Service + Ingress route),
  `ingress-nginx`, ingress routes, and secrets created at deploy time from GitHub
  Environment secrets.

## Deploy flow (CI)

**Deploy is a manual CI action — merging to `main` does NOT deploy.**
`deploy.yml` triggers only on a `v*.*.*` **tag push** or **`workflow_dispatch`**;
routine pushes/merges to `main` run CI/CodeQL/security but ship nothing. After a
squash-merge, deploy from CI (never locally):

```bash
gh workflow run deploy.yml --ref main
gh run list --workflow=deploy.yml --limit 1   # grab the run id
gh run watch <id> --interval 30               # exit 0 = success (DOKS rollout + DB migrations)
```

Then run the unauthenticated post-deploy smoke (`/readyz` + home → 200). The
deploy job itself: `digitalocean/action-doctl` auth → `doctl kubernetes cluster
kubeconfig save <cluster>` → `envsubst < manifest | kubectl apply -f -` →
`kubectl rollout status`. Migrations run via `kubectl exec` into the backend pod
(`alembic upgrade head`). Rollouts gate on `rollout status` (small cluster — tune
`maxSurge`/`maxUnavailable` accordingly), not `wait --for=available`.

## Terraform apply discipline (CI only) — plan first, read the whole blast radius

Applies run in CI via `terraform.yml` (`workflow_dispatch`, `action=apply`, gated
on the `production` env). **Always `plan` first and read the ENTIRE plan — not
just the resource you changed.** A count-gated resource that is live in state is a
silent-destroy trap: a routine apply can plan `N to destroy` on infra you never
touched. (This bit us once on the basemap Spaces gate — since removed via
Terraform `moved` blocks so the basemap is now unconditional infra.)

**🔴 Changing the DOKS `node_size` is `ForceNew` and RECREATES THE WHOLE CLUSTER
— it is not a rolling node resize.** DO node-pool droplet size is immutable, and
`node_size` feeds the cluster's mandatory inline default pool, so `terraform
apply` plans `1 to add, 1 to destroy` on the cluster resource. Treat any
`node_size` change as a **planned maintenance event**: a full outage while the new
(empty) cluster comes up, then **re-run `deploy.yml`** to repopulate it. The
Load Balancer IP / DNS / cert survive (only the cluster resource is replaced) and
the **managed Postgres DB is external and untouched** — there are **no PVCs
in-cluster** (all Deployments; only emptyDir/Secret/ConfigMap volumes), so nothing
durable lives on the nodes. Kubeconfig is saved by stable cluster **name**, so CI
keeps working across the recreate.

## Divergences from the TherapyLink template

This project reuses TherapyLink's single-file Terraform pattern but deliberately:
(a) uses **DO Managed Postgres + PostGIS** instead of in-cluster Postgres; (b)
adds **Logto**; (c) keeps **LB-managed Let's Encrypt** TLS (cert-manager is not
used).
