# Phase 0f — CI/CD + Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the GitHub Actions CI + security layer so every push/PR is gated by lint/type-check/test/build, code scanning (CodeQL), dependency scanning (`pip-audit`/`pnpm audit`), and secret scanning (`trivy fs` secret gate + GitHub secret scanning) — with container **images** scanned report-only (`ignore-unfixed`, SARIF) on push + daily; author (but do not fire) the gated CD workflows (image build/push, DOKS deploy, Terraform apply); and land the one BLOCKING backend change (asyncpg TLS, wired end-to-end into the deploy contract) and the web Docker image the live deploy needs.

**Architecture:** Two layers. **Layer 1 (lands green immediately, no cloud/secrets):** PR-check CI mirroring `run.ps1 check`, CodeQL, Dependabot, Trivy filesystem + `pip-audit`/`pnpm audit` (active + daily), governance files, repo security settings, the web Dockerfile/compose service, and the backend asyncpg-SSL change. **Layer 2 (authored + gated, NOT fired this phase):** `deploy.yml` (image build/push + DOKS deploy, triggers on a `v*.*.*` release **tag push** + manual dispatch) and `terraform.yml` (apply via manual dispatch; `fmt`/`validate` on infra PRs). The first live cloud apply/deploy is a separate, owner-triggered action once external registrations + cost sign-off + the production-env DB secrets are in place (spec §21).

**Tech Stack:** GitHub Actions (self-hosted `redducklabs-runners` for no-secret jobs; `ubuntu-latest` for secret-handling jobs), CodeQL, Trivy, `pip-audit` (via `uv export`), `pnpm audit`, Dependabot, Docker (multi-stage), Next.js 16, FastAPI/SQLAlchemy-asyncpg, Terraform (DigitalOcean), Helm (ingress-nginx), `actionlint`, `kubeconform`.

## Global Constraints

Copied verbatim from `CLAUDE.md` / spec / the spokes. Every task implicitly includes these.

- **Phase 0 git policy:** commits go **directly to `main`** until CI is green; **after** Phase 0, branch → PR → CI green + Codex `VERDICT: APPROVED` → squash-merge. Conventional Commits (`feat:`/`fix:`/`docs:`/`chore:`/`build:`/`ci:`/`test:`/`refactor:`).
- **No AI attribution** in any commit or PR. **No time estimates** in any artifact.
- **No secrets, ever.** No `.env` files created/modified. Public repo — the repo references secret **names** only. Secrets live in the GitHub **`production`** Environment.
- **Runner split (do not change a job's `runs-on` without an explicit decision):** Class A (no secrets — lint/type-check/test/build/scan) → `redducklabs-runners`. Class B (secret-handling — image push, DOKS deploy, Terraform apply) → `ubuntu-latest`.
- **Local IaC is READ-ONLY:** `terraform fmt`/`init -backend=false`/`validate` and (registry-only) `terraform providers lock`; render k8s with `envsubst` + validate with `kubeconform`. **Never** `apply`/`plan`-against-backend/`import`/`state`, **never** `kubectl apply`/`helm upgrade` by hand. All applies/deploys happen in CI.
- **CD is authored but NOT fired this phase.** `deploy.yml` triggers on `push: tags: ['v*.*.*']` + `workflow_dispatch`; `terraform.yml` triggers on `workflow_dispatch` (+ `fmt`/`validate` on infra PRs). Neither fires on routine pushes to `main`.
- **Pinned versions (researched 2026-06-18, latest stable):**
  - Actions: `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6.0.9`, `astral-sh/setup-uv@v8.2.0`, `github/codeql-action/*@v4`, `aquasecurity/trivy-action@v0.36.0`, `digitalocean/action-doctl@v2.5.2`, `azure/setup-helm@v5`, `hashicorp/setup-terraform@v4`, `actions/upload-artifact@v7`.
  - Tools: Trivy CLI `0.71.1`, `actionlint` pre-commit `rev: v1.7.12`, `kubeconform v0.8.0`, ingress-nginx chart `4.15.1` (appVersion 1.15.1), Helm CLI `v3.21.1`, Terraform CLI `1.15.6`, Node `22`, pnpm read from `package.json#packageManager` (`pnpm@11.7.0`).
  - CodeQL `languages`: `python` and `javascript` (the `javascript` analysis covers TypeScript; do **not** use `javascript-typescript`).
- **Repo facts:** repo `redducklabs/fountainrank` (owner is the `redducklabs` org); the owner's GitHub login is `aronweiler`. Domain `fountainrank.com`. DO region `sfo3`. Registry name `fountainrank`. k8s namespace `fountainrank`, environment `production`.
- **`run.ps1 check` is the CI contract** — CI jobs must run the same commands. Backend: `ruff check .` + `ruff format --check .` + `alembic upgrade head` + `alembic check` + `pytest`. Frontend: `turbo run lint typecheck test` + `pnpm run format:check` + `turbo run build --filter=web`. Mobile: `expo-doctor`. The frontend `generate` turbo-dep runs `cd backend && uv run python -m app.export_openapi` → **frontend jobs need Python+uv**.

---

## Verification model (read before implementing)

Three tiers — each task states which applies:

1. **Locally runnable (authoritative now):** backend SSL unit tests (`uv run pytest`), `run.ps1 check`, `docker build`/`docker run` for the web image, `uvx pip-audit`/`pnpm audit`/`trivy fs`, `terraform fmt`/`validate`/`providers lock`, `envsubst | kubeconform`. The **controller** runs these (subagents lack a reliable docker/terraform/uv/gh runtime — same pattern as Phases 0d/0e).
2. **CI-authoritative (the real proof for the workflow files):** Phase 0 commits go to `main`; pushing `ci.yml`/`security-audit.yml` triggers them. **Verify with `gh run watch` / `gh run list` until green**, fixing root causes. CI — not local — is the source of truth. (CodeQL is GitHub default setup, not a workflow file — verify via `gh api .../code-scanning/default-setup`.)
3. **Gated, not fired (authored only):** `deploy.yml`, `terraform.yml`, the web image build-arg path, the Trivy *image* scan. Verified by `actionlint` (syntax/expressions) + rendering the k8s apply set with `envsubst | kubeconform` + `terraform fmt`/`validate`. They will not run until an owner pushes a release tag / dispatches them after the prerequisites in `infra/terraform/README.md`.

**Tooling the controller installs once (Go is on PATH) — pin to the recorded versions, not `@latest`, so the local tools match the README/pre-commit pins:**
`go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.12` and (if absent) `go install github.com/yannh/kubeconform/cmd/kubeconform@v0.8.0`. Binaries land in `$(go env GOPATH)/bin`.

---

## File Structure

**Create:**
- `.github/workflows/ci.yml` — PR/push checks (Class A): `backend`, `workspace-js`, `mobile-doctor`.
- ~~`.github/workflows/codeql.yml`~~ — **NOT created** (REVISED): CodeQL **default setup** is already enabled/green (python + js-ts + actions). See Task 3.
- `.github/workflows/security-audit.yml` — Class A: `pip-audit`, `pnpm-audit`, `trivy-fs`; PR + push + daily.
- `.github/workflows/deploy.yml` — Class B, gated: `build-push` + `deploy`; `push: tags` + dispatch.
- `.github/workflows/terraform.yml` — Class B dispatch `apply` + Class A `fmt`/`validate` on infra PRs.
- `.github/dependabot.yml` — uv + npm + github-actions, grouped, weekly.
- `.github/CODEOWNERS` — `* @aronweiler`.
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml`
- `web/Dockerfile`, `web/.dockerignore`
- `backend/tests/test_db_ssl.py`

**Modify:**
- `backend/app/config.py` — add `db_ssl_root_cert` setting.
- `backend/app/db.py` — build `connect_args={"ssl": ctx}` when configured.
- `infra/k8s/backend.yaml` — mount the DB CA cert + set `DB_SSL_ROOT_CERT` (authored deploy contract for the asyncpg-SSL change).
- `infra/k8s/secrets.yaml` — document the new `database-ca.crt` key (reference only).
- `docker/docker-compose.yml` — add the `web` service (profile `full`).
- `.pre-commit-config.yaml` — add the `actionlint` hook.
- `.gitignore` — un-ignore `infra/terraform/.terraform.lock.hcl`.
- `infra/terraform/.terraform.lock.hcl` — replace single-platform with the 4-platform lock (committed).
- `infra/terraform/README.md`, `infra/README.md`, `claude_help/kubernetes-infra.md` — mark prereqs addressed; document `providers lock` as a read-only local command.
- `claude_help/testing-ci.md` — add the workflow-file references + re-confirm "= CI" parity.
- `README.md` — status badges, Software Versions rows, CI/security prose.
- `docs/setup/README.md` — GitHub security-settings owner steps (what CI auto-enables vs. manual).

**Create (final):**
- `handoffs/2026-06-18-phase-0f-complete-handoff.md`

---

### Task 1: Backend asyncpg TLS connect_args (BLOCKING pre-deploy change)

DO Managed Postgres requires TLS; `asyncpg` rejects libpq `?sslmode=` (see the existing comment in `config.py`). Pass `connect_args={"ssl": ssl.SSLContext}` to `create_async_engine`, built from a CA cert path. Local dev (no cert configured) keeps plaintext — a no-op. Pure helper so it is unit-testable without a database.

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/db.py`
- Test: `backend/tests/test_db_ssl.py` (create)

**Interfaces:**
- Produces: `app.config.Settings.db_ssl_root_cert: str | None` (env `DB_SSL_ROOT_CERT`, default `None`).
- Produces: `app.db.engine_connect_args(settings: Settings) -> dict[str, object]` — `{}` when no cert; `{"ssl": ssl.SSLContext}` (verify-full) when `db_ssl_root_cert` is set.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_db_ssl.py` (the PEM constant below is a throwaway self-signed EC CA generated for this test — it is **not a secret**):

```python
import ssl

import pytest

from app.config import Settings
from app.db import engine_connect_args

# Throwaway self-signed EC CA, used only to prove a real SSLContext is built.
# Not a secret; never used to connect to anything.
TEST_CA_PEM = """-----BEGIN CERTIFICATE-----
MIIBkzCCATmgAwIBAgIUYUUj9bj7XtAFoEDG0Uscm8BhDWEwCgYIKoZIzj0EAwIw
HzEdMBsGA1UEAwwUZm91bnRhaW5yYW5rLXRlc3QtY2EwHhcNMjYwNjE4MTcwNTU2
WhcNMzYwNjE1MTcwNTU2WjAfMR0wGwYDVQQDDBRmb3VudGFpbnJhbmstdGVzdC1j
YTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABJc8G6C6E65F27qfXsjo1uyqTTQa
J54qK2NRPuGaHfyEiXzKawo+ccXfTOCsYjbsYvZ259S2JpIhG1NGImZ1Y+2jUzBR
MB0GA1UdDgQWBBRDkV6y0GD/3Dx44q40KEm6bEIuJTAfBgNVHSMEGDAWgBRDkV6y
0GD/3Dx44q40KEm6bEIuJTAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gA
MEUCIFe7Z6HfddOgX9krJhBIfs/oh2d6r++hiKoJOXoXWneiAiEA+QypLxLpfbk8
CVKAMWACd3257BTVlmt9YRTi6LDPMRs=
-----END CERTIFICATE-----
"""


def test_connect_args_empty_without_cert():
    # Local/dev default: no SSL cert configured -> no connect_args (plaintext).
    assert engine_connect_args(Settings(db_ssl_root_cert=None)) == {}


def test_connect_args_builds_verify_full_ssl_context(tmp_path):
    ca = tmp_path / "ca.pem"
    ca.write_text(TEST_CA_PEM, encoding="utf-8")
    args = engine_connect_args(Settings(db_ssl_root_cert=str(ca)))
    ctx = args["ssl"]
    assert isinstance(ctx, ssl.SSLContext)
    # verify-full: hostname checked + peer cert required.
    assert ctx.check_hostname is True
    assert ctx.verify_mode == ssl.CERT_REQUIRED


def test_connect_args_missing_cert_file_raises(tmp_path):
    missing = tmp_path / "nope.pem"
    with pytest.raises(FileNotFoundError):
        engine_connect_args(Settings(db_ssl_root_cert=str(missing)))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_db_ssl.py -v`
Expected: FAIL — `ImportError: cannot import name 'engine_connect_args'` (and `Settings` has no `db_ssl_root_cert`).

- [ ] **Step 3: Add the setting**

In `backend/app/config.py`, add the field to `Settings` (keep the existing `database_url` comment):

```python
    app_name: str = "fountainrank-backend"
    # Path to the CA cert (PEM) for DO Managed Postgres TLS, mounted as a k8s secret
    # in production (env DB_SSL_ROOT_CERT). Unset locally -> plaintext, no SSL.
    db_ssl_root_cert: str | None = None
```

- [ ] **Step 4: Build connect_args and wire the engine**

In `backend/app/db.py`, add `import ssl` at the top, then add the helper and use it:

```python
import ssl
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def engine_connect_args(settings: Settings) -> dict[str, object]:
    """asyncpg TLS args. asyncpg's key is `ssl` (a SSLContext) — NOT pg8000's
    `ssl_context`, and NOT a libpq `?sslmode=` URL arg (asyncpg rejects those).
    No cert configured -> {} (plaintext, for local dev)."""
    if not settings.db_ssl_root_cert:
        return {}
    # create_default_context() sets check_hostname=True + CERT_REQUIRED == verify-full.
    ctx = ssl.create_default_context(cafile=settings.db_ssl_root_cert)
    return {"ssl": ctx}


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            connect_args=engine_connect_args(settings),
        )
        # expire_on_commit=False avoids the GeoAlchemy2/AsyncSession expired-
        # attribute reload gotcha once geometry columns exist (Phase 1).
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine
```

(Leave `get_sessionmaker` and `get_session` unchanged.)

- [ ] **Step 5: Run the new tests + the full backend check**

Run: `cd backend && uv run pytest tests/test_db_ssl.py -v`
Expected: 3 PASS.
Run (controller, mirrors CI; needs the db container): `./run.ps1 check -Backend`
Expected: ruff + format + alembic upgrade/check + pytest all green (local DB has no SSL → `connect_args == {}`, behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add backend/app/config.py backend/app/db.py backend/tests/test_db_ssl.py
git commit -m "feat(backend): pass asyncpg SSL connect_args for Managed Postgres TLS"
```

---

### Task 2: CI PR-check workflow (`ci.yml`)

The keystone "green CI" deliverable. Mirrors `run.ps1 check` exactly, split into Class-A jobs on `redducklabs-runners`.

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `run.ps1`'s check commands (Global Constraints). The backend job needs a Postgres+PostGIS service identical to the compose `db` (image `postgis/postgis:17-3.5`, user/pw/db `fountainrank`/`fountainrank_dev`/`fountainrank`).
- Produces: status checks named `backend`, `workspace-js`, `mobile-doctor` (used by branch protection after Phase 0). **Mobile lint + type-check are enforced in `workspace-js`** (the workspace-wide `turbo run lint typecheck test` includes `mobile`); `mobile-doctor` adds only `expo-doctor`. Together they equal `run.ps1 check`'s mobile coverage (lint + typecheck + expo-doctor).

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  backend:
    runs-on: redducklabs-runners
    services:
      postgres:
        image: postgis/postgis:17-3.5
        env:
          POSTGRES_USER: fountainrank
          POSTGRES_PASSWORD: fountainrank_dev
          POSTGRES_DB: fountainrank
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U fountainrank -d fountainrank"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 12
    env:
      # asyncpg over the service container. No SSL locally (matches dev/compose).
      DATABASE_URL: postgresql+asyncpg://fountainrank:fountainrank_dev@localhost:5432/fountainrank
    steps:
      - uses: actions/checkout@v6
      - uses: astral-sh/setup-uv@v8.2.0
      - name: Sync backend deps (installs Python 3.13 via uv)
        working-directory: backend
        run: uv sync --frozen
      - name: ruff check
        working-directory: backend
        run: uv run ruff check .
      - name: ruff format --check
        working-directory: backend
        run: uv run ruff format --check .
      - name: alembic upgrade head
        working-directory: backend
        run: uv run alembic upgrade head
      - name: alembic check (no model drift)
        working-directory: backend
        run: uv run alembic check
      - name: pytest
        working-directory: backend
        run: uv run pytest

  # Whole JS/TS workspace: web + mobile + api-client + packages. The workspace-wide
  # turbo run enforces mobile lint+typecheck here (mobile-doctor only adds expo-doctor).
  workspace-js:
    runs-on: redducklabs-runners
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v6.0.9
      - uses: astral-sh/setup-uv@v8.2.0
      - name: Sync backend deps (the `generate` turbo-dep runs the OpenAPI export)
        working-directory: backend
        run: uv sync --frozen
      - name: Install workspace deps
        run: pnpm install --frozen-lockfile
      - name: Lint + type-check + test (turbo across the workspace; runs `generate` first)
        run: pnpm exec turbo run lint typecheck test
      - name: Prettier format check
        run: pnpm run format:check
      - name: Web build
        run: pnpm exec turbo run build --filter=web

  mobile-doctor:
    runs-on: redducklabs-runners
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v6.0.9
      - name: Install workspace deps
        run: pnpm install --frozen-lockfile
      - name: expo-doctor
        working-directory: mobile
        run: pnpm dlx expo-doctor
```

- [ ] **Step 2: Lint the workflow + confirm local parity (controller)**

Run: `actionlint .github/workflows/ci.yml`
Expected: no errors.
Run: `./run.ps1 check` (full local mirror — backend + frontend + mobile)
Expected: "All requested checks passed." (proves the commands CI runs are green on this commit).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR-check workflow (backend, workspace-js, mobile-doctor) on redducklabs-runners"
```

- [ ] **Step 4: Push and verify CI is green (CI-authoritative)**

```bash
git push origin main
gh run list --workflow=ci.yml --limit 1
gh run watch $(gh run list --workflow=ci.yml --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```
Expected: all three jobs conclude `success`. If red, `gh run view <id> --log-failed`, fix the root cause, push, re-watch. **Do not proceed to later tasks until `ci.yml` is green on `main`.**

---

### Task 3: CodeQL — keep GitHub default setup (REVISED; CONTROLLER, no workflow file)

**Revised at implementation (owner-approved 2026-06-18).** CodeQL **default setup is already enabled and green** on the repo, analyzing `python`, `javascript-typescript`, **and** `actions` weekly. GitHub does not allow an advanced `codeql.yml` to run while default setup is enabled (mutually exclusive). Adding the advanced workflow would mean disabling a working, broader scanner — so we **keep default setup** and do **not** create `codeql.yml`. This satisfies spec §17 ("CodeQL for Python + JS/TS, enabled in repo settings"). Default setup runs on GitHub-managed runners — a deliberate exception to the RDL-runner preference, which governs the Class-A jobs we author, not GitHub's managed analysis.

**Files:** none created.

- [ ] **Step 1: Confirm default setup is active (controller)**

Run: `gh api repos/redducklabs/fountainrank/code-scanning/default-setup --jq '{state,languages,schedule}'`
Expected: `state: configured`, languages include `python` + `javascript-typescript`.
Run: `gh api 'repos/redducklabs/fountainrank/code-scanning/analyses?per_page=3' --jq '.[].tool.name'`
Expected: recent `CodeQL` analyses exist (green). No workflow file, commit, or push for this task.

(Plan File Structure no longer lists `codeql.yml`; the README CodeQL badge in Task 12 references the code-scanning page, not a workflow file.)

---

### Task 4: Dependabot config (`.github/dependabot.yml`)

Grouped weekly updates for uv (backend), npm (pnpm workspace at root), and github-actions.

**Files:**
- Create: `.github/dependabot.yml`

**Interfaces:** none consumed; Dependabot reads this file directly.

- [ ] **Step 1: Write the config**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  # `uv` (not `pip`): this is a uv.lock project gated by `uv sync --frozen`, so
  # Dependabot must update pyproject.toml AND uv.lock together. The `pip` ecosystem
  # would update pyproject without maintaining uv.lock -> `uv sync --frozen` fails CI.
  - package-ecosystem: uv
    directory: "/backend"
    schedule:
      interval: weekly
    groups:
      backend-python:
        patterns: ["*"]
    open-pull-requests-limit: 10
    commit-message:
      prefix: "build"

  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    groups:
      frontend-js:
        patterns: ["*"]
    open-pull-requests-limit: 10
    commit-message:
      prefix: "build"

  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    groups:
      gha:
        patterns: ["*"]
    commit-message:
      prefix: "ci"
```

- [ ] **Step 2: Validate + commit (controller)**

Dependabot config is not covered by actionlint. Validate the YAML parses and the required keys exist:
Run: `python -c "import yaml,sys; d=yaml.safe_load(open('.github/dependabot.yml')); assert d['version']==2; assert len(d['updates'])==3; print('ok')"`
Expected: `ok`.

```bash
git add .github/dependabot.yml
git commit -m "ci: add grouped Dependabot config (uv, npm, github-actions)"
git push origin main
```
(Dependabot activates from the file on `main`; the `uv` ecosystem reads `backend/pyproject.toml` + `backend/uv.lock` and updates both together, `npm` reads the root `pnpm-lock.yaml`.)

---

### Task 5: Security audit workflow (`security-audit.yml`)

Active scanning now. **Gating** jobs (fail CI): `pip-audit` (via `uv export`, since `gh-action-pip-audit` predates `uv.lock`), `pnpm audit`, and a `trivy fs` **secret** gate. **Report-only** (SARIF → Security tab, never fail CI): `trivy fs` vuln+misconfig. The **image scan** job (both images, report-only) is appended in **Task 6 Step 6** (it needs `web/Dockerfile`).

**Scanning policy (deliberate — Codex accepted this in review 2):** dependency CVEs gate via `pip-audit`/`pnpm audit`; committed secrets gate via `trivy fs --scanners secret`. Container **image** scanning (added in Task 6) is **report-only with `ignore-unfixed`** — base-image OS CVEs are largely unfixable upstream, so hard-gating on them is a false-red treadmill that would block every merge; we surface them in the Security tab and gate only on fixable issues via `.trivyignore` review. `trivy fs` misconfig is also report-only (k8s/Docker hardening is tracked, not a Phase-0f merge gate). This satisfies spec §17 ("Trivy container scanning + justified `.trivyignore`") without coupling merges to upstream CVE churn.

**Files:**
- Create: `.github/workflows/security-audit.yml` (the `image-scan` job is appended in Task 6)

**Interfaces:**
- Consumes: `.trivyignore` (existing) for suppressions; `backend/uv.lock`; root `pnpm-lock.yaml`. (The image-scan job added in Task 6 also consumes `backend/Dockerfile` + `web/Dockerfile`.)

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/security-audit.yml`:

```yaml
name: Security audit

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: "17 5 * * *" # daily 05:17 UTC — catches CVEs on unchanged deps

concurrency:
  group: security-audit-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  pip-audit:
    runs-on: redducklabs-runners
    steps:
      - uses: actions/checkout@v6
      - uses: astral-sh/setup-uv@v8.2.0
      - name: Export locked backend deps (no hashes; pip-audit --no-deps audits the pinned set)
        working-directory: backend
        # --no-hashes: `uv export` emits a cross-platform hash SUBSET that pip's
        # installer rejects on a single platform (greenlet wheel mismatch). --no-deps
        # makes pip-audit audit exactly the pinned lines without an install/resolve step.
        run: uv export --frozen --no-dev --no-hashes --format requirements-txt -o requirements.txt
      - name: pip-audit (locked runtime deps) — GATE
        working-directory: backend
        run: uvx pip-audit --requirement requirements.txt --no-deps --strict

  pnpm-audit:
    runs-on: redducklabs-runners
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v6.0.9
      - name: Install workspace deps
        run: pnpm install --frozen-lockfile
      - name: pnpm audit (GATE — fail on high/critical)
        run: pnpm audit --audit-level high

  trivy-fs:
    runs-on: redducklabs-runners
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v6
      - name: Trivy filesystem scan (report -> SARIF)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: fs
          scanners: vuln,secret,misconfig
          scan-ref: .
          format: sarif
          output: trivy-fs.sarif
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          trivyignores: .trivyignore
          version: v0.71.1
      - name: Upload Trivy SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-fs.sarif
          category: trivy-fs
      - name: Trivy secret scan (GATE — fail on any committed secret)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: fs
          scanners: secret
          scan-ref: .
          format: table
          exit-code: "1"
          version: v0.71.1
```

> **The `image-scan` job is added in Task 6, not here** — it builds the web image, and `web/Dockerfile` does not exist until Task 6. Adding it now would make this workflow's first push to `main` red (it references a missing file). This task lands the three deps/secret jobs green first; Task 6 Step 6 appends `image-scan` once the web image exists.

- [ ] **Step 2: Confirm the gating audits pass locally (controller)**

Run: `cd backend && uv export --frozen --no-dev --no-hashes --format requirements-txt -o requirements.txt && uvx pip-audit --requirement requirements.txt --no-deps --strict`
Expected: "No known vulnerabilities found" (clean exit; two advisory hash warnings are fine). If a CVE appears, surface it — do **not** suppress without a justification + revisit condition.
Run: `pnpm audit --audit-level high`
Expected: exit 0 (no high/critical).
Run: `actionlint .github/workflows/security-audit.yml`
Expected: no errors.
Delete the throwaway export so it isn't committed: `rm -f backend/requirements.txt`.
(Trivy is not installed locally; the `trivy-fs` secret gate is verified by the CI run in Step 3 — CI is the source of truth.)

- [ ] **Step 3: Commit + push + verify (CI-authoritative)**

```bash
git add .github/workflows/security-audit.yml
git commit -m "ci: add security audit (pip-audit via uv, pnpm audit, Trivy fs)"
git push origin main
gh run watch $(gh run list --workflow=security-audit.yml --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```
Expected: `pip-audit`, `pnpm-audit`, `trivy-fs` all `success`. If `trivy-fs`'s secret gate fails, a real secret was committed — remediate (rotate + remove from history), never `.trivyignore` a secret. (The `image-scan` job is added in Task 6.)

---

### Task 6: Web Docker image + compose service

The deferred web image (needed by the gated `deploy.yml`) plus the local compose service. Multi-stage pnpm build; codegen artifacts (`packages/api-client/openapi.json` + `src/schema.d.ts`) must already exist in the build context — CI runs `pnpm run generate` (Python+uv) before `docker build`. Container listens on **3000** (matches `infra/k8s/web.yaml`), not the dev port 3020.

**Files:**
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`
- Modify: `docker/docker-compose.yml` (add `web` service under profile `full`)
- Modify: `.github/workflows/security-audit.yml` (append the `image-scan` job — Step 6)

**Interfaces:**
- Consumes: build-arg `NEXT_PUBLIC_API_BASE_URL` (inlined at build time; `https://api.fountainrank.com` in prod). The image is built from the **repo root** context.
- Produces: an image serving Next.js on `:3000`; consumed by `deploy.yml` (Task 7), the Task 5 `image-scan` job, and `infra/k8s/web.yaml`.

- [ ] **Step 1: Write `web/.dockerignore`**

Create `web/.dockerignore` (note: with a root-context build, Docker uses the **root** `.dockerignore` if present; this file documents intent and is used if the context is `web/`. To be safe the Dockerfile copies only the paths it needs.) Create it anyway for hygiene:

```
**/node_modules
**/.next
**/.turbo
**/.expo
**/dist
**/build
.git
```

- [ ] **Step 2: Write `web/Dockerfile`**

Create `web/Dockerfile` (non-standalone for determinism in a pnpm workspace — image size is a later optimization):

```dockerfile
# syntax=docker/dockerfile:1
# Built from the REPO ROOT context (pnpm workspace). CI runs `pnpm run generate`
# first so packages/api-client/{openapi.json,src/schema.d.ts} exist in the context.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Manifests first for layer caching. All workspace package.json files are needed
# for pnpm to resolve the frozen lockfile graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api-client/package.json packages/api-client/
COPY web/package.json web/
COPY mobile/package.json mobile/
RUN pnpm install --frozen-lockfile --filter web...
# Sources (codegen artifacts must be present in the context already).
COPY packages/api-client packages/api-client
COPY web web
RUN pnpm --filter web run build

FROM base AS runner
ENV NODE_ENV=production
RUN useradd --system --uid 1001 --user-group --create-home nextjs
COPY --from=build --chown=nextjs:nextjs /repo /repo
USER nextjs
EXPOSE 3000
# Next must listen on 3000 to match infra/k8s/web.yaml (containerPort/targetPort 3000).
CMD ["pnpm", "--filter", "web", "exec", "next", "start", "-p", "3000"]
```

- [ ] **Step 3: Add the compose `web` service**

In `docker/docker-compose.yml`, add under `services:` (after `backend`), and update the top comment that says web is "intentionally NOT containerized":

```yaml
  web:
    profiles: ["full"]
    build:
      context: ..
      dockerfile: web/Dockerfile
      args:
        # NEXT_PUBLIC_* is inlined at BUILD time. For local, the browser calls the
        # host-published backend on :3021. Run `..\run.ps1 generate` BEFORE building
        # so the api-client codegen artifacts exist in the build context.
        NEXT_PUBLIC_API_BASE_URL: "http://localhost:3021"
    depends_on:
      - backend
    ports:
      - "3020:3000"
```

- [ ] **Step 4: Build + run + smoke-test locally (controller)**

```bash
# Codegen must run first (needs Python+uv); produces the artifacts the image copies.
pnpm install --frozen-lockfile
pnpm run generate
# Build from the repo root context.
docker build -f web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com \
  -t fr-web:plan-check .
# Smoke test: serves the homepage on 3000.
docker run -d --rm -p 3099:3000 --name fr-web-check fr-web:plan-check
sleep 8
curl -fsS -o /dev/null -w "%{http_code}\n" http://localhost:3099/   # expect 200
docker rm -f fr-web-check
```
Expected: `docker build` succeeds; `curl` prints `200`. If pnpm complains about the lockfile graph, adjust the `--filter`/copied manifests (controller iterates — this is expected env-heavy work). Also verify `docker compose -f docker/docker-compose.yml build web` succeeds after `run.ps1 generate`.

- [ ] **Step 5: Confirm the manifest still validates (controller)**

The image now exists; re-run the manifest validation from `infra/README.md` to confirm `web.yaml` is unaffected:
Run: `cd infra/k8s && export NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com; for f in *.yaml; do r="$(envsubst < "$f")"; echo "$r" | grep -q '\${' && echo "UNSUBSTITUTED in $f"; echo "$r" | kubeconform -strict -summary -kubernetes-version 1.34.0 -; done`
Expected: all resources Valid; no UNSUBSTITUTED.

- [ ] **Step 6: Append the `image-scan` job to `security-audit.yml`**

Now that `web/Dockerfile` exists, add the report-only image scan to the workflow created in Task 5. In `.github/workflows/security-audit.yml`, add this job under `jobs:` (after `trivy-fs`):

```yaml
  image-scan:
    # Report-only (ignore-unfixed) — see Task 5's scanning policy. Active on push +
    # daily, NOT every PR (image builds are heavy — web needs codegen + a full Next build).
    if: github.event_name != 'pull_request'
    runs-on: redducklabs-runners
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v6.0.9
      - uses: astral-sh/setup-uv@v8.2.0
      - run: uv sync --frozen
        working-directory: backend
      - run: pnpm install --frozen-lockfile
      - run: pnpm run generate # web image needs the api-client codegen artifacts in context
      - name: Build images (no push)
        run: |
          docker build -t fountainrank-backend:scan backend
          docker build -f web/Dockerfile \
            --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com \
            -t fountainrank-web:scan .
      - name: Trivy scan backend image (report -> SARIF)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: fountainrank-backend:scan
          format: sarif
          output: trivy-backend.sarif
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          trivyignores: .trivyignore
          version: v0.71.1
      - name: Upload backend image SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-backend.sarif
          category: trivy-image-backend
      - name: Trivy scan web image (report -> SARIF)
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: fountainrank-web:scan
          format: sarif
          output: trivy-web.sarif
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          trivyignores: .trivyignore
          version: v0.71.1
      - name: Upload web image SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-web.sarif
          category: trivy-image-web
```

Run: `actionlint .github/workflows/security-audit.yml`
Expected: no errors.

- [ ] **Step 7: Commit + push + verify (CI-authoritative)**

```bash
git add web/Dockerfile web/.dockerignore docker/docker-compose.yml .github/workflows/security-audit.yml
git commit -m "build(web): add Next.js Dockerfile + compose service + image scan (listens on :3000)"
git push origin main
gh run watch $(gh run list --workflow=security-audit.yml --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```
Expected: `pip-audit`, `pnpm-audit`, `trivy-fs`, and now `image-scan` (this push is to `main`) all `success`.

---

### Task 7: App deploy workflow + asyncpg-SSL deploy contract — authored, gated, NOT fired

Image build/push to DOCR + DOKS deploy, **plus** the manifest/secret wiring that makes the Task 1 asyncpg-SSL change real (CA cert mounted + `DB_SSL_ROOT_CERT` set). Class B (`ubuntu-latest`, `production` environment). Triggers on `push: tags: ['v*.*.*']` (a release **tag push**) + `workflow_dispatch` — **not** a GitHub `release` event, and never routine pushes to `main`. **Will not run** until an owner pushes a `v*.*.*` tag after the `infra/terraform/README.md` prerequisites (incl. supplying the `DATABASE_CA_CERT` secret).

> **Why the SSL wiring is here, not deferred:** the Task 1 code returns `connect_args={}` when no cert is configured. Without `DB_SSL_ROOT_CERT` + a mounted CA, the first deploy connects **plaintext** → DO Managed Postgres (TLS-required) rejects it, and the `alembic upgrade head` exec below fails. The contract must be authored now even though it is not fired. The cert **value** (`DATABASE_CA_CERT`) is owner-supplied at fire time.

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `infra/k8s/backend.yaml` (mount the CA cert + `DB_SSL_ROOT_CERT`)
- Modify: `infra/k8s/secrets.yaml` (document the `database-ca.crt` key — reference only)

**Interfaces:**
- Consumes (Environment `production` secrets/vars — names only): secrets `DIGITALOCEAN_ACCESS_TOKEN`, `DATABASE_URL`, `LOGTO_DB_URL`, **`DATABASE_CA_CERT`** (the DO Managed-Postgres CA PEM; not strictly secret but carried alongside); vars `DO_REGISTRY` (`fountainrank`), `DO_REGION` (`sfo3`). envsubst vars `NAMESPACE`/`ENVIRONMENT`/`IMAGE_TAG`/`REGISTRY`/`DOMAIN` per `infra/README.md`. k8s apply set: `namespace.yaml`, `backend.yaml`, `web.yaml`, `logto.yaml`, `ingress.yaml`. The `fountainrank-secrets` keys are now `database-url`, `logto-db-url`, **`database-ca.crt`**.

- [ ] **Step 1: Wire the CA cert + version label into `backend.yaml`**

Two edits to `infra/k8s/backend.yaml`:

**(a)** Add a `version: ${IMAGE_TAG}` label to `spec.template.metadata.labels` (so the deploy's migration step can select the new image's pod — not an old one — by label). The pod template metadata becomes:

```yaml
  template:
    metadata:
      labels:
        app: fountainrank-backend
        component: backend
        version: ${IMAGE_TAG}
```

(Do **not** add `version` to `spec.selector.matchLabels` — the selector must stay `app: fountainrank-backend` and immutable.)

**(b)** Under the pod `spec:` (sibling of `imagePullSecrets:`/`containers:`), add a `volumes:` block; add the `DB_SSL_ROOT_CERT` env var right after `DATABASE_URL`; and add a `volumeMounts:` block to the `backend` container. The resulting `spec:` is:

```yaml
    spec:
      imagePullSecrets:
        - name: regcred
      volumes:
        - name: db-ca
          secret:
            secretName: fountainrank-secrets
            items:
              - key: database-ca.crt
                path: database-ca.crt
      containers:
        - name: backend
          image: ${REGISTRY}/fountainrank-backend:${IMAGE_TAG}
          ports:
            - containerPort: 8000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: fountainrank-secrets
                  key: database-url
            # asyncpg verify-full TLS to DO Managed Postgres. The CA is mounted from
            # fountainrank-secrets.database-ca.crt; the backend builds the SSLContext
            # from this path (app/db.py::engine_connect_args). Required in prod.
            - name: DB_SSL_ROOT_CERT
              value: /var/run/secrets/fountainrank/database-ca.crt
          volumeMounts:
            - name: db-ca
              mountPath: /var/run/secrets/fountainrank
              readOnly: true
```

(Leave the existing `resources:`/probes and the Service unchanged.)

- [ ] **Step 2: Document the new secret key in `secrets.yaml`**

In `infra/k8s/secrets.yaml` (reference-only), add under `stringData:` (after `logto-db-url`):

```yaml
  # REQUIRED in prod. The DO Managed-Postgres CA cert (PEM). Mounted into the backend
  # at /var/run/secrets/fountainrank/database-ca.crt; the app builds an asyncpg
  # verify-full SSLContext from it (DB_SSL_ROOT_CERT). Get it from `doctl databases
  # get <id>` / the DO console. Created imperatively in deploy.yml from the
  # `production` env secret DATABASE_CA_CERT — never committed.
  database-ca.crt: ""
```

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    tags: ["v*.*.*"] # release TAG push only — never routine pushes to main
  workflow_dispatch:
    inputs:
      image_tag:
        description: "Image tag to build/deploy (defaults to the git SHA)"
        required: false
        default: ""

concurrency:
  group: deploy-production
  cancel-in-progress: false

permissions:
  contents: read

env:
  CLUSTER_NAME: fountainrank-production-cluster
  NAMESPACE: fountainrank
  ENVIRONMENT: production
  DOMAIN: fountainrank.com

jobs:
  build-push:
    name: Build + push images
    runs-on: ubuntu-latest # Class B: handles registry credentials
    environment: production
    permissions:
      contents: read
      security-events: write
    outputs:
      image_tag: ${{ steps.tag.outputs.image_tag }}
    steps:
      - uses: actions/checkout@v6
      - name: Resolve image tag
        id: tag
        env:
          INPUT_TAG: ${{ github.event.inputs.image_tag }}
        run: |
          TAG="$INPUT_TAG"
          if [ -z "$TAG" ]; then TAG="${GITHUB_SHA::12}"; fi
          # IMAGE_TAG is reused as a Docker tag AND a k8s label value (backend pod
          # `version` label). Enforce the intersection: a valid k8s label value
          # (<=63 chars, alnum + -._, alnum ends). Tag pushes (v1.2.3) + SHAs pass;
          # a malformed manual workflow_dispatch image_tag fails fast here.
          if ! printf '%s' "$TAG" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$'; then
            echo "::error::image_tag '$TAG' is not a valid Docker tag / k8s label value"; exit 1
          fi
          echo "image_tag=$TAG" >> "$GITHUB_OUTPUT"
      - uses: digitalocean/action-doctl@v2.5.2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      - name: Registry login
        run: doctl registry login --expiry-seconds 1200
      # Frontend codegen (Python+uv) must run before the web image build, since the
      # web Dockerfile expects packages/api-client/{openapi.json,schema.d.ts} in context.
      - uses: actions/setup-node@v6
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v6.0.9
      - uses: astral-sh/setup-uv@v8.2.0
      - run: uv sync --frozen
        working-directory: backend
      - run: pnpm install --frozen-lockfile
      - run: pnpm run generate
      - name: Build + push backend
        env:
          REGISTRY: registry.digitalocean.com/${{ vars.DO_REGISTRY }}
          IMAGE_TAG: ${{ steps.tag.outputs.image_tag }}
        run: |
          docker build -t "$REGISTRY/fountainrank-backend:$IMAGE_TAG" backend
          docker push "$REGISTRY/fountainrank-backend:$IMAGE_TAG"
      - name: Build + push web
        env:
          REGISTRY: registry.digitalocean.com/${{ vars.DO_REGISTRY }}
          IMAGE_TAG: ${{ steps.tag.outputs.image_tag }}
        run: |
          docker build -f web/Dockerfile \
            --build-arg NEXT_PUBLIC_API_BASE_URL="https://api.${DOMAIN}" \
            -t "$REGISTRY/fountainrank-web:$IMAGE_TAG" .
          docker push "$REGISTRY/fountainrank-web:$IMAGE_TAG"
      # Image scans are report-only (ignore-unfixed) — see Task 5's scanning policy.
      - name: Trivy image scan (backend) — report -> SARIF
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: registry.digitalocean.com/${{ vars.DO_REGISTRY }}/fountainrank-backend:${{ steps.tag.outputs.image_tag }}
          format: sarif
          output: trivy-backend.sarif
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          trivyignores: .trivyignore
          version: v0.71.1
      - name: Upload backend image SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-backend.sarif
          category: trivy-image-backend
      - name: Trivy image scan (web) — report -> SARIF
        uses: aquasecurity/trivy-action@v0.36.0
        with:
          scan-type: image
          image-ref: registry.digitalocean.com/${{ vars.DO_REGISTRY }}/fountainrank-web:${{ steps.tag.outputs.image_tag }}
          format: sarif
          output: trivy-web.sarif
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          trivyignores: .trivyignore
          version: v0.71.1
      - name: Upload web image SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: trivy-web.sarif
          category: trivy-image-web

  deploy:
    name: Deploy to DOKS
    needs: build-push
    runs-on: ubuntu-latest # Class B: handles cluster + DB credentials
    environment: production
    env:
      IMAGE_TAG: ${{ needs.build-push.outputs.image_tag }}
      REGISTRY: registry.digitalocean.com/${{ vars.DO_REGISTRY }}
    steps:
      - uses: actions/checkout@v6
      - uses: digitalocean/action-doctl@v2.5.2
        with:
          token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      - name: Save kubeconfig
        run: doctl kubernetes cluster kubeconfig save "$CLUSTER_NAME"
      - uses: azure/setup-helm@v5
        with:
          version: v3.21.1
      - name: Install/upgrade ingress-nginx (NodePort 30080/30443)
        run: |
          helm upgrade --install ingress-nginx ingress-nginx \
            --repo https://kubernetes.github.io/ingress-nginx \
            --version 4.15.1 \
            --namespace ingress-nginx --create-namespace \
            --set controller.service.type=NodePort \
            --set controller.service.nodePorts.http=30080 \
            --set controller.service.nodePorts.https=30443 \
            --set controller.config.use-forwarded-headers="true" \
            --set controller.config.compute-full-forwarded-for="true" \
            --set controller.config.use-proxy-protocol="false" \
            --wait
      - name: Render + apply namespace first
        run: |
          export NAMESPACE ENVIRONMENT IMAGE_TAG REGISTRY DOMAIN
          envsubst < infra/k8s/namespace.yaml | kubectl apply -f -
      # Secrets are passed via env (never interpolated into the shell — DATABASE_CA_CERT
      # is a multiline PEM; URLs can contain shell-significant chars). The CA PEM is
      # written to a temp file and loaded with --from-file so newlines survive intact.
      - name: Create app + registry secrets imperatively
        env:
          DATABASE_URL_SECRET: ${{ secrets.DATABASE_URL }}
          LOGTO_DB_URL_SECRET: ${{ secrets.LOGTO_DB_URL }}
          DATABASE_CA_CERT: ${{ secrets.DATABASE_CA_CERT }}
          DO_REGISTRY: ${{ vars.DO_REGISTRY }}
        run: |
          tmp="$(mktemp -d)"
          trap 'rm -rf "$tmp"' EXIT
          printf '%s\n' "$DATABASE_CA_CERT" > "$tmp/database-ca.crt"
          kubectl create secret generic fountainrank-secrets \
            -n "$NAMESPACE" \
            --from-literal=database-url="$DATABASE_URL_SECRET" \
            --from-literal=logto-db-url="$LOGTO_DB_URL_SECRET" \
            --from-file=database-ca.crt="$tmp/database-ca.crt" \
            --dry-run=client -o yaml | kubectl apply -f -
          doctl registry kubernetes-manifest "$DO_REGISTRY" \
            --name regcred --namespace "$NAMESPACE" | kubectl apply -f -
      - name: Render + apply workloads
        run: |
          export NAMESPACE ENVIRONMENT IMAGE_TAG REGISTRY DOMAIN
          for f in backend web logto ingress; do
            envsubst < "infra/k8s/$f.yaml" | kubectl apply -f -
          done
      # Migrations run BEFORE gating backend readiness: /readyz runs a PostGIS query,
      # and PostGIS is enabled by migration 0001. The pod reaches Running (DB-free
      # /healthz startup probe) but is NOT Ready until the migration runs — so gating
      # rollout first would deadlock. Select the NEW image's pod by its `version`
      # label (= IMAGE_TAG) so re-deploys never exec the old pod / old image.
      - name: Run DB migrations (before rollout gate)
        run: |
          kubectl -n "$NAMESPACE" wait --for=jsonpath='{.status.phase}'=Running \
            pod -l "app=fountainrank-backend,version=$IMAGE_TAG" --timeout=150s
          POD="$(kubectl -n "$NAMESPACE" get pod \
            -l "app=fountainrank-backend,version=$IMAGE_TAG" \
            -o jsonpath='{.items[0].metadata.name}')"
          kubectl -n "$NAMESPACE" exec "$POD" -- alembic upgrade head
      - name: Wait for rollouts
        run: |
          kubectl -n "$NAMESPACE" rollout status deploy/fountainrank-backend --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/fountainrank-web --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/logto --timeout=180s
          kubectl -n "$NAMESPACE" rollout status deploy/healthz --timeout=120s
```

- [ ] **Step 4: Lint + render the apply set (controller)**

Run: `actionlint .github/workflows/deploy.yml`
Expected: no errors.
Run the manifest render/validate (the deploy applies these — confirms the `backend.yaml` CA-cert edits are still valid k8s): same `envsubst | kubeconform` loop as Task 6 Step 5 over all of `infra/k8s/*.yaml`.
Expected: all Valid; no UNSUBSTITUTED. (There is **no** push/dispatch here — the workflow stays dormant until an owner fires it.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml infra/k8s/backend.yaml infra/k8s/secrets.yaml
git commit -m "ci: add gated DOKS deploy + wire asyncpg-SSL CA cert into the deploy contract"
git push origin main
```

---

### Task 8: Terraform workflow (`terraform.yml`) — authored, gated, NOT fired

Read-only `fmt`/`validate` on infra PRs (Class A); state-mutating `plan`/`apply` via `workflow_dispatch` only (Class B, `production`). Infra provisioning is deliberate — it is **not** tied to release tags (it must not re-provision the cluster/DB/DNS on every app release).

**Files:**
- Create: `.github/workflows/terraform.yml`

**Interfaces:**
- Consumes (Environment `production`): secrets `DIGITALOCEAN_ACCESS_TOKEN`, `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY`. The S3 backend reads Spaces keys via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`; the provider reads `TF_VAR_do_token`/`TF_VAR_spaces_access_id`/`TF_VAR_spaces_secret_key`.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/terraform.yml`:

```yaml
name: Terraform

on:
  pull_request:
    branches: [main]
    paths: ["infra/terraform/**"]
  workflow_dispatch:
    inputs:
      action:
        description: "Terraform action"
        required: true
        default: plan
        type: choice
        options: [plan, apply]

concurrency:
  group: terraform-production
  cancel-in-progress: false

permissions:
  contents: read

defaults:
  run:
    working-directory: infra/terraform

jobs:
  # Class A: read-only, no secrets, no backend. Runs on infra PRs.
  validate:
    if: github.event_name == 'pull_request'
    runs-on: redducklabs-runners
    steps:
      - uses: actions/checkout@v6
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: 1.15.6
      - run: terraform fmt -check -recursive
      - run: terraform init -backend=false
      - run: terraform validate

  # Class B: state-mutating, manual dispatch only.
  apply:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment: production
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.SPACES_ACCESS_KEY }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.SPACES_SECRET_KEY }}
      TF_VAR_do_token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}
      TF_VAR_spaces_access_id: ${{ secrets.SPACES_ACCESS_KEY }}
      TF_VAR_spaces_secret_key: ${{ secrets.SPACES_SECRET_KEY }}
    steps:
      - uses: actions/checkout@v6
      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: 1.15.6
      - run: terraform init
      - name: Terraform plan
        run: terraform plan -input=false -out=tfplan
      - name: Terraform apply
        if: github.event.inputs.action == 'apply'
        run: terraform apply -input=false -auto-approve tfplan
```

- [ ] **Step 2: Lint + local read-only validate (controller)**

Run: `actionlint .github/workflows/terraform.yml`
Expected: no errors.
Run: `cd infra/terraform && terraform fmt -check -recursive && terraform init -backend=false && terraform validate`
Expected: fmt clean; init downloads the provider; `validate` → "Success!". (No backend, no apply — read-only.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/terraform.yml
git commit -m "ci: add Terraform workflow (PR fmt/validate; gated dispatch apply)"
git push origin main
```

---

### Task 9: Commit the multi-platform Terraform provider lock (CONTROLLER)

`terraform providers lock` contacts only the provider registry (no backend/state/cloud) — it is a read-only-against-infrastructure op, safe to run locally. Generate hashes for all platforms CI/devs use, un-ignore, and commit. This retires prerequisite #2 in `infra/terraform/README.md`.

**Files:**
- Modify: `.gitignore` (remove the `infra/terraform/.terraform.lock.hcl` ignore line + its comment)
- Modify: `infra/terraform/.terraform.lock.hcl` (regenerated, committed)
- Modify: `infra/terraform/README.md`, `infra/README.md`, `claude_help/kubernetes-infra.md`

- [ ] **Step 1: Generate the 4-platform lock (controller)**

```bash
cd infra/terraform
terraform init -backend=false
terraform providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64 \
  -platform=windows_amd64 \
  -platform=windows_386
```
(`windows_386` is included because the repo's local Terraform is the 32-bit Windows build — its omission would break local `init -backend=false`.)
Run: `grep -c 'hashes' .terraform.lock.hcl` and confirm the file lists `digitalocean/digitalocean` with `h1:`/`zh:` hashes for all four platforms (visually inspect; expect entries for each).
Expected: a `.terraform.lock.hcl` with the DO provider pinned (`2.90.0` or newer under `~> 2.0`) and hashes for the four platforms.

- [ ] **Step 2: Un-ignore the lock**

In `.gitignore`, delete the final block (the comment paragraph + the `infra/terraform/.terraform.lock.hcl` line). Leave the other `infra/terraform/*` ignores intact.

- [ ] **Step 3: Update the docs that said "CI generates the lock"**

- `infra/terraform/README.md`: change prerequisite #1 to state the multi-platform lock is now committed (generated locally via `terraform providers lock`, registry-only); drop the "gitignored until then" caveat.
- `claude_help/kubernetes-infra.md`: add `terraform providers lock -platform=...` to the allowed local read-only commands, noting it is registry-only (no backend/state/cloud access).
- `infra/README.md`: no change needed unless it repeats the "CI generates the lock" claim — if so, align it.

- [ ] **Step 4: Verify + commit (controller)**

Run: `cd infra/terraform && terraform init -backend=false && terraform validate`
Expected: init succeeds against the committed lock; `validate` → "Success!".

```bash
git add .gitignore infra/terraform/.terraform.lock.hcl infra/terraform/README.md infra/README.md claude_help/kubernetes-infra.md
git commit -m "build(infra): commit multi-platform Terraform provider lock"
git push origin main
```

---

### Task 10: Governance files + actionlint pre-commit hook

CODEOWNERS, issue/PR templates, and the `actionlint` pre-commit hook (so the new workflows are linted on commit).

**Files:**
- Create: `.github/CODEOWNERS`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml`
- Modify: `.pre-commit-config.yaml`

- [ ] **Step 1: CODEOWNERS**

Create `.github/CODEOWNERS`:

```
# Default owner for everything in this repo.
* @aronweiler
```

- [ ] **Step 2: PR template**

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
## Summary

<!-- What does this change and why? Link the spec/plan/issue. -->

## Changes

-

## Testing

<!-- Commands run + results. CI is the source of truth; do not claim green without it. -->

- [ ] `./run.ps1 check` passes locally
- [ ] CI is green
- [ ] Codex review: `VERDICT: APPROVED` (post-Phase-0)

## Notes

<!-- Migrations, infra/cluster impact, security considerations, follow-ups. -->
```

- [ ] **Step 3: Issue templates**

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: https://github.com/redducklabs/fountainrank/security/advisories/new
    about: Report security issues privately — do NOT open a public issue (see SECURITY.md).
```

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
name: Bug report
description: Report a defect in the backend, web, mobile, or infra.
labels: [bug]
body:
  - type: dropdown
    id: component
    attributes:
      label: Component
      options: [backend, web, mobile, infra, other]
    validations:
      required: true
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: What did you expect, and what happened instead?
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. ...
        2. ...
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environment
      description: OS, browser/device, commit SHA.
    validations:
      required: false
```

Create `.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
name: Feature request
description: Suggest an enhancement.
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What problem would this solve?
    validations:
      required: true
  - type: textarea
    id: proposal
    attributes:
      label: Proposed solution
    validations:
      required: false
```

- [ ] **Step 4: Add the actionlint pre-commit hook**

In `.pre-commit-config.yaml`, add this repo block (after the `gitleaks` block, before `ruff-pre-commit`):

```yaml
  - repo: https://github.com/rhysd/actionlint
    rev: v1.7.12
    hooks:
      - id: actionlint
```

- [ ] **Step 5: Validate + commit (controller)**

Run: `python -c "import yaml; [yaml.safe_load(open(f)) for f in ['.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','.github/ISSUE_TEMPLATE/config.yml','.pre-commit-config.yaml']]; print('ok')"`
Expected: `ok`.
Run (if `pre-commit` is available): `pre-commit run actionlint --all-files`
Expected: passes (actionlint already run manually in earlier tasks).

```bash
git add .github/CODEOWNERS .github/PULL_REQUEST_TEMPLATE.md .github/ISSUE_TEMPLATE/ .pre-commit-config.yaml
git commit -m "chore: add CODEOWNERS, issue/PR templates, actionlint pre-commit hook"
git push origin main
```

---

### Task 11: Enable repo security features (CONTROLLER)

Secret scanning, push protection, Dependabot security updates, vulnerability alerts — via `gh api` (the owner has org admin). Document what is auto vs. manual.

**Files:**
- Modify: `docs/setup/README.md` (add a "GitHub security settings" subsection)

- [ ] **Step 1: Enable features (controller)**

```bash
# Secret scanning + push protection
gh api -X PATCH repos/redducklabs/fountainrank \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
# Vulnerability alerts (Dependabot alerts)
gh api -X PUT repos/redducklabs/fountainrank/vulnerability-alerts
# Dependabot automated security fixes
gh api -X PUT repos/redducklabs/fountainrank/automated-security-fixes
```
Run: `gh api repos/redducklabs/fountainrank --jq '.security_and_analysis'`
Expected: `secret_scanning` + `secret_scanning_push_protection` show `enabled`.
If any call returns 403 (insufficient scope/permission), record it as a manual owner step in the doc instead of failing the task.

- [ ] **Step 2: Document in `docs/setup/README.md`**

Add a subsection listing: what the workflows provide (CodeQL, Trivy, pip-audit/pnpm audit, Dependabot version PRs) and what is a one-time GitHub Settings toggle (secret scanning + push protection, Dependabot alerts/security updates), plus the complete `production` Environment secret/var inventory the gated CD needs:
- **Secrets:** `DIGITALOCEAN_ACCESS_TOKEN`, `SPACES_ACCESS_KEY`, `SPACES_SECRET_KEY`, `DATABASE_URL`, `LOGTO_DB_URL`, **`DATABASE_CA_CERT`** (the DO Managed-Postgres CA PEM; not committed; used to create the `database-ca.crt` key in `fountainrank-secrets` for the backend's asyncpg verify-full TLS).
- **Vars:** `DO_REGISTRY`, `DO_REGION`.

- [ ] **Step 3: Commit**

```bash
git add docs/setup/README.md
git commit -m "docs(setup): document GitHub security settings + production env inventory"
git push origin main
```

---

### Task 12: Docs, README badges, and the Phase 0f handoff

Final docs pass: status badges, Software Versions rows, CI/security prose, testing-ci parity note, and the resume-here handoff.

**Files:**
- Modify: `README.md`
- Modify: `claude_help/testing-ci.md`
- Create: `handoffs/2026-06-18-phase-0f-complete-handoff.md`

- [ ] **Step 1: README badges**

At the top of `README.md` (under the title), add:

```markdown
[![CI](https://github.com/redducklabs/fountainrank/actions/workflows/ci.yml/badge.svg)](https://github.com/redducklabs/fountainrank/actions/workflows/ci.yml)
[![Security audit](https://github.com/redducklabs/fountainrank/actions/workflows/security-audit.yml/badge.svg)](https://github.com/redducklabs/fountainrank/actions/workflows/security-audit.yml)
```

(No CodeQL workflow-file badge — CodeQL uses GitHub **default setup**, which has no `codeql.yml`. The security prose in Step 3 names CodeQL as active; link "Code scanning" to `https://github.com/redducklabs/fountainrank/security/code-scanning` if a link is wanted.)

- [ ] **Step 2: Software Versions rows**

In the `## Software Versions` table, add rows (Last checked `2026-06-18`):

```markdown
| GitHub Actions (checkout/setup-node/setup-uv) | v6 / v6 / v8.2.0 | 2026-06-18 |
| CodeQL action | v4 | 2026-06-18 |
| Trivy | 0.71.1 (action 0.36.0) | 2026-06-18 |
| actionlint | v1.7.12 | 2026-06-18 |
| kubeconform | v0.8.0 | 2026-06-18 |
| ingress-nginx chart | 4.15.1 (app 1.15.1) | 2026-06-18 |
| Helm | v3.21.1 | 2026-06-18 |
```

(Also bump the Terraform row note to `1.15.6` as the current CI-pinned CLI, keeping `>= 1.6` as the provider constraint.)

- [ ] **Step 3: CI/security prose + testing-ci parity**

- `README.md` `## Contributing & security`: add one line naming the active scanners (CodeQL, Trivy, pip-audit/pnpm audit, secret scanning + push protection, Dependabot) and that deploys are gated/CI-only.
- `claude_help/testing-ci.md`: under "Local checks (mirror CI)", add a line pointing to `.github/workflows/ci.yml` as the authoritative mirror, and re-confirm the `= CI` parity now that the workflow exists (`backend` job = `check -Backend`; `workspace-js` job = workspace-wide `turbo lint/typecheck/test` — which enforces mobile lint+typecheck — plus `format:check` + web build; `mobile-doctor` = expo-doctor).

- [ ] **Step 4: Write the handoff**

Create `handoffs/2026-06-18-phase-0f-complete-handoff.md` (supersedes the 0e handoff): TL;DR of what landed (the five workflows, Dependabot, governance, web image, backend SSL, provider lock, repo security settings); confirm CI green on `main` (with the run URLs); restate the **first-live-apply/deploy** prerequisites still owned by the owner (external registrations, `production` DB secrets `DATABASE_URL`/`LOGTO_DB_URL`, sizing/cost review, the DB CA cert mounted for the backend SSL path, registry import check); and the next phase (Phase 1 — data model + fountains API). Note the CD trigger model (app `deploy.yml` on `v*.*.*` tags + dispatch; `terraform.yml` dispatch-only).

- [ ] **Step 5: Commit + final CI confirmation (controller)**

```bash
git add README.md claude_help/testing-ci.md handoffs/2026-06-18-phase-0f-complete-handoff.md
git commit -m "docs: add CI/security badges, version rows, and Phase 0f handoff"
git push origin main
```
Run: `gh run list --limit 6`
Expected: latest `CI`, `CodeQL`, `Security audit` runs on `main` all `success`. If any is red, fix the root cause before declaring the phase done.

---

## Self-Review

**1. Spec coverage (§16 CI/CD, §17 Security, §21 Phase-0f scope):**
- §16 GitHub Actions on `redducklabs-runners` + secret jobs on `ubuntu-latest` → Tasks 2,3,5 (Class A) + 7,8 (Class B). ✅
- §16 PR checks (backend/web/mobile lint+type+test) → Task 2. ✅
- §16 image build/push to DOCR + DOKS deploy via `doctl` + `envsubst | kubectl apply` + `rollout status` + `kubectl exec` migrations → Task 7. ✅
- §16 rollout gate (not `wait --for=available`) → Task 7 uses `rollout status`. ✅
- §17 CodeQL (Python + JS/TS) → Task 3: GitHub **default setup** (already enabled/green; python + js-ts + actions). No advanced workflow (would conflict). ✅
- §17 Dependabot (uv/npm/github-actions, grouped) → Task 4. ✅
- §17 secret scanning + push protection, advisories → Task 11. ✅
- §17 Trivy + `.trivyignore`; pip-audit + pnpm audit in CI + daily → Task 5: `pip-audit`/`pnpm audit` **gate**; `trivy fs` secret **gate** + vuln/misconfig report. Both images scanned **report-only** (`ignore-unfixed`) via the `image-scan` job appended in Task 6 (push+daily) and at release (Task 7). Scanning policy accepted by Codex (review 2). ✅
- §17 CODEOWNERS → Task 10. SECURITY.md already exists (0a). ✅
- §17 pre-commit mirroring CI → already present (0b/0c); Task 10 adds actionlint. ✅ `.gitattributes` LF already present (0a). ✅
- §21 issue templates → Task 10. ✅ README Software Versions → Task 12. ✅
- BLOCKING asyncpg SSL (handoff/infra README) → Task 1 (code) **+ Task 7 (deploy contract: CA mount + `DB_SSL_ROOT_CERT` in `backend.yaml`, `database-ca.crt` secret key)**. ✅ web Dockerfile + compose (deferred from 0d) → Task 6. ✅ provider lock → Task 9. ✅
- Owner decision honored: Layer 2 authored + gated; app CD on **`v*.*.*` tag push** + dispatch; terraform on dispatch; nothing fired. ✅

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N"/"write tests for the above". Every code/YAML step carries full content. The one acknowledged iteration point (web Docker pnpm `--filter` graph) is an explicit controller verification step with a concrete build+curl test, not a placeholder. ✅

**3. Type consistency:** `engine_connect_args(settings)` and `Settings.db_ssl_root_cert` used identically in Task 1 code + tests. envsubst var set (`NAMESPACE`/`ENVIRONMENT`/`IMAGE_TAG`/`REGISTRY`/`DOMAIN`) and the apply set (`namespace,backend,web,logto,ingress`) match `infra/README.md` and Tasks 6/7. Secret keys `database-url`/`logto-db-url` and pull secret `regcred` match `infra/k8s/*`. Cluster name `fountainrank-production-cluster` matches `main.tf` (`${project_name}-${environment}-cluster`). ✅

**Deferred to the first-live-apply (owner-triggered, NOT this phase):** registry import check (prereq #3), sizing/cost review (#4), and supplying the `production` Environment secret **values** the gated CD reads — `DATABASE_URL`, `LOGTO_DB_URL`, and `DATABASE_CA_CERT` (the DO Managed-Postgres CA PEM). The asyncpg-SSL **wiring** (code + `backend.yaml` mount + `DB_SSL_ROOT_CERT` + secret key) is authored in this phase (Tasks 1 + 7); only the cert value is owner-supplied at fire time. These are recorded in the Task 12 handoff.

---

## Execution Handoff

Plan complete. Recommended execution: **subagent-driven** (REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`) — a fresh implementer subagent per task with a two-stage review, while the **controller** runs all env-heavy verification (docker, terraform, uv, gh, actionlint, kubeconform, `run.ps1 check`) and the `gh run watch` CI gating, exactly as in Phases 0d/0e. Tasks 9 and 11 are controller-run.
