# Handoff — FountainRank (Phase 2a MERGED + DEPLOYED; system LIVE with auth gate)

**Date:** 2026-06-19 (PDT)
**From:** In-repo Claude session (brainstormed → spec → plan → Codex Loop A → subagent-driven implementation → PR #8 → CI green + Codex Loop B APPROVED → squash-merge → tag v0.2.0 → deploy → live-verified)
**To:** A fresh Claude/Codex instance in `D:\repos\fountainrank`
**Purpose:** Self-contained "resume here". Read this + `CLAUDE.md` + the Phase 2a spec/plan and continue with no prior conversation.
**Supersedes:** `handoffs/2026-06-19-phase-1-merged-handoff.md` (its "RESUME HERE → Phase 2" first sub-project is now DONE + deployed).

---

## TL;DR

1. **Phase 2a is DONE, MERGED, and DEPLOYED.** PR **#8** (`feat(backend): Phase 2a — Logto infra-unblock + backend JWT validation`) squash-merged → **`main` @ `ef6e677`**, then tagged **`v0.2.0`** → Deploy workflow **success**. **This was the first prod deploy of Phase 1's data model + migrations `0002`/`0003`,** together with Phase 2a auth.
2. **Two things shipped:** (a) `TRUST_PROXY_HEADER=1` on the Logto deployment so its OIDC endpoints are emitted over **https** (they were `http://` for every derived endpoint — the live discovery doc now reports `https://` across the board); (b) the backend now validates **real Logto JWTs** (ES384 via JWKS, verify `iss`/`aud`/`exp`/`sub`), replacing the Phase 1 dev-auth seam with a dual-path resolver.
3. **Verified live (read-only):** OIDC discovery → all `https://` (0 `http://`); `GET /api/v1/rating-types` → `200` (4 seeded dimensions); `POST /api/v1/fountains` with **no auth → 401**, with a **bogus Bearer → 401 (not 500)** — the fail-closed JWT gate works in prod. Writes stay **closed** (`dev_auth_enabled=False`, and no API Resource / client exists yet).

---

## ▶ RESUME HERE

### Owner action (you, Aron — unblocks "get Logto set up")
Logto now emits https and is deployed. Configure it via the admin console (intentionally **not** publicly exposed — port-forward only), per `docs/setup/06-logto.md`:
```bash
kubectl config use-context do-sfo3-fountainrank-production-cluster
kubectl -n fountainrank port-forward deploy/logto 3002:3002   # then open http://localhost:3002
```
- Set the initial Logto admin credentials (first boot) → password manager.
- **Register an API Resource** with identifier **`https://api.fountainrank.com`** (this is the `aud` the backend already validates).
- Configure the **Google** connector (you have the Google OAuth client). **Apple** waits on your Developer Program enrollment.

### Next feature specs (each its own spec → plan → Codex Loop A → implement)
1. **Web** — Logto Next.js SDK (auth-code+PKCE, server session) + set `NEXT_PUBLIC_API_BASE_URL=https://api.fountainrank.com` at **web build time** (`web/Dockerfile` build-arg + `deploy.yml`) so the deployed web calls the real API. App registration (Traditional Web) in Logto.
2. **Mobile** — Logto React Native SDK (native OAuth via `expo-auth-session`; `expo-apple-authentication` for Apple), secure token storage; native app registration.
3. **Email** — custom Gmail-API Logto connector (`GOOGLE_SERVICE_ACCOUNT_JSON` + domain-wide delegation; see `claude_help/email.md`).
4. **Apple sign-in** — once enrolled (Services ID + key → Logto Apple connector).
5. Once a client + API Resource exist and round-trip, real Logto JWTs gate writes; `dev_auth_enabled` stays `False` in prod (it's the local-only fallback).

**Before any code:** spec → plan → **Codex Loop A APPROVED** → implement (see `claude_help/codex-review-process.md`).

---

## What shipped in Phase 2a (PR #8)

- **Infra (`infra/k8s/logto.yaml`):** `TRUST_PROXY_HEADER=1` added after `ENDPOINT` so koa/oidc-provider trusts the DO-LB's `X-Forwarded-Proto: https`. Admin console (port 3002) stays unexposed; access is `kubectl port-forward` only (no DNS/cert/Service/Ingress change).
- **`backend/app/logto_auth.py` (new):** `validate_bearer_token` — hardcoded **`ES384`-only** allowlist (no alg-confusion / `none`), `iss`/`aud`/`exp`/`sub` required & verified via JWKS. `JwksCache` is async, `kid`-keyed, TTL'd, and **fails closed**: never serves a stale/expired key; fetch error → `jwks_fetch_failed`, parse error → `jwks_invalid`, rate-limited miss → `jwks_unavailable`, post-refetch miss → `unknown_kid` — all typed `AuthError` → `401`, never a `500`. First fetch always allowed (`_last_attempt is None`, **not** a `monotonic()==0` sentinel). Unknown-`kid` flood rate-limited.
- **`backend/app/auth.py`:** dual-path `get_current_user` — `Authorization: Bearer <jwt>` (validated → provision via the **unchanged** `get_or_create_user` tail) OR the `X-Dev-User` dev seam, reachable only when `dev_auth_enabled=True` AND no `Authorization` header. A present-but-invalid Bearer is a hard `401` and **never** falls through. `get_jwks_cache` is an injectable FastAPI dependency (tests override it). Provisioning fallbacks for the NOT-NULL columns: `email = claim or f"{sub}@users.noreply.fountainrank.com"`, `display_name = name|username|sub`.
- **`backend/app/config.py`:** `logto_endpoint`/`logto_audience`/`logto_jwks_cache_ttl_seconds` + derived `logto_issuer`/`logto_jwks_uri` (derived from the endpoint, **not** the discovery doc). Startup log now includes the non-secret Logto resolved config.
- **Deps:** `pyjwt[crypto]==2.13.0`, `httpx==0.28.1` (runtime), `cryptography==49.0.0` (transitive, locked).
- **Tests:** `backend/tests/test_logto_auth.py` (synthetic EC P-384 JWKS, no network) — valid, expired-past-leeway, wrong aud/iss, tampered sig, alg-confusion (HS256+none), missing sub, unknown kid, flood rate-limit, rotation, fetch-failure→401, invalid-body→401, fallbacks, malformed header→401, no-credential→401, kid-logged-not-token. **71 backend tests pass; full local CI mirror green.**
- **Docs:** `docs/setup/06-logto.md` corrected (port-forward admin + API-Resource step); `backend/README.md` reworded (Bearer = prod, dev seam = local fallback).

---

## State / gotchas

- **`main` @ `ef6e677`**; tag **`v0.2.0`** is deployed (prod was `v0.1.2`). Tags so far: `v0.1.0/1/2`, `v0.2.0`. Linear history (`<title> (#PR)`).
- **Process used:** brainstorming → writing-plans → **Codex Loop A (3 rounds → APPROVED)** → **subagent-driven-development** (fresh implementer + independent review per task; final whole-branch review on opus = READY TO MERGE: YES) → PR #8 → CI green → **Codex Loop B (2 rounds → APPROVED)** → squash-merge → `v0.2.0` deploy. Loop A caught real fail-closed/leeway/observability bugs **before** any code — keep using the gate. Scratch ledger: `.git/sdd/phase-2a-progress.md` (local, gitignored).
- **Codex (WSL) can corrupt `backend/.venv`** (POSIX layout). If the next Windows `uv` fails with `Access is denied` / `lib64`: `cd /d/repos/fountainrank/backend && rm -rf .venv && uv sync`. (Didn't recur this session, but be ready.)
- **`pwsh` not on PATH** — run the task runner as `powershell.exe -NoProfile -File run.ps1 <cmd>` from the repo root. DB container `fountainrank-db-1` on `localhost:5436` (`./run.ps1 up`).
- **Dependabot backend-python PR is open** (fastapi/ruff group bump) — non-blocking; triage separately.
- **`docs/setup/04-apple-and-app-stores.md`** remains the owner's modified/unstaged file — **leave it untouched** (carried across the whole session).
- **CI on a code PR:** `backend`, `workspace-js`, `mobile-doctor`, `pip-audit`, `pnpm-audit`, `trivy-fs`, CodeQL (Analyze actions|javascript-typescript|python + aggregate `CodeQL`). `image-scan` + container `Trivy` **skip** — expected/green. A `v*.*.*` tag triggers `Deploy` (build+push → DOKS apply + migrate).
