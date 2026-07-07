# GitHub Environments & Secrets

How CI/CD configuration and secrets are organized. The workflows and the
`production` environment are live (`ci.yml`, `deploy.yml`, `terraform.yml`,
`basemap-upload.yml`, `mobile-store-release.yml`, `security-audit.yml`); this is
the convention they follow.

## Principles

- **No secrets in the repo.** All credentials live in **GitHub Environment
  secrets** (and are injected into the cluster as Kubernetes secrets at deploy
  time). The repo only ever references secret **names**, never values.
- Per-environment config (e.g. `staging`, `production`) via GitHub Environments,
  with required reviewers/protection on production where appropriate.
- Non-secret config goes in repo/environment **variables**, not secrets.

## Secret names (by convention)

| Name | Purpose |
|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | doctl/Terraform auth to DigitalOcean |
| `DO_REGISTRY` | DO container registry name |
| `CLUSTER_NAME` | DOKS cluster name (resolved to id by `doctl`) |
| `SPACES_ACCESS_KEY` / `SPACES_SECRET_KEY` | DO Spaces (photos, pmtiles, TF state) |
| `DATABASE_URL` | Managed Postgres connection (app) |
| `LOGTO_DB_URL` | Managed Postgres database for Logto |
| `LOGTO_*` | Logto app endpoints/credentials consumed by web/mobile/backend |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Gmail-API sending (Workspace delegation) |
| `FROM_EMAIL` / `BASE_URL` | email sender + link base |

## The `production` environment has no branch policy

The `production` GitHub environment has **no `deployment_branch_policy`** (it is
`null`), so a `workflow_dispatch` from **any branch** — not just `main` — can
access its secrets (`SPACES_*`, `DIGITALOCEAN_ACCESS_TOKEN`, etc.). The practical
upshot: you can verify an infra/workflow change **on its feature branch before
merging** (e.g. `gh workflow run basemap-upload.yml --ref feat/...`) rather than
being forced to merge-then-dispatch. Verify with
`gh api repos/redducklabs/fountainrank/environments/production --jq '.deployment_branch_policy'`
→ `null`; re-check before relying on it, since branch protection can change.

## Runner placement

CI jobs are split by secret exposure — see `testing-ci.md`. Secret-handling
(Class B) jobs run on `ubuntu-latest`; no-secret (Class A) jobs run on
`redducklabs-runners`.
