"""The Mogo GitHub App: short-lived installation tokens, so a run reads the user's repo and posts its review as
mogo[bot]. The App's private key stays in the runner; the repo's commands never see it (sandbox.scrubbed_env)."""
from __future__ import annotations

import base64
import binascii
import json
import time

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

# What a run needs on the user's repo, no more (the App may have been granted more).
RUN_PERMISSIONS = {"contents": "read", "pull_requests": "write", "metadata": "read"}


class GitHubAppError(RuntimeError):
    pass


def load_private_key(raw: str) -> rsa.RSAPrivateKey:
    """The .pem as downloaded, with literal \\n (one-line env vars), or base64 of the file."""
    text = raw.strip().strip("'\"").replace("\\n", "\n")
    if not text.startswith("-----BEGIN"):
        try:
            text = base64.b64decode(text, validate=True).decode()
        except (binascii.Error, ValueError, UnicodeDecodeError) as e:
            raise GitHubAppError("GITHUB_APP_PRIVATE_KEY must be the .pem contents (or base64 of the file)") from e
    try:
        key = serialization.load_pem_private_key(text.encode(), password=None)
    except ValueError as e:
        raise GitHubAppError("GITHUB_APP_PRIVATE_KEY is not a readable private key") from e
    if not isinstance(key, rsa.RSAPrivateKey):
        raise GitHubAppError("GITHUB_APP_PRIVATE_KEY must be the RSA key GitHub generated for the App")
    return key


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def app_jwt(app_id: str, key: rsa.RSAPrivateKey, now: float | None = None) -> str:
    """RS256 JWT that authenticates as the App itself. Backdated a minute against clock drift; GitHub allows 10 min."""
    now = int(now if now is not None else time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({"iat": now - 60, "exp": now + 540, "iss": str(app_id)}).encode())
    signing_input = f"{header}.{payload}".encode()
    sig = key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{payload}.{_b64url(sig)}"


class GitHubApp:
    def __init__(self, app_id: str, private_key: str, slug: str = "", transport: httpx.BaseTransport | None = None):
        if not app_id or not private_key:
            raise GitHubAppError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set (the Mogo GitHub App)")
        self.app_id, self.slug = app_id, slug
        self._key = load_private_key(private_key)
        self._http = httpx.Client(
            base_url="https://api.github.com",
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
            timeout=30.0,
            transport=transport,
        )

    def _req(self, method: str, path: str, **kw) -> httpx.Response:
        return self._http.request(method, path, headers={"Authorization": f"Bearer {app_jwt(self.app_id, self._key)}"}, **kw)

    def _not_installed(self, owner: str, repo: str) -> GitHubAppError:
        where = f": https://github.com/apps/{self.slug}/installations/new" if self.slug else ""
        return GitHubAppError(f"Mogo is not installed on {owner}/{repo}; install the GitHub App on it{where}")

    def installation_id(self, owner: str, repo: str) -> int:
        r = self._req("GET", f"/repos/{owner}/{repo}/installation")
        if r.status_code == 404:
            raise self._not_installed(owner, repo)
        if r.status_code >= 400:
            raise GitHubAppError(f"GitHub API {r.status_code}: {r.text[:300]}")
        return int(r.json()["id"])

    def repo_token(self, owner: str, repo: str, installation_id: int | None = None) -> str:
        """A token for this one repo, valid one hour. A stale installation id (App reinstalled) is looked up again."""
        for attempt in range(2):
            iid = installation_id if installation_id and attempt == 0 else self.installation_id(owner, repo)
            r = self._req("POST", f"/app/installations/{iid}/access_tokens",
                          json={"repositories": [repo], "permissions": RUN_PERMISSIONS})
            if r.status_code < 400:
                return r.json()["token"]
            if r.status_code in (404, 422) and installation_id and attempt == 0:
                continue  # the stored installation is gone or no longer covers the repo
            if r.status_code in (404, 422):
                raise self._not_installed(owner, repo)
            raise GitHubAppError(f"GitHub API {r.status_code}: {r.text[:300]}")
        raise self._not_installed(owner, repo)


def repo_token(settings, owner: str, repo: str, installation_id: int | None = None) -> str:
    """Installation token for one repo, from the App credentials in Settings."""
    app = GitHubApp(settings.github_app_id, settings.github_app_private_key, settings.github_app_slug)
    return app.repo_token(owner, repo, installation_id)
