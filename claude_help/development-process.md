# Development Process

The operating rules for doing work in this repo. Read this before any
development task. `CLAUDE.md` is the hub; this is the "how we work" spoke.

## The flow

1. **Spec first.** Significant work starts from a design spec in `docs/specs/`.
   The standing design is `docs/specs/2026-06-16-architecture-and-foundation-design.md`.
   If a feature isn't covered, write/extend a spec and get it reviewed (Codex)
   before planning.
2. **Plan next.** Turn the spec into a dated implementation plan in `docs/plans/`
   with bite-sized, testable tasks. Get the plan Codex-reviewed.
3. **Implement task-by-task.** One task at a time, TDD where it applies, frequent
   commits. Don't batch unrelated changes.
4. **Verify, then claim.** Run the checks yourself (see `testing-ci.md`; and
   `local-dev.md` for what is verifiable on this Windows/WSL host vs. what only CI
   can confirm). Never say something works or is "done" without having run it.

## Keep knowledge in the repo

**Project knowledge lives in the repo, not in an agent's memory.** Capture design
decisions in `docs/design/` or `docs/specs/`, work breakdowns in `docs/plans/`,
and session state in `handoffs/`. A new Claude/Codex instance started inside this
repo should be able to continue from these files alone.

## Git policy

- **All work goes on a branch → PR → CI green + Codex `VERDICT: APPROVED` + every
  PR comment addressed → squash-merge.** Phase 0's direct-to-`main` allowance is
  **over** (see `CLAUDE.md` → *Source Control Strategy*). "Green / ready to merge"
  *includes* Codex approval — CI is necessary but not sufficient.
- **Always squash-merge** (`gh pr merge <N> --squash`) — never a merge commit,
  never rebase-merge — to keep the linear `<title> (#PR)` history, even when a
  branch bundles multiple topics.
- **Conventional Commits:** `feat:`, `fix:`, `docs:`, `chore:`, `build:`, `ci:`,
  `test:`, `refactor:`. Frequent commits, one task at a time.
- **No AI attribution** in commit messages or PR bodies — ever. No
  "Generated with Claude", no "Co-Authored-By: Claude", no AI markers.
- **No time estimates** in any artifact.

## File discipline

- Prefer editing existing files over creating new ones; search first.
- Follow established patterns in the surrounding code.
- Keep files focused — one clear responsibility. Split by responsibility, not by
  layer. Files that change together live together.

## Delegation

For multi-step or specialized work, delegate to subagents (research, review,
infra, etc.) and keep the orchestration here. Give each subagent complete
context and a clear, verifiable deliverable.

## Definition of done

A task is done only when: the requirement is implemented, tests exist and pass,
the local CI-mirror checks are green, and the PR's CI + Codex review are green.
See `testing-ci.md` and `codex-review-process.md`.
