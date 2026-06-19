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
        "kty": "EC",
        "crv": "P-384",
        "alg": "ES384",
        "use": "sig",
        "kid": KID,
        "x": _b64(nums.x, 48),
        "y": _b64(nums.y, 48),
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
    payload = {
        "sub": "logto|abc",
        "email": "u@example.com",
        "name": "U",
        "iss": ISSUER,
        "aud": AUDIENCE,
        "iat": now,
        "exp": now + 300,
    }
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
    token = _mint(priv, iss="https://evil.example.com/oidc")
    with pytest.raises(AuthError):
        await validate_bearer_token(token, settings, cache)


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
    hs = jwt.encode(
        {"sub": "x", "iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300},
        "secret",
        algorithm="HS256",
        headers={"kid": KID},
    )
    with pytest.raises(AuthError):
        await validate_bearer_token(hs, settings, cache)
    with pytest.raises(AuthError):
        await validate_bearer_token(_mint(priv, alg="none"), settings, cache)


async def test_missing_sub_rejected(keypair, cache, settings):
    priv, _ = keypair
    token = jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "exp": int(time.time()) + 300},
        priv,
        algorithm="ES384",
        headers={"kid": KID},
    )
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
    jwk2 = {
        "kty": "EC",
        "crv": "P-384",
        "alg": "ES384",
        "use": "sig",
        "kid": "test-key-2",
        "x": _b64(nums.x, 48),
        "y": _b64(nums.y, 48),
    }
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
        priv2,
        algorithm="ES384",
        headers={"kid": "test-key-2"},
    )
    assert (await validate_bearer_token(token2, settings, c))["sub"] == "logto|xyz"


async def test_jwks_fetch_failure_is_auth_error(keypair, settings):
    # Fail closed: if the JWKS fetch errors, reject (-> 401), never raise a 500.
    priv, _ = keypair

    async def fetch():
        raise RuntimeError("network down")

    c = JwksCache("https://x/jwks", 3600, fetch=fetch)
    with pytest.raises(AuthError) as ei:
        await validate_bearer_token(_mint(priv), settings, c)
    assert ei.value.reason == "jwks_fetch_failed"


async def test_jwks_invalid_body_is_auth_error(keypair, settings):
    # A malformed JWKS body must surface as a typed AuthError (-> 401), not an uncaught 500.
    priv, _ = keypair

    async def fetch():
        return "this is not a jwks object"

    c = JwksCache("https://x/jwks", 3600, fetch=fetch)
    with pytest.raises(AuthError) as ei:
        await validate_bearer_token(_mint(priv), settings, c)
    assert ei.value.reason == "jwks_invalid"
