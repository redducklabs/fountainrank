# 01 — DigitalOcean

Provisions the cloud account and credentials FountainRank deploys onto: DOKS
(Kubernetes), Managed Postgres + PostGIS (app DB + a separate Logto DB), Spaces
(photos, `pmtiles` basemap, **and** Terraform state), the Load Balancer with
LB-terminated Let's Encrypt TLS, and the Container Registry.

> **Important — who creates what.** The DOKS cluster, database cluster, Spaces
> buckets, load balancer, certificate, DNS records, and registry are all created
> by **Terraform in CI** (plan 0e/0f), *not* by hand. Per
> `claude_help/kubernetes-infra.md`, we never click these into existence or run
> a state-mutating `apply` locally. **Your job in this guide is only to create
> the _account-level credentials_ Terraform needs**: the API token, the Spaces
> access keys, and the Terraform-state bucket those keys will write to.
>
> The two exceptions you create manually are called out below (Spaces keys and
> the state bucket) because Terraform's own state has to live *somewhere* before
> Terraform runs.

**Unblocks:** plan 0f CI/CD and the first live deploy.

---

## ✅ Status — completed 2026-06-17

The account-level bootstrap in this guide is **done** (Red Duck Labs DO account,
`FountainRank` project):

- **Region:** `sfo3` (co-located with the rest of the RDL fleet + the managed
  Postgres). Stored as the `DO_REGION` GitHub variable.
- **Terraform-state bucket:** `fountainrank-terraform-state` (sfo3), private,
  assigned to the `FountainRank` project.
- **CI Spaces key:** `fountainrank-gh-key`, **scoped `readwrite` to the state
  bucket only** (least privilege; verified end-to-end with a PUT/LIST/GET/DELETE
  probe). App-bucket (`photos`/`pmtiles`) grants get added in 0e once their
  names are final.
- **GitHub `production` environment** created with secrets
  `DIGITALOCEAN_ACCESS_TOKEN`, `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY` and
  variables `DO_REGISTRY=fountainrank`, `DO_REGION=sfo3`.

> **✅ Resolved 2026-06-17 — CI DO token replaced.** The
> `DIGITALOCEAN_ACCESS_TOKEN` `production` secret now holds a **dedicated CI
> PAT** (it replaced the local-`.env` bootstrap token). Its validity gets
> exercised for real by the first CI deploy job in **plan 0f**. If the bootstrap
> token in local `.env` is no longer needed, revoke it in the DO console. To
> rotate later:
> `gh secret set DIGITALOCEAN_ACCESS_TOKEN --env production --repo redducklabs/fountainrank`
> (paste/pipe the new value — never commit it).

> **Note for 0e:** the DO API only allows `permission=fullaccess` on an
> *account-wide* grant (`bucket=`), not on a single bucket — per-bucket grants
> must be `read`/`readwrite`. A `readwrite` key cannot **create** a bucket, so
> the state bucket was created with a throwaway account-wide key that was then
> deleted. For the app buckets, Terraform will need a key whose grants cover
> those bucket names (created at the time, then their grants pinned).

---

## Prerequisites

- A DigitalOcean account with billing enabled.
- `doctl` is optional for you — CI uses it. You can do everything here in the
  web console (<https://cloud.digitalocean.com>).

---

## Step 1 — Create a Personal Access Token (API token)

1. Console → **API** (left nav) → **Tokens** → **Generate New Token**.
2. Name it `fountainrank-ci`.
3. Scopes: grant **Read** and **Write** (Terraform needs to create clusters,
   databases, load balancers, DNS, and the registry). Full read/write is
   expected for an IaC token.
4. Set an expiry you'll rotate on (e.g. the longest allowed), and **copy the
   token now** — it's shown only once.

→ This becomes the `DIGITALOCEAN_ACCESS_TOKEN` GitHub secret.

## Step 2 — Create Spaces access keys

Spaces is DO's S3-compatible object store. We use it for photos, the Protomaps
`pmtiles` basemap, **and** the Terraform state backend (S3-compatible).

1. Console → **API** → **Spaces Keys** → **Generate New Key**.
2. Name it `fountainrank-spaces`.
3. Copy both the **Access Key** and the **Secret Key** (secret shown once).

→ These become `SPACES_ACCESS_KEY` and `SPACES_SECRET_KEY`.

## Step 3 — Create the Terraform-state Spaces bucket (manual, one-time)

Terraform stores its state in Spaces (S3 backend). The bucket that *holds* the
state must exist before Terraform first runs, so create this one by hand.

1. Console → **Spaces Object Storage** → **Create a Spaces Bucket**.
2. **Region:** `sfo3` (chosen to co-locate with the existing RDL clusters +
   managed Postgres; pinned in Terraform). **Record the region.**
3. **Name:** `fountainrank-terraform-state` (matches the RDL
   `<project>-terraform-state` convention; globally unique).
4. Leave it **private** (no public file listing). Do not enable a CDN on this
   bucket.

> The **application** Spaces buckets (photos, `pmtiles`) are created by
> Terraform — do **not** create those here.

→ Record the **bucket name** and **region** for the Terraform backend config.

## Step 4 — Note the region & registry name (no creation needed)

- **Region:** the single region for cluster + DB + Spaces + LB. Record it; it
  feeds Terraform and the `kubectl` context name
  (`do-<region>-<cluster-name>`).
- **Container Registry name:** the registry itself is created by Terraform, but
  its **name must be globally unique** across all of DO. Reserve a name now:
  `fountainrank` (if taken, e.g. `fountainrank-rdl`). Record your choice — it
  becomes `DO_REGISTRY`.

---

## What Terraform will create later (FYI — do not do these by hand)

So you know what's coming and can sanity-check the eventual bill:

- **DOKS cluster** (small node pool to start).
- **Managed Postgres cluster** with the **PostGIS** extension, plus a
  **separate database inside it for Logto**.
- **Spaces buckets** for photos and the `pmtiles` basemap (+ CDN).
- **Load Balancer** with an **LB-managed Let's Encrypt** SAN cert covering
  apex, `www`, `api`, and `auth`.
- **DNS records** (if the domain's nameservers point at DO — see `02-dns.md`).
- **Container Registry** named per Step 4.

---

## Outputs to record

| Value | Becomes | Destination |
|---|---|---|
| API token (`fountainrank-ci`) | `DIGITALOCEAN_ACCESS_TOKEN` | GitHub Env **secret** |
| Spaces access key | `SPACES_ACCESS_KEY` | GitHub Env **secret** |
| Spaces secret key | `SPACES_SECRET_KEY` | GitHub Env **secret** |
| TF-state bucket name (`fountainrank-terraform-state`) | TF backend config | recorded |
| Region (`sfo3`) | `DO_REGION` + kubectl context | GitHub Env **variable** |
| Registry name (`fountainrank`) | `DO_REGISTRY` | GitHub Env **variable** |

**Hand me:** the region, the TF-state bucket name, and the registry name (these
are not secrets and I need them to write the Terraform backend + 0f workflows).
**You keep / set yourself:** the API token and Spaces keys — paste them into
GitHub Environment secrets per `05-github.md`.

---

## Security notes

- The API token is **full read/write** to your DO account — treat it like a
  root password. It lives only in GitHub Environment secrets, never in the repo.
- Rotate the token and Spaces keys on a schedule; regenerate immediately if ever
  exposed.
- Keep the TF-state bucket **private** — state can contain sensitive values.
