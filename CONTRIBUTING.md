# Contributing to FountainRank

Thanks for helping improve FountainRank. This project welcomes focused fixes,
documentation improvements, tests, and feature work that fits the existing product
direction.

## Ground Rules

- Be respectful and keep discussion focused on the work.
- Keep changes scoped. Avoid bundling unrelated refactors, formatting sweeps, or
  dependency updates with feature work.
- Follow the existing code style and project patterns before adding new abstractions.
- Do not commit secrets, credentials, certificates, `.env` values, private keys, or
  generated service-account files.
- Do not weaken authentication, authorization, TLS, logging, security scanning, or
  deployment controls.
- Do not add AI attribution lines to commits, PRs, changelogs, or documentation.
- Do not include implementation timelines or effort estimates in project artifacts.

## Before You Start

1. Read [`README.md`](README.md) for the product and local setup overview.
2. Read [`CLAUDE.md`](CLAUDE.md) for the source-of-truth project operating rules.
3. For code changes, read the relevant runbook under [`claude_help/`](claude_help/):
   development process, testing/CI, GitHub workflow, infrastructure, auth, or email.
4. Check [`docs/specs/`](docs/specs/) and [`docs/plans/`](docs/plans/) for the feature
   area you want to change.

Significant product or architecture work should start with a spec or plan update.
Small docs fixes and narrow bug fixes can usually go straight to implementation.

## Development Setup

From the repository root:

```powershell
.\run.ps1 bootstrap
.\run.ps1 up
.\run.ps1 backend
.\run.ps1 web
```

Useful targeted commands:

```powershell
.\run.ps1 check
.\run.ps1 check -Backend
.\run.ps1 check -Web
.\run.ps1 check -Mobile
```

Package-level commands are also available:

```bash
pnpm --filter web run lint
pnpm --filter web run typecheck
pnpm --filter web run test
pnpm --filter mobile run lint
pnpm --filter mobile run typecheck
pnpm --filter mobile run test
```

Backend commands are run from `backend/` with `uv`, for example:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Pull Requests

- Work on a branch and open a PR against `main`.
- Use a clear title and describe what changed, why it changed, and how it was tested.
- Link the related issue, spec, or plan when one exists.
- Update tests and documentation when behavior changes.
- Keep generated files in sync when the project expects them, such as regenerating
  the shared API client after backend OpenAPI changes.
- Use Conventional Commit style for commits when possible: `feat:`, `fix:`,
  `docs:`, `test:`, `refactor:`, `build:`, `ci:`, or `chore:`.

Before requesting review, run the checks that match your change and record the exact
commands in the PR. Do not say checks pass unless you ran them and they passed.

PRs are mergeable only when CI is green, the required review gate is approved, and
all PR comments have been addressed. The project uses squash merges.

## Testing Expectations

Use the smallest reliable check set for your change, then broaden it when the change
touches shared behavior or user-facing workflows.

- Backend behavior: run relevant `uv run pytest` tests, ruff, and migrations checks
  when applicable.
- Web behavior: run web lint, typecheck, tests, and build when UI/runtime behavior
  changes.
- Mobile behavior: run mobile lint, typecheck, tests, and Expo Doctor when native or
  app-shell behavior changes.
- Infrastructure: local Terraform is read-only only: `init`, `validate`, `fmt`, or
  `plan`. Do not run local `apply`, `destroy`, `import`, or state-mutating commands.

If a check is skipped or blocked, state exactly what was not run and why.

## Security

Report vulnerabilities using [`SECURITY.md`](SECURITY.md). Do not disclose security
issues in public GitHub issues.

Security-sensitive changes require extra care:

- Auth is owned by self-hosted Logto and backend JWT validation.
- Production write APIs must remain authenticated.
- Secrets stay outside the repository and outside logs.
- Deployments and infrastructure mutations happen through CI/CD, not local machines.

## Documentation

Project knowledge should live in the repository. When a change creates a new product,
architecture, setup, deployment, or operational decision, document it in the relevant
place under `docs/`, `claude_help/`, or an app-specific README.

Keep user-facing documentation approachable first, then link to technical detail for
contributors who need it.
