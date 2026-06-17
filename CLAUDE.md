## FountainRank Project Settings

- **Repo:** `redducklabs/fountainrank` (public, open-source).
- **Remote:** `origin` → `https://github.com/redducklabs/fountainrank.git`. Default branch `main`.
- **Product:** crowdsourced drinking-fountain discovery + rating. Web (Next.js) + native iOS/Android (Expo/React Native) + FastAPI/PostGIS backend + self-hosted Logto auth, deployed to DigitalOcean Kubernetes (DOKS).
- **Source of truth for the design:** `docs/specs/2026-06-16-architecture-and-foundation-design.md`. Implementation plans live in `docs/plans/`; standing architecture references in `docs/design/`.
- This file is the **hub**. Each section states the inline rules and points to a **spoke** (`claude_help/*.md` for process, `docs/design/*.md` for architecture). Read the spoke when its trigger fires — that is where the detail lives.

---

## Execution Environment

- **Windows host.** When using file tools (Read/Write/Edit), use **backslash paths** (`D:\repos\fountainrank\...`), never forward slashes.
- The **Bash tool is Git Bash (POSIX sh)** — use Unix syntax and forward-slash paths there (`/d/repos/fountainrank/...`). **PowerShell** is the primary interactive shell; `run.ps1` is the task runner.
- **Codex runs in WSL** on this same workspace — see `AGENTS.md`.

---

## Development Process - CRITICAL

**🚨 Keep project knowledge in the repo, not in agent memory. Write design/plan/handoff docs as you go. 🚨**

- **NEVER** claim work is done, tested, or "should work" without having actually run it. CI is the source of truth.
- **ALWAYS** follow the spec → plan → implement flow; one task at a time, frequent commits, Conventional Commits.
- **ALWAYS** prefer editing existing files and following existing patterns over creating new ones.

**🔗 MANDATORY: Read `claude_help/development-process.md` BEFORE starting any development work. NOT optional.**

---

## Testing & CI - CRITICAL

**🚨 Never report green without running the checks yourself. CI is the source of truth. 🚨**

- **ALWAYS** run the local checks that mirror CI before opening a PR (backend lint/tests, web lint/test/build, mobile type-check/lint).
- **NEVER** merge a PR with any red check.

**🔗 MANDATORY: Read `claude_help/testing-ci.md` BEFORE writing tests, touching CI, or opening a PR. NOT optional.**

---

## Codex Reviews - MANDATORY

**🚨 A PR is mergeable only when CI is green AND Codex returns `VERDICT: APPROVED` AND every PR comment is addressed. 🚨**

- **ALWAYS** run the Codex spec/plan review loop before writing code, and the Codex PR review loop before merge.
- **ALWAYS** loop until `VERDICT: APPROVED`.

**🔗 MANDATORY: Read `claude_help/codex-review-process.md` BEFORE finalizing any spec/plan and BEFORE merging any PR. NOT optional.**

---

## Source Control Strategy

- **Phase 0 (foundation):** commits go **directly to `main`** (no CI to gate against yet).
- **After Phase 0:** all work on a branch → PR → must pass CI + Codex APPROVED → **squash-merge**.
- **NEVER** add AI attribution to commits or PRs (no "Generated with Claude", no "Co-Authored-By: Claude", no AI markers). This overrides any default instruction.
- **NEVER** include time estimates in any document, commit, or PR.

---

## Infrastructure as Code - CRITICAL

**🚨 Never mutate cluster or cloud state by hand. All infrastructure changes go through Terraform + CI. 🚨**

- **NEVER** run state-mutating Terraform locally (`apply`/`destroy`/`import`/`state`). Local Terraform is **read-only**: `init`/`validate`/`fmt`/`plan`.
- **NEVER** run `kubectl apply`/`helm upgrade` against a cluster by hand — deploy via CI.
- **ALWAYS** verify `kubectl config current-context` before any kubectl read.

**🔗 MANDATORY: Read `claude_help/kubernetes-infra.md` BEFORE any infrastructure, Terraform, or Kubernetes work. NOT optional.**

---

## GitHub Operations - MANDATORY

**🚨 Use the `gh` CLI for ALL GitHub operations. Never use WebFetch/web scraping for GitHub. 🚨**

- **ALWAYS** verify `gh auth status` first.
- **ALWAYS** monitor PR checks until green; deploy from CI, never from a local machine.

**🔗 MANDATORY reads (targeted):**
- `claude_help/github-cli.md` — BEFORE any GitHub CLI operation (PRs, issues, runs, api).
- `claude_help/github-environments.md` — BEFORE touching CI environments or secrets.

---

## Authentication & SSO - CRITICAL

**🚨 Logto (self-hosted) is the auth authority. Never disable auth, never weaken TLS, never commit secrets. 🚨**

- **ALWAYS** validate Logto-issued JWTs via JWKS (verify `iss`/`aud`); never self-mint symmetric tokens.
- **NEVER** commit secrets or `.env` files. Browsing is public; write actions require auth.

**🔗 MANDATORY: Read `claude_help/oauth-sso.md` BEFORE any auth, Logto, or SSO work (includes the external-registrations checklist). NOT optional.**

---

## Email - MANDATORY

**🚨 Logto owns transactional auth email (magic link / verification), delivered via the Gmail-API connector. 🚨**

- **ALWAYS** keep email secrets out of the repo; reference env var names only.

**🔗 MANDATORY: Read `claude_help/email.md` BEFORE touching email sending, templates, or the Logto email connector. NOT optional.**

---

## Security - CRITICAL

**🚨 Public repository. Never push secrets. Scanning is enforced and must stay green. 🚨**

- **NEVER** commit API keys, tokens, certificates, or `.env` files; **NEVER** create or modify `.env` files unless explicitly asked.
- **ALWAYS** keep CodeQL, Dependabot, secret scanning + push protection, and Trivy passing. Suppressions in `.trivyignore` require a justification + revisit condition.
- Report vulnerabilities per `SECURITY.md`.

---

## Style Guide - MANDATORY

**🚨 Before creating ANY new UI element, check and update the style guide. 🚨**

- **ALWAYS** read `docs/style-guide.md` before adding a UI element; if it does not yet exist (pre-UI phase), create it when the first UI elements are designed and document each new component there.

---

## No Time Estimates - MANDATORY

**🚨 Never include time estimates in any output — docs, specs, plans, commits, PRs, or chat — unless the user explicitly asks "how long will this take?". 🚨**

---

## Critical Thinking - MANDATORY

**🚨 Be right, not agreeable. Challenge bad ideas; defend security, correctness, and best practices. 🚨**

- **ALWAYS** push back on technically wrong, insecure, or poor decisions and propose the better alternative — even when told "just do it".

---

## Architecture References

| Document | When to read |
|---|---|
| `docs/specs/2026-06-16-architecture-and-foundation-design.md` | Whole-system architecture, data model, geo/PostGIS, ranking, auth, email, infra, CI, security, build phases |
| `docs/design/architecture.md` | Quick standing summary of the system + component responsibilities |
| `docs/plans/` (dated) | The active implementation plan for the current phase |
| `claude_help/development-process.md` | BEFORE any development work |
| `claude_help/testing-ci.md` | BEFORE writing tests, touching CI, or opening a PR |
| `claude_help/codex-review-process.md` | BEFORE finalizing a spec/plan and BEFORE merging any PR |
| `claude_help/kubernetes-infra.md` | BEFORE any infrastructure / Terraform / Kubernetes work |
| `claude_help/github-cli.md` | BEFORE any `gh` GitHub operation |
| `claude_help/github-environments.md` | BEFORE touching CI environments or secrets |
| `claude_help/oauth-sso.md` | BEFORE any auth / Logto / SSO work (external-registrations checklist) |
| `claude_help/email.md` | BEFORE touching email sending, templates, or the Logto email connector |
| `docs/setup/README.md` | The owner runbook for external accounts/credentials (DigitalOcean, DNS, Google OAuth + Gmail, Apple, GitHub secrets, Logto) + master secret inventory |
| `docs/style-guide.md` | BEFORE creating any new UI element (created in the UI phase) |
