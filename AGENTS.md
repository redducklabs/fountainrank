# AGENTS.md — Codex Adapter

This file orients **Codex** (and other AGENTS.md-aware tools). It is a thin
adapter, not a second source of truth.

## Source of truth

**`CLAUDE.md` is the source of truth for how to work in this repo.** Before any
code, test, commit, database, Docker, infrastructure, UI, auth, email, or
migration work, read `CLAUDE.md` and the files it points to:

- `claude_help/*.md` — process runbooks (development, testing/CI, Codex review,
  Kubernetes/infra, GitHub CLI, GitHub environments, OAuth/SSO, email).
- `docs/specs/2026-06-16-architecture-and-foundation-design.md` — the design.
- `docs/design/*.md` — standing architecture references.

Read only the file relevant to the task at hand.

## Codex-specific rules

- **Do not modify `CLAUDE.md` or Claude-specific files** unless explicitly asked.
- **Codex runs in WSL** on this Windows workspace. Use **Linux/WSL paths** or
  repo-relative forward-slash paths; never Windows absolute paths (`D:\...`). The
  repo root in WSL is `/mnt/d/repos/fountainrank`.
- **Never write to a database** unless explicitly asked (read-only queries are
  fine).
- **No state-mutating Terraform locally** (`apply`/`destroy`/`import`/`state`).
  Read-only `init`/`validate`/`fmt`/`plan` only. Deploy via CI.
- Use **Docker Compose** + the `./run.ps1` workflows for local dev.
- **`gh`-first** for all GitHub operations; verify `gh auth status`.
- **Don't commit** without an explicit request and task context. No AI attribution
  in commits/PRs. No time estimates in any artifact.

## Claude review from Codex

Codex can use the local Claude Code CLI as the independent review tool. Current
Claude Code supports non-interactive print mode with `claude -p` / `--print`;
`--output-format text|json|stream-json`; and `--permission-mode` values including
`default`, `plan`, `dontAsk`, and `bypassPermissions`. On this workspace, pass
Claude Opus 4.8 explicitly with `--model claude-opus-4-8` because persisted
Claude defaults can point at an unavailable dated model. Anthropic documents
Claude Opus 4.8 as `claude-opus-4-8`, with a 1M-token context window by default
on the Claude API. For review runs that need repo reads and artifact writes, use
the same robust non-interactive shape Claude-control uses:
`--output-format stream-json --verbose --permission-mode bypassPermissions`.
Keep the prompt scoped to review-only writes under `temp/claude-reviews/`. Do
not use bypass mode for implementation work unless the user explicitly asks for
that risk.

Review artifacts live in `temp/claude-reviews/` (gitignored through `temp/`).
Use the same verdict discipline as the normal review gate: the review must end
with exactly `VERDICT: CHANGES REQUESTED` or `VERDICT: APPROVED`, and every
finding must be tagged `[BLOCKER]`, `[MAJOR]`, `[MINOR]`, or `[NIT]`.

Plan/spec review command shape:

```bash
SLUG="<slug>"
mkdir -p temp/claude-reviews
claude --print --model claude-opus-4-8 --output-format stream-json --verbose --permission-mode bypassPermissions -- "$(cat <<'PROMPT'
You are a critical, adversarial reviewer. Be hard on this work; do not
rubber-stamp it.

Review the plan/spec at <repo-relative-path>. First read CLAUDE.md and the
relevant files under claude_help/ and docs/design/, and hold the work to those
standards.

Review security, correctness, best practices, and project standards. Tag every
finding [BLOCKER], [MAJOR], [MINOR], or [NIT]. Approve only if there are no
[BLOCKER] or [MAJOR] findings.

Write the full review to:
temp/claude-reviews/<slug>-plan-review-1.md

This is a review-only task. You may read files and write only the review
artifact under temp/claude-reviews/. Do not edit source files or run
state-mutating project commands.

End that file with exactly one verdict line:
VERDICT: CHANGES REQUESTED
or
VERDICT: APPROVED
PROMPT
)" > "/tmp/${SLUG}-plan-review.stream.jsonl"
```

PR/code review command shape:

```bash
PR_NUMBER="<number>"
mkdir -p temp/claude-reviews
claude --print --model claude-opus-4-8 --output-format stream-json --verbose --permission-mode bypassPermissions -- "$(cat <<'PROMPT'
You are a critical, adversarial reviewer. Be hard on this PR; do not
rubber-stamp it.

Review the current branch against main. Run `git fetch origin main` and inspect
`git diff origin/main...HEAD`. First read CLAUDE.md and the relevant files under
claude_help/ and docs/design/, and hold the work to those standards.

Review security, correctness, best practices, and project standards. Tag every
finding [BLOCKER], [MAJOR], [MINOR], or [NIT]. Approve only if there are no
[BLOCKER] or [MAJOR] findings.

Write the full review to:
temp/claude-reviews/pr-<number>-review-1.md

This is a review-only task. You may read files and write only the review
artifact under temp/claude-reviews/. Do not edit source files or run
state-mutating project commands.

End that file with exactly one verdict line:
VERDICT: CHANGES REQUESTED
or
VERDICT: APPROVED
PROMPT
)" > "/tmp/pr-${PR_NUMBER}-review.stream.jsonl"
```

Before relying on a new machine's Claude CLI config, smoke-test it with:
`claude -p --model claude-opus-4-8 --output-format text 'Reply exactly: ok'`. If
that fails, fix Claude authentication/model config before treating Claude review
as available. Do not commit review artifacts.

Claude-control MCP: `/mnt/d/repos/claude-control/projects.json` and the active
`CLAUDE_CONTROL_PROJECTS` config at `/mnt/d/repos/sts-tl-meta/projects.json`
include the `fountainrank` project (`/mnt/d/repos/fountainrank`). If
`mcp__claude_control__send_command` reports `Unknown project: 'fountainrank'`,
restart the MCP server/session so it reloads that config.

## MCP servers

**Codex does not read `.mcp.json`.** Register the MCP servers Codex needs in your
Codex user config with `codex mcp add` / `codex mcp login`. See
`docs/codex/setup.md` for the list and commands, and `scripts/launch-codex.sh`
for the launcher.

## SEO Agent

For SEO analysis in this repository, use the `seo` skill and the seo-agent site
name `fountainrank`. The configured providers are GSC and Bing; GA4 is not
configured.
