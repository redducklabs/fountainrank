# Handoff — FountainRank (Email LIVE; Phase 2a + Email merged & deployed; auth email working)

**Date:** 2026-06-19 (evening PDT; some prod timestamps below are early 2026-06-20 UTC)
**From:** In-repo Claude session (Phase 2a → deploy v0.2.0; then the Email sub-project → PR #14 → deploy v0.3.0; configured + verified Logto auth email end-to-end)
**To:** A fresh Claude/Codex instance in `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here". Read this + `CLAUDE.md` + the spec(s) and continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-19-phase-2a-merged-deployed-handoff.md` (Phase 2a is unchanged from there; this adds Email + the live-email config + the moderation tickets).

---

## TL;DR

1. **System is LIVE at `v0.3.0`.** Prod runs: Phase 1 data model + fountains API, **Phase 2a** Logto JWT auth (backend validates Logto JWTs; writes closed until a client mints real tokens), **Email** (transactional auth email via Gmail), and the web **privacy/terms** pages.
2. **Auth email works end-to-end (verified).** Logto's **HTTP email connector** → `POST /internal/email` (token-authed, in-cluster) on the backend → Jinja2 template → **Gmail API** (service-account JWT-bearer + domain-wide delegation, impersonating `noreply@fountainrank.com`). A live Logto test send returned `200` / `"email sent"` (to `aron@aronweiler.com`). SPF/DKIM/DMARC pass.
3. **`main` @ `d3acb65`** (Email PR #14, squash-merged). Tag **`v0.3.0`** deployed. Tags: `v0.1.0/1/2`, `v0.2.0` (Phase 1+2a), `v0.3.0` (Email + legal pages).

---

## ▶ RESUME HERE — next work

Each gets its own **spec → plan → Codex Loop A APPROVED → subagent-driven implement → PR → CI green → Codex Loop B APPROVED → squash-merge → (owner-gated) tag-deploy** (the exact flow used for Phase 2a and Email). See `claude_help/codex-review-process.md` + `claude_help/development-process.md`.

- **Phase 2 remaining auth sub-projects** (so a real Logto JWT round-trips and writes open):
  1. **Web** — Logto Next.js SDK (auth-code+PKCE, server session) + set `NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com` at **web build time** (`web/Dockerfile` build-arg + `deploy.yml`). The web Logto app is registered; config values live in GitHub `production` (`LOGTO_ENDPOINT`, `LOGTO_APP_ID`/`LOGTO_APP_SECRET`, `LOGTO_COOKIE_SECRET` — placeholders set, owner fills real values). Note the SDK's `baseUrl` must be `https://fountainrank.com` in prod and the Logto web app's redirect URIs must match (`https://fountainrank.com/callback`).
  2. **Mobile** — Logto React Native SDK (native OAuth via `expo-auth-session`; `expo-apple-authentication` for Apple), secure token storage; native app id placeholder `LOGTO_NATIVE_APP_ID`.
  3. **Apple sign-in** — gated on the owner's Apple Developer enrollment (Services ID + key → Logto Apple connector).
  - **Backend API Resource** must be registered in Logto (identifier `https://api.fountainrank.com`) so clients can mint JWTs with `aud` the backend validates (Phase 2a). Confirm this exists.
- **Trust & Safety / moderation** (tickets filed, not started): **#10** user blocking, **#11** report→moderation queue, **#12** admin moderation queue + content removal, **#13** admin account bans. Each needs new tables (`user_blocks`, `content_reports`, `moderation_actions`), the `users.is_admin` gate, soft-delete + ranking recompute, and a ban write-guard. See the issue bodies.

---

## What's deployed / live now

- **Backend** (`api.fountainrank.com`): Phase 1 API (`/api/v1`), Phase 2a JWT auth (`app/logto_auth.py` + dual-path `app/auth.py`; `dev_auth_enabled=False` in prod → writes closed), Email webhook (`app/routers/email_webhook.py`, `app/email/`). `/healthz` 200, public reads 200, writes 401 without a valid Logto JWT.
- **Logto** (`auth.fountainrank.com`): emits **https** OIDC (Phase 2a `TRUST_PROXY_HEADER=1`); **HTTP email connector configured + working**. Admin console is **port-forward only** (not publicly exposed): `kubectl -n fountainrank port-forward deploy/logto 3002:3002` → `http://localhost:3002`.
- **Web** (`fountainrank.com`): landing + **/privacy** + **/terms** pages.

---

## Email sub-project (PR #14) — details + the one gotcha

- **Architecture:** Logto HTTP email connector POSTs `{to, type, payload:{code,locale}}` to `http://fountainrank-backend-service/internal/email` (in-cluster Service URL — email never leaves the cluster). The route is token-authed + **`include_in_schema=False`** (out of OpenAPI/api-client). Fail-closed: `503` unconfigured · `401` bad token · `422` malformed/CR-LF-in-recipient · `502` send failure · `200` sent. No silent `500`.
- **Sender** (`app/email/sender.py`): OAuth2 **JWT-bearer** service-account flow (RS256 assertion via PyJWT, `sub`=delegated user, `scope`=`gmail.send`), token cached behind an `asyncio.Lock`; lazy credential parse so the constructor never raises; **every** credential/token/Gmail failure → typed `EmailSendError`. No `google-auth` — reuses `pyjwt[crypto]` + `httpx`. **Only new dep: `jinja2==3.1.6`.** No DB/model changes.
- **🔴 GOTCHA (cost real debugging time):** Logto's connector field is **"Authorization Header"** and it is sent **VERBATIM**. The backend `_bearer()` requires the standard `Bearer ` scheme, so the field MUST be **`Bearer <LOGTO_EMAIL_WEBHOOK_TOKEN>`** — not the bare token. A bare token → backend 401. (This is how it's currently set and working.)
- **Tests:** `backend/tests/test_email_{templates,sender,webhook}.py` — 105 backend tests total, no network (injected MockTransport/FakeSender). Review caught + fixed: a token-compare **timing oracle**, a **header-injection→500**, 4 CodeQL substring-in-URL alerts (use `request.url.host ==`), and a `pydantic-settings` CVE bump (2.14.1→**2.14.2**).
- **Infra:** `backend.yaml` adds 4 email env vars (2 `secretKeyRef`, 2 envsubst); `deploy.yml` creates the `google-service-account-json` + `logto-email-webhook-token` secret keys + exports `GOOGLE_DELEGATED_USER`/`FROM_EMAIL`; `secrets.yaml` documents them. Runbooks updated (`infra/README.md`, `docs/setup/README.md`, `docs/setup/05-github.md`, `06-logto.md`, `claude_help/email.md`).

---

## Production GitHub Environment — secrets/vars (what's set)

`production` env. **Variables:** `DO_REGION`, `DO_REGISTRY`, `LOGTO_ENDPOINT`(=https://auth.fountainrank.com), `LOGTO_APP_ID`/`LOGTO_NATIVE_APP_ID`/`LOGTO_M2M_APP_ID` (placeholders), `GOOGLE_DELEGATED_USER`+`FROM_EMAIL`(=noreply@fountainrank.com). **Secrets:** `DIGITALOCEAN_ACCESS_TOKEN`, `SPACES_*`, `DATABASE_URL`, `LOGTO_DB_URL`, `DATABASE_CA_CERT`, `LOGTO_APP_SECRET`/`LOGTO_COOKIE_SECRET`/`LOGTO_M2M_APP_SECRET` (placeholders), **`GOOGLE_SERVICE_ACCOUNT_JSON`** (real — see security note), **`LOGTO_EMAIL_WEBHOOK_TOKEN`** (real; the same value, prefixed `Bearer `, is in the Logto connector).

> **k8s secret reality:** `fountainrank-secrets` is (re)created imperatively at each deploy from these GitHub secrets. Changing a GitHub secret has NO effect on the running pods until the next **deploy** (tag `v*.*.*`).

---

## ⚠ Security note (owner action)

The **Google service-account private key** (`GOOGLE_SERVICE_ACCOUNT_JSON`) is from project **`webpage-463304`** (SA `webpage-mailer-service-account@webpage-463304…`, NOT the runbook's `fountainrank-mailer@fountainrank`) — fine because its client id has domain-wide delegation for `gmail.send` impersonating `noreply@fountainrank.com`. **That key was surfaced into a chat transcript and a copy sits at `temp/webpage-463304-414967f96519.json`** (gitignored, but a live key on disk). Recommend: **rotate the key** (new key in the SA → set the GitHub secret → redeploy → delete the old key) and **delete the temp file**. Owner's call.

---

## Process notes + gotchas (carry forward — these cost real time)

- **Codex is the gating reviewer** (MCP, bypass mode, WSL `cwd` `/mnt/d/repos/fountainrank`). It caught real bugs in BOTH Phase 2a and Email — keep looping to `VERDICT: APPROVED` for every spec/plan and every PR. Reviews land in `temp/codex-reviews/` (gitignored). Subagent-driven scratch/ledgers live in `.git/sdd/` (local).
- **Codex (WSL) corrupts `backend/.venv`.** After ANY Codex run, the next Windows `uv` may fail (`Access is denied`/`lib64`/`Input/output error`). Fix: `cd /d/repos/fountainrank/backend && rm -rf .venv && uv sync`.
- **`pwsh` not on PATH** → run the task runner as `powershell.exe -NoProfile -File run.ps1 <cmd>` from the repo root. **DB** container `fountainrank-db-1` on `localhost:5436` (`./run.ps1 up`). Backend gate: `run.ps1 check -Backend` (104–105 tests).
- **Frontend local mirror is flaky on Windows:** `pnpm`/turbo's deps-status check wants to purge `node_modules` (NO_TTY / EACCES file locks from the open IDE), and even after a reinstall `web#lint` can fail with `eslint-config-next` not resolving `next/dist/compiled/babel/eslint-parser`. This is a **Windows linking artifact** — CI's clean Linux install passes (`workspace-js` green). For the local web mirror: `CI=true powershell.exe -NoProfile -File run.ps1 check`; if web-lint still fails on the resolution error, trust CI. `next build` mutates `web/next-env.d.ts`+`tsconfig.json`; `run.ps1` restores them.
- **Source control:** branch → PR → CI green + Codex APPROVED + all comments addressed → **squash-merge** (`gh pr merge <N> --squash`). The ONLY sanctioned direct-to-`main` push is `handoffs/*.md` (like this file). Deploy = owner-gated `v*.*.*` tag → `deploy.yml` (build/push → DOKS apply + migrate). No new migrations were in v0.3.0 (email added no tables).
- **CI on a code PR:** `backend`, `workspace-js`, `mobile-doctor`, `pip-audit`, `pnpm-audit`, `trivy-fs`, CodeQL (Analyze actions|js-ts|python + aggregate `CodeQL`). `image-scan` + container `Trivy` skip — expected. **CodeQL gates on NEW alerts** (e.g. `py/incomplete-url-substring-sanitization` — avoid `"x" in str(url)`; use exact `.host ==`). **pip-audit gates on the locked deps** (bump vulnerable pins).
- **Working tree:** clean on `main` except possibly the untracked `temp/…json` key. The previously-long-modified `docs/setup/04-apple-and-app-stores.md` was committed (owner's Google notes) in PR #14.

---

## Read-first (in order)

1. `CLAUDE.md` — operating-rules hub.
2. `claude_help/codex-review-process.md` — the gating Codex loop (Loop A spec/plan, Loop B PR). MANDATORY before finalizing a spec/plan or merging.
3. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — whole-system design (§10 auth, §11 email).
4. `docs/specs/2026-06-19-email-gmail-connector-design.md` + `docs/plans/2026-06-19-email-gmail-connector.md` — the (done) Email sub-project.
5. `docs/specs/2026-06-19-phase-2a-logto-infra-and-backend-jwt-design.md` — the (done) Phase 2a auth.
6. `handoffs/2026-06-19-phase-2a-merged-deployed-handoff.md` — Phase 2a deploy history (this supersedes it for "current state").
7. The relevant `claude_help/*.md` spoke for whatever you're about to do.
