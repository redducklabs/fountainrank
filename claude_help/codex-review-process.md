# Codex Review Process

Codex is a **mandatory, gating, adversarial reviewer** that runs *in addition to*
CI — never instead of it. Nothing merges without Codex `VERDICT: APPROVED`.

Codex is driven via the Codex MCP server (`mcp__codex__codex` to start a review,
`mcp__codex__codex-reply` to continue the same conversation). Run Codex in
**bypass mode** (`sandbox: "danger-full-access"`, `approval-policy: "never"`) —
a sandboxed Codex has a read-only filesystem and no `gh` network access, so it
would silently fail to write its review, fetch, or post comments.

## Loop A — spec / plan review (before any code)

1. Write or update the spec (`docs/specs/`) or plan (`docs/plans/`); self-review.
2. Start a Codex review (`mcp__codex__codex`). Codex writes its review to
   `temp/codex-reviews/<slug>-spec-review-<N>.md` (or `-plan-review-<N>.md`).
3. Address **every** finding.
4. Continue the same conversation (`mcp__codex__codex-reply`) for re-review.
5. Loop until `VERDICT: APPROVED`.

## Loop B — PR review (before merge)

1. Open the PR (`gh pr create`).
2. Start a Codex review of the checked-out branch. Codex runs
   `git fetch origin main && git diff origin/main...HEAD`, posts findings as PR
   comments via `gh`, and writes `temp/codex-reviews/pr-<N>-review-<N>.md`.
3. Read **all** comments: `gh pr view <N> --comments` plus inline review comments
   via `gh api repos/redducklabs/fountainrank/pulls/<N>/comments`.
4. Address each finding; re-review on the same conversation.
5. Loop until `VERDICT: APPROVED`, then squash-merge.

## Verdict & severity format

- The review ends with exactly one line: `VERDICT: APPROVED` or
  `VERDICT: CHANGES REQUESTED`.
- Findings are tagged `[BLOCKER]`, `[MAJOR]`, `[MINOR]`, or `[NIT]`. Blockers and
  majors must be resolved before approval.

## Path translation (Windows ↔ WSL)

Codex runs in WSL on this Windows workspace. When passing the MCP `cwd`, translate
the Windows repo root to WSL form: drive letter → `/mnt/<lowercase>`, backslashes
→ forward slashes (e.g. `D:\repos\fountainrank` → `/mnt/d/repos/fountainrank`).
That is the only absolute path; everything in the prompt is repo-relative.

## Artifacts

Reviews live in `temp/codex-reviews/` (gitignored). Keep them for the life of the
spec/PR; they are working artifacts, not committed deliverables.
