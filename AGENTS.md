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

## MCP servers

**Codex does not read `.mcp.json`.** Register the MCP servers Codex needs in your
Codex user config with `codex mcp add` / `codex mcp login`. See
`docs/codex/setup.md` for the list and commands, and `scripts/launch-codex.sh`
for the launcher.
