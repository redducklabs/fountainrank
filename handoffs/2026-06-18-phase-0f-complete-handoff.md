# Handoff — FountainRank (Phase 0f complete; resume at Phase 1)

**Date:** 2026-06-18
**From:** In-repo Claude session (Phase 0f CI/CD + security)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec and continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-18-phase-0e-complete-handoff.md` (still accurate for Phase 0a–0e history + the DigitalOcean bootstrap + local-dev 302x ports + pending external registrations, which are not repeated here).

---

## TL;DR

**Phase 0f (CI/CD + security) is done and pushed to `main`. All CI is green; the final
whole-branch review (opus) returned "Ready to merge: Yes" with no Critical/Important code
defects.** This was the last Phase-0 phase — **the repo now has CI, so from here on work
goes on a branch → PR → CI green + Codex APPROVED → squash-merge** (no more direct-to-main).

The 0f implementation is commits `5f81b87`…`725c7a9` (16 commits) on top of the plan commit
`d44faf5`. **This handoff commit is the current `main` HEAD** — run `git log --oneline -20`
to confirm the tip. **Local == `origin/main`; tree clean apart from the pre-existing
untracked/owner-modified `docs/setup/04-apple-and-app-stores.md` (your open IDE file —
left untouched) and `docs/logos/`.**

**Next:** **Phase 1** (data model + fountains API).

> **⚡ UPDATE — the first live apply + deploy was DONE on 2026-06-18; the system is LIVE.**
> Infra provisioned on DOKS (cluster + Managed Postgres + LB + verified LE cert + DNS),
> the `fountainrank` registry created, the `production` DB secrets set, and the app
> deployed (tag `v0.1.1`). All four pods Ready; live over HTTPS:
> `https://api.fountainrank.com/healthz`=200, `/readyz`=200 (PostGIS 3.6, TLS to Managed PG),
> `https://fountainrank.com`/`www`=200, `https://auth.fountainrank.com`=302 (Logto). See the
> "First live deploy" section below for what was done, the deviations, and remaining hardening.
> The "🔴 First-live-apply prerequisites" section further down is now historical (all cleared).

---

## Read these first (in order)

1. `CLAUDE.md` — operating-rules hub (points to all `claude_help/*` spokes).
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — approved whole-system design.
3. `docs/plans/2026-06-18-phase-0f-cicd-and-security.md` — the just-executed plan (Codex Loop A
   approved; reviews in `temp/codex-reviews/phase-0f-plan-review-{1..3}.md`). It records the
   in-flight deviations (below) inline.
4. Prior handoffs (`…phase-0e/0d/0b-complete-handoff.md`) for earlier history — unchanged.
5. The relevant `claude_help/*.md` spoke for whatever you're about to do.

---

## What landed in 0f

- **`backend/app/{config,db}.py` + `tests/test_db_ssl.py`** (`5f81b87`) — asyncpg TLS. `Settings.db_ssl_root_cert`
  (env `DB_SSL_ROOT_CERT`); `engine_connect_args()` returns `{}` locally (plaintext) or
  `{"ssl": ssl.create_default_context(cafile=…)}` (verify-full) in prod. Wired into `create_async_engine`.
- **`.github/workflows/ci.yml`** (`7b03d53`,`0d5bbce`) — PR/push checks on `redducklabs-runners`, three jobs
  mirroring `run.ps1 check`: `backend` (postgis service on **5436**, no `DATABASE_URL` override → uses the
  default URL, like `run.ps1`), `workspace-js` (workspace-wide `turbo lint typecheck test` + `format:check` +
  web build — enforces mobile lint/typecheck too), `mobile-doctor` (expo-doctor). Plus `.github/actionlint.yaml`
  registering the `redducklabs-runners` self-hosted label.
- **`.github/workflows/security-audit.yml`** (`69588f4`,`a489146`,`e882285`) — push/PR/daily. Gates: `pip-audit`
  (`uv export --no-hashes` → `uvx pip-audit --no-deps --strict`), `pnpm audit --audit-level high`, `trivy fs`
  **secret** gate. Report-only (SARIF, `ignore-unfixed`): `trivy fs` vuln/misconfig + an `image-scan` job that
  builds **both** images and Trivy-scans them (push+daily, not PRs).
- **CodeQL = GitHub default setup** (no `codeql.yml`) — analyzes python + javascript-typescript + actions, weekly.
- **`.github/dependabot.yml`** (`7253f65`) — grouped weekly: **`uv`** (`/backend`), `npm` (`/`), `github-actions`.
  (Already opened PRs **#1** gha checkout v6→v7, **#2** uv backend group, **#3** npm frontend group — left open for
  owner review; merging them is out of 0f scope.)
- **`.github/workflows/deploy.yml`** (`2d4648d`) — **GATED, not fired.** Build/push to DOCR + DOKS deploy. Triggers
  on `push: tags: ['v*.*.*']` + `workflow_dispatch`. Class B on `ubuntu-latest`, `environment: production`.
  Secrets via `env:`; CA PEM written to a temp file + `--from-file`; **migrations run before gating rollout**
  (selecting the new pod by `version=$IMAGE_TAG` label); both images Trivy-scanned report-only.
- **`infra/k8s/backend.yaml` + `secrets.yaml`** (`2d4648d`) — the asyncpg-SSL deploy contract: a `db-ca` volume
  from `fountainrank-secrets.database-ca.crt` mounted at `/var/run/secrets/fountainrank`, `DB_SSL_ROOT_CERT` set
  to it, and a `version: ${IMAGE_TAG}` pod-template label (selector stays immutable `app: fountainrank-backend`).
- **`.github/workflows/terraform.yml`** (`f13787b`) — **GATED.** PR `fmt`/`validate` on `infra/terraform/**`
  (Class A); `plan`/`apply` via `workflow_dispatch` only (Class B, `production`).
- **`web/Dockerfile` + root `.dockerignore` + compose `web` service** (`e882285`,`3bc9507`) — multi-stage pnpm
  build from repo root, listens on **3000**. Controller-verified: `docker build` + `docker run` → homepage **HTTP 200**
  + `docker compose build web`.
- **`infra/terraform/.terraform.lock.hcl`** (`dea43e2`) — committed multi-platform lock (linux_amd64, darwin_arm64,
  windows_amd64, **windows_386**); `.gitignore` un-ignores it. Retires the 0e "provider lock" prerequisite.
- **Governance** (`bc87b2a`) — `.github/CODEOWNERS` (`* @aronweiler`), PR template, 3 issue templates, and an
  **actionlint pre-commit hook** (`pre-commit run actionlint --all-files` passes on all 4 workflows).
- **Repo security settings** — confirmed already enabled (secret scanning + push protection, Dependabot
  alerts/security updates, vulnerability alerts). Docs: `docs/setup/05-github.md` + `README.md` updated.
- **Docs** (`725c7a9`) — README CI + Security-audit badges + a CodeQL "default setup" badge to the code-scanning
  page; Software Versions rows; `claude_help/testing-ci.md` parity note.

---

## Deviations from the plan (all reviewed/approved; the plan was updated inline)

- **CodeQL:** plan specced an advanced `codeql.yml`; owner approved **keeping GitHub default setup** (broader,
  zero-maintenance) — advanced would conflict (mutually exclusive). No `codeql.yml` exists.
- **`aquasecurity/trivy-action@v0.36.0`** (the `v`-prefixed tag; bare `0.36.0` does not exist — version research
  was wrong). Fixed everywhere.
- **ci.yml backend job** publishes postgres on **5436** with **no `DATABASE_URL` override** (the plan's draft used
  5432 + an override, which broke `test_config`'s `:5436/` default assertion). Now mirrors `run.ps1` exactly.
- **Root `.dockerignore`** added — a root-context build was dragging host `node_modules` into the image →
  `next build` `MODULE_NOT_FOUND`. (The plan's `web/.dockerignore` is ineffective for a root-context build.)
- **pip-audit** uses `uv export --no-hashes` + `pip-audit --no-deps` (the hashed export caused a cross-platform
  greenlet hash mismatch in pip's installer).

---

## First live deploy — DONE (2026-06-18). System is LIVE.

The full apply + deploy ran the same day. What happened (so a fresh instance knows the real state):

**Infra (DOKS, sfo3):** DOKS cluster `fountainrank-production-cluster` + Managed Postgres `fountainrank-production-db`
(`db-s-1vcpu-1gb`, single node) with `fountainrank` + `logto` databases; LB `fountainrank-production-lb`
(IP `146.190.0.127`); LE SAN cert **verified** (apex/www/api/auth); four A records → LB. Provisioned via
`terraform.yml` (workflow_dispatch `apply`). State is in the `fountainrank-terraform-state` Spaces bucket.

**Three first-apply failures and how they were cleared (see commits + PR #4/#5):**
1. **Registry** — the DO provider can't manage registries on this multiple-registries account. Removed from
   Terraform (PR #4); `fountainrank` registry created out-of-band via `POST /v2/registries`
   (`subscription_tier_slug: professional` — the account's tier; `basic` is rejected). No extra cost (within the
   account's Professional plan, 10 registries included).
2. **Spaces buckets** — the `SPACES_ACCESS_KEY` is scoped to the TF-state bucket only (403 on create). Removed from
   Terraform (PR #4); deferred to Phase 3 (pmtiles) / Phase 4 (photos) — re-add with a bucket-create-capable key.
3. **LE cert** — blocked by **DNSSEC** (a stale orphaned DS record at GoDaddy; the DO-hosted zone was unsigned).
   Owner removed the DS record at GoDaddy → cert issued. (Registrar = GoDaddy; DNS host = DigitalOcean.)

**Secrets set** (`production` env): `DATABASE_URL` (asyncpg, `fountainrank` DB, `doadmin@…:25060`, **no** `?sslmode`),
`LOGTO_DB_URL` (libpq, `logto` DB, `?sslmode=require`), `DATABASE_CA_CERT` (DO CA PEM). Host is the DO hostname
(verify-full works).

**App deploy** (`deploy.yml`, tags `v0.1.0` → `v0.1.1`): `v0.1.0` brought backend+web+healthz up; **Logto
crash-looped** (`SELF_SIGNED_CERT_IN_CHAIN` — Node didn't trust the DO CA). **PR #5** mounted the DO CA into the
Logto pod + set `NODE_EXTRA_CA_CERTS` (mirrors the backend). `v0.1.1` → all four pods Ready.

**Live (verified, HTTPS):** `api.fountainrank.com/healthz`=200, `/readyz`=200 (PostGIS 3.6, geo query over TLS),
`fountainrank.com`/`www`=200, `auth.fountainrank.com`=302.

**Remaining hardening (non-blocking, future):**
- Dedicated least-privilege DB users (app + Logto currently use `doadmin`).
- Apex DNS cleanup: a duplicate `A @` + an `AAAA @` (IPs `…005`/`…006`) pre-date Terraform and aren't in its state.
- `deploy.yml` tags images with the git SHA even on a `v*` tag push — could map the tag name instead.
- Add **required reviewers** to the `production` GitHub Environment (currently none — apply/deploy run unattended).
- Re-add the Spaces buckets (Phase 3/4) with a capable key.
- `redducklabs-runners` access confirmed working (Class A jobs ran).

---

## CD trigger model (so you don't accidentally fire it)

- **`deploy.yml`** fires on a **`v*.*.*` tag push** or manual `workflow_dispatch` — never on routine pushes to `main`.
- **`terraform.yml`** fires `fmt`/`validate` on PRs touching `infra/terraform/**`; `plan`/`apply` only via
  manual `workflow_dispatch`.
- Both stayed dormant through all of 0f's pushes (verified).

---

## Process notes (how 0f was built — for continuity)

- **Subagent-driven** (superpowers): a fresh implementer subagent per task (cheap tier — the plan carried complete
  file contents, so it was transcription), task review after each, final whole-branch review on **opus**
  (= "Ready to merge: Yes"). The **controller ran all env-heavy verification** (uv/pytest, `run.ps1 check`,
  docker build/run, terraform fmt/init/validate/providers-lock, actionlint, kubeconform, `gh api`, `gh run watch`)
  — subagents transcribed + self-reviewed. Ledger lived in `.git/sdd/progress.md` (gitignored).
- **CI is the source of truth:** every workflow was pushed and watched green with `gh run watch` before being
  called done.
- **Codex Loop A** approved the plan (review 3); it caught two real BLOCKERs (a migration↔readiness deadlock and
  multiline-secret shell interpolation) that are fixed in the shipped workflows.

---

## Open minor items (non-blocking; from the final review)

- `deploy.yml` passes DB URLs via `--from-literal` (argv visible in `/proc` on the ephemeral runner) — accepted
  GH Actions pattern; could file-mount like the CA cert if hardening later.
- `pnpm audit` reports **3 moderate** vulns (below the `--audit-level high` gate) — Dependabot/daily audit will surface fixes.
- Web runner image is non-standalone (copies whole `/repo`) — image-size optimization deferred.
- `web/.dockerignore` is effectively dead (root context uses root `.dockerignore`) — cosmetic; honest header comment.

---

## Next: Phase 1 (data model + fountains API)

Per spec §20: PostGIS schema + migrations, nearby/bbox/detail/add endpoints, ranking computation. **Write the
Phase 1 spec section (if needed) + a dated plan in `docs/plans/`, run Codex Loop A to APPROVED, then implement on
a branch → PR (CI must pass: backend/workspace-js/mobile-doctor + security-audit) → Codex PR review → squash-merge.**
Feature phases after: 2) auth (Logto) + magic-link email; 3) maps UI + add/rate-on-add (after a UI brainstorm —
create `docs/style-guide.md`); 4) photos; 5) leaderboards.
