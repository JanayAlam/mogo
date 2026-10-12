import base64
import json

import httpx
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from mogo.github.app import GitHubApp, GitHubAppError, app_jwt, load_private_key

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption()).decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def test_jwt_is_rs256_signed_by_the_app():
    token = app_jwt("123", KEY, now=1_000_000)
    header, payload, sig = token.split(".")
    assert json.loads(_unb64(header))["alg"] == "RS256"
    assert json.loads(_unb64(payload)) == {"iat": 999_940, "exp": 1_000_540, "iss": "123"}
    KEY.public_key().verify(_unb64(sig), f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())


@pytest.mark.parametrize("raw", [PEM, PEM.replace("\n", "\\n"), base64.b64encode(PEM.encode()).decode()])
def test_key_formats(raw):
    assert load_private_key(raw).private_numbers() == KEY.private_numbers()


def test_bad_key_is_reported():
    with pytest.raises(GitHubAppError, match="PRIVATE_KEY"):
        load_private_key("not a key")


def app(handler):
    return GitHubApp("123", PEM, slug="mogo", transport=httpx.MockTransport(handler))


def test_token_for_one_repo_with_minimal_permissions():
    seen = []

    def handler(req):
        seen.append(req)
        return httpx.Response(201, json={"token": "ghs_x"})
    assert app(handler).repo_token("acme", "api", 42) == "ghs_x"
    (req,) = seen
    assert req.url.path == "/app/installations/42/access_tokens"
    assert req.headers["authorization"].startswith("Bearer ey")
    body = json.loads(req.content)
    assert body["repositories"] == ["api"] and body["permissions"]["pull_requests"] == "write"
    assert body["permissions"]["contents"] == "read"


def test_stale_installation_is_looked_up_again():
    def handler(req):
        if req.url.path == "/app/installations/1/access_tokens":
            return httpx.Response(404)
        if req.url.path == "/repos/acme/api/installation":
            return httpx.Response(200, json={"id": 2})
        return httpx.Response(201, json={"token": "fresh"})
    assert app(handler).repo_token("acme", "api", 1) == "fresh"


def test_not_installed_points_to_the_install_page():
    with pytest.raises(GitHubAppError, match="github.com/apps/mogo/installations/new"):
        app(lambda _r: httpx.Response(404)).repo_token("acme", "api")


def test_app_credentials_are_required():
    with pytest.raises(GitHubAppError, match="GITHUB_APP_ID"):
        GitHubApp("", "")
