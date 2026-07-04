# DOKS worker nodes right-sized s-2vcpu-2gb → s-2vcpu-4gb — DEPLOYED & VERIFIED (2026-07-04)

Self-contained handoff. Picked up from `handoffs/2026-07-04-mobile-doctor-fixed-and-doks-node-sizing.md` §2
(the node right-sizing recommendation) and executed it end-to-end: PR → Codex → CI → squash-merge →
Terraform apply (via CI) → `deploy.yml` redeploy → live verification. **Owner authorized the full run
including the destructive apply** (no active users; data-safety confirmed first).

`main` HEAD: `1b31c23 chore(infra): right-size DOKS worker nodes s-2vcpu-2gb -> s-2vcpu-4gb (#173)`.

---

## 1. What shipped — PR #173

One-line Terraform change: `infra/terraform/main.tf` `variable "node_size"` default
`s-2vcpu-2gb` → **`s-2vcpu-4gb`** (2→4 GB RAM, 60→80 GB disk; autoscale `1→3` unchanged), plus a
prominent ForceNew warning comment. Gates: CI green (all checks) · Codex `VERDICT: APPROVED`
(round 2; artifacts `temp/codex-reviews/pr-173-review-{1,2}.md`) · every PR comment addressed.

**Why:** node1 (`worker-pool-3c75eg`) tripped DO's 70% disk alert (stale `fountainrank-web` image
tags on the 60 GB fs, not data growth; `DiskPressure: False`), and both 2 GB nodes were ~90%
RAM-committed (node1 91% req / 133% lim). RAM was the tighter constraint; the plan bump fixes both.

## 2. 🔴 The critical correction Codex caught (and the approach it forced)

The prior handoff (and PR v1) called this a "rolling node replacement." **Wrong.** `node_size` feeds
the **inline default `node_pool`** of `digitalocean_kubernetes_cluster.main`, whose `size` the DO
provider marks **`ForceNew`** — DO node-pool droplet size is immutable (no in-place resize; confirmed
by a synthetic `terraform plan`, DO's "Can I resize a DOKS node?" doc, and provider docs). So
`terraform apply` plans **`1 to add, 1 to destroy`** on the cluster — a **full destroy-and-recreate**.

The mandatory inline default pool also **can't be removed** (a cluster needs exactly one) nor
**scaled to 0** (private preview), so the separate-`digitalocean_kubernetes_node_pool` workaround
leaves a permanent idle residual node. Owner chose the **deliberate recreate-as-maintenance-event**
path instead (early stage, no active users). **No data loss** — verified before applying:
- Postgres/PostGIS is a DO **Managed Database** (`digitalocean_database_cluster.postgres`), separate
  resource, not in the plan; its own storage + DO backups.
- **No PVCs** anywhere in `infra/k8s` (all Deployments; only emptyDir/Secret/ConfigMap volumes).
- No `digitalocean_database_firewall`/trusted-sources tying DB access to the specific cluster.
- LB public IP / DNS A records / cert survive (only the cluster resource is replaced; LB updated
  in place). `deploy.yml` saves kubeconfig by the **stable cluster name**, so CI still works.

## 3. ⚠️ Landmine hit during apply — `manage_basemap_spaces` MUST be `true`

The first `plan` (with the input's default `manage_basemap_spaces=false`) showed
`Plan: 1 to add, 2 to change, 4 to destroy` — the 3 extra destroys were the **live basemap Spaces
bucket (planet `.pmtiles`), CDN, and CORS** (`*.basemap[0]`). They're gated behind
`count = var.manage_basemap_spaces ? 1 : 0`; the var **defaults `false`** but the resources **exist
in state** from a prior apply. Re-planning with **`manage_basemap_spaces=true`** gave the clean
`1 to add, 2 to change, 1 to destroy` (cluster replace + LB/project in-place, basemap preserved).
**Every future apply must pass `manage_basemap_spaces=true`** (memory:
`fountainrank-terraform-basemap-gate-landmine`). Proper fix TBD (flip the default / reconcile the gate).

## 4. Apply sequence (all via CI — never local)

1. `terraform.yml action=apply manage_basemap_spaces=true` — old cluster destroyed, **new cluster
   created** (`fb82e8b9-edf6-4cd2-9d09-0bd6b93e7c1c`, 4m23s), LB updated. Failed on the LAST
   resource: `digitalocean_project_resources.main` → `404 could not find cluster` (benign
   eventual-consistency — cluster too new for the project-assign API; purely DO-console grouping).
2. **Re-dispatched the same apply** to reconcile → `Apply complete! 0 added, 1 changed, 0 destroyed`
   (project assignment retried, succeeded). State fully converged.
3. `deploy.yml --ref main` — rebuilt/pushed images, installed ingress-nginx, applied namespace +
   secrets + workloads, ran DB migrations (idempotent), all rollouts green (2m29s).

## 5. Verification (live)

- `https://fountainrank.com/` + `www` → 200 · `https://api.fountainrank.com/healthz` → 200 ·
  `https://auth.fountainrank.com/` (Logto) → 200. (Apex `/healthz` 404 is expected — backend/LB route.)
- `GET /readyz` → `{"status":"ok","postgis_version":"3.6 ...","sf_to_nyc_m":4140025.16...}` — live
  PostGIS query → backend↔managed-DB round-trip confirmed.
- `GET /api/v1/rating-types` → real reference data · `GET /api/v1/fountains/sitemap` → 200, **729 KB**
  → all imported fountains intact. **Zero data loss.**

## 6. Follow-ups (unchanged from prior handoff §3, still outstanding)

- **Reconcile the `manage_basemap_spaces` gate** so a default apply is safe (flip default to `true`
  or gate on actual state) — new, from §3 above.
- Optional cluster hygiene: install **metrics-server** (`kubectl top` / HPA), pod anti-affinity /
  topology-spread so app pods aren't all on one node.
- **Resubmit sitemap in GSC + Bing** (owner-local; now includes the fountains chunk).
- **Slice 1e** — coverage report/gate (spec §4.2/§7); backend-heavy, no new public routes.
- **#128 GA4** — owner-local (GA4 property id in SEO registry; `seo_health_check` until ok).
- Dependabot **#151** (frontend-js) & **#138** (backend-python).

## 7. Env gotchas (carried forward)

Codex review is bypass-mode (`sandbox: danger-full-access`, `approval-policy: never`) with
`cwd=/mnt/d/repos/fountainrank` + repo-relative paths. Terraform is **read-only locally**
(`init -backend=false`/`fmt`/`validate`); all applies via CI. Deploy = `gh workflow run deploy.yml
--ref main` (manual dispatch; merge to main does NOT deploy). See
`handoffs/2026-07-04-seo-slice5-shipped-handoff.md` §5 for the full detail.
