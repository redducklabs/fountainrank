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
