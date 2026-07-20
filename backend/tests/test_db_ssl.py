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


# --- loader-session server_settings (spec 2026-07-17 §2a) -------------------------------------
# Parameterized per-setting matrix: each setting alone, a partial pair, and all three, asserting
# the EXACT dict shape — a lone optional setting must create server_settings by itself.

_MARKER = "loader:boundary-load:29468135928"


@pytest.mark.parametrize(
    ("overrides", "expected_server_settings"),
    [
        ({"db_application_name": _MARKER}, {"application_name": _MARKER}),
        (
            {"db_client_connection_check_interval_ms": 30_000},
            {"client_connection_check_interval": "30000"},
        ),
        ({"db_lock_timeout_ms": 900_000}, {"lock_timeout": "900000"}),
        (
            {"db_application_name": _MARKER, "db_lock_timeout_ms": 900_000},
            {"application_name": _MARKER, "lock_timeout": "900000"},
        ),
        (
            {
                "db_application_name": _MARKER,
                "db_client_connection_check_interval_ms": 30_000,
                "db_lock_timeout_ms": 900_000,
            },
            {
                "application_name": _MARKER,
                "client_connection_check_interval": "30000",
                "lock_timeout": "900000",
            },
        ),
    ],
)
def test_server_settings_exact_shape_plaintext(overrides, expected_server_settings):
    args = engine_connect_args(Settings(db_ssl_root_cert=None, **overrides))
    assert args == {"server_settings": expected_server_settings}


@pytest.mark.parametrize(
    "overrides",
    [
        {
            "db_application_name": _MARKER,
            "db_client_connection_check_interval_ms": 30_000,
            "db_lock_timeout_ms": 900_000,
        },
        {"db_client_connection_check_interval_ms": 30_000},
    ],
)
def test_server_settings_merge_with_tls(tmp_path, overrides):
    # Production runs TLS; server_settings must MERGE with the ssl entry, neither displacing
    # the other (a plaintext-only test could hide a connect-args merge bug).
    ca = tmp_path / "ca.pem"
    ca.write_text(TEST_CA_PEM, encoding="utf-8")
    args = engine_connect_args(Settings(db_ssl_root_cert=str(ca), **overrides))
    assert set(args) == {"ssl", "server_settings"}
    assert isinstance(args["ssl"], ssl.SSLContext)
    expected_keys = {
        "db_application_name": "application_name",
        "db_client_connection_check_interval_ms": "client_connection_check_interval",
        "db_lock_timeout_ms": "lock_timeout",
    }
    assert set(args["server_settings"]) == {expected_keys[k] for k in overrides}


@pytest.mark.parametrize(
    ("field", "bad"),
    [
        ("db_client_connection_check_interval_ms", 0),
        ("db_client_connection_check_interval_ms", -1),
        ("db_client_connection_check_interval_ms", 600_001),
        ("db_lock_timeout_ms", 0),
        ("db_lock_timeout_ms", -5),
        ("db_lock_timeout_ms", 18_000_001),
    ],
)
def test_interval_settings_validation(field, bad):
    with pytest.raises(ValueError):
        Settings(**{field: bad})
