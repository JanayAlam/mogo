import json

import httpx
import pytest

from mogo.github.client import GitHubClient, GitHubError, parse_pr_url


def test_parse_pr_url():
    assert parse_pr_url("https://github.com/acme/api/pull/42/files") == ("acme", "api", 42)
    with pytest.raises(ValueError):
        parse_pr_url("https://github.com/acme/api/issues/1")


def test_create_review_payload_and_auth():
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"] = req.headers["authorization"]
        seen["path"] = req.url.path
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"html_url": "https://x/review"})

    gh = GitHubClient("tok", transport=httpx.MockTransport(handler))
    res = gh.create_review("acme", "api", 7, body="hi", event="COMMENT",
                           comments=[{"path": "a", "line": 1, "side": "RIGHT", "body": "b"}], commit_id="abc")
    assert res["html_url"] == "https://x/review"
    assert seen["auth"] == "Bearer tok"
    assert seen["path"] == "/repos/acme/api/pulls/7/reviews"
    assert seen["body"]["commit_id"] == "abc" and seen["body"]["comments"][0]["side"] == "RIGHT"


def test_errors_raise():
    gh = GitHubClient("t", transport=httpx.MockTransport(lambda r: httpx.Response(404, text="nope")))
    with pytest.raises(GitHubError) as e:
        gh.get_pr("a", "b", 1)
    assert e.value.status == 404
