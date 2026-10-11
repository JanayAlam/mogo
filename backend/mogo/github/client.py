from __future__ import annotations

import re

import httpx

_PR_URL = re.compile(r"^https?://github\.com/([^/\s]+)/([^/\s]+)/pull/(\d+)")


def parse_pr_url(url: str) -> tuple[str, str, int]:
    m = _PR_URL.match(url.strip())
    if not m:
        raise ValueError(f"not a GitHub PR url: {url}")
    return m.group(1), m.group(2), int(m.group(3))


class GitHubError(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"GitHub API {status}: {body[:300]}")
        self.status = status


class GitHubClient:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None):
        self._http = httpx.Client(
            base_url="https://api.github.com",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30.0,
            transport=transport,
        )

    def _req(self, method: str, path: str, **kw) -> httpx.Response:
        r = self._http.request(method, path, **kw)
        if r.status_code >= 400:
            raise GitHubError(r.status_code, r.text)
        return r

    def get_pr(self, owner: str, repo: str, number: int) -> dict:
        return self._req("GET", f"/repos/{owner}/{repo}/pulls/{number}").json()

    def get_diff(self, owner: str, repo: str, number: int) -> str:
        r = self._req(
            "GET", f"/repos/{owner}/{repo}/pulls/{number}",
            headers={"Accept": "application/vnd.github.diff"},
        )
        return r.text

    def branch_sha(self, owner: str, repo: str, branch: str) -> str:
        r = self._req(
            "GET", f"/repos/{owner}/{repo}/commits/{branch}", headers={"Accept": "application/vnd.github.sha"},
        )
        return r.text.strip()

    def create_review(
        self, owner: str, repo: str, number: int, *, body: str, event: str,
        comments: list[dict], commit_id: str | None = None,
    ) -> dict:
        payload: dict = {"body": body, "event": event, "comments": comments}
        if commit_id:
            payload["commit_id"] = commit_id
        return self._req("POST", f"/repos/{owner}/{repo}/pulls/{number}/reviews", json=payload).json()

    def dispatch_workflow(self, repo: str, workflow: str, ref: str, inputs: dict) -> None:
        self._req(
            "POST", f"/repos/{repo}/actions/workflows/{workflow}/dispatches",
            json={"ref": ref, "inputs": inputs},
        )
