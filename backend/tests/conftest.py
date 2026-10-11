import json
from types import SimpleNamespace

import pytest

from mogo.config import RepoConfig, Settings
from mogo.models import Project, Repo, RepoEnvVar, make_session_factory


FAKE_DB_URL = "postgresql://user:pw@localhost:5432/db"


@pytest.fixture
def settings():
    return Settings(
        _env_file=None, environment="test", github_token="gh-test", deepseek_api_key="ds-key",
        local_llm_base_url="http://localhost:11434/v1", local_llm_model="qwen",
        database_url=FAKE_DB_URL,
    )


@pytest.fixture
def sf(tmp_path):
    """Tests use a throwaway sqlite file; the app itself only supports Postgres (Supabase)."""
    return make_session_factory(f"sqlite:///{tmp_path / 'test.db'}")


def seed_repos(sf, cfgs, project="Acme", roles=None, env=None):
    """Store repo settings the way the web app does. `env`: {owner/repo: {NAME: plain value}}.
    Returns {owner/repo: repo id}."""
    roles, env = roles or {}, env or {}
    with sf() as s:
        p = Project(name=project, description="Acme shop")
        s.add(p)
        s.flush()
        rows = [Repo(project_id=p.id, full_name=c.name, role=roles.get(c.name, ""), config=c.model_dump(exclude={"name"}))
                for c in cfgs.values()]
        s.add_all(rows)
        s.flush()
        for r in rows:
            for k, v in env.get(r.full_name, {}).items():
                s.add(RepoEnvVar(repo_id=r.id, name=k, sensitive=False, value=v))
        s.commit()
        return {r.full_name: r.id for r in rows}


@pytest.fixture
def repos(sf):
    cfgs = {"acme/api": RepoConfig(name="acme/api", conventions=["CONVENTIONS.md"], rules=["no raw SQL"])}
    seed_repos(sf, cfgs, roles={"acme/api": "backend"})
    return cfgs


def tool_call(name, args, id_="c1"):
    return SimpleNamespace(id=id_, function=SimpleNamespace(name=name, arguments=json.dumps(args)))


class FakeLLM:
    """Scripted OpenAI-style client: each entry is a list of tool calls, [] for an empty reply, or a str for a
    plain-text reply (no tool_calls)."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0
        self.first_user_prompt = ""
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls += 1
        if not self.first_user_prompt:
            self.first_user_prompt = kw["messages"][1]["content"]
        self.messages = kw["messages"]  # everything sent so far, tool results included
        calls = self.script.pop(0) if self.script else []
        if isinstance(calls, str):
            msg = SimpleNamespace(content=calls, tool_calls=None)
        else:
            msg = SimpleNamespace(content="", tool_calls=calls or None)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])
