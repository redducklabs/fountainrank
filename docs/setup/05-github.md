# 05 — GitHub (security features, Environments, secrets, runners)

Wires the credentials from the other guides into CI/CD and turns on the
repo-level security features the project requires. Repo: `redducklabs/fountainrank`
(public).

**Unblocks:** plan 0f CI/CD (every deploy job reads these) and the security
posture the spec mandates.

> The **workflow files** (CI, security audit, gated deploy/terraform) are added
> by plan 0f. This guide is the **repo-settings + secrets** half that only an
> owner can do.

> **Status (Phase 0f landed, 2026-06-18):** the repo security features below are
> **confirmed enabled** (`gh api … --jq '.security_and_analysis'`: secret scanning,
> push protection, Dependabot alerts + security updates; vulnerability alerts on).
> CI provides: CodeQL (**default setup** — see Step 1), Trivy (fs gate on secrets +
> report-only image scans), `pip-audit`/`pnpm audit` (daily), Dependabot version PRs.
> What's still owner-only: creating the `production` Environment secret **values**
> (`DATABASE_URL`, `LOGTO_DB_URL`, `DATABASE_CA_CERT`) before the first live deploy.

---

## Step 1 — Enable security features

**Settings → Code security** (a.k.a. "Code security and analysis"). Enable:

- **Dependabot alerts** + **Dependabot security updates**.
- **Secret scanning** + **Push protection** (blocks pushing a detected secret —
  critical for a public repo).
- **Code scanning / CodeQL** — **default setup is enabled** and is what Phase 0f
  uses (analyzes `python` + `javascript-typescript` + `actions`, weekly). Plan 0f
  deliberately did **not** add an advanced `codeql.yml` — it would conflict with
  default setup (mutually exclusive), and default setup is broader + zero-maintenance.
- Confirm **Private vulnerability reporting** is on (pairs with `SECURITY.md`).

These can also be checked via `gh`:

```bash
gh api repos/redducklabs/fountainrank --jq '.security_and_analysis'
```

## Step 2 — Confirm runner access

CI uses the self-hosted runner label **`redducklabs-runners`** for no-secret
jobs; secret-handling deploy jobs run on `ubuntu-latest` (blast-radius split,
per `claude_help/testing-ci.md`).

- Verify (org admin) that **`redducklabs/fountainrank` is allowed to use the
  `redducklabs-runners` runner group**: Org **Settings → Actions → Runner
  groups** → ensure the repo is in the group's repository access list.
- If the repo can't see the runners, deploy/lint jobs will queue forever — fix
  this before 0f.

## Step 3 — Create Environments

**Settings → Environments → New environment.** Create:

- **`production`** — add **required reviewers** (yourself) and optionally
  restrict to the `main` branch, so deploys gate on a human click.
- **`staging`** (optional now) — looser protection for pre-prod.

Scope secrets/variables **per environment** so prod and staging can differ.

## Step 4 — Add secrets & variables

For each environment: **Environment → Add secret / Add variable**. Use the names
from `docs/setup/README.md`'s master inventory. Set values as they become
available (you don't need them all at once — 0e/0f tell you when each is read).

**Secrets** (sensitive):

| Name | From |
|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | `01-digitalocean.md` |
| `SPACES_ACCESS_KEY` / `SPACES_SECRET_KEY` | `01-digitalocean.md` |
| `DATABASE_URL` | DO Managed Postgres (0e/0f) |
| `LOGTO_DB_URL` | DO Managed Postgres / Logto DB (0e/0f) |
| `DATABASE_CA_CERT` | DO Managed Postgres CA PEM (`doctl databases get <id>` / console) — mounted as `database-ca.crt` for the backend's asyncpg verify-full TLS |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `03-google-cloud.md` |
| `LOGTO_*` (endpoint/app/secret as needed) | `06-logto.md` |

**Variables** (non-sensitive):

| Name | From |
|---|---|
| `DO_REGISTRY` | `01-digitalocean.md` |
| `CLUSTER_NAME` | Terraform output (0e/0f) |
| `GOOGLE_WORKSPACE_DOMAIN` / `GOOGLE_DELEGATED_USER` | `03-google-cloud.md` |
| `FROM_EMAIL` / `BASE_URL` | `02` / per-environment |

Setting a secret via `gh` (example — run it yourself; the value is never
committed):

```bash
gh secret set DIGITALOCEAN_ACCESS_TOKEN --env production --repo redducklabs/fountainrank
# (prompts for the value; or pipe from your password manager's CLI)
```

```bash
gh variable set DO_REGISTRY --env production --body "fountainrank" --repo redducklabs/fountainrank
```

---

## Outputs to record

There are no new credentials produced here — this guide **consumes** the others.
What I need from you:

- Confirmation that **security features are on** (push protection especially).
- Confirmation that **`redducklabs-runners` is accessible** to this repo.
- The **environment names** you created (`production`, and `staging` if any) so
  0f's workflows target them correctly.

---

## Security notes

- **Never** paste a secret value into the repo, a PR, an issue, or these docs —
  only into the Environment **secret** store. Push protection is your backstop,
  not a substitute for care.
- Put real deploy credentials behind **`production` with required reviewers** so
  a deploy can't fire unattended.
- Prefer **environment** secrets over repo-wide secrets so staging can't read
  production credentials.
