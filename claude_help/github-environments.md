# GitHub Environments & Secrets

How CI/CD configuration and secrets are organized. The concrete workflows and
environment definitions land in plan 0f; this is the convention.

## Principles

- **No secrets in the repo.** All credentials live in **GitHub Environment
  secrets** (and are injected into the cluster as Kubernetes secrets at deploy
  time). The repo only ever references secret **names**, never values.
- Per-environment config (e.g. `staging`, `production`) via GitHub Environments,
  with required reviewers/protection on production where appropriate.
- Non-secret config goes in repo/environment **variables**, not secrets.

## Expected secret names (illustrative — finalized in 0f)

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

## Runner placement

CI jobs are split by secret exposure — see `testing-ci.md`. Secret-handling
(Class B) jobs run on `ubuntu-latest`; no-secret (Class A) jobs run on
`redducklabs-runners`.
