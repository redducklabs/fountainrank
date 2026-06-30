# Phase 0a — Repo Foundation & AI Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish FountainRank's repository conventions and AI-tooling (hub-and-spoke `CLAUDE.md`, `claude_help/` spokes, Codex `AGENTS.md` + onboarding) so the repo is "properly set up" for an in-project Claude/Codex instance to continue feature work.

**Architecture:** Documentation- and convention-only layer. No application code. Deliverables are verified structurally: Git attributes apply correctly, pre-commit passes, Markdown is well-formed, and every `🔗`/reference link in `CLAUDE.md`/`AGENTS.md` resolves to a file that exists.

**Tech Stack:** Markdown, Git, pre-commit (Python), Bash. Direct commits to `main` (Phase 0 git policy).

## Global Constraints

- Repo: `redducklabs/fountainrank` (public, open-source). Remote `origin` = `https://github.com/redducklabs/fountainrank.git`. Default branch `main`. Phase 0 commits go **directly to `main`**.
- **No AI attribution** in commits or docs (no "Generated with Claude", no "Co-Authored-By: Claude"). This overrides any default.
- **No secrets** committed. No `.env` files created or modified.
- Windows host; files use **LF** line endings (enforced via `.gitattributes`).
- Backend = Python 3.13 / FastAPI / PostGIS; Web = Next.js/TS; Mobile = Expo/RN; Auth = self-hosted Logto; Deploy = DOKS via GitHub Actions on `redducklabs-runners` (secret-handling jobs on `ubuntu-latest`). These are referenced in docs but not implemented here.
- Spec of record: `docs/specs/2026-06-16-architecture-and-foundation-design.md`. Plans live in `docs/plans/`; architecture references in `docs/design/`.
- Each task ends by committing directly to `main` with a Conventional-Commits message (`docs:`, `chore:`, `build:`), no attribution footer.

---

### Task 1: Git hygiene config (`.gitattributes`, `.gitignore`, `.trivyignore`)

**Files:**
- Create: `D:\repos\fountainrank\.gitattributes`
- Create: `D:\repos\fountainrank\.gitignore`
- Create: `D:\repos\fountainrank\.trivyignore`

**Interfaces:**
- Produces: a repo that normalizes text to LF and ignores Python/Node/Next/Expo/Terraform/tooling artifacts. Later plans (0b–0f) rely on these ignore rules so build artifacts are never committed.

- [ ] **Step 1: Create `.gitattributes`** (LF normalization + binary list)

```gitattributes
* text=auto eol=lf

# Explicitly binary — never normalize
*.png binary
*.jpg binary
*.jpeg binary
*.gif binary
*.ico binary
*.webp binary
*.pdf binary
*.zip binary
*.gz binary
*.woff binary
*.woff2 binary
*.ttf binary
*.eot binary
*.pmtiles binary

# Windows scripts keep CRLF
*.ps1 text eol=crlf
*.bat text eol=crlf
```

- [ ] **Step 2: Create `.gitignore`** (covers all Phase 0 subsystems)

```gitignore
# ---- Python / backend ----
__pycache__/
*.py[cod]
.venv/
venv/
.mypy_cache/
.ruff_cache/
.pytest_cache/
.coverage
coverage.xml
htmlcov/
dist/
build/
*.egg-info/

# ---- Node / web / mobile ----
node_modules/
.pnpm-store/
.next/
out/
.expo/
.expo-shared/
*.tsbuildinfo
.turbo/
coverage/
playwright-report/
test-results/
.playwright-mcp/

# ---- Terraform ----
.terraform/
*.tfstate
*.tfstate.*
crash.log
*.tfvars
!*.tfvars.example
backend-config.tfbackend

# ---- Secrets / env (NEVER commit) ----
.env
.env.*
!.env.example
*.pem
*.key
*.jwk
kubeconfig
*.kubeconfig

# ---- AI tooling runtime ----
.claude/scheduled_tasks.lock
.claude/worktrees/
.worktrees/
.superpowers/
temp/
temp/codex-reviews/

# ---- OS / editor ----
.DS_Store
Thumbs.db
.idea/
*.swp
```

- [ ] **Step 3: Create `.trivyignore`** (header + policy, no suppressions yet)

```trivyignore
# Trivy ignore file — container vulnerability suppressions.
# RULE: every entry MUST carry a justification + a revisit condition.
# Format:
#   CVE-XXXX-YYYY  # <why not exploitable in our runtime> — revisit when <condition>
# No suppressions yet.
```

- [ ] **Step 4: Verify LF normalization is wired**

Run: `cd /d/repos/fountainrank && git check-attr text eol -- .gitignore`
Expected: output includes `text: set` and `eol: lf`.

Run: `cd /d/repos/fountainrank && git check-attr eol -- scripts/anything.ps1`
Expected: `eol: crlf` (rule resolves even though the file doesn't exist yet).

- [ ] **Step 5: Commit**

```bash
cd /d/repos/fountainrank
git add .gitattributes .gitignore .trivyignore
git commit -m "chore: add git hygiene config (gitattributes, gitignore, trivyignore)"
```

---

### Task 2: `SECURITY.md` and `README.md` skeleton

**Files:**
- Create: `D:\repos\fountainrank\SECURITY.md`
- Create: `D:\repos\fountainrank\README.md`

**Interfaces:**
- Produces: `README.md` with a **Software Versions** section that plans 0b/0c populate via `version-research-expert`. `CLAUDE.md` (Task 3) links to `SECURITY.md`.

- [ ] **Step 1: Create `SECURITY.md`**

Content requirements (author verbatim):
- Title "Security Policy".
- "Reporting a Vulnerability" section: report privately via GitHub Security Advisories ("Report a vulnerability" on the repo's Security tab) or email `security@fountainrank.com`; do not open public issues for vulnerabilities.
- Response targets: acknowledge within 3 business days; triage within 7 business days.
- "Supported Versions": only the latest `main` is supported (pre-release project).
- "Scope": the FountainRank backend, web, mobile, and infrastructure in this repo. Out of scope: third-party services (DigitalOcean, Logto upstream, Google/Apple), social-engineering, DoS.
- Safe-harbor clause for good-faith research.

- [ ] **Step 2: Create `README.md` skeleton**

Content requirements (author verbatim):
- Title `# FountainRank` + tagline "Find, rate, and rank public drinking fountains."
- Badges placeholder line (CI / CodeQL — to be wired in plan 0f).
- **Status:** "Walking skeleton — under active development."
- **What it is:** 2–3 sentences (crowdsourced fountain discovery + rating; web + native iOS/Android; FastAPI + Postgres/PostGIS; deployed on DigitalOcean Kubernetes).
- **Repository layout:** the tree from spec §22.
- **Tech stack:** the table from spec §5.
- **Software Versions** section with a table (`Component | Version | Last checked`) and the note: "Populated and pinned during Phase 0b/0c via version research; latest stable per project policy." Seed rows for Python, Node, and "see backend/web for pinned dependency versions."
- **Getting started:** placeholder pointing to `run.ps1` (added in plan 0d) and `docker-compose.yml`.
- **Contributing / Security:** link to `SECURITY.md`; note Codex review + CI gate (`claude_help/codex-review-process.md`, `claude_help/testing-ci.md`).
- **License:** reference the existing `LICENSE`.
- **No time estimates anywhere.**

- [ ] **Step 3: Verify Markdown well-formedness**

Run: `cd /d/repos/fountainrank && npx --yes markdownlint-cli2 "README.md" "SECURITY.md"`
Expected: exit 0 (or only line-length warnings). If `npx` unavailable, visually confirm headings/tables render.

- [ ] **Step 4: Commit**

```bash
cd /d/repos/fountainrank
git add SECURITY.md README.md
git commit -m "docs: add SECURITY policy and README skeleton"
```

---

### Task 3: `CLAUDE.md` hub

**Files:**
- Create: `D:\repos\fountainrank\CLAUDE.md`

**Interfaces:**
- Consumes: spec at `docs/specs/2026-06-16-architecture-and-foundation-design.md`.
- Produces: the hub that every later file and the in-project instance reads. `AGENTS.md` (Task 5) defers to it. Every `🔗 MANDATORY` pointer must name a file created in Task 4/5/6 (or an existing file), so this task is committed **after** those files exist if authored out of order — but the canonical order here creates the spokes in Task 4 before the link-check in Task 6.

- [ ] **Step 1: Author `CLAUDE.md` using the hub-and-spoke pattern**

Required structure (follow defender.ai/TherapyLink idioms exactly):
- **No title preamble.** Open with `## FountainRank Project Settings` (repo, org, default branch, public/OSS, working dirs on Windows w/ backslash-path rule).
- `---`-separated `## <Topic> - CRITICAL|MANDATORY` sections. Each section = a `🚨 ... 🚨` one-line banner of the single most important rule + `NEVER`/`ALWAYS` bullets + a `🔗 MANDATORY: Read \`<spoke>\` BEFORE <trigger>. NOT optional.` pointer.
- Sections to include (each with inline rules + spoke pointer):
  - `## Execution Environment` — Windows host; backslash paths for file tools; Bash tool = Git Bash/POSIX; PowerShell primary.
  - `## Development Process - CRITICAL` → `🔗 claude_help/development-process.md`.
  - `## Testing & CI - CRITICAL` → `🔗 claude_help/testing-ci.md`. Inline: never claim green without running; CI is source of truth.
  - `## Codex Reviews - MANDATORY` → `🔗 claude_help/codex-review-process.md`. Inline: PR mergeable only when CI green AND Codex `VERDICT: APPROVED` AND all comments addressed.
  - `## Source Control Strategy` — Phase 0 direct-to-main; **after Phase 0, branch + PR + squash-merge, no AI attribution**.
  - `## Infrastructure as Code - CRITICAL` → `🔗 claude_help/kubernetes-infra.md`. Inline: no local state-mutating Terraform; no `kubectl apply` to clusters by hand; deploy via CI only.
  - `## GitHub Operations - MANDATORY` → `🔗 claude_help/github-cli.md` + `🔗 claude_help/github-environments.md`. Inline: use `gh` CLI, never WebFetch for GitHub.
  - `## Authentication & SSO - CRITICAL` → `🔗 claude_help/oauth-sso.md`. Inline: never disable auth; never weaken TLS; never commit secrets.
  - `## Email - MANDATORY` → `🔗 claude_help/email.md`. Inline: Logto owns auth email via Gmail-API connector.
  - `## Security - CRITICAL` — public repo; never push secrets; scanning is enforced (CodeQL/Dependabot/secret-scanning/Trivy).
  - `## Style Guide - MANDATORY` — before any new UI element, read/update `docs/style-guide.md` (created in the UI phase).
  - `## No Time Estimates - MANDATORY` and `## Critical Thinking - MANDATORY` — short, mirroring the global policy.
- **End with `## Architecture References`** — a `Document | When to Read` table mapping: `docs/specs/2026-06-16-architecture-and-foundation-design.md` (whole-system architecture, data model, geo, ranking, auth, infra), `docs/design/*.md` (as they are added), and the `claude_help/*.md` spokes with their triggers.

- [ ] **Step 2: Verify the hub references only files that will exist**

Run (lists every backticked path referenced in CLAUDE.md):
```bash
cd /d/repos/fountainrank
grep -oE '`[a-zA-Z0-9_./-]+\.md`' CLAUDE.md | tr -d '`' | sort -u
```
Expected: every path is one of `SECURITY.md`, `docs/specs/2026-06-16-architecture-and-foundation-design.md`, `docs/style-guide.md` (future), `docs/design/*.md` (future), or a `claude_help/*.md` created in Task 4. Note any not covered — they must be created in Task 4 or the reference removed.

- [ ] **Step 3: Commit**

```bash
cd /d/repos/fountainrank
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md hub (hub-and-spoke operating rules)"
```

---

### Task 4: `claude_help/` spokes

**Files:**
- Create: `D:\repos\fountainrank\claude_help\development-process.md`
- Create: `D:\repos\fountainrank\claude_help\testing-ci.md`
- Create: `D:\repos\fountainrank\claude_help\codex-review-process.md`
- Create: `D:\repos\fountainrank\claude_help\kubernetes-infra.md`
- Create: `D:\repos\fountainrank\claude_help\github-cli.md`
- Create: `D:\repos\fountainrank\claude_help\github-environments.md`
- Create: `D:\repos\fountainrank\claude_help\oauth-sso.md`
- Create: `D:\repos\fountainrank\claude_help\email.md`

**Interfaces:**
- Consumes: the `🔗 MANDATORY` pointers in `CLAUDE.md` (Task 3) — each spoke here is the target of one pointer.
- Produces: self-contained runbooks. Each file must be authored with real content (no "TBD").

- [ ] **Step 1: Author `development-process.md`**

Required content: the in-project workflow — before/during/after a task; how to use the spec/plans/design docs; Phase 0 direct-to-main vs. post-Phase-0 branch+PR+squash; Conventional Commits; **no AI attribution**; when to delegate to subagents; the "keep project knowledge in the repo, not in agent memory" rule (write design/plan/handoff docs).

- [ ] **Step 2: Author `testing-ci.md`**

Required content: the local checks that mirror CI and must pass before a PR (backend: ruff + pytest; web: eslint/prettier + vitest + build; mobile: tsc + lint); "never claim green without running"; CI is source of truth; the runner split (no-secret jobs on `redducklabs-runners`, secret-handling deploy jobs on `ubuntu-latest`) and the rule not to change any job's `runs-on`. Note that exact commands are finalized in plans 0b/0c/0f.

- [ ] **Step 3: Author `codex-review-process.md`**

Required content (adapt defender.ai's two-loop process): Loop A (spec/plan, before code) and Loop B (PR, before merge); run Codex in bypass mode; review artifacts to gitignored `temp/codex-reviews/` with naming `<slug>-{spec|plan}-review-<N>.md` and `pr-<N>-review-<N>.md`; required `VERDICT: APPROVED|CHANGES REQUESTED` format + severity tags `[BLOCKER]/[MAJOR]/[MINOR]/[NIT]`; loop until APPROVED; Windows→WSL path translation note (drive→`/mnt/<lower>`, `\`→`/`).

- [ ] **Step 4: Author `kubernetes-infra.md`**

Required content: DOKS via Terraform (`infra/terraform/`) + raw-YAML-`envsubst` manifests (`infra/k8s/`); **read-only Terraform locally** (`init/validate/fmt/plan` only — never `apply/destroy/import/state`); **never `kubectl apply` to a cluster by hand** — deploy via CI; **always verify `kubectl config current-context` before any kubectl read**; Managed Postgres+PostGIS (not in-cluster); Logto as its own Deployment+Service+Ingress with its own DB; LB-managed Let's Encrypt TLS. Points to spec §15.

- [ ] **Step 5: Author `github-cli.md`**

Required content: use `gh` for ALL GitHub ops (never WebFetch); common commands (PRs, issues, runs, api); verify `gh auth status`; squash-merge after CI green + Codex APPROVED.

- [ ] **Step 6: Author `github-environments.md`**

Required content: how environments + secrets are organized for CI/deploy (placeholder list of expected secret NAMES — never values — e.g. `DIGITALOCEAN_ACCESS_TOKEN`, `DO_REGISTRY`, `CLUSTER_NAME`, `LOGTO_*`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `FROM_EMAIL`, `BASE_URL`); finalized in plan 0f.

- [ ] **Step 7: Author `oauth-sso.md`**

Required content: Logto self-hosted is the auth authority; connectors Google/Apple/email-magic-link; web uses Logto Next.js SDK, mobile uses Logto RN SDK (+ `expo-apple-authentication`); backend validates Logto JWTs via JWKS (verify `iss`/`aud`; never self-mint HS256); JIT user provisioning by Logto subject; guest browsing public, write actions require auth; **never disable auth or weaken TLS**. Includes the **External Registrations checklist** (mirror spec §19: Google Cloud OAuth clients + consent screen; Apple Developer Sign in with Apple; Logto app/connector config; redirect URIs).

- [ ] **Step 8: Author `email.md`**

Required content: Logto owns transactional auth email (magic link/verification) via a **custom Logto email connector backed by the Gmail API** (service account + Workspace domain-wide delegation), with SMTP-to-Workspace fallback; reuse TherapyLink's Jinja2 `.html`/`.txt` template structure + email-tracking patterns as reference; SPF/DKIM/DMARC required on the sending domain; env var NAMES only (never values).

- [ ] **Step 9: Verify all spokes exist and are non-empty**

Run:
```bash
cd /d/repos/fountainrank
for f in development-process testing-ci codex-review-process kubernetes-infra github-cli github-environments oauth-sso email; do
  test -s "claude_help/$f.md" && echo "OK $f" || echo "MISSING/EMPTY $f"
done
```
Expected: eight `OK` lines.

- [ ] **Step 10: Commit**

```bash
cd /d/repos/fountainrank
git add claude_help/
git commit -m "docs: add claude_help spokes (process runbooks)"
```

---

### Task 5: Codex setup (`AGENTS.md`, `docs/codex/setup.md`, `scripts/launch-codex.sh`)

**Files:**
- Create: `D:\repos\fountainrank\AGENTS.md`
- Create: `D:\repos\fountainrank\docs\codex\setup.md`
- Create: `D:\repos\fountainrank\scripts\launch-codex.sh`

**Interfaces:**
- Consumes: `CLAUDE.md` (source of truth) and the `claude_help/*.md` spokes (Task 3/4).
- Produces: the Codex adapter + onboarding so an in-project Codex instance can operate.

- [ ] **Step 1: Author `AGENTS.md`** (thin Codex adapter — full content)

Required content (adapt defender.ai's, ~40–60 lines):
- State `CLAUDE.md` is the source of truth; read it + the referenced `claude_help/*.md` and `docs/specs|design/*.md` before any code/test/commit/DB/Docker/infra/UI/migration work.
- Codex-specific adapter rules: don't modify `CLAUDE.md`/Claude-specific files unless asked; never write to a DB unless explicitly asked (read-only OK); **Codex runs in WSL on this Windows workspace — use Linux/WSL or repo-relative forward-slash paths, never Windows absolute paths**; use Docker Compose + `./run.ps1` workflows; no state-mutating Terraform locally; don't commit without explicit request + task context; `gh`-first for GitHub (verify `gh auth status`).
- State: **MCP servers are configured in Codex user config, not this repo** — register via `codex mcp add`; see `docs/codex/setup.md`.

- [ ] **Step 2: Author `docs/codex/setup.md`**

Required content: onboarding mapping Claude→Codex concepts (`CLAUDE.md`→`AGENTS.md`, user `~/.codex/AGENTS.md`, `.mcp.json`→`codex mcp add`); how to register MCP servers Codex will use (Context7, Playwright, and a Postgres server reading an env var such as `CODEX_POSTGRES_URL`); installing/authenticating `gh` in WSL; pointer to `scripts/launch-codex.sh`.

- [ ] **Step 3: Author `scripts/launch-codex.sh`**

```bash
#!/usr/bin/env bash
# Launch Codex for FountainRank with the local Postgres connection exported.
# Usage: ./scripts/launch-codex.sh [codex args...]
set -euo pipefail

# Local dev Postgres (see docker-compose.yml, added in plan 0d). Override as needed.
export CODEX_POSTGRES_URL="${CODEX_POSTGRES_URL:-postgresql://fountainrank:fountainrank_dev@localhost:5436/fountainrank}"

# cd to repo root (this script lives in scripts/)
cd "$(dirname "$0")/.."

exec codex "$@"
```

- [ ] **Step 4: Make the launcher executable in Git's index**

Run:
```bash
cd /d/repos/fountainrank
git add scripts/launch-codex.sh
git update-index --chmod=+x scripts/launch-codex.sh
```
Expected: no error.

- [ ] **Step 5: Verify**

Run: `cd /d/repos/fountainrank && bash -n scripts/launch-codex.sh && test -s AGENTS.md && test -s docs/codex/setup.md && echo OK`
Expected: `OK` (and no bash syntax error).

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add AGENTS.md docs/codex/setup.md scripts/launch-codex.sh
git commit -m "docs: add Codex adapter (AGENTS.md), setup guide, and launcher"
```

---

### Task 6: `docs/design/` references, pre-commit config, and full link-check

**Files:**
- Create: `D:\repos\fountainrank\docs\design\architecture.md`
- Create: `D:\repos\fountainrank\.pre-commit-config.yaml`

**Interfaces:**
- Consumes: every prior task's files.
- Produces: a standing architecture reference target for `CLAUDE.md`'s table, plus a pre-commit baseline (whitespace/EOF/yaml/secret-scan) that plans 0b/0c extend with ruff/eslint. Final link-check proves the hub-and-spoke graph is intact.

- [ ] **Step 1: Author `docs/design/architecture.md`**

Required content: a concise standing summary (not a duplicate of the spec) — the system diagram from spec §4, the component responsibilities (§4), and an explicit "Source of truth: `docs/specs/2026-06-16-architecture-and-foundation-design.md`" pointer. Add `data-model.md`/`tech-stack.md` later as they're needed (note this).

- [ ] **Step 2: Create `.pre-commit-config.yaml`** (baseline; language hooks added later)

```yaml
# Pre-commit baseline. Backend (ruff) and frontend (eslint/prettier) hooks
# are added in plans 0b/0c. Install: pip install pre-commit && pre-commit install
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
        args: ["--maxkb=2048"]
      - id: check-merge-conflict
      - id: mixed-line-ending
        args: ["--fix=lf"]
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2
    hooks:
      - id: gitleaks
```

> Note: `rev` pins are bumped to latest stable in plan 0f via version research; the above are known-good floors.

- [ ] **Step 3: Run pre-commit across the repo**

Run:
```bash
cd /d/repos/fountainrank
pip install --quiet pre-commit && pre-commit run --all-files
```
Expected: hooks pass (or auto-fix whitespace/EOF; re-run until clean). If `pre-commit`/network unavailable, record that and verify YAML parses: `python -c "import yaml,sys; yaml.safe_load(open('.pre-commit-config.yaml'))"`.

- [ ] **Step 4: Full hub-and-spoke link-check**

Run (every backticked `*.md`/`*.sh`/`*.yaml` path referenced in CLAUDE.md and AGENTS.md must resolve, ignoring ones explicitly marked "future"):
```bash
cd /d/repos/fountainrank
miss=0
for src in CLAUDE.md AGENTS.md; do
  for p in $(grep -oE '`[a-zA-Z0-9_./-]+\.(md|sh|yaml|yml)`' "$src" | tr -d '`' | sort -u); do
    if [ ! -e "$p" ]; then echo "MISSING ($src): $p"; miss=1; fi
  done
done
[ "$miss" = "0" ] && echo "ALL LINKS RESOLVE"
```
Expected: `ALL LINKS RESOLVE`. Any `MISSING` that is not an intentional future file (`docs/style-guide.md`, `docs/design/data-model.md`, `docs/design/tech-stack.md`) must be fixed by creating the file or removing the reference.

- [ ] **Step 5: Commit**

```bash
cd /d/repos/fountainrank
git add docs/design/architecture.md .pre-commit-config.yaml
git commit -m "docs: add architecture reference and pre-commit baseline"
```

- [ ] **Step 6: Push Phase 0a to origin**

Run: `cd /d/repos/fountainrank && git push origin main`
Expected: push succeeds (no CI yet — added in plan 0f).

---

## Self-Review

**Spec coverage (spec §18 + §21 foundation items):**
- Hub-and-spoke `CLAUDE.md` → Task 3. ✅
- `claude_help/` spokes (development-process, codex-review-process, kubernetes-infra, oauth-sso, email, testing-ci, github-cli, github-environments) → Task 4. ✅ (matches spec §18 initial set)
- Codex `AGENTS.md` + `docs/codex/setup.md` + `scripts/launch-codex.sh` → Task 5. ✅
- `.gitignore`/`.gitattributes`/`.trivyignore` → Task 1; `SECURITY.md`/`README.md` (incl. Software Versions section) → Task 2; `docs/design/` references + pre-commit → Task 6. ✅
- Deferred to other plans (correctly out of 0a scope): monorepo/backend/web/mobile (0b/0c), docker-compose/run.ps1 (0d), infra Terraform/k8s (0e), CI workflows + CodeQL/Dependabot/Trivy + CODEOWNERS + issue templates (0f). Noted in each relevant task.

**Placeholder scan:** Content-heavy docs (CLAUDE.md, spokes) are specified by required sections + exact rules/idioms rather than pasted verbatim, because they are prose artifacts the executor authors from the spec + reference patterns; this is intentional, not a "TBD." All code/config files (`.gitattributes`, `.gitignore`, `.trivyignore`, `launch-codex.sh`, `.pre-commit-config.yaml`) contain complete content. No "TBD/TODO/implement later" left as a deliverable.

**Type/name consistency:** Spoke filenames are identical between Task 3's `🔗` pointers, Task 4's creation list, and Task 6's link-check. Local Postgres URL/port in `launch-codex.sh` (`localhost:5436`) is flagged to match `docker-compose.yml` in plan 0d. Verification commands use the actual repo path `/d/repos/fountainrank`.
