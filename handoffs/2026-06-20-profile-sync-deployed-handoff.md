# Handoff — FountainRank (User profile sync DEPLOYED + VERIFIED — `v0.5.0`)

**Date:** 2026-06-20
**From:** In-repo Claude session (user-profile-sync sub-project: spec → Codex Loop A → plan → Codex Loop A → subagent-driven implement → PR #17 → CI green + Codex Loop B APPROVED → squash-merge → `v0.5.0` deploy)
**To:** A fresh Claude/Codex instance in `D:\repos\fountainrank`
**Supersedes:** `handoffs/2026-06-19-web-auth-merged-handoff.md` for "current state" (web auth v0.4.0 unchanged from there; this adds profile sync).

---

## TL;DR

1. **User profile sync is MERGED + DEPLOYED** (`main` @ `99866ee`, PR #17, tag **`v0.5.0`**; deploy.yml succeeded, all rollouts green). On login the backend now learns the user's **real** `email`/`name`/`avatar` from Logto userinfo and stores them, replacing the synthetic Phase-2a fallbacks.
2. **Prod smoke checks pass:** `POST https://api.fountainrank.com/api/v1/me/sync` → **401** (deployed + auth-gated, not 404); `https://fountainrank.com/account` → **200** (new web code live); `/api/v1/me` → 401.
3. **Post-deploy verification CONFIRMED (owner, 2026-06-20):** signed in at `https://fountainrank.com/account` and the **real** email/name/avatar render. So the one runtime assumption is proven — `getAccessTokenRSC(config)` (no resource) yields an opaque token **Logto userinfo accepts**, and the full `/account` → opaque-token → userinfo → upsert path works end-to-end in prod. The **Management-API contingency (design §8) is NOT needed** (kept only as a reference if profile sync ever regresses). **Writes + real profile are now live end-to-end on web.**

---

## What shipped in PR #17 (`v0.5.0`)

- **Mechanism (backend-authoritative):** `/account` (force-dynamic RSC) best-effort-forwards the **opaque** Logto access token (server-only, via `getAccessTokenRSC`) to **`POST /api/v1/me/sync`**; the backend calls Logto **userinfo** (`{logto_issuer}/me`) with it (a resource JWT is rejected at userinfo), enforces a **`sub` cross-check** (`403` on mismatch, **before** any mutation), and upserts the profile. The opaque token **never reaches the browser**.
- **Backend** (`backend/app/userinfo.py`): `UserinfoClaims` (non-blank `sub`), a **streamed/guarded** `fetch_userinfo` (timeout 5s, no-redirects, body aborted past 65536 bytes → `502`), and strict normalization — **email** accepted only if valid + non-synthetic + not `email_verified:false` (else existing preserved); **display_name** = `name`→`username`→existing→`sub`; **avatar** = a valid `https` URL only (else existing kept, never cleared). `POST /api/v1/me/sync` in `app/routers/users.py`; `logto_userinfo_uri` config property. `get_or_create_user` is still INSERT-only — the **update** lives only in the sync endpoint.
- **Web** (`web/lib/logto.ts` adds `email`/`profile` scopes; `web/lib/server/sync.ts` is the `server-only` best-effort `syncProfile`; `/account` calls it before its `GET /api/v1/me`). The callback is unchanged.
- Design: `docs/specs/2026-06-19-user-profile-sync-design.md` + `docs/plans/2026-06-19-user-profile-sync.md` (both Codex Loop A APPROVED). 130 backend tests; final whole-branch review (opus) clean.

## Self-healing

Users provisioned earlier with a synthetic email (`<sub>@users.noreply.fountainrank.com`) are **overwritten with the real email on their next `/account` load** — no migration/backfill needed.

## Logto prerequisite (owner)

- Google scopes `openid profile email` — **done**. Ensure the Google (and later Apple) connector's **"Sync profile information"** is enabled so Logto keeps `name`/`avatar` populated (userinfo returns them).

---

## ▶ RESUME HERE — next sub-projects

Each: spec → Codex Loop A → plan → Codex Loop A → subagent-driven implement → PR → CI + Codex Loop B → squash-merge → owner-gated `v*.*.*` deploy. Phase roadmap is spec §20. **Done so far:** Phase 0 (foundation), Phase 1 (data model + fountains API), Phase 2 **web** (Logto auth + email + profile sync). **Not yet built:** the actual product UI, and the mobile client.

- **Phase 3 — Web product UI: Maps + add-fountain + rate-on-add (MapLibre).** The biggest next piece and **highest user value** — the Phase-1 fountains API exists (`GET /api/v1/fountains`, `/bbox`, `/{id}`, `POST` add/rate — see `backend/README.md`) and writes are now open, but there is **no product UI yet** (web is only landing + `/account` + privacy/terms). Per spec §14/§20 this starts with a **UI design brainstorm + the style guide** (`docs/style-guide.md` exists) before implementation.
- **Mobile (finishes Phase 2's mobile half)** — Logto React Native SDK (native OAuth via `expo-auth-session`; `expo-apple-authentication` for Apple); native app id `LOGTO_NATIVE_APP_ID` (=`oikth3qbmnrhqd9jmkbc8`). Reuses the backend `/api/v1/me` + `/api/v1/me/sync` (mobile forwards its own opaque token). (Mobile also needs the Phase-3 UI to be useful, so it usually follows or parallels Phase 3.)
- **Apple sign-in** — gated on the owner's Apple Developer enrollment (Services ID + key → Logto Apple connector).
- **Trust & Safety / moderation** (issues #10–#13): user blocking, report→queue, admin queue + content removal, admin bans. New tables, `users.is_admin` gate, soft-delete + ranking recompute. Independent of the UI; acts on real user content.
- **Phase 4** (photos + rating existing fountains from detail) and **Phase 5** (leaderboards: weighted/Bayesian ranking + contributor board) follow.
- **(Reference only) Management-API profile sync** — NOT needed (the v0.5.0 probe passed); design §8 is the fallback only if the opaque-token path ever regresses. M2M creds exist (`LOGTO_M2M_APP_ID`=`y5pux8b2iy7hmkl79zbic`).

---

## Process gotchas (carry forward — these cost real time this session)

- **Windows pnpm store breaks repeatedly** (`EACCES … linkBinsOfPkgsByAliases`/`removeBinsOfDependency`, IDE file locks + stale `.pnpm` symlinks). Reliable fix: `pnpm install --lockfile-only` to reconcile the lockfile if needed, then `rm -rf node_modules web/node_modules packages/*/node_modules mobile/node_modules && pnpm install --frozen-lockfile` (a FRESH install has no prune step, so it sidesteps the EACCES). `CI=true … run.ps1 check` does NOT reliably avoid turbo's deps-status pnpm-install.
- **Codex (WSL) corrupts `backend/.venv`** — after a Codex run the next Windows `uv` fails (`failed to locate pyvenv.cfg`). Fix: `cd backend && rm -rf .venv && uv sync`.
- **Bash-tool cwd persists** across calls — a stray `cd backend` makes later repo-relative paths (`docs/…`, `git add backend/…`) resolve wrong; `cd /d/repos/fountainrank` first.
- **Backend implementers must run `run.ps1 check -Backend` (ruff + format + pytest), not just pytest** — pytest-only left E402/E501/format issues fixed by the controller.
- **Source control:** branch → PR → CI green + Codex `VERDICT: APPROVED` + every PR comment addressed → **squash-merge** (`gh pr merge <N> --squash`). Only `handoffs/*.md` may go direct to `main` (like this file). Deploy = owner-gated `v*.*.*` tag → `deploy.yml`. Codex reviews → `temp/codex-reviews/`; subagent ledgers → `.superpowers/sdd/` (both gitignored).

---

## Read-first (in order)

1. `CLAUDE.md` — operating-rules hub.
2. `claude_help/codex-review-process.md` — the gating Codex loop.
3. `docs/specs/2026-06-16-architecture-and-foundation-design.md` — whole-system design (§10 auth).
4. `docs/specs/2026-06-19-user-profile-sync-design.md` + `docs/plans/2026-06-19-user-profile-sync.md` — the (deployed) profile-sync sub-project; §8 = the Management-API contingency.
5. `handoffs/2026-06-19-web-auth-merged-handoff.md` — prior state (web auth `v0.4.0`).
6. The relevant `claude_help/*.md` spoke for whatever you're about to do.
