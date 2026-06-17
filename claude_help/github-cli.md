# GitHub CLI

**Use the `gh` CLI for ALL GitHub operations.** Never use WebFetch, web scraping,
or raw API calls through a browser for GitHub — `gh` only.

## First, always

```bash
gh auth status        # confirm authenticated before any operation
```

## Common operations

```bash
# Pull requests
gh pr create --fill                       # open a PR for the current branch
gh pr view <N> --comments                 # read PR + all comments
gh pr checks <N>                          # check status of CI on a PR
gh pr merge <N> --squash                  # squash-merge (after CI + Codex green)

# Inline review comments (not shown by `pr view`)
gh api repos/redducklabs/fountainrank/pulls/<N>/comments

# Issues
gh issue create --title "..." --body "..."
gh issue list --state open

# Workflow runs
gh run list --limit 20
gh run view <run-id> --log-failed         # logs for failed steps

# Generic API
gh api repos/redducklabs/fountainrank/...
```

## Rules

- Always **monitor PR checks until green** (`gh pr checks` / `gh run view`). If a
  check fails, read the failing logs, fix the root cause, push, and keep watching.
- **Squash-merge** only after CI is green AND Codex `VERDICT: APPROVED` AND every
  PR comment is addressed.
- **Deploy from CI, never from a local machine.**
