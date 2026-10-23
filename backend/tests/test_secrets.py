"""Repo secrets: decrypt what the web app wrote, reach the repo's commands, never leave the sandbox in clear text."""
import base64

import pytest

from mogo.config import RepoConfig
from mogo.models import RepoEnvVar, Run, RunEvent
from mogo.runner.pipeline import execute_run
from mogo.secrets import Redactor, SecretError, decrypt, decrypt_all, encrypt, load_key
from conftest import FakeLLM, seed_repos, tool_call
from test_pipeline import fake_checkout, fake_github, make_run

# Written by web/src/lib/secrets.ts (see web/tests/secrets.test.ts).
KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
TOKEN = "v1:AQEBAQEBAQEBAQEBBo76w/fNiX3r+/NUSkezlduIY5tq83t3Oh470rmxICyxyR4c1nGnqI+mwg=="


def test_decrypts_the_web_apps_format():
    assert decrypt(load_key(KEY), "repo-1", "DATABASE_URL", TOKEN) == "postgres://u:pässword@db/x"
    assert encrypt(load_key(KEY), "repo-1", "DATABASE_URL", "postgres://u:pässword@db/x", iv=b"\x01" * 12) == TOKEN


@pytest.mark.parametrize("repo,name", [("repo-2", "DATABASE_URL"), ("repo-1", "OTHER")])
def test_a_value_is_bound_to_its_repo_and_name(repo, name):
    with pytest.raises(SecretError, match="cannot decrypt"):
        decrypt(load_key(KEY), repo, name, TOKEN)


def test_bad_keys_and_missing_key_are_reported_without_values():
    with pytest.raises(SecretError):
        load_key(base64.b64encode(b"short").decode())
    values, problems = decrypt_all("", "repo-1", {"DATABASE_URL": TOKEN})
    assert values == {} and "MOGO_SECRET_KEY is not set" in problems[0] and "pässword" not in problems[0]
    other = base64.b64encode(b"\x09" * 32).decode()
    values, problems = decrypt_all(other, "repo-1", {"DATABASE_URL": TOKEN})
    assert values == {} and "MOGO_SECRET_KEY changed" in problems[0]


def test_redactor():
    r = Redactor(["s3cr3t-value", "on", "longer-s3cr3t-value"])
    assert r("a longer-s3cr3t-value and s3cr3t-value, on") == "a *** and ***, on"
    assert r.deep({"a": ["x s3cr3t-value"], "n": 1}) == {"a": ["x ***"], "n": 1}


def test_secrets_reach_commands_override_env_and_are_masked(settings, sf, tmp_path, monkeypatch):
    ids = seed_repos(sf, {"acme/api": RepoConfig(
        name="acme/api", start="python3 -m http.server 8781", healthcheck="http://localhost:8781",
        prepare=[f'echo "$API_KEY $MODE" > {tmp_path}/env; echo "leak: $API_KEY"; exit 1'],
    )})
    rid_repo = ids["acme/api"]
    with sf() as s:
        s.add(RepoEnvVar(repo_id=rid_repo, name="MODE", sensitive=False, value="test"))
        s.add(RepoEnvVar(repo_id=rid_repo, name="API_KEY", sensitive=True,
                         value_enc=encrypt(load_key(KEY), rid_repo, "API_KEY", "dash-secret-value")))
        s.commit()
    settings.mogo_secret_key = KEY
    report = {"summary": "the key is dash-secret-value", "findings": [
        {"path": "src/svc.ts", "line": 2, "severity": "minor", "message": "prints dash-secret-value"}]}
    llm = FakeLLM([[tool_call("run_shell", {"command": "echo $API_KEY"})], [tool_call("submit_report", report, "c2")]])
    posted = []
    rid = make_run(sf, feature="thing works")
    execute_run(rid, settings, sf, gh=fake_github(posted), llm_factory=lambda _c: llm, checkout=fake_checkout)

    assert (tmp_path / "env").read_text().strip() == "dash-secret-value test"
    with sf() as s:
        run = s.get(Run, rid)
        events = " ".join(e.message for e in s.query(RunEvent))
        assert run.status == "succeeded", run.error
        stored = str(run.result)
    leaked = [where for where, text in [
        ("events", events), ("result", stored), ("review", str(posted)),
        ("sent to the llm", str([m for m in llm.messages if m["role"] in ("system", "user", "tool")])),
    ] if "dash-secret-value" in text]
    assert leaked == []
    assert "leak: ***" in events and "repo secrets: API_KEY" in events
    assert "the key is ***" in posted[0]["body"]
    assert any(m.get("role") == "tool" and m["content"].strip().endswith("***") for m in llm.messages)


def test_a_bad_secret_is_a_warning_not_a_failure(settings, sf):
    ids = seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    with sf() as s:
        s.add(RepoEnvVar(repo_id=ids["acme/api"], name="X", sensitive=True, value_enc="v1:garbage"))
        s.commit()
    settings.mogo_secret_key = KEY
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    rid = make_run(sf)
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"
        assert any("repo secret unavailable: X" in e.message for e in s.query(RunEvent))


def test_runner_credentials_never_reach_repo_commands(settings, sf, tmp_path, monkeypatch):
    """Runner repo secrets are for the runner: a repo's commands get only its own env and secrets."""
    for name in ("GITHUB_APP_PRIVATE_KEY", "DATABASE_URL", "MOGO_SECRET_KEY", "API_JWT_SECRET"):
        monkeypatch.setenv(name, "runner-only-value")
    seed_repos(sf, {"acme/api": RepoConfig(
        name="acme/api", start="python3 -m http.server 8782", healthcheck="http://localhost:8782",
        prepare=[f"env > {tmp_path}/env"],
    )}, env={"acme/api": {"APP_MODE": "test"}})
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(make_run(sf, feature="thing works"), settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm,
                checkout=fake_checkout)
    seen = (tmp_path / "env").read_text()
    assert "APP_MODE=test" in seen and "runner-only-value" not in seen


def test_a_repo_still_listing_env_from_gets_a_warning_not_the_values(settings, sf, tmp_path, monkeypatch):
    from mogo.models import Repo
    monkeypatch.setenv("API_JWT_SECRET", "runner-only-value")
    ids = seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    with sf() as s:
        s.get(Repo, ids["acme/api"]).config = {"start": "python3 -m http.server 8783",
                                               "healthcheck": "http://localhost:8783",
                                               "prepare": [f"env > {tmp_path}/env"],
                                               "env_from": {"JWT_SECRET": "API_JWT_SECRET", "SMTP": "SMTP"}}
        s.commit()
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    rid = make_run(sf, feature="thing works")
    execute_run(rid, settings, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)
    assert "runner-only-value" not in (tmp_path / "env").read_text()
    with sf() as s:
        assert s.get(Run, rid).status == "succeeded"
        assert any("env_from is no longer read" in e.message and "JWT_SECRET, SMTP" in e.message for e in s.query(RunEvent))
