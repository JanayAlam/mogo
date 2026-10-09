from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    github_token: str = ""

    llm_mode: str = "auto"  # auto | local | deepseek
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    local_llm_base_url: str = ""
    local_llm_model: str = ""

    database_url: str  # required: Supabase Postgres connection string (pooler URL)
    sentry_dsn: str = ""
    environment: str  # required: set ENVIRONMENT (e.g. dev, staging, production)
    log_level: str = "INFO"

    repos_file: str = "../repos.yaml"

    max_agent_steps: int = 25
    run_timeout_s: int = 1200

    @property
    def db_url(self) -> str:
        for prefix in ("postgres://", "postgresql://"):
            if self.database_url.startswith(prefix):
                return "postgresql+psycopg://" + self.database_url[len(prefix):]
        return self.database_url


# The runner's own credentials. `env_from` copies real values from the runner, so it may not read these.
# (Exposing another secret under one of these names, e.g. DATABASE_URL: ANTROTRIP_SERVER_DATABASE_URL, is fine.)
RESERVED_ENV = frozenset({
    "GITHUB_TOKEN", "AGENT_GITHUB_TOKEN", "DEEPSEEK_API_KEY", "DATABASE_URL", "SENTRY_DSN",
    "LOCAL_LLM_BASE_URL", "LOCAL_LLM_MODEL", "MOGO_SECRETS_JSON", "ACTIONS_RUNTIME_TOKEN",
})


class RepoConfig(BaseModel):
    name: str
    setup: list[str] = Field(default_factory=list)
    gates: list[str] = Field(default_factory=list)
    test_cmd: str = ""
    services_cmd: str = ""
    services_down: str = ""  # stops what services_cmd started; always run at the end of a run
    prepare: list[str] = Field(default_factory=list)  # after services_cmd, before start: migrate, seed
    start: str = ""
    healthcheck: str = ""
    env: dict[str, str] = Field(default_factory=dict)  # plain test values, committed
    # Sandbox name -> runner secret name, never committed. A plain list means the same name on both sides.
    env_from: dict[str, str] = Field(default_factory=dict)
    conventions: list[str] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)
    notes: str = ""  # shown to the agent verbatim: seeded accounts, how to log in, known limits
    allow_forks: bool = False

    @field_validator("env_from", mode="before")
    @classmethod
    def _list_means_same_name(cls, value):
        if isinstance(value, list):
            return {n: n for n in value}
        return value or {}

    @field_validator("env_from")
    @classmethod
    def _no_runner_credentials(cls, mapping: dict[str, str]) -> dict[str, str]:
        bad = sorted(src for src in mapping.values() if src.upper() in RESERVED_ENV)
        if bad:
            raise ValueError(
                f"env_from must not forward the runner's own credentials: {', '.join(bad)} "
                "(store the repo's value under its own secret name, e.g. DATABASE_URL: MYREPO_DATABASE_URL)"
            )
        return mapping


def load_repos(path: str | Path) -> dict[str, RepoConfig]:
    data = yaml.safe_load(Path(path).read_text()) or {}
    repos = [RepoConfig(**r) for r in data.get("repos", [])]
    return {r.name.lower(): r for r in repos}


@lru_cache
def get_settings() -> Settings:
    return Settings()
