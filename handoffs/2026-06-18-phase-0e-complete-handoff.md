# Handoff — FountainRank (Phase 0e complete; resume at Phase 0f)

**Date:** 2026-06-18
**From:** In-repo Claude session (Phase 0e infra Terraform skeleton)
**To:** A fresh Claude/Codex instance running inside `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here" note. Read this + `CLAUDE.md` + the spec and you can continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-17-phase-0d-complete-handoff.md` (still accurate for Phase 0a/0b/0c/0d history + the DigitalOcean bootstrap + the local-dev 302x ports + the still-pending external registrations, which are NOT repeated in full here).

---

## TL;DR

FountainRank: **FastAPI + PostgreSQL/PostGIS** backend, **Next.js** web, **Expo/React Native**
mobile, **self-hosted Logto** auth, **MapLibre + Protomaps** maps, on **DigitalOcean
Kubernetes (DOKS)**. Public OSS repo `redducklabs/fountainrank`.

**Done and pushed on `main`:** Phase 0a (repo foundation + AI tooling), the `docs/setup/`
runbook, the **DigitalOcean account bootstrap**, **0b** (backend walking skeleton), **0c**
(frontend monorepo), **0d** (local dev orchestration), and now **0e (infra Terraform skeleton
+ deferred Dockerfile hardening)**. The 0e implementation is commits `edfdf6e`…`c5f4467`; the
plan doc (`5c7ab55`) and **this handoff commit sit on top as the current `main` HEAD** — run
`git log --oneline -8` to confirm the exact tip. **Local == `origin/main`; tree clean apart
from the pre-existing untracked `docs/logos/`.**

**Next:** **Phase 0f** (CI/CD + security) — see "Next steps". Then feature phases 1–5.
**Start by writing the 0f plan with `superpowers:writing-plans`, run Codex Loop A to APPROVED,
then implement subagent-driven.**

---

## Read these first (in order)

1. `CLAUDE.md` — the operating-rules hub (points to all `claude_help/*` spokes).
2. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — approved whole-system design
   (§15 infra, §16 CI, §17 security, §20–21 build phases, §22 layout).
3. The dated, executed plans in `docs/plans/` — including
   `…phase-0e-infra-terraform-skeleton.md` (just landed).
4. `handoffs/2026-06-17-phase-0d-complete-handoff.md` — local-dev 302x ports, the compose stack,
   `run.ps1`. `handoffs/2026-06-17-phase-0b-complete-handoff.md` + `docs/setup/` — the DigitalOcean
   bootstrap + the master external-setup checklist + the pending external registrations
   (Google/Apple/GitHub/Logto). **Those are unchanged.**
5. The relevant `claude_help/*.md` spoke for whatever you're about to do (for 0f:
   `testing-ci.md`, `github-cli.md`, `github-environments.md`, `kubernetes-infra.md`).

---

## Process rules (how work happens here — non-negotiable, unchanged)

- **Flow:** spec → plan → **Codex Loop A review (loop to `VERDICT: APPROVED`)** → implement → verify.
- **Phase 0 commits go directly to `main`** (no CI gate until 0f lands). **After Phase 0:** branch
  → PR → CI green + Codex APPROVED + comments addressed → squash-merge.
- **Codex** via the Codex MCP (`mcp__codex__codex` / `…-reply`) in **bypass mode**
  (`sandbox: danger-full-access`, `approval-policy: never`), `cwd` in WSL form
  (`/mnt/d/repos/fountainrank`). Reviews land in `temp/codex-reviews/` (gitignored).
- **Implementation used subagent-driven development** (superpowers): a fresh implementer subagent
  per task (cheap/standard tier — the plan carried complete file contents, so it was transcription),
  a task review (spec + quality) after each, and a final whole-branch review on **opus**. Working
  artifacts (briefs/reports/diffs/ledger) live in `.git/sdd/` (local, gitignored).
  **As in 0d:** the env-heavy verification was run by the **controller in the main session**, not the
  implementer subagents — subagents lack a reliable terraform/docker/kubeconform runtime. Keep doing this.
- **🔴 Local IaC is READ-ONLY** (`claude_help/kubernetes-infra.md`): `terraform fmt`/`init -backend=false`/
  `validate` only; **never** `apply`/`plan`-against-backend/`import`/`state`, **never** `kubectl apply`/
  `helm upgrade`. All applies/deploys happen in CI (0f).
- **Hard rules:** no secrets, no `.env` files, **no AI attribution** in commits/PRs, **no time
  estimates** anywhere. Public repo — never push secrets.

---

## Phase 0e — infra Terraform skeleton (done + verified + pushed)

Plan: `docs/plans/2026-06-17-phase-0e-infra-terraform-skeleton.md`. Codex Loop A **APPROVED**
(review 4; reviews 1–4 in `temp/codex-reviews/phase-0e-plan-review-{1..4}.md`). All 4 task reviews
Approved (spec ✅ + quality). Final opus whole-branch review = **Ready to merge: Yes** (no
Critical/Important; minors M1–M4 are 0f-apply-time or cosmetic — see gotchas). Commits
`edfdf6e`…`c5f4467` (impl) + `5c7ab55` (plan doc).

**What landed:**
- **`backend/Dockerfile`** (`edfdf6e`) — closes the 0b-deferred item: runtime stage now creates a
  **non-root user** (`app`, uid/gid 1000), `COPY --chown`s from the deps stage, runs `USER app`, and
  adds a **`HEALTHCHECK`** that hits the DB-free `/healthz` via Python `urllib` (no curl in slim).
  Verified locally: `docker build` OK; `id` → `uid=1000(app)`; HEALTHCHECK → `healthy`; `/healthz` →
  `{"status":"ok"}`. (k8s ignores Docker HEALTHCHECK and uses its own HTTP probes — this mainly
  hardens local/compose + Trivy posture.)
- **`infra/terraform/main.tf`** (`b3c0755`) — single-file DO config (TherapyLink pattern + the §15
  divergences): `digitalocean_kubernetes_cluster` (sfo3, `s-2vcpu-2gb`, autoscale 1–3, version via
  `data.digitalocean_kubernetes_versions` prefix `1.34.`), `digitalocean_database_cluster` (pg 17,
  single-node `db-s-1vcpu-1gb`) + `digitalocean_database_db` **`fountainrank`** (app) and **`logto`**
  (separate Logto DB), `digitalocean_container_registry` `fountainrank` (`basic` tier), Spaces
  `fountainrank-photos` (private, `prevent_destroy`) + `fountainrank-pmtiles` (public-read) +
  `digitalocean_cdn`, `digitalocean_certificate` (LE SAN: apex/www/api/auth, `create_before_destroy`),
  `digitalocean_loadbalancer` (`lb-small`, http→30080 / https→30443+cert, healthcheck `/healthz`,
  `droplet_tag = "k8s:<cluster id>"`), four `digitalocean_record` **A records** (`@`/`www`/`api`/`auth`
  → LB IP), and `digitalocean_project_resources` assigning cluster/DB/LB/both buckets/**domain URN**
  to the `FountainRank` project. **S3 backend** in the pre-existing `fountainrank-terraform-state`
  bucket (sfo3). Plus `infra/terraform/README.md` and a Terraform block in `.gitignore`. Verified:
  `terraform fmt -check` clean; `init -backend=false` (provider **v2.90.0** under `~> 2.0`);
  `validate` → "Success!".
- **`infra/k8s/*.yaml`** (`1792655`) — `envsubst` raw YAML (vars `${NAMESPACE}` `${ENVIRONMENT}`
  `${IMAGE_TAG}` `${REGISTRY}` `${DOMAIN}`): `namespace`, `backend` (Deploy+Svc, probes `/healthz`+
  `/readyz`, `imagePullSecrets: regcred`, recreate-in-place), `web` (Deploy+Svc), `logto` (Deploy+Svc),
  `ingress` (host routes `api.`→backend / `auth.`→logto / apex+`www`→web, **a hostless `/healthz`→
  healthz-service** for the LB health check), plus `infra/README.md`. **`secrets.yaml` +
  `registry-secret.yaml` are 📄 reference-only and EXCLUDED from the apply loop** (CI creates them
  imperatively); **`ingress-nginx.yaml` is Helm-install documentation only** (no k8s objects).
  Verified: every file renders with no leftover `${…}`; `kubeconform -strict -kubernetes-version
  1.34.0` → all resources Valid / 0 Invalid / 0 Errors.
- **Docs** (`c5f4467`) — README Software Versions rows (Terraform/DO-provider/DOKS/Logto) + an
  `## Infrastructure` subsection; `claude_help/kubernetes-infra.md` got the read-only local-validate
  command paragraph (kubeconform, **not** `kubectl --dry-run=client`).

---

## Decisions made in 0e (owner-approved / verified — keep these)

- **DNS = DigitalOcean-managed (owner-confirmed).** NS delegated to DO; the domain + email records
  already exist. Terraform references the domain via `data "digitalocean_domain"` and **creates the
  four app A records** (`@`/`www`/`api`/`auth`); it **does not touch** the owner's existing email
  records (Google site-verification TXT, `smtp.google.com` MX, `google._domainkey` DKIM). SPF/DMARC
  + Logto connectors stay in Phase 2. **Verified live (read-only) that the four A records did NOT yet
  exist** — TF creates them at the 0f apply (no by-hand DNS changes were made).
- **Sizing = minimal / cheapest (owner choice).** DOKS `s-2vcpu-2gb` autoscale 1–3; Managed Postgres
  single-node `db-s-1vcpu-1gb`. Variables — tune defaults before the first real apply.
- **Single-file `main.tf`** (spec §15) · **registry `basic` tier** (≥2 repos: backend + web) ·
  **PostGIS enabled by the app's Alembic `0001_enable_postgis`** at deploy time (DO has no TF
  "enable extension" resource).
- **Secrets are created imperatively by CI, never bulk-applied** (avoids empty-value overwrites). The
  apply set is `namespace`/`backend`/`web`/`logto`/`ingress` only. **Required 0f secret keys:**
  `fountainrank-secrets.database-url` (app) **and** `fountainrank-secrets.logto-db-url` (Logto's URL to
  the `logto` DB, with `sslmode=require`) — both because `backend.yaml` + `logto.yaml` are in the apply
  set. Pull secret is `regcred` (`doctl registry kubernetes-manifest fountainrank --name regcred …`).
- **ingress-nginx is Helm-installed** (NodePort 30080/30443 + forwarded-header config via
  `--set controller.config.*`); the committed file just documents the command.
- **Provider lock is NOT committed in 0e** — a local `init -backend=false` writes a Windows-only lock
  (gitignored). **CI generates + commits the multi-platform lock in 0f.**

---

## 🔴 Phase 0f BLOCKING prerequisites (do these before the first deploy/migrations)

These are recorded in `infra/terraform/README.md` "Pre-first-apply checklist" — surfaced here so they
aren't lost:

1. **App-side Managed-Postgres SSL (backend code change).** DO Managed Postgres requires TLS and
   `asyncpg` rejects libpq `?sslmode=` (see `backend/app/config.py` + `db.py` — `create_async_engine`
   currently passes **no** `connect_args`). Before the first deploy the backend MUST pass
   `connect_args={"ssl": ctx}`. Concrete approach: take DO's DB CA cert (`doctl databases get <id>` /
   console) → mount as a k8s secret → build an `ssl.SSLContext` (verify-full) → pass via `connect_args`.
   Without it, `alembic upgrade head` and `/readyz` fail on first deploy. (Logto's `logto-db-url` needs
   `sslmode=require` similarly.)
2. **Provider lock:** generate + commit the multi-platform `.terraform.lock.hcl` in CI
   (`terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=windows_amd64`),
   then un-ignore it.
3. **Registry import:** the shared RDL account uses DO's **multiple-registries** feature; confirm the
   `fountainrank` registry doesn't already exist and `terraform import digitalocean_container_registry.main
   fountainrank` if it does.
4. **Sizing review** for cost before apply.

---

## Next steps — Phase 0f (CI/CD + security)

Write with `superpowers:writing-plans`, Codex Loop A to APPROVED, then implement subagent-driven
(controller runs env-heavy verification). Commit direct to `main` until CI is green; push at milestones.

- **`.github/workflows/`** with the **runner split** (Class A no-secret jobs on `redducklabs-runners`;
  secret-handling deploy jobs on `ubuntu-latest`): PR checks (backend lint/test, web/mobile
  lint/typecheck/test/build — **the web/mobile jobs run `pnpm run generate` first, which needs Python +
  uv in the job** — owner-accepted live-codegen coupling), image **build/push** to DOCR, **DOKS deploy**
  (`doctl` auth → `kubeconfig save` → Helm-install ingress-nginx on NodePort 30080/30443 → create
  `fountainrank-secrets` (`database-url`+`logto-db-url`) + `regcred` imperatively → `envsubst | kubectl
  apply` the apply set → `kubectl rollout status`; migrations via `kubectl exec … alembic upgrade head`).
- **The web Dockerfile + a web compose service land here** (deferred from 0d). `NEXT_PUBLIC_API_BASE_URL`
  is **build-time** — pass it as a build arg (`https://api.fountainrank.com`) when building the web image.
- **Security:** CodeQL (Py + JS/TS), Dependabot (grouped), secret scanning + push protection, Trivy +
  `.trivyignore`, `pip-audit` + `pnpm audit`, CODEOWNERS, issue templates, README badges. Enable the
  repo security features in GitHub Settings; confirm `redducklabs-runners` access + the `production`
  Environment secrets/vars (already created: `DIGITALOCEAN_ACCESS_TOKEN`, `SPACES_ACCESS_KEY`,
  `SPACES_SECRET_KEY`; vars `DO_REGISTRY=fountainrank`, `DO_REGION=sfo3`).
- **Do the 0f BLOCKING prerequisites above** before wiring the live deploy. When CI lands, re-confirm
  `testing-ci.md`'s "= CI" parity claim against the real workflow files.

Then the **feature phases** (each gets its own spec + plan): 1) data model + fountains API; 2) auth
(Logto) + magic-link email; 3) maps UI + add/rate-on-add (after a UI brainstorm — create
`docs/style-guide.md`); 4) photos; 5) leaderboards.

---

## Gotchas / environment notes (0e additions; see prior handoffs for the rest)

- **Verified live DigitalOcean state (read-only, 2026-06-17/18):** project `FountainRank`
  (`be84b91e-…`, Production) exists with **only** the state bucket assigned; domain `fountainrank.com`
  is DO-managed with **email/verification records only** (the four app A records do NOT exist yet);
  **no** FountainRank cluster/DB/LB/cert exists yet (so the first apply creates everything fresh —
  except the possibly-pre-existing `fountainrank` registry; see prereq 3). `doctl` is authenticated
  (context `redducklabs`). `doctl registry get` 412s because the account has **multiple registries** —
  doctl 1.141 can't list them via the legacy endpoint.
- **kubeconform** is the manifest validator (cluster-independent). It is **not** installed by default;
  install with `go install github.com/yannh/kubeconform/cmd/kubeconform@latest` (`go` is on PATH at
  `/c/Program Files/Go/bin/go`; binary lands in `$(go env GOPATH)/bin`). **Do NOT** use
  `kubectl apply --dry-run=client` as a local check — in this env it reaches the live DO cluster for
  OpenAPI (the kubeconfig points at a real cluster).
- **Terraform** is **v1.12.2 (windows_386 / 32-bit)** on PATH. `init -backend=false` is read-only and
  downloads providers into the gitignored `infra/terraform/.terraform/`.
- **Final-review minors (non-blocking, for the 0f apply):** M1 apex A-record could collide if an apex
  A record is ever added out-of-band; M2 the LE SAN cert validates against DNS so there's an inherent
  cert↔DNS↔LB-IP ordering/propagation dependency at first apply; M3 the tiny `healthz` Deployment/Svc
  lacks the `app: fountainrank` umbrella label (cosmetic); M4 the README "last checked" dates read
  2026-06-17 (accurate — that's when versions were researched).
- **The 0d local compose stack is still running** (`docker compose -f docker/docker-compose.yml ps`):
  `db` (5436, healthy) + `logto` (3022/3023) + `backend` (3021) on the 302x ports, ~7h up. `run.ps1 down`
  to stop it. (0e did not touch it; the only 0e local container — a throwaway `fr-hc` health probe — was
  removed.)
- **Untracked `docs/logos/`** is still in the working tree (not produced by 0a–0e). Left
  untracked/unpushed — decide what it is before staging it.
- **Pre-existing nit (deferred):** `.gitignore` has a duplicate `.env` line from Phase 0a — harmless.
