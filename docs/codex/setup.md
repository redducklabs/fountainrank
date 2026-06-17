# Codex Setup

How to run Codex against this repo. Codex is the mandatory gating reviewer (see
`claude_help/codex-review-process.md`) and can also do implementation work under
the same rules as Claude.

## Concept mapping (Claude Code → Codex)

| Claude Code | Codex |
|---|---|
| `CLAUDE.md` (project rules) | `AGENTS.md` (defers to `CLAUDE.md`) |
| User/global `CLAUDE.md` | `~/.codex/AGENTS.md` |
| `.mcp.json` (auto-loaded) | `codex mcp add ...` (per-user config; **not** read from repo) |
| Subagents / skills | Codex's own tooling |

## One-time setup

1. **Run Codex in WSL.** This is a Windows workspace; Codex uses WSL. The repo
   root in WSL is `/mnt/d/repos/fountainrank`.

2. **Install / authenticate `gh` in WSL** (the distro package often lags and
   lacks `gh project`):

   ```bash
   # Official GitHub CLI apt repo (Ubuntu/WSL)
   type -p curl >/dev/null || sudo apt update && sudo apt install -y curl
   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
     | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
   sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
   sudo apt update && sudo apt install -y gh
   gh auth login
   gh auth status
   ```

3. **Register MCP servers Codex should use:**

   ```bash
   # Up-to-date library/framework docs
   codex mcp add context7 -- npx -y @upstash/context7-mcp

   # Browser automation (E2E/manual)
   codex mcp add playwright -- npx -y @playwright/mcp@latest

   # Local Postgres (reads CODEX_POSTGRES_URL; see launch-codex.sh)
   # Register a Postgres MCP server of your choice pointed at $CODEX_POSTGRES_URL.
   ```

4. **Write `~/.codex/AGENTS.md`** with any personal Codex defaults (the repo
   `AGENTS.md` covers project rules).

## Launching

Use the launcher, which exports the local Postgres URL and `cd`s to the repo
root:

```bash
./scripts/launch-codex.sh            # forwards any extra args to `codex`
```
