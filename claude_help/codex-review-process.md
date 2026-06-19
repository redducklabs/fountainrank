# Codex Review Process — Claude's Operating Guide

**Read this BEFORE finalizing any spec or plan, and BEFORE merging any pull request.**

> **🔴 Codex is the GATING automated code reviewer.** We do **not** run GitHub Copilot
> PR reviews on this repo — do not request, poll for, or *wait/block* on a Copilot
> review; one is not a gate and may never arrive. **BUT** Copilot, Dependabot, a human,
> or any other commenter MAY still post comments on a PR — you MUST check for them and
> address each (fix or reply) before merge. Because Codex is the gating reviewer, give it
> thorough context on every review (changed files, intent, edge cases, and the relevant
> standards) — **the quality of the gate scales with the context you provide.**

Codex (the OpenAI coding agent, reached via the **Codex MCP server**) is our **mandatory,
critical review partner** and our **gating automated code reviewer**. It runs in addition
to — never instead of — CI. Its job is to be hard on us: it reviews for **security,
correctness, best practices, and project standards**, and it does not give a passing grade
to please us.

There are two review surfaces, each with its own loop:

1. **Spec / plan review** — every design spec and implementation plan is reviewed by Codex
   *before* we write code.
2. **PR review** — every pull request is reviewed by Codex *before* it is merged.

Both surfaces use the **same iron rule: loop until Codex explicitly approves.** A single
review pass is never enough on its own — we address every finding and send it back for
re-review until Codex returns an explicit green light.

---

## Why This Matters

A spec or plan that ships with a security hole, a wrong assumption, or a project-standards
violation costs far more to fix once it is code. A PR that merges with a latent bug costs
even more. Codex is a fresh, adversarial set of eyes that does not share our conversation
context or our blind spots — so it catches what we miss. It is the automated reviewer
standing between a bug and `main`, which is why a thorough, well-contextualized Codex loop
is non-negotiable.

**Codex is instructed to be critical.** A review that returns "looks good, no comments" on
the first pass of a non-trivial change should make us *more* suspicious, not less —
re-read the prompt we gave it and make sure it actually had the context to be critical.

---

## The Review Directory

All Codex review artifacts are written to:

```
temp/codex-reviews/
```

This directory is gitignored (`temp/` is ignored wholesale) — review files are working
artifacts, never committed.

**File naming convention (mandatory — the iteration number is how we track the loop):**

| Surface | File pattern | Example |
|---------|--------------|---------|
| Spec | `temp/codex-reviews/<spec-slug>-spec-review-<N>.md` | `temp/codex-reviews/2026-06-16-architecture-and-foundation-design-spec-review-1.md` |
| Plan | `temp/codex-reviews/<plan-slug>-plan-review-<N>.md` | `temp/codex-reviews/2026-06-18-phase-1-data-model-and-fountains-api-plan-review-2.md` |
| PR | `temp/codex-reviews/pr-<number>-review-<N>.md` | `temp/codex-reviews/pr-7-review-1.md` |

`<N>` starts at `1` and increments on every re-review. The highest-numbered file is the
latest round.

---

## Path Translation — WSL ↔ Windows (CRITICAL)

**🚨 We (Claude Code) run on Windows; Codex runs in WSL (Linux) — see `AGENTS.md`. The two
see the same files under different paths. Every path that crosses the boundary MUST be
translated, or Codex will fail to find the artifact and we will fail to read its review. 🚨**

**🚨 NEVER hardcode an absolute repo path — they differ per machine and per clone (drive
letter, parent folders, even OS casing). DERIVE the WSL path from the repo root on the
CURRENT machine every time. 🚨**

**Derivation rule (Windows working dir → WSL `cwd`):** take the repo root as it exists on
this machine — i.e. your current Windows working directory (the absolute path the harness
reports as the cwd; do NOT type a remembered value) — and translate it:

- **Drive letter → `/mnt/<lowercase-drive-letter>`**.
- **Backslashes → forward slashes** — `\` becomes `/`.
- **Preserve the rest of the path verbatim** (folder names and casing unchanged).

So `D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`. It is the **same physical file**
(`/mnt/<drive>` is WSL's view of the Windows drive), so no copy step — just the path
rewrite. When Codex writes `temp/codex-reviews/foo-plan-review-1.md` (relative to that
`cwd`), we Read it back on Windows under the same repo root.

**What this means in practice:**

1. **`cwd` in the Codex MCP call is the DERIVED WSL path of the current repo root** —
   translate the working directory the harness reports for THIS session; never paste a
   fixed string. This is the only absolute path anywhere in the flow.
2. **ALWAYS pass repo-relative paths in the prompt — never absolute paths.** Every path we
   hand Codex (the spec/plan to review, the `temp/codex-reviews/...` file to write, any
   `gh --body-file`) MUST be relative to the repo root, e.g. `docs/plans/2026-06-18-foo.md`
   and `temp/codex-reviews/foo-plan-review-1.md`. The WSL `cwd` resolves them, and a
   relative path is byte-for-byte identical on both sides — so it sidesteps translation
   entirely and works on any machine.
3. **When we Read Codex's output, translate back to Windows** — the review file Codex wrote
   at `temp/codex-reviews/...` is read with our Windows file tools at
   `D:\repos\fountainrank\temp\codex-reviews\...` (backslashes, per the Windows file-tool
   rule in `CLAUDE.md`).
4. **PR review `gh` commands run inside WSL** — Codex runs `gh` in its own WSL environment.
   That's fine (`gh` is path-agnostic for PR operations), but any `--body-file` or file
   path passed to `gh` must be repo-relative so it resolves against the WSL `cwd`.

**Rule of thumb:** the only absolute path in the whole flow is the MCP `cwd`, and it is
DERIVED from the current repo root at call time — never hardcoded. Everything in the prompt
is repo-relative.

---

## Codex Must Be Told To Be Critical

Every review prompt we send to Codex MUST explicitly instruct it to be a critical reviewer
across these four dimensions, and to hold the work to **this project's** standards:

- **Security** — Logto JWT validation (verify `iss`/`aud` via JWKS; never self-mint a
  symmetric token), the dev-auth seam staying **closed in production**
  (`dev_auth_enabled=False`), secrets handling (never commit secrets or `.env`; never log
  secrets/tokens/full JWTs/passwords/raw PII/full DB URLs — redact), CORS origins,
  injection, data exposure, and DOKS/Terraform/IAM permissions on a **public** repo.
- **Correctness** — PostGIS/geo correctness (the API speaks `latitude`/`longitude`; PostGIS
  takes `(lon, lat)` — verify ordering and that it stays centralized in `app/geo.py`),
  Alembic migrations that are **drift-free** (`alembic check`) and reversible, the Bayesian
  ranking math, async SQLAlchemy session/transaction handling, race conditions (e.g. the
  rating upsert), edge cases, error handling, off-by-one, wrong assumptions, missing tests.
- **Best practices** — idiomatic FastAPI + SQLAlchemy 2 async, structured logging (no bare
  `print()`, no silent `500`s, secrets redacted), no silent error suppression, proper data
  structures, no needless complexity, following the existing patterns in the codebase.
- **Project standards** — conformance to `CLAUDE.md` and the relevant `claude_help/` and
  `docs/design/` rules: the **Logging & Observability** standard, **no AI attribution** in
  commits/PRs, **no time estimates** anywhere, **IaC is read-only locally** (Terraform
  `apply`/`destroy`/`import`/`state` and `kubectl apply`/`helm upgrade` never run by hand),
  the spec → plan → implement flow, and the hub-and-spoke docs convention.

Always point Codex at the project standards so it can check against them. Include in the
prompt: "Read `CLAUDE.md` and the relevant files under `claude_help/` and `docs/design/`
and hold this work to those standards."

**Required verdict format.** Every review Codex writes MUST end with exactly one of these
two lines so the loop is machine-unambiguous:

```
VERDICT: CHANGES REQUESTED
```
or
```
VERDICT: APPROVED
```

And every finding MUST carry a severity tag: `[BLOCKER]`, `[MAJOR]`, `[MINOR]`, or `[NIT]`.
We treat **any `[BLOCKER]` or `[MAJOR]` as mandatory to resolve** before Codex can approve.

---

## Loop A — Spec / Plan Review (before any code)

Specs live in `docs/specs/YYYY-MM-DD-<topic>-design.md`; plans live in
`docs/plans/YYYY-MM-DD-<topic>.md`. A spec or plan is **not ready to implement until Codex
has approved it.**

### Steps

1. **Write the spec/plan** to its fixed location.
2. **Self-review first.** Do a critical security/correctness pass on your own work before
   handing it to a reviewer. Do not waste a Codex round on issues you can catch yourself.
3. **Invoke Codex** (`mcp__codex__codex`) to review it, using a prompt of the shape in
   *Invocation* below. Capture the returned `conversation_id`.
4. **Codex writes** its review to `temp/codex-reviews/<slug>-{spec|plan}-review-1.md`,
   ending with a `VERDICT:` line.
5. **Read the review file.** Create a todo per finding. For each: either **fix the
   spec/plan**, or **reply in your response with a concrete justification** for why the
   current text is correct. Never silently ignore a finding.
6. **Re-review:** call `mcp__codex__codex-reply` with the same `conversation_id` (preserves
   Codex's context from the prior round — cheaper and sharper than a cold session), telling
   it what you changed and asking it to re-review and write `…-review-2.md`.
7. **Loop steps 5–6** — incrementing `<N>` each round — until the latest review file ends
   with `VERDICT: APPROVED`.
8. **Only then** proceed to implementation (or, for plans, to `superpowers:executing-plans`
   / `superpowers:subagent-driven-development`).

**Do not start writing implementation code for a spec/plan that Codex has not approved.**

---

## Loop B — PR Review (before merge)

Codex review is the **gating automated code review** on top of CI. The order on a new PR
is: open PR → CI green → run the Codex review loop + check for any Copilot/other comments →
merge once CI is green **and** Codex has approved **and** every PR comment is addressed.

A PR is **not mergeable** until: CI is green **AND** Codex has returned `VERDICT: APPROVED`
**AND** every PR comment (Codex, Copilot, Dependabot, human, or any other commenter) has
been addressed.

### Steps

1. **Open the PR** and get CI green first (run the full local mirror — see
   `claude_help/testing-ci.md` — before you push). There is no Copilot step to *wait* on
   (Copilot is not a gate), but a Copilot review or other comments may still appear —
   step 3 checks for them.
2. **Invoke Codex** (`mcp__codex__codex`) to review the PR. The branch is already checked
   out locally in the repo working tree, so Codex can diff it directly. Capture the
   `conversation_id`. Instruct Codex to:
   - Diff the PR branch against `main` (`git fetch origin main` then
     `git diff origin/main...HEAD`) and review the change critically across the four
     dimensions.
   - **Post its findings as comments on the PR itself** using the `gh` CLI — a summary via
     `gh pr comment <number>`, and line-specific findings as inline review comments via
     `gh api repos/redducklabs/fountainrank/pulls/<number>/comments`. Tell it the repo
     `redducklabs/fountainrank` and the PR `<number>` explicitly.
   - **Also write** the full review to `temp/codex-reviews/pr-<number>-review-1.md`, ending
     with a `VERDICT:` line.
   - To post to GitHub, Codex needs to run `gh` with full network + write access — invoke
     in **bypass mode: `sandbox: "danger-full-access"`, `approval-policy: "never"`** (see
     *Invocation*). **NEVER use `workspace-write` (or any sandboxed mode) for Codex on this
     project** — the sandbox blocks `gh`'s network/write AND makes the filesystem read-only
     (even `git fetch` fails with `cannot open .git/FETCH_HEAD: Read-only file system`), so
     Codex silently fails to post the review or diff the branch and you only find out after
     the fact. `gh` auth is inherited from the environment.
   - **Codex cannot `gh pr review --approve` a PR opened by its own GitHub account** — it
     posts the `VERDICT:` as a normal PR comment instead. That still counts: squash-merge
     once CI is green, the verdict is `APPROVED`, and every comment is addressed.
3. **Read ALL PR comments and the review file.** Pull the full comment set —
   `gh pr view <number> --comments` (top-level) AND
   `gh api repos/redducklabs/fountainrank/pulls/<number>/comments` (inline review comments)
   — so you catch Codex's findings AND any **Copilot/Dependabot/other-reviewer** comments
   (these land on the PR, NOT in `temp/codex-reviews/`). Create a todo per finding,
   regardless of who posted it. For each: **fix the code** (add a test if it's a real bug),
   or **reply on the PR comment** explaining why the current code is correct. Every comment
   gets a response; never leave one unaddressed.
4. **If code changed:** re-run the full local CI mirror (`./run.ps1 check` — see
   `claude_help/testing-ci.md`), then push.
5. **Re-review:** `mcp__codex__codex-reply` on the same `conversation_id`, telling Codex
   what changed; it re-reviews, updates the PR, and writes `pr-<number>-review-2.md`.
6. **Loop steps 3–5** until the latest review ends with `VERDICT: APPROVED`.
7. **Squash-merge** once CI is green and Codex has approved
   (`gh pr merge <number> --squash`).

---

## Invocation

Codex is invoked through the MCP tools `mcp__codex__codex` (start a session — returns a
`conversation_id`) and `mcp__codex__codex-reply` (continue that session for re-reviews).
Re-reviews MUST use `codex-reply` on the same `conversation_id` so Codex retains the prior
round's context.

Codex does **not** share our conversation history — every prompt must carry full context:
what the artifact is, where it lives, what standards to check against, where to write the
review, and the required verdict format.

### Spec / plan review — starter prompt shape

```
You are a critical, adversarial reviewer. Be hard on this work — do NOT
rubber-stamp it.

Review the {spec|plan} at <repo-relative-path> (e.g.
docs/plans/2026-06-18-phase-1-data-model-and-fountains-api.md — relative to the
cwd, never an absolute path). First read CLAUDE.md and the relevant files under
claude_help/ and docs/design/, and hold this work to those project standards.

Review across four dimensions and tag every finding [BLOCKER] / [MAJOR] /
[MINOR] / [NIT]:
  - Security (Logto JWT validation, dev-auth seam closed in prod, secrets never
    committed/logged, CORS, injection, data exposure, DOKS/Terraform/IAM)
  - Correctness (PostGIS lon/lat ordering, Alembic drift-free + reversible,
    ranking math, async session handling, race conditions, edge cases, missing
    tests)
  - Best practices (idiomatic FastAPI/SQLAlchemy 2 async, structured logging with
    no silent 500s or leaked secrets, no silent error suppression)
  - Project standards (conformance to CLAUDE.md, claude_help/, docs/design/ —
    logging standard, no AI attribution, no time estimates, IaC read-only locally)

Write your full review to temp/codex-reviews/<slug>-{spec|plan}-review-1.md.
End the file with exactly one line: "VERDICT: CHANGES REQUESTED" or
"VERDICT: APPROVED". Approve only if there are no [BLOCKER] or [MAJOR] findings.
```

Recommended call settings: `cwd` = the repo root **as a WSL path, DERIVED from the current
working directory on this machine** (translate `D:\repos\fountainrank` →
`/mnt/d/repos/fountainrank`; never hardcode — see *Path Translation*). This is the only
absolute path in the call. **Run in bypass mode: `sandbox: "danger-full-access"`,
`approval-policy: "never"`** (a sandboxed mode leaves the filesystem read-only and Codex
cannot write the review file or `git fetch`). **All paths in the prompt MUST be
repo-relative** (`docs/plans/...`, `temp/codex-reviews/...`) so the WSL `cwd` resolves them.

### PR review — starter prompt shape

```
You are a critical, adversarial reviewer. Be hard on this PR — do NOT
rubber-stamp it.

Review PR #<number> in redducklabs/fountainrank. The branch is checked out in the
working tree. Run: git fetch origin main && git diff origin/main...HEAD to see the
change. First read CLAUDE.md and the relevant claude_help/ and docs/design/ files,
and hold the change to those standards.

Review across the four dimensions (security, correctness, best practices, project
standards), tagging every finding [BLOCKER]/[MAJOR]/[MINOR]/[NIT].

Post your findings on the PR using gh:
  - a summary comment: gh pr comment <number> --body "..."
  - line-specific findings as inline comments:
    gh api repos/redducklabs/fountainrank/pulls/<number>/comments ...
Also write the full review to temp/codex-reviews/pr-<number>-review-1.md, ending
with exactly one line: "VERDICT: CHANGES REQUESTED" or "VERDICT: APPROVED".
Approve only if there are no [BLOCKER] or [MAJOR] findings.
```

Recommended call settings: `cwd` = the repo root **as a WSL path, DERIVED from the current
working directory** (see *Path Translation*) — the only absolute path in the call. **Run in
bypass mode: `sandbox: "danger-full-access"`, `approval-policy: "never"`** so `gh` has the
network + write access to reach GitHub and post comments (a sandboxed mode blocks this and
also breaks `git fetch`). `gh` runs inside WSL and is authenticated there. **All paths in
the prompt MUST be repo-relative** (including any `--body-file` path passed to `gh`).

### Re-review (both surfaces)

Call `mcp__codex__codex-reply` with the saved `conversation_id`:

```
I addressed your previous review. Changes: <bullet list of what changed and, for
anything not changed, why>. Re-review the updated {spec|plan|PR}. Write the new
review to <…-review-<N+1>.md> (and update the PR comments if this is a PR). End
with the VERDICT line as before.
```

---

## The Rule

**A spec or plan is not ready to implement, and a PR is not ready to merge, until Codex has
written a review ending in `VERDICT: APPROVED` AND every PR comment (Codex, Copilot,
Dependabot, human, or any other commenter) has been addressed.** Address every finding,
send it back, and loop. One green light from Codex — not one review pass — is the gate; a
posted comment from any source is not itself a gate but must still be handled.

---

## Related Documentation

- `CLAUDE.md` → *Codex Reviews* (the mandatory pointer to this file) and *Source Control
  Strategy* (branch/PR/CI + Codex-gated/squash-merge rules).
- `claude_help/testing-ci.md` — the full local CI mirror (`./run.ps1 check`) to run before
  opening a PR and re-run after any PR code change, plus the PR-readiness checklist.
- `claude_help/development-process.md` — the overall spec → plan → implement loop.
- `claude_help/github-cli.md` — `gh` operations (PRs, comments, runs).
- `docs/design/` — standing architecture references to point Codex at when relevant.
- `AGENTS.md` — how Codex runs in WSL against this workspace.
