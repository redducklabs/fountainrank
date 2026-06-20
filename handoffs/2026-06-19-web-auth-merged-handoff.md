# Handoff — FountainRank (Web Logto auth MERGED to `main`, not yet deployed)

**Date:** 2026-06-19 (evening PDT)
**From:** In-repo Claude session (Phase 2 **web** auth sub-project: spec → plan → subagent-driven implement → PR #16 → CI green + Codex Loop B APPROVED → squash-merge)
**To:** A fresh Claude/Codex instance in `D:\repos\fountainrank`
**Supersedes:** `handoffs/2026-06-19-email-deployed-handoff.md` for "current state" (Email + Phase 2a unchanged from there; this adds the merged web-auth client).

---

## TL;DR

1. **Web Logto auth is MERGED** (`main` @ `4613a2b`, PR #16) but **NOT deployed** — the live system is still `v0.3.0`. The web app is now a real Logto OIDC client (server-side **BFF**), and the backend has `GET /api/v1/me`.
2. **Writes are still closed in prod** until this deploys AND the owner sets the real Logto secrets — nothing changed in the running cluster yet.
3. **3 owner actions remain before it's live** (below): set real GitHub `production` Logto secrets, tag a `v*.*.*` deploy, and do the post-deploy live verification (deferred from pre-merge by owner choice).

---

## What merged in PR #16

- **Backend** — `GET /api/v1/me` (`app/routers/users.py` + `MeResponse` in `app/schemas.py`, mounted in `app/main.py`). Auth-required (Phase 2a resolver); returns `id`/`display_name`/`email`/`avatar_url`/`is_admin`/`created_at`, **excludes `logto_user_id`**. Tests: `test_me.py` + a synthetic-bearer round-trip in `test_logto_auth.py` + `test_openapi.py` assertion (109 backend tests).
- **Web** (`@logto/next@4.2.10`, App Router) — server-side **BFF token pattern**: the access token for `https://api.fountainrank.com` is fetched server-side via **`getAccessTokenRSC`** and attached server-to-server (`web/lib/server/api.ts`); **the browser never sees it** (`server-only` guards on `logto.ts`/`server/api.ts`/`server/log.ts`). `getLogtoConfig()` is **request-scoped** (not a top-level const) and `/account` + `/callback` are `force-dynamic`, so `next build` passes with **no `LOGTO_*` set**. Sign-in/out actions + callback (rethrows `NEXT_REDIRECT`), `"use client"` buttons, an `/account` page (renders the signed-in user; safe `?error=signin` state), a landing footer "Sign in" link, a recursively-redacting structured server logger (`web/lib/server/log.ts`), and style-guide entries.
- **Infra** — `infra/k8s/web.yaml` web pod env: non-secret `LOGTO_ENDPOINT`/`LOGTO_BASE_URL`/`LOGTO_APP_ID` + `LOG_LEVEL`/`LOG_FORMAT` (envsubst), and `LOGTO_APP_SECRET`/`LOGTO_COOKIE_SECRET` via `secretKeyRef` to `fountainrank-secrets` (keys `logto-app-secret`/`logto-cookie-secret`). `deploy.yml` creates those two secret keys + exports `LOGTO_APP_ID` for envsubst. `secrets.yaml` documents them.
- **Docs** — `claude_help/oauth-sso.md` (web BFF + env names), `docs/setup/06-logto.md` (web redirect URIs + the owner secret task).
- Design: `docs/specs/2026-06-19-web-logto-auth-design.md` + `docs/plans/2026-06-19-web-logto-auth.md` (both Codex Loop A APPROVED).

---

## ▶ Owner actions to make it live (in order)

1. **Set the REAL GitHub `production` Logto values** (replacing the Phase 2a placeholders): `LOGTO_APP_ID` (**variable**), `LOGTO_APP_SECRET` + a ≥32-char `LOGTO_COOKIE_SECRET` (**secrets**). The k8s `fountainrank-secrets` is recreated from these at each deploy, so a deploy before this gives a web pod that **starts** but fails `requireEnv`/`requireCookieSecret` at request time on `/account`/`/callback` (fail-fast, visible in logs).
2. **Deploy** — tag a `v*.*.*` release (e.g. `v0.4.0`) → `deploy.yml` builds/pushes the web image (with `NEXT_PUBLIC_API_BASE_URL` build-arg) and applies the manifests. No new DB migration (web auth added no tables).
3. **Post-deploy live verification** (deferred from pre-merge): open `https://fountainrank.com/account`, sign in (Google/email), confirm `/account` shows your profile, the web + backend logs show `GET /api/v1/me 200` (correlated by `X-Request-ID`), and the **browser Network panel shows NO `Authorization`-bearing call to `api.fountainrank.com`** (token stays server-side; a browser-side `/api/v1/me` call would mean the boundary broke). This is the real proof that **writes are open**.

---

## ▶ RESUME HERE — next sub-projects (unchanged from prior handoff)

Each gets its own spec → plan → Codex Loop A → subagent-driven implement → PR → CI green → Codex Loop B → squash-merge → owner-gated tag-deploy.

- **Mobile auth** — Logto React Native SDK (native OAuth via `expo-auth-session`; `expo-apple-authentication` for Apple), secure token storage; native app id placeholder `LOGTO_NATIVE_APP_ID`. (Same backend `/api/v1/me` + resource JWT contract the web now exercises.)
- **Apple sign-in** — gated on the owner's Apple Developer enrollment (Services ID + key → Logto Apple connector).
- **Trust & Safety / moderation** (issues filed, not started): **#10** user blocking, **#11** report→queue, **#12** admin queue + content removal, **#13** admin bans. New tables (`user_blocks`, `content_reports`, `moderation_actions`), the `users.is_admin` gate, soft-delete + ranking recompute, ban write-guard.

---

## Process notes / gotchas (carry forward)

- **pnpm store can break on this Windows host** (IDE file locks + stale symlinks → `EACCES ... removeBinsOfDependency`). This session hit it: `pnpm add` updated `package.json`/lockfile but failed to link. Fix that worked: `pnpm install --lockfile-only` to reconcile the lockfile (no node_modules touch), then `rm -rf node_modules web/node_modules packages/*/node_modules mobile/node_modules && pnpm install --frozen-lockfile` (a FRESH install has no prune step, so it sidesteps the `removeBins` EACCES). The generated `packages/api-client/{openapi.json,src/schema.d.ts}` are **gitignored** — regenerate with `pnpm run generate`, never commit them.
- **Web per-task gating must include `tsc` AND prettier**, not just vitest — this session a `NodeJS.ProcessEnv` param type (repo augments it to require `NODE_ENV`) and prettier formatting both slipped past vitest-only checks and were caught later. Repo convention for an injectable env param is `Record<string, string | undefined>` (see `web/lib/api.ts`). Full local web mirror: `CI=true powershell.exe -NoProfile -File run.ps1 check`.
- **Codex (WSL) can corrupt `backend/.venv`** — after a Codex run, `uv` may need `rm -rf .venv && uv sync` (or it auto-resyncs). Codex review files live in `temp/codex-reviews/` (gitignored); subagent-driven scratch/ledger in `.superpowers/sdd/` (gitignored).
- **Source control:** branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → **squash-merge** (`gh pr merge <N> --squash`). Only `handoffs/*.md` may go direct to `main` (like this file).

---

## Read-first (in order)

1. `CLAUDE.md` — operating-rules hub.
2. `claude_help/codex-review-process.md` — the gating Codex loop (Loop A spec/plan, Loop B PR).
3. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — whole-system design (§10 auth).
4. `docs/specs/2026-06-19-web-logto-auth-design.md` + `docs/plans/2026-06-19-web-logto-auth.md` — the (merged) web-auth sub-project.
5. `handoffs/2026-06-19-email-deployed-handoff.md` — prior state (Phase 2a + Email, both deployed at `v0.3.0`).
6. The relevant `claude_help/*.md` spoke for whatever you're about to do.
