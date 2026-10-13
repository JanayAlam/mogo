import json
from types import SimpleNamespace

import pytest

from mogo.config import RepoConfig, Settings
from mogo.models import LlmConnection, Project, Repo, RepoEnvVar, User, make_session_factory


FAKE_DB_URL = "postgresql://user:pw@localhost:5432/db"


@pytest.fixture
def settings():
    return Settings(_env_file=None, environment="test", database_url=FAKE_DB_URL)


@pytest.fixture(autouse=True)
def fake_app_token(monkeypatch):
    """No test talks to GitHub for an installation token; the requested (owner, repo, installation) are recorded."""
    calls = []

    def token(_settings, owner, repo, installation_id=None):
        calls.append((owner, repo, installation_id))
        return "app-token"
    monkeypatch.setattr("mogo.runner.pipeline.app_repo_token", token)
    monkeypatch.setattr("mogo.profile.job.app_repo_token", token)
    return calls


@pytest.fixture
def sf(tmp_path):
    """Tests use a throwaway sqlite file; the app itself only supports Postgres (Supabase)."""
    return make_session_factory(f"sqlite:///{tmp_path / 'test.db'}")


def seed_user(sf, login="alice", llm=True, **conn) -> str:
    """A signed-in user. With `llm` (default) they have DeepSeek switched on, no key stored; `conn` overrides its
    columns. Returns the user id."""
    with sf() as s:
        if u := s.query(User).filter_by(login=login).first():
            return u.id
        u = User(github_id=abs(hash(login)) % 10**9, login=login)
        s.add(u)
        s.flush()
        if llm:
            s.add(LlmConnection(**{"user_id": u.id, "provider": "deepseek", "name": "DeepSeek", "active": True, "position": 1,
                                   "base_url": "https://api.deepseek.com", "model": "deepseek-chat", **conn}))
        s.commit()
        return u.id


def seed_repos(sf, cfgs, project="Acme", roles=None, env=None):
    """Store repo settings the way the web app does. `env`: {owner/repo: {NAME: plain value}}.
    Returns {owner/repo: repo id}."""
    roles, env = roles or {}, env or {}
    owner_id = seed_user(sf)
    with sf() as s:
        p = Project(owner_id=owner_id, name=project, description="Acme shop")
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
