import pytest
from pydantic import ValidationError

from mogo.config import RepoConfig
from mogo.runner.pipeline import execute_run
from mogo.runner.sandbox import resolve_repo_env
from conftest import FakeLLM, tool_call
from test_pipeline import fake_checkout, fake_github, make_run


def test_values_come_from_environment_then_secrets_blob(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "from-environ")
    monkeypatch.delenv("SMTP_PASS", raising=False)
    monkeypatch.setenv("MOGO_SECRETS_JSON", '{"SMTP_PASS": "from-blob", "LLM_API_KEY": "ignored", "OTHER": "x"}')
    env, missing = resolve_repo_env({"PORT": "8000"}, {n: n for n in ["LLM_API_KEY", "SMTP_PASS", "NOT_SET"]})
    assert env == {"PORT": "8000", "LLM_API_KEY": "from-environ", "SMTP_PASS": "from-blob"}
    assert missing == ["NOT_SET"]  # "OTHER" is in the blob but was not requested, so it is not forwarded


def test_bad_blob_is_ignored(monkeypatch):
    monkeypatch.setenv("MOGO_SECRETS_JSON", "not json")
    assert resolve_repo_env({}, {"A": "A"}) == ({}, ["A"])


def test_a_secret_can_be_exposed_under_another_name(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "runner-db")
    monkeypatch.setenv("MOGO_SECRETS_JSON", '{"ACME_DATABASE_URL": "repo-db"}')
    cfg = RepoConfig(name="a/b", env={"DATABASE_URL": "local"}, env_from={"DATABASE_URL": "ACME_DATABASE_URL", "X": "ACME_X"})
    env, missing = resolve_repo_env(cfg.env, cfg.env_from)
    assert env == {"DATABASE_URL": "repo-db"}
    assert missing == ["ACME_X"]


def test_a_list_means_the_same_name():
    assert RepoConfig(name="a/b", env_from=["A", "B"]).env_from == {"A": "A", "B": "B"}


@pytest.mark.parametrize("name", ["GITHUB_TOKEN", "agent_github_token", "DEEPSEEK_API_KEY", "DATABASE_URL"])
def test_runner_credentials_cannot_be_forwarded(name):
    with pytest.raises(ValidationError, match="runner's own credentials"):
        RepoConfig(name="a/b", env_from=[name])
    with pytest.raises(ValidationError, match="runner's own credentials"):
        RepoConfig(name="a/b", env_from={"SOMETHING": name})


def test_a_literal_test_value_with_a_reserved_name_is_allowed():
    cfg = RepoConfig(name="a/b", env={"DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/test"})
    assert cfg.env["DATABASE_URL"].endswith("/test")


def test_secrets_reach_commands_but_runner_credentials_do_not(settings, sf, tmp_path, monkeypatch):
    monkeypatch.setenv("MOGO_SECRETS_JSON", '{"TEST_LLM_KEY": "sk-test-123"}')
    monkeypatch.setenv("GITHUB_TOKEN", "runner-secret")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "runner-secret")
    cfg = {"acme/api": RepoConfig(
        name="acme/api", env={"APP_MODE": "test"}, env_from=["TEST_LLM_KEY", "MISSING_ONE"],
        gates=[f"env > {tmp_path}/gate-env"],
    )}
    rid = make_run(sf, llm_mode="deepseek")
    settings.llm_mode = "deepseek"
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(rid, settings, cfg, sf, gh=fake_github([]), llm_factory=lambda _c: llm, checkout=fake_checkout)

    seen = (tmp_path / "gate-env").read_text()
    assert "TEST_LLM_KEY=sk-test-123" in seen and "APP_MODE=test" in seen
    assert "runner-secret" not in seen and "MOGO_SECRETS_JSON" not in seen and "MISSING_ONE" not in seen
    from mogo.models import Run

    with sf() as s:
        run = s.get(Run, rid)
        assert run.status == "succeeded"
        assert any("MISSING_ONE" in e.message and "not set" in e.message for e in run.events)
        assert not any("sk-test-123" in e.message for e in run.events)  # values are never logged
