# External Setup & Credentials — Owner Runbook

This folder is the **operator runbook** for everything that must be created
outside the repo: cloud accounts, OAuth clients, DNS, email sending, and the
GitHub secrets that wire them into CI/CD. It is written so **Aron can work
through it independently** while implementation continues in parallel.

> **Source of truth:** spec §19 (External setup & registrations checklist) in
> `docs/specs/2026-06-16-architecture-and-foundation-design.md`, plus the
> `claude_help/oauth-sso.md`, `claude_help/email.md`,
> `claude_help/github-environments.md`, and `claude_help/kubernetes-infra.md`
> spokes. This runbook turns that checklist into click-by-click steps.

---

## 🔴 Golden rules (read once, never break)

- **No secret value ever goes in this repo.** Not in these docs, not in code,
  not in a committed `.env`. The repo references secret **names** only. Values
  live in **GitHub Environment secrets** and (at deploy time) Kubernetes
  secrets, or in Logto's own config.
- When a step produces a value, **record it in your own private store** (a
  password manager / secure note), then paste it into the destination listed in
  that guide's **Outputs to record** table — never into a file under
  `D:\repos\fountainrank`.
- Cloud-console UIs change. These guides describe the **stable conceptual
  steps and the exact outputs needed**; button labels may differ slightly from
  what you see. If a screen doesn't match, tell me what you see and I'll adjust.
- When you finish a guide, **hand me the "Outputs to record" values you're
  comfortable sharing** (IDs, names, domains — not raw secrets) so I can wire
  the config. For true secrets, you set them in GitHub/Logto yourself; I only
  need the **names** to exist.

---

## When each piece is actually needed (priority)

You do **not** have to do all of this at once. Order by what unblocks the next
milestone:

| Guide | Unblocks | Start now? |
|---|---|---|
| `01-digitalocean.md` | 0f CI/CD + first live deploy | ✅ Yes — account + API token are quick and gate everything cloud |
| `02-dns.md` | TLS cert issuance + email deliverability + auth subdomain | ✅ Yes — DNS + DMARC propagation is slow |
| `03-google-cloud.md` | Phase 2 auth (Google sign-in) **and** all auth email | ✅ Yes — OAuth consent verification + Workspace delegation are slow |
| `04-apple-and-app-stores.md` | Phase 2 auth (Apple sign-in) + store submission | ⚠️ Start the **paid enrollments** now (slow approval); the rest later |
| `05-github.md` | 0f CI/CD (every deploy job) | ✅ Repo security features now; secrets as each value lands |
| `06-logto.md` | Phase 2 auth end-to-end | ⏳ Later — needs Logto deployed (0e) and OAuth clients (03/04) first |

**Bottom line:** the highest-leverage things to start today are the **paid /
slow-approval** items — Apple Developer Program enrollment, Google Play Console
enrollment, Google Workspace domain-wide delegation, the OAuth consent screen,
and DNS/DMARC records — because they involve external review or propagation
delays that nothing in the codebase can shorten.

---

## Master secret inventory

Every credential the system consumes, what produces it, and its destination.
Names match `claude_help/github-environments.md`; some are finalized in plan 0f
(marked **TBD-0f**) and some only exist once Logto is deployed (**TBD-Logto**).

| Secret / value name | Produced in | Destination | Status |
|---|---|---|---|
| `DIGITALOCEAN_ACCESS_TOKEN` | `01-digitalocean.md` | GitHub Env secret | ✅ set (`production`) — dedicated CI PAT (replaced bootstrap 2026-06-17) |
| `SPACES_ACCESS_KEY` / `SPACES_SECRET_KEY` | `01-digitalocean.md` | GitHub Env secret | ✅ set (`production`), scoped readwrite to TF-state bucket |
| `DO_REGISTRY` | `01-digitalocean.md` | GitHub Env **variable** | ✅ set (`fountainrank`) |
| `DO_REGION` | `01-digitalocean.md` | GitHub Env **variable** | ✅ set (`sfo3`) |
| `CLUSTER_NAME` | `01-digitalocean.md` / Terraform | GitHub Env **variable** | TBD-0f |
| `DATABASE_URL` | DO Managed Postgres (Terraform) | GitHub Env secret | TBD (first deploy) |
| `LOGTO_DB_URL` | DO Managed Postgres (Logto DB) | GitHub Env secret | TBD (first deploy) |
| `DATABASE_CA_CERT` | DO Managed Postgres CA PEM (`doctl databases get`) | GitHub Env secret → mounted `database-ca.crt` | TBD (first deploy) — backend asyncpg verify-full TLS |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `03-google-cloud.md` | GitHub Env secret | Ready to create |
| `GOOGLE_WORKSPACE_DOMAIN` | `03-google-cloud.md` | GitHub Env **variable** | Ready to create |
| `GOOGLE_DELEGATED_USER` | `03-google-cloud.md` | GitHub Env **variable** | Ready to create |
| `FROM_EMAIL` | `02-dns.md` / `03-google-cloud.md` | GitHub Env **variable** | Ready to create |
| `BASE_URL` | decided per environment | GitHub Env **variable** | TBD-0f |
| Google OAuth client id/secret (web/iOS/Android) | `03-google-cloud.md` | **Logto** Google connector | Ready to create |
| Apple Services ID / Team ID / Key ID / `.p8` key | `04-apple-and-app-stores.md` | **Logto** Apple connector | Ready to create |
| `LOGTO_ENDPOINT` / `LOGTO_APP_ID` / `LOGTO_APP_SECRET` (web) | `06-logto.md` | GitHub Env secret + web config | TBD-Logto |
| Logto native app id, M2M app id/secret | `06-logto.md` | mobile config / backend | TBD-Logto |

> **Variable vs. secret:** non-sensitive identifiers (region, cluster name,
> registry name, sending domain, base URL) are GitHub **variables**; anything
> that grants access (tokens, passwords, connection strings, private keys, the
> service-account JSON) is a **secret**.

---

## Progress checklist

Tick these off as you go (edit this file, or just tell me and I'll update it):

- [x] **DigitalOcean** — account, API token, Spaces keys, registry name, TF-state bucket, `production` env secrets/vars (`01`) — done 2026-06-17 (region `sfo3`)
- [ ] **DNS** — domain control confirmed; apex/www/api/auth records planned; SPF/DKIM/DMARC (`02`)
- [ ] **Google Cloud** — project, OAuth consent screen, web/iOS/Android OAuth clients (`03`)
- [ ] **Google Workspace** — service account + domain-wide delegation for Gmail sending (`03`)
- [ ] **Apple** — Developer Program enrolled; App ID; Sign in with Apple (Services ID + key) (`04`)
- [ ] **Google Play** — Console account enrolled (`04`)
- [x] **GitHub** — security features enabled (secret scanning + push protection, Dependabot alerts/updates, vulnerability alerts — confirmed 2026-06-18); CI/security workflows landed (0f). Remaining: set the first-deploy secret values `DATABASE_URL`/`LOGTO_DB_URL`/`DATABASE_CA_CERT` in the `production` env (`05`)
- [ ] **Logto** — app registrations + connectors (after Logto is deployed) (`06`)

---

## How this connects to the build

- **0e (infra Terraform)** consumes the DigitalOcean and DNS outputs.
- **0f (CI/CD)** consumes the GitHub secrets/variables.
- **Phase 2 (auth)** consumes the Google/Apple OAuth outputs and the Logto
  registrations.
- The Gmail service account + Workspace delegation powers **all** transactional
  email (Logto magic link/verification, and any future app email).
