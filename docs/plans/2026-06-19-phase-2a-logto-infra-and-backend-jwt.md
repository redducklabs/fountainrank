# Phase 2a — Logto infra-unblock + backend JWT validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Logto emit HTTPS OIDC endpoints and have the FastAPI backend authenticate real Logto JWTs (JWKS + `iss`/`aud`/`exp`, ES384), replacing the Phase 1 dev-auth seam while reusing its provisioning tail.

**Architecture:** One k8s env-var fix on the Logto deployment (`TRUST_PROXY_HEADER=1`) plus a focused backend auth path: a new `app/logto_auth.py` (injectable JWKS cache + ES384 verification) consumed by a reworked dual-path `get_current_user` in `app/auth.py`. Local dev/tests keep the `X-Dev-User` seam (gated by `dev_auth_enabled`, default `False`).

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2 async, PyJWT[crypto] (ES384/JWKS), httpx (JWKS fetch), pytest; Kubernetes manifests (`infra/k8s`), `uv` task runner via `./run.ps1`.

**Spec:** `docs/specs/2026-06-19-phase-2a-logto-infra-and-backend-jwt-design.md`

## Global Constraints

- Logto OIDC issuer (verbatim): `https://auth.fountainrank.com/oidc`
- Backend API Resource indicator / JWT audience (verbatim): `https://api.fountainrank.com`
- JWKS URI (verbatim): `https://auth.fountainrank.com/oidc/jwks`
- Signing algorithm allowlist: **`ES384` only** — never trust the token header's `alg`.
- New runtime deps (exact pins, matching repo `==` convention): `pyjwt[crypto]==2.13.0`; promote `httpx==0.28.1` from the dev group to runtime. `cryptography` (49.0.0) arrives transitively via `pyjwt[crypto]` and is pinned in `uv.lock`.
- `dev_auth_enabled` defaults `False` (production never opens an unauthenticated write path).
- Every auth failure returns **HTTP 401**, never 500. **Never** log the raw token, full JWT, or signature; log only a reason code + (when decodable) `sub`/`kid`, via the existing structured logger (`logging.getLogger("app.auth")`, `extra={...}`).
- No AI attribution in commits/PRs; no time estimates anywhere. Conventional Commits, frequent commits.
- **Execution environment:** this plan is implemented by a worker on the **Windows host**, where the Bash tool is **Git Bash** (POSIX sh, forward-slash paths under `/d/repos/fountainrank`) and `run.ps1` is invoked as `powershell.exe -NoProfile -File run.ps1 <cmd>` (`pwsh` is not on PATH — per the handoffs). These command forms are correct for that environment; they are **not** meant to run inside Codex's WSL shell. File tools (Read/Write/Edit) use backslash paths.
- IaC is read-only locally: validate manifests with `kubeconform`; never `kubectl apply`/`helm upgrade` by hand. Deploy is owner-gated (a `v*.*.*` tag).

---

### Task 1: Infra — `TRUST_PROXY_HEADER` + admin/API-resource docs

**Files:**
- Modify: `infra/k8s/logto.yaml` (add one env var to the `logto` container)
- Modify: `docs/setup/06-logto.md` (correct admin-access method; add API-Resource step)

**Interfaces:**
- Consumes: nothing.
- Produces: a Logto Deployment that, once deployed, emits `https://` OIDC endpoints; operator docs for port-forward admin access + API-Resource registration.

- [ ] **Step 1: Add the env var to the Logto container**

In `infra/k8s/logto.yaml`, inside `spec.template.spec.containers[0].env`, immediately after the `ENDPOINT` entry, add:

```yaml
            # Logto sits behind the DO Load Balancer (TLS terminates there) -> the pod sees
            # plain HTTP. Without trusting the forwarded proto, node-oidc-provider derives
            # http:// OIDC endpoints from the request, breaking OAuth/JWKS consumers even
            # though ENDPOINT is https. Trust the X-Forwarded-Proto the LB/nginx forward.
            - name: TRUST_PROXY_HEADER
              value: "1"
```

- [ ] **Step 2: Validate the manifest still renders + passes kubeconform**

Run (Git Bash):

```bash
cd /d/repos/fountainrank
NAMESPACE=fountainrank ENVIRONMENT=production IMAGE_TAG=test \
  REGISTRY=registry.digitalocean.com/fountainrank DOMAIN=fountainrank.com \
  envsubst < infra/k8s/logto.yaml | "$(go env GOPATH)/bin/kubeconform" -strict -kubernetes-version 1.34.0 -
```

Expected: `... logto ... Valid` / `... logto-service ... Valid`, 0 Invalid, 0 Errors, and no leftover `${...}` in the rendered output.

If `kubeconform` is not installed (it is not by default — see the Phase 0e handoff): `go install github.com/yannh/kubeconform/cmd/kubeconform@v0.6.7` (`go` is on PATH; the binary lands in `$(go env GOPATH)/bin`). Pin the tag (not `@latest`) so the gate is reproducible. Do **not** substitute `kubectl apply --dry-run=client` — in this environment it reaches the live cluster.

- [ ] **Step 3: Correct the admin-access + API-resource docs**

In `docs/setup/06-logto.md`, replace the sequencing blockquote (currently telling the reader the admin lives at `https://auth.fountainrank.com`) with the accurate access method, and add an API-Resource step.

Replace this block:

```markdown
> **Sequencing:** do this **after** (a) Logto is deployed by 0e, and (b) you've
> created the Google OAuth client (`03`) and Apple Sign-in artifacts (`04`).
> Logto's admin lives at `https://auth.fountainrank.com` (you'll set the initial
> admin credentials on first boot — keep them in your password manager).
```

with:

```markdown
> **Sequencing:** do this **after** (a) Logto is deployed by 0e, and (b) you've
> created the Google OAuth client (`03`) and Apple Sign-in artifacts (`04`).
>
> **Admin console access (port-forward).** The admin console is served on the
> container's port **3002**, which is intentionally **not** exposed publicly. Reach
> it over a local port-forward (no internet-facing admin surface):
>
> ```bash
> kubectl config use-context do-sfo3-fountainrank-production-cluster
> kubectl -n fountainrank port-forward deploy/logto 3002:3002
> # then open http://localhost:3002
> ```
>
> On first boot you set the initial admin credentials — keep them in your password
> manager (Logto admin can mint tokens for any user).
```

Then add a new step before `## Step 1 — Applications` (so it is done first):

```markdown
## Step 0 — API Resource (backend audience)

In **API resources → Create API resource**, set the **API identifier** to
`https://api.fountainrank.com`. This indicator becomes the `aud` of the JWT access
tokens the web/mobile clients request for the backend; the backend validates exactly
this audience. (No scopes are required for Phase 2a — the backend authenticates the
subject; per-scope authorization is a later concern.)

```

- [ ] **Step 4: Commit**

```bash
cd /d/repos/fountainrank
git add infra/k8s/logto.yaml docs/setup/06-logto.md
git commit -m "feat(infra): trust proxy header so Logto emits https OIDC endpoints; document port-forward admin + API resource"
```

---

### Task 2: Backend config — Logto settings

**Files:**
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_config.py`

**Interfaces:**
- Produces: `Settings.logto_endpoint: str`, `Settings.logto_audience: str`, `Settings.logto_jwks_cache_ttl_seconds: int`, and computed `Settings.logto_issuer -> str`, `Settings.logto_jwks_uri -> str`.

- [ ] **Step 1: Write the failing test**

Append the two functions below to `backend/tests/test_config.py`. (`Settings` is already imported at the top of that file — do **not** add another import line; a mid-file import fails `ruff`.)

```python
def test_logto_defaults_and_derived_urls():
    s = Settings()
    assert s.logto_endpoint == "https://auth.fountainrank.com"
    assert s.logto_audience == "https://api.fountainrank.com"
    assert s.logto_jwks_cache_ttl_seconds == 3600
    # Derived from the endpoint — never read from the (pre-fix http) discovery doc.
    assert s.logto_issuer == "https://auth.fountainrank.com/oidc"
    assert s.logto_jwks_uri == "https://auth.fountainrank.com/oidc/jwks"


def test_logto_derived_urls_strip_trailing_slash():
    s = Settings(logto_endpoint="https://auth.example.com/")
    assert s.logto_issuer == "https://auth.example.com/oidc"
    assert s.logto_jwks_uri == "https://auth.example.com/oidc/jwks"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /d/repos/fountainrank && powershell.exe -NoProfile -File run.ps1 check -Backend` (or directly `cd backend && uv run pytest tests/test_config.py -v`)
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'logto_endpoint'`.

- [ ] **Step 3: Implement the settings**

In `backend/app/config.py`, inside `class Settings`, after the `# --- Phase 1 ---` block, add:

```python
    # --- Phase 2a (Logto auth) ---
    # Logto OIDC authority. Issuer + JWKS are DERIVED from this so the backend never
    # depends on the OIDC discovery document (which emits http:// until TRUST_PROXY_HEADER
    # is deployed). Local dev/tests use the dev-auth seam instead of Logto.
    logto_endpoint: str = "https://auth.fountainrank.com"
    # The registered API Resource indicator; becomes the JWT `aud` the backend requires.
    logto_audience: str = "https://api.fountainrank.com"
    # How long a fetched JWKS key set is trusted before a refetch is allowed.
    logto_jwks_cache_ttl_seconds: int = 3600

    @property
    def logto_issuer(self) -> str:
        return f"{self.logto_endpoint.rstrip('/')}/oidc"

    @property
    def logto_jwks_uri(self) -> str:
        return f"{self.logto_issuer}/jwks"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_config.py -v`
Expected: PASS (both new tests green; existing config tests still green).

- [ ] **Step 5: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/config.py backend/tests/test_config.py
git commit -m "feat(backend): add Logto auth settings (endpoint/audience + derived issuer/jwks)"
```

---

### Task 3: Logto JWT validation module (`app/logto_auth.py`)

**Files:**
- Create: `backend/app/logto_auth.py`
- Modify: `backend/pyproject.toml` (add `pyjwt[crypto]`; move `httpx` to runtime)
- Test: `backend/tests/test_logto_auth.py`

**Interfaces:**
- Consumes: `Settings.logto_audience`, `Settings.logto_issuer`, `Settings.logto_jwks_uri`, `Settings.logto_jwks_cache_ttl_seconds`.
- Produces:
  - `class AuthError(Exception)` with attribute `reason: str`.
  - `class JwksCache` with `__init__(jwks_uri: str, ttl_seconds: int, *, fetch: Callable[[], Awaitable[dict]] | None = None, min_refetch_interval: float = 10.0)` and `async get_key(kid: str) -> jwt.PyJWK`.
  - `async validate_bearer_token(token: str, settings: Settings, cache: JwksCache) -> dict` returning verified claims (`sub` guaranteed).

- [ ] **Step 1: Add dependencies**

In `backend/pyproject.toml`, change the `dependencies` list to add PyJWT and httpx (runtime), and remove `httpx` from `[dependency-groups].dev`:

`dependencies` becomes:

```toml
dependencies = [
    "fastapi==0.137.1",
    "uvicorn[standard]==0.49.0",
    "pydantic==2.13.4",
    "pydantic-settings==2.14.1",
    "sqlalchemy[asyncio]==2.0.51",
    "asyncpg==0.31.0",
    "alembic==1.18.4",
    "geoalchemy2==0.20.0",
    "pyjwt[crypto]==2.13.0",
    "httpx==0.28.1",
]
```

and the dev group drops its `httpx` line:

```toml
dev = [
    "pytest==9.1.0",
    "pytest-asyncio==1.4.0",
    "ruff==0.15.17",
]
```

Then sync + smoke-import:

```bash
cd /d/repos/fountainrank/backend
uv sync
uv run python -c "import jwt, httpx, cryptography; print(jwt.__version__, httpx.__version__, cryptography.__version__)"
```

Expected: prints `2.13.0 0.28.1 49.0.0` (cryptography patch may differ; major 49).

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_logto_auth.py`:

```python
import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import Settings
from app.logto_auth import AuthError, JwksCache, validate_bearer_token

KID = "test-key-1"
ISSUER = "https://auth.fountainrank.com/oidc"
AUDIENCE = "https://api.fountainrank.com"


def _b64(n: int, length: int) -> str:
    return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode()


@pytest.fixture
def keypair():
    priv = ec.generate_private_key(ec.SECP384R1())
    nums = priv.public_key().public_numbers()
    jwk = {
        "kty": "EC", "crv": "P-384", "alg": "ES384", "use": "sig", "kid": KID,
        "x": _b64(nums.x, 48), "y": _b64(nums.y, 48),
    }
    return priv, {"keys": [jwk]}


@pytest.fixture
def cache(keypair):
    _, jwks = keypair

    async def fetch():
        return jwks

    return JwksCache("https://auth.fountainrank.com/oidc/jwks", 3600, fetch=fetch)


@pytest.fixture
def settings():
    return Settings()


def _mint(priv, *, alg="ES384", kid=KID, **overrides):
    now = int(time.time())
    payload = {"sub": "logto|abc", "email": "u@example.com", "name": "U",
               "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 300}
    payload.update(overrides)
    key = "" if alg == "none" else priv
    return jwt.encode(payload, key, algorithm=alg, headers={"kid": kid})


async def test_valid_token_returns_claims(keypair, cache, settings):
    priv, _ = keypair
    claims = await validate_bearer_token(_mint(priv), settings, cache)
    assert claims["sub"] == "logto|abc"
    assert claims["email"] == "u@example.com"


async def test_expired_token_rejected(keypair, cache, settings):
    # exp must be older than the verifier's 60s leeway, or PyJWT still accepts it.
    priv, _ = keypair
    now = int(time.time())
    with pytest.raises(AuthError):
        await validate_bearer_token(_mint(priv, exp=now - 120, iat=now - 300), settings, cache)


async def test_wrong_audience_rejected(keypair, cache, settings):
    priv, _ = keypair
    with pytest.raises(AuthError):
        await validate_bearer_token(_mint(priv, aud="https://evil.example.com"), settings, cache)


async def test_wrong_issuer_rejected(keypair, cache, settings):
    priv, _ = keypair
    with pytest.raises(AuthError):
        await validate_bearer_token(_mint(priv, iss="https://evil.example.com/oidc"), settings, cache)


async def test_tampered_signature_rejected(keypair, cache, settings):
    priv, _ = keypair
    token = _mint(priv)
    tampered = token[:-3] + ("aaa" if token[-3:] != "aaa" else "bbb")
    with pytest.raises(AuthError):
        await validate_bearer_token(tampered, settings, cache)


async def test_alg_confusion_rejected(keypair, cache, settings):
    # HS256 forgery and unsecured "none" must both be refused — we never honor the
    # token header's alg; only ES384 against the EC JWKS is accepted.
    priv, _ = keypair
    hs = jwt.encode({"sub": "x", "iss": ISSUER, "aud": AUDIENCE,
                     "exp": int(time.time()) + 300}, "secret",
                    algorithm="HS256", headers={"kid": KID})
    with pytest.raises(AuthError):
        await validate_bearer_token(hs, settings, cache)
    with pytest.raises(AuthError):
        await validate_bearer_token(_mint(priv, alg="none"), settings, cache)


async def test_missing_sub_rejected(keypair, cache, settings):
    priv, _ = keypair
    token = jwt.encode({"iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300},
                       priv, algorithm="ES384", headers={"kid": KID})
    with pytest.raises(AuthError):
        await validate_bearer_token(token, settings, cache)


async def test_unknown_kid_rejected(keypair, cache, settings):
    priv, _ = keypair
    with pytest.raises(AuthError):
        await validate_bearer_token(_mint(priv, kid="no-such-kid"), settings, cache)


async def test_unknown_kid_flood_is_rate_limited(keypair, settings):
    # A flood of bogus-kid tokens must not trigger a network fetch per request.
    calls = {"n": 0}
    _, jwks = keypair

    async def fetch():
        calls["n"] += 1
        return jwks

    c = JwksCache("https://x/jwks", 3600, fetch=fetch, min_refetch_interval=60.0)
    priv, _ = keypair
    for _ in range(5):
        with pytest.raises(AuthError):
            await validate_bearer_token(_mint(priv, kid="bogus"), settings, c)
    assert calls["n"] == 1  # only the first unknown-kid miss fetched; rest rate-limited


async def test_rotation_new_kid_resolves_after_refetch(keypair, settings):
    priv1, jwks1 = keypair
    priv2 = ec.generate_private_key(ec.SECP384R1())
    nums = priv2.public_key().public_numbers()
    jwk2 = {"kty": "EC", "crv": "P-384", "alg": "ES384", "use": "sig", "kid": "test-key-2",
            "x": _b64(nums.x, 48), "y": _b64(nums.y, 48)}
    state = {"set": jwks1}

    async def fetch():
        return state["set"]

    c = JwksCache("https://x/jwks", 3600, fetch=fetch, min_refetch_interval=0.0)
    assert (await validate_bearer_token(_mint(priv1), settings, c))["sub"] == "logto|abc"

    # Rotate: the JWKS now serves only KID2. A KID2 token misses the cache and, because
    # min_refetch_interval=0, triggers a refetch that picks up the rotated key.
    state["set"] = {"keys": [jwk2]}
    now = int(time.time())
    token2 = jwt.encode(
        {"sub": "logto|xyz", "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 300},
        priv2, algorithm="ES384", headers={"kid": "test-key-2"},
    )
    assert (await validate_bearer_token(token2, settings, c))["sub"] == "logto|xyz"
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_logto_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.logto_auth'`.

- [ ] **Step 4: Implement the module**

Create `backend/app/logto_auth.py`:

```python
"""Logto JWT access-token validation.

Turns a bearer token string into verified claims: ES384 signature checked against
Logto's JWKS, with `iss`/`aud`/`exp` enforced. The algorithm is a hardcoded allowlist
(never the token header's `alg`) to defeat alg-confusion / `none` attacks. The JWKS is
cached with a TTL and a minimum refetch interval so unknown-`kid` floods cannot force
unbounded network fetches. See the Phase 2a design spec under docs/specs/.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable

import httpx
import jwt

from app.config import Settings

_ALGORITHMS = ["ES384"]
_LEEWAY_SECONDS = 60


class AuthError(Exception):
    """A bearer token could not be validated. The resolver maps this to HTTP 401.

    `reason` is a short machine code for logging — never contains token material.
    `kid` is the (unverified) key id from the token header when known, for log
    correlation only (distinguishes unknown-kid / rotation misses from generic
    invalid-token traffic). The unverified `sub` is deliberately NOT carried — it is
    attacker-controlled and must not be logged as identity.
    """

    def __init__(self, reason: str, *, kid: str | None = None):
        self.reason = reason
        self.kid = kid
        super().__init__(reason)


class JwksCache:
    """Async, kid-keyed JWKS cache.

    Fast path serves a known key while the set is fresh (< ttl). A miss (unknown or
    stale kid) refetches under a lock, rate-limited by `min_refetch_interval` so a
    flood of bogus kids triggers at most one fetch per interval. `fetch` is injectable
    for tests (no network)."""

    def __init__(
        self,
        jwks_uri: str,
        ttl_seconds: int,
        *,
        fetch: Callable[[], Awaitable[dict]] | None = None,
        min_refetch_interval: float = 10.0,
    ):
        self._jwks_uri = jwks_uri
        self._ttl = ttl_seconds
        self._fetch_override = fetch
        self._min_refetch_interval = min_refetch_interval
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        # None = never attempted -> the first fetch is always allowed. NOT 0.0: monotonic()'s
        # origin is arbitrary, so `now - 0.0 < interval` could spuriously block the first fetch.
        self._last_attempt: float | None = None
        self._lock = asyncio.Lock()

    async def _fetch(self) -> dict:
        if self._fetch_override is not None:
            return await self._fetch_override()
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(self._jwks_uri)
            resp.raise_for_status()
            return resp.json()

    def _fresh(self, now: float) -> bool:
        return (now - self._fetched_at) < self._ttl

    async def get_key(self, kid: str) -> jwt.PyJWK:
        now = time.monotonic()
        if kid in self._keys and self._fresh(now):
            return self._keys[kid]
        async with self._lock:
            now = time.monotonic()
            if kid in self._keys and self._fresh(now):
                return self._keys[kid]
            # First fetch always allowed (_last_attempt is None); after that, rate-limited so
            # an unknown-kid flood cannot force unbounded fetches (DoS guard).
            may_refetch = (
                self._last_attempt is None
                or (now - self._last_attempt) >= self._min_refetch_interval
            )
            if not may_refetch:
                # Rate-limited: serve a cached key if we have one, else reject without
                # touching the network.
                if kid in self._keys:
                    return self._keys[kid]
                raise AuthError("unknown_kid")
            self._last_attempt = now
            try:
                raw = await self._fetch()
            except Exception as exc:  # network/HTTP/JSON error
                raise AuthError("jwks_fetch_failed") from exc
            key_set = jwt.PyJWKSet.from_dict(raw)
            self._keys = {k.key_id: k for k in key_set.keys if k.key_id}
            self._fetched_at = now
            if kid in self._keys:
                return self._keys[kid]
            raise AuthError("unknown_kid")


async def validate_bearer_token(token: str, settings: Settings, cache: JwksCache) -> dict:
    """Verify a Logto JWT access token and return its claims. Raises AuthError on any
    failure (mapped to 401 by the caller). `sub` is guaranteed present on success."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise AuthError("malformed_token") from exc
    kid = header.get("kid")
    if header.get("alg") not in _ALGORITHMS:
        raise AuthError("unexpected_alg", kid=kid)
    if not kid:
        raise AuthError("missing_kid")
    try:
        signing_key = await cache.get_key(kid)
    except AuthError as exc:
        if exc.kid is None:
            exc.kid = kid  # annotate cache-raised errors (unknown_kid / jwks_fetch_failed)
        raise
    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=_ALGORITHMS,
            audience=settings.logto_audience,
            issuer=settings.logto_issuer,
            leeway=_LEEWAY_SECONDS,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthError(f"invalid_token:{type(exc).__name__}", kid=kid) from exc
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_logto_auth.py -v`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/pyproject.toml backend/uv.lock backend/app/logto_auth.py backend/tests/test_logto_auth.py
git commit -m "feat(backend): Logto JWT validation module (ES384 + cached JWKS)"
```

---

### Task 4: Auth resolver — dual-path `get_current_user`

**Files:**
- Modify: `backend/app/auth.py`
- Test: `backend/tests/test_logto_auth.py` (add resolver-level cases) — or keep module tests pure and add resolver cases here.

**Interfaces:**
- Consumes: `validate_bearer_token`, `JwksCache`, `AuthError` from Task 3; `get_or_create_user` (unchanged); `get_settings`, `get_session`.
- Produces: `get_jwks_cache(settings) -> JwksCache` (FastAPI dependency, process-singleton) and a reworked `get_current_user` that authenticates `Authorization: Bearer <jwt>` (real path) or `X-Dev-User` (dev path, only when `dev_auth_enabled` and no `Authorization` header).

- [ ] **Step 1: Write the failing tests**

First **replace the import block** at the top of `backend/tests/test_logto_auth.py` (the lines from `import base64` through `from app.logto_auth import ...`) with this complete, ruff-sorted block — straight imports before `from` imports, matching the repo convention:

```python
import base64
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.auth import get_current_user, get_jwks_cache
from app.config import Settings, get_settings
from app.logto_auth import AuthError, JwksCache, validate_bearer_token
from app.main import app
```

Then **append** these functions at the end of the file (no further imports):

```python
async def test_bearer_jwt_provisions_and_authorizes_write(keypair, cache, clean_db):
    priv, _ = keypair
    app.dependency_overrides[get_jwks_cache] = lambda: cache
    app.dependency_overrides[get_settings] = lambda: Settings(dev_auth_enabled=False)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post(
                "/api/v1/fountains",
                json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
                headers={"Authorization": f"Bearer {_mint(priv)}"},
            )
        assert resp.status_code == 201
    finally:
        app.dependency_overrides.pop(get_jwks_cache, None)
        app.dependency_overrides.pop(get_settings, None)


async def test_invalid_bearer_does_not_fall_through_to_dev(keypair, cache, clean_db):
    # An Authorization header is present but the token is expired; even with dev auth
    # ENABLED and X-Dev-User set, this must be 401 — never silently use the dev path.
    priv, _ = keypair
    now = int(time.time())
    app.dependency_overrides[get_jwks_cache] = lambda: cache
    app.dependency_overrides[get_settings] = lambda: Settings(dev_auth_enabled=True)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.post(
                "/api/v1/fountains",
                json={"location": {"latitude": 1.0, "longitude": 2.0}, "is_working": True},
                headers={
                    "Authorization": f"Bearer {_mint(priv, exp=now - 120, iat=now - 300)}",
                    "X-Dev-User": "logto-abc",
                },
            )
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.pop(get_jwks_cache, None)
        app.dependency_overrides.pop(get_settings, None)


async def test_bearer_without_email_name_uses_fallbacks(keypair, cache, session, clean_db):
    # A resource JWT carries sub but no email/name -> NOT NULL columns get safe fallbacks.
    # Call the resolver directly (no HTTP/commit needed): get_or_create_user flushes and
    # returns the User with the values we provisioned.
    priv, _ = keypair
    now = int(time.time())
    token = jwt.encode(
        {"sub": "logto|nomail", "iss": ISSUER, "aud": AUDIENCE, "iat": now, "exp": now + 300},
        priv, algorithm="ES384", headers={"kid": KID},
    )
    user = await get_current_user(
        authorization=f"Bearer {token}",
        x_dev_user=None, x_dev_email=None, x_dev_name=None,
        session=session, settings=Settings(dev_auth_enabled=False), jwks_cache=cache,
    )
    assert user.logto_user_id == "logto|nomail"
    assert user.email == "logto|nomail@users.noreply.fountainrank.com"
    assert user.display_name == "logto|nomail"


async def test_malformed_authorization_rejected_without_dev_fallthrough(cache, session):
    # A present but non-Bearer Authorization header is 401 even with the dev seam enabled
    # and X-Dev-User set — it must NOT fall through to the dev path.
    with pytest.raises(HTTPException) as ei:
        await get_current_user(
            authorization="Banana xyz",
            x_dev_user="logto-abc", x_dev_email=None, x_dev_name=None,
            session=session, settings=Settings(dev_auth_enabled=True), jwks_cache=cache,
        )
    assert ei.value.status_code == 401


async def test_no_credential_rejected_when_dev_disabled(cache, session):
    with pytest.raises(HTTPException) as ei:
        await get_current_user(
            authorization=None,
            x_dev_user=None, x_dev_email=None, x_dev_name=None,
            session=session, settings=Settings(dev_auth_enabled=False), jwks_cache=cache,
        )
    assert ei.value.status_code == 401


async def test_auth_failure_logs_kid_not_token(keypair, cache, session, caplog):
    # Observability: an auth failure logs reason + kid (request_id is auto-stamped) and
    # never the token. Use an unknown kid so the cache annotates it onto the AuthError.
    priv, _ = keypair
    token = _mint(priv, kid="rotated-out")
    with caplog.at_level("WARNING", logger="app.auth"):
        with pytest.raises(HTTPException):
            await get_current_user(
                authorization=f"Bearer {token}",
                x_dev_user=None, x_dev_email=None, x_dev_name=None,
                session=session, settings=Settings(dev_auth_enabled=False), jwks_cache=cache,
            )
    rec = next(r for r in caplog.records if r.name == "app.auth")
    assert rec.reason == "unknown_kid"
    assert rec.kid == "rotated-out"
    assert token not in rec.getMessage()
```

Note: `clean_db` (from `conftest.py`) resets tables; these tests need the DB up (`./run.ps1 up`).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_logto_auth.py -k "bearer or fall_through" -v`
Expected: FAIL — `ImportError: cannot import name 'get_jwks_cache' from 'app.auth'`.

- [ ] **Step 3: Rework `app/auth.py`**

Replace the imports + `get_current_user` in `backend/app/auth.py` (keep `get_or_create_user` exactly as-is). New file head and resolver:

```python
import logging
import uuid

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import get_session
from app.logto_auth import AuthError, JwksCache, validate_bearer_token
from app.models import User

logger = logging.getLogger("app.auth")

# Process-wide JWKS cache singleton (keys are fetched once and cached). Exposed as a
# dependency so tests can override it with a synthetic, network-free cache.
_jwks_cache: JwksCache | None = None


def get_jwks_cache(settings: Settings = Depends(get_settings)) -> JwksCache:
    global _jwks_cache
    if _jwks_cache is None:
        _jwks_cache = JwksCache(settings.logto_jwks_uri, settings.logto_jwks_cache_ttl_seconds)
    return _jwks_cache
```

Keep `get_or_create_user(...)` unchanged. Then replace `get_current_user` with:

```python
async def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None, alias="X-Dev-User"),
    x_dev_email: str | None = Header(default=None, alias="X-Dev-Email"),
    x_dev_name: str | None = Header(default=None, alias="X-Dev-Name"),
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
    jwks_cache: JwksCache = Depends(get_jwks_cache),
) -> User:
    """Resolve the authenticated user.

    Real path: a Logto `Authorization: Bearer <jwt>` (validated via JWKS, iss/aud/exp).
    Dev path: the `X-Dev-User` seam, only when `dev_auth_enabled` is True AND no
    Authorization header is present. A present-but-invalid bearer is a hard 401 and
    never falls through to the dev path. Production runs with dev_auth_enabled=False,
    so only the real path can authenticate."""
    if authorization is not None:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            logger.warning(
                "auth failed",
                extra={"reason": "malformed_authorization_header", "kid": None},
            )
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid authorization header")
        try:
            claims = await validate_bearer_token(token.strip(), settings, jwks_cache)
        except AuthError as exc:
            # request_id is auto-stamped by RequestIdFilter; kid aids rotation/flood triage.
            # Never log the token, full JWT, or the unverified sub.
            logger.warning("auth failed", extra={"reason": exc.reason, "kid": exc.kid})
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED, detail="invalid token"
            ) from exc
        sub = claims["sub"]
        email = claims.get("email") or f"{sub}@users.noreply.fountainrank.com"
        display_name = claims.get("name") or claims.get("username") or sub
        return await get_or_create_user(
            session, logto_user_id=sub, email=email, display_name=display_name
        )

    if settings.dev_auth_enabled and x_dev_user:
        return await get_or_create_user(
            session,
            logto_user_id=x_dev_user,
            email=x_dev_email or f"{x_dev_user}@dev.local",
            display_name=x_dev_name or x_dev_user,
        )

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="authentication required")
```

Then add an autouse reset fixture to `backend/tests/conftest.py` (append at the end) so the
process-singleton JWKS cache never leaks between tests — mirroring the existing
`reset_app_engine` fixture:

```python
@pytest.fixture(autouse=True)
def reset_jwks_cache():
    """Reset the app-global JWKS cache singleton after each test so a cache built from one
    test's settings can't leak into the next (order-independence)."""
    yield
    import app.auth as _app_auth

    _app_auth._jwks_cache = None
```

(`pytest` is already imported at the top of `conftest.py`.)

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_logto_auth.py -v`
Expected: PASS (module + resolver cases all green).

- [ ] **Step 5: Commit**

```bash
cd /d/repos/fountainrank
git add backend/app/auth.py backend/tests/test_logto_auth.py backend/tests/conftest.py
git commit -m "feat(backend): dual-path get_current_user (Logto JWT real path + gated dev seam)"
```

---

### Task 5: Regression sweep — dev-seam still gated + full local CI mirror

**Files:**
- Modify: `backend/tests/test_auth_seam.py` (assert the dev path is reachable only without an Authorization header)
- Modify: `backend/README.md` (document the Bearer real path alongside the dev headers)

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: a green full local CI mirror and updated API-auth docs.

- [ ] **Step 1: Add a dev-seam guard test**

Append to `backend/tests/test_auth_seam.py`:

```python
async def test_dev_path_used_when_enabled_and_no_authorization_header(settings_override):
    settings_override(dev_auth_enabled=True)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(
            "/api/v1/fountains",
            json={"location": {"latitude": 3.0, "longitude": 4.0}, "is_working": True},
            headers={"X-Dev-User": "logto-dev-1"},
        )
    assert resp.status_code == 201  # dev seam provisions + authorizes when no Bearer
```

- [ ] **Step 2: Run the auth-seam tests**

Run: `cd /d/repos/fountainrank/backend && uv run pytest tests/test_auth_seam.py -v`
Expected: PASS (new + existing cases green).

- [ ] **Step 3: Document the real path in `backend/README.md`**

Find the section documenting the `X-Dev-User` dev-auth headers and add a sentence before it:

```markdown
**Production auth (Phase 2a):** write endpoints require a Logto JWT access token —
`Authorization: Bearer <token>` — validated via JWKS (`iss`/`aud`/`exp`, ES384). The
token must be issued for the API Resource `https://api.fountainrank.com`. The dev-auth
headers below are a local-only convenience, active solely when `DEV_AUTH_ENABLED=true`
(default `false` in production) and only when no `Authorization` header is sent.
```

- [ ] **Step 4: Run the full backend check**

Run: `cd /d/repos/fountainrank && powershell.exe -NoProfile -File run.ps1 check -Backend`
Expected: ruff check ✓, ruff format --check ✓, alembic upgrade ✓, alembic check (drift-free) ✓, pytest — all tests pass (the existing 50 + the new auth tests).

- [ ] **Step 5: Run the full local CI mirror**

Run: `cd /d/repos/fountainrank && powershell.exe -NoProfile -File run.ps1 check`
Expected: backend + frontend lint/typecheck/test + web build all green. (The web/mobile jobs run `pnpm run generate`, which regenerates the api-client from the backend OpenAPI — no API surface changed here, so the generated client should be unchanged.)

- [ ] **Step 6: Commit**

```bash
cd /d/repos/fountainrank
git add backend/tests/test_auth_seam.py backend/README.md
git commit -m "test(backend): assert dev seam gated behind no-Authorization; document Bearer auth"
```

---

## After all tasks

- Open the PR, get **CI green**, run **Codex Loop B** (PR review) to `VERDICT: APPROVED`, address every PR comment, then **squash-merge** (`gh pr merge <N> --squash`). See `claude_help/codex-review-process.md` and `claude_help/testing-ci.md`.
- **Owner, post-merge (owner-gated deploy):** tag a `v*.*.*` release to deploy the `TRUST_PROXY_HEADER` fix; then verify `https://auth.fountainrank.com/oidc/.well-known/openid-configuration` reports `https://` endpoints; then port-forward the admin console and register the API Resource `https://api.fountainrank.com` (per `docs/setup/06-logto.md`).

## Self-review notes (coverage vs spec)

- §4.1 infra → Task 1. §4.2 config → Task 2. §4.3 JWKS/verify → Task 3. §4.4 resolver → Task 4. §4.5 provisioning fallbacks → Task 4 Step 3. §4.6 deps → Task 3 Step 1. §4.7 owner tasks + §7 post-deploy check → Task 1 docs + "After all tasks". §5 error handling (401-not-500, no token logging) → Task 3 (AuthError) + Task 4 (HTTPException + redacted WARNING logs). §6 testing matrix → Tasks 3–5. §7 acceptance → Tasks 1–5 + PR/Codex gate.
