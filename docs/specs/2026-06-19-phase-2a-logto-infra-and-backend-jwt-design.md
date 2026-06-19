# Phase 2a — Logto infra-unblock + backend JWT validation (design)

**Date:** 2026-06-19
**Status:** Proposed (brainstormed + owner-approved; pending Codex Loop A)
**Relates to:** spec `2026-06-16-architecture-and-foundation-design.md` §10 (auth), §11
(email); `claude_help/oauth-sso.md`; the Phase 1 dev-auth seam (`backend/app/auth.py`).
**Supersedes/forms:** the first sub-project of Phase 2 (auth). Web SDK, mobile SDK, the
Gmail-API email connector, and Apple sign-in are **later, separate specs**.

---

## 1. Goal

Make self-hosted Logto usable as the real identity authority for the **backend**, and make
the backend validate Logto-issued JWTs — without standing up the web/mobile clients yet.
Concretely:

1. Fix the live Logto so its OIDC endpoints are emitted over **HTTPS** (today they are
   `http://`, which breaks every downstream OAuth/JWKS consumer).
2. Give the owner a secure way to reach the Logto **admin console** to configure it.
3. Replace the Phase 1 **dev-auth seam** with real **Logto JWT validation** (verify
   signature via JWKS, `iss`, `aud`, `exp`; take `sub`), reusing the existing
   `get_or_create_user` provisioning tail unchanged.

After this ships and is deployed, the owner can register the backend **API Resource** in
Logto (and, in the later web/mobile spec, the app registrations + Google/Apple/email
connectors), and write endpoints become reachable only with a valid Logto JWT.

## 2. Background — verified live state (2026-06-19)

Read-only checks against the production cluster and `auth.fountainrank.com`:

- **Logto is deployed and healthy** (`svhd/logto:1.40.1`, 1/1 Running, 18h). OIDC discovery
  and JWKS both return `200`.
- **Issuer/endpoint protocol mismatch.** Discovery reports `"issuer":
  "https://auth.fountainrank.com/oidc"` (correct, from `ENDPOINT`) but **every derived
  endpoint is `http://`** — `authorization_endpoint`, `token_endpoint`, `jwks_uri`,
  `end_session_endpoint`. Root cause: the DO Load Balancer terminates TLS and forwards plain
  HTTP to the pod; Logto (koa / node-oidc-provider) derives endpoint URLs from the request's
  perceived protocol, and **`TRUST_PROXY_HEADER` is not set**, so it does not trust the
  `X-Forwarded-Proto: https` that nginx forwards. The Logto deployment env today is only
  `DB_URL`, `NODE_EXTRA_CA_CERTS`, `ENDPOINT`, `PORT`, `ADMIN_PORT`.
- **Admin console (port 3002) is unexposed.** `logto-service` maps only `80→3001`; no
  Service port or ingress route targets 3002. The container **does** declare
  `containerPort: 3002`. So the admin UI is unreachable except via `kubectl port-forward`.
- **Signing algorithm is ES384** (EC, curve P-384) per the live JWKS (`kty=EC`, `alg=ES384`,
  `crv=P-384`, `use=sig`).
- **Logto token model:** an access token is an **opaque** userinfo token by default; it is
  issued as a **JWT only when the client requests a token for a registered API Resource**,
  in which case the resource indicator becomes the `aud`. A resource JWT reliably carries
  `sub` but **not** `email`/`name` (those live in the ID token / `/oidc/userinfo`).
- **Backend Phase 1 seam:** `app/auth.py` has `get_or_create_user(...)` (race-safe JIT
  provisioning, keyed on `users.logto_user_id`) and `get_current_user(...)` (the
  `X-Dev-User` dev seam, gated by `settings.dev_auth_enabled`, default `False`).
  `User.email` and `User.display_name` are **`NOT NULL`**.

## 3. Scope

**In scope**

- Infra: add `TRUST_PROXY_HEADER=1` to the Logto deployment; document admin access via
  `kubectl port-forward`; correct `docs/setup/06-logto.md` (it wrongly says admin lives at
  `https://auth.fountainrank.com`).
- Backend: a Logto JWT validation module; rework `get_current_user` to a dual-path resolver
  (Bearer JWT → real path; `X-Dev-User` → dev path only when `dev_auth_enabled`); config
  additions; dependency additions; unit/integration tests.

**Out of scope** (later specs / owner actions)

- Web Next.js SDK + `NEXT_PUBLIC_API_BASE_URL` build wiring; mobile RN SDK; the Gmail-API
  Logto email connector; Apple sign-in; the in-Logto app registrations + Google/Apple/email
  connector configuration; flipping `dev_auth_enabled` or deciding to deploy/tag a release.
- Logto profile richness beyond `sub`/`email`/`name` (e.g. `/oidc/userinfo` backfill,
  custom claims, organizations/roles) and updating an **existing** user's profile on
  subsequent logins.

## 4. Design

### 4.1 Infra — `infra/k8s/logto.yaml`

Add one env var to the `logto` container:

```yaml
- name: TRUST_PROXY_HEADER
  value: "1"
```

This makes Logto trust the forwarded proto and emit `https://` endpoints. The DO Load
Balancer sets `X-Forwarded-Proto: https` when it terminates TLS, and the existing ingress
forwards it (`nginx.ingress.kubernetes.io/use-forwarded-headers: "true"`); Logto simply was
not told to trust it. If — contrary to expectation — the LB/nginx are not forwarding the
header, the post-deploy HTTPS check (§7) will reveal it, and the fallback is to also set
`ENDPOINT`-aware proxy handling at the ingress; this is the documented Logto remedy and the
single most likely fix.

**Admin access — port-forward (no public surface).** Documented operator step (not a
manifest change, since 3002 is already a container port):

```bash
kubectl config use-context do-sfo3-fountainrank-production-cluster
kubectl -n fountainrank port-forward deploy/logto 3002:3002
# then open http://localhost:3002
```

During implementation, verify the admin console's own sign-in round-trips over
`localhost:3002`. Logto enables the localhost admin experience by default
(`ADMIN_DISABLE_LOCALHOST` unset). **Only if** the login fails to round-trip do we add an
`ADMIN_ENDPOINT` (and revisit exposure) — captured as an implementation checkpoint, not a
committed change up front. No new DNS record, no cert SAN change, no ingress route.

**Deploy is owner-gated.** The manifest change takes effect only on the next deploy, which a
`v*.*.*` tag triggers (per the Phase 0f/1 model). Tagging/deploying remains the owner's
decision; this spec does not tag or deploy. The HTTPS acceptance check (§7) is therefore a
**post-deploy** verification.

### 4.2 Backend config — `app/config.py`

Add settings with prod-correct defaults (so local dev needs no Logto — it uses the dev seam):

```python
logto_endpoint: str = "https://auth.fountainrank.com"
logto_audience: str = "https://api.fountainrank.com"   # the API Resource indicator
logto_jwks_cache_ttl_seconds: int = 3600
```

Derived (computed, not stored, to avoid env duplication / drift):

- `logto_issuer` = `f"{logto_endpoint.rstrip('/')}/oidc"` → `https://auth.fountainrank.com/oidc`
- `logto_jwks_uri` = `f"{logto_issuer}/jwks"`

We **derive** the issuer/JWKS URI from `logto_endpoint` rather than reading OIDC discovery,
so the backend is unaffected by the (pre-fix) `http://` discovery document and by any
discovery downtime. `dev_auth_enabled` stays `False` in production.

### 4.3 JWT validation module — `app/logto_auth.py` (new)

A focused module with one responsibility: turn a bearer token string into validated claims.

- **JWKS cache.** An async, `kid`-keyed cache fed by an injectable fetch coroutine
  (`httpx.AsyncClient.get(logto_jwks_uri)`). Behaviour:
  - Cache the full key set with a TTL (`logto_jwks_cache_ttl_seconds`).
  - On a token whose `kid` is not in cache, refetch (handles key rotation), guarded by an
    `asyncio.Lock` (no thundering herd) and a **minimum refetch interval** (negative caching)
    so a flood of tokens bearing bogus `kid`s cannot force unbounded refetches (DoS guard).
    If the `kid` is still absent after the allowed refetch → reject. The very first fetch is
    always allowed (the "never attempted" state is tracked explicitly, **not** as a
    `monotonic()==0` sentinel — `monotonic()`'s origin is arbitrary). Worst-case lag to
    recognize a **newly rotated** `kid` is one `min_refetch_interval` (~10s) if a fetch
    happened immediately prior; acceptable because Logto key rotation is infrequent.
  - The fetch coroutine is injectable so tests supply a synthetic JWKS with **no network**.
- **Verification.** Build the EC public key from the matching JWK and call
  `jwt.decode(token, key, algorithms=["ES384"], audience=settings.logto_audience,
  issuer=settings.logto_issuer, leeway=60, options={"require": ["exp", "iss", "aud",
  "sub"]})`. The algorithm is a **hardcoded allowlist** (`["ES384"]`) — never the token
  header's `alg` — to defeat alg-confusion / `none` attacks.
- **Output.** Return the decoded claims (at minimum `sub`; optionally `email`, `name`,
  `username`). On any failure, raise a typed auth error the resolver maps to `401`.

### 4.4 Auth resolver — `app/auth.py`

`get_or_create_user(...)` is unchanged. `get_current_user` becomes a dual-path resolver:

1. If an `Authorization` header is present:
   - It MUST be `Bearer <token>`; otherwise `401` (malformed).
   - Validate via `logto_auth`. On success, map claims → `get_or_create_user`. On failure,
     `401`. **A present-but-invalid Bearer never falls through to the dev path.**
2. Else if `settings.dev_auth_enabled` and `X-Dev-User` present: the existing dev path
   (unchanged behaviour).
3. Else: `401` ("authentication required").

In production (`dev_auth_enabled=False`) only path 1 can authenticate, so write endpoints
stay closed until a real Logto JWT (which needs the API Resource + a client) exists. Reads
remain public (no dependency on `get_current_user`).

### 4.5 Provisioning & claims (NOT-NULL reality)

`User.email` / `User.display_name` are `NOT NULL`, but a resource JWT may carry neither. Map
with safe fallbacks at provisioning time:

- `logto_user_id` = `sub` (required; absence → `401`).
- `email` = `claims["email"]` if present, else `f"{sub}@users.noreply.fountainrank.com"`
  (a non-routable placeholder on a domain we control; clearly synthetic).
- `display_name` = `claims["name"]` or `claims["username"]` or `sub`.

`get_or_create_user` only writes these on first INSERT; an existing user's profile is **not**
updated here (profile sync is deferred, §3). Documented as a known limitation.

### 4.6 Dependencies — `backend/pyproject.toml`

- Add `pyjwt[crypto]` (signature verification; `[crypto]` pulls `cryptography` for ES384).
- Promote `httpx` from the dev group to **runtime** deps (used for the JWKS fetch).
- Pin to latest stable versions, verified at plan time (PyJWT, httpx, cryptography). The
  lockfile (`uv.lock`/`uv sync`) updates accordingly.

### 4.7 Owner tasks (after this is merged **and** deployed)

1. Decide to deploy (tag a `v*.*.*` release) so the `TRUST_PROXY_HEADER` fix goes live.
2. `kubectl port-forward` to the admin console; set the initial Logto admin credentials
   (first boot) and store them in a password manager.
3. **Register an API Resource** with indicator **`https://api.fountainrank.com`** — this is
   what makes Logto mint JWTs (aud = that indicator) the backend will accept. (App
   registrations + Google/Apple/email connectors come with the web/mobile spec.)

These are recorded in `docs/setup/06-logto.md` (updated here).

## 5. Error handling

- All auth failures (missing/malformed header, bad signature, wrong `iss`/`aud`, expired,
  unknown `kid`, missing `sub`) → **`401 Unauthorized`**, never `500`.
- JWKS endpoint unreachable / network error during a required fetch → `401` (auth cannot be
  established) plus a `WARNING` log; never a silent pass and never a `500`.
- Per the Logging & Observability standard: log every auth failure at `WARNING` with the
  reason code, the request id (auto-stamped by `RequestIdFilter`), and the `kid` **when
  decodable** — **never** the raw token, full JWT, signature, or the **unverified** `sub`.
  (The `sub` from an unvalidated token is attacker-controlled; logging it as identity/PII is
  unsafe, so failure logs carry `kid`+reason only.) The success path logs at `DEBUG`/`INFO`
  with the **validated** `sub` only.

## 6. Testing

New `backend/tests/test_logto_auth.py` (no live Logto, no network):

- Fixtures generate an ephemeral **EC P-384** keypair, expose a synthetic JWKS (matching
  `kid`), and mint ES384 tokens with arbitrary claims; the JWKS fetch coroutine is
  monkeypatched to return the synthetic set.
- Cases: valid → provisions a user with claim-derived `email`/`name`; valid with **no**
  `email`/`name` → fallbacks applied; **expired**; **wrong `aud`**; **wrong `iss`**;
  **tampered signature**; **unknown `kid`** (one refetch, then reject); **`alg: none` /
  HS256 forgery** rejected (alg-confusion guard); **missing `sub`**; **malformed
  `Authorization`** header; **valid-but-expired Bearer does not fall through** to the dev
  path even when `dev_auth_enabled=True`.
- JWKS cache: unknown-`kid` flood does not exceed the min-refetch-interval (DoS guard);
  rotation (new `kid`) resolves after one refetch.
- Integration through the fountains router: a write with a valid synthetic Bearer provisions
  and succeeds; without any credential → `401`.
- `test_auth_seam.py` is extended (dev path only when no `Authorization` header) and the
  existing 50 tests stay green (API tests override `get_current_user`, so they are
  unaffected).

Local gate before PR: `./run.ps1 check` (full CI mirror).

## 7. Acceptance criteria

1. `backend/app/logto_auth.py` validates ES384 Logto JWTs against JWKS with `iss`/`aud`/`exp`
   checks and an `["ES384"]` allowlist; all §6 tests pass under `./run.ps1 check`.
2. `get_current_user` authenticates a valid Bearer JWT and provisions via the unchanged
   `get_or_create_user`; rejects every invalid case with `401` (no `500`); the dev seam still
   works when `dev_auth_enabled=True` and is unreachable in prod.
3. `infra/k8s/logto.yaml` carries `TRUST_PROXY_HEADER=1`; manifests still pass
   `kubeconform`. **Post-deploy (owner-gated):** `…/oidc/.well-known/openid-configuration`
   reports `authorization_endpoint`/`token_endpoint`/`jwks_uri` as **`https://`**.
4. `docs/setup/06-logto.md` documents port-forward admin access and the API-Resource
   registration; no secrets in the repo; no AI attribution; no time estimates.
5. CI green + Codex `VERDICT: APPROVED` + all PR comments addressed → squash-merge.

## 8. Risks / open points

- **Admin-console localhost round-trip** may need an `ADMIN_ENDPOINT` if Logto's first-party
  admin app rejects the `localhost:3002` origin/redirect — verified at implementation time;
  contained to one env var if needed.
- **Placeholder email** for connector logins that omit email is intentionally synthetic;
  acceptable because email is display metadata here, not an auth key (`sub` is the key). A
  real profile sync is a deliberate later-spec item.
- **No end-to-end token test in CI** — there is no client or API Resource yet, so CI proves
  validation against **synthetic** ES384 tokens. The real round-trip is exercised in the
  web/mobile spec. This is called out, not hidden.
