from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]
# backend/.env, wherever the command runs from (the web app has its own web/.env.local). Real env vars override it.
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore", hide_input_in_errors=True)  # errors never echo secrets

    github_token: str = ""

    llm_mode: str = "auto"  # auto | local | deepseek
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    local_llm_base_url: str = ""
    local_llm_model: str = ""

    database_url: str  # required: Supabase Postgres connection string (pooler URL)
    sentry_dsn: str = ""
    mogo_secret_key: str = ""  # base64, 32 bytes: decrypts repo secrets entered in the web app
    environment: str  # required: set ENVIRONMENT (e.g. dev, staging, production)
    log_level: str = "INFO"

    max_agent_steps: int = 25
    run_timeout_s: int = 1200

    @field_validator("database_url")
    @classmethod
    def _usable_database_url(cls, v: str) -> str:
        # Never echo the value: it holds the password.
        v = v.strip().strip("'\"").strip()
        if not v:
            raise ValueError("DATABASE_URL is empty (on Actions: the DATABASE_URL secret is missing in the runner repo)")
        if not v.startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
            raise ValueError("DATABASE_URL must start with postgresql:// (copy the Supabase pooler connection string)")
        return _drop_prisma_options(_encode_at_in_password(v))

    @property
    def db_url(self) -> str:
        for prefix in ("postgres://", "postgresql://"):
            if self.database_url.startswith(prefix):
                return "postgresql+psycopg://" + self.database_url[len(prefix):]
        return self.database_url


def _encode_at_in_password(url: str) -> str:
    """Supabase shows the connection string with the raw password; an '@' in it would be read as the host separator.
    The last '@' before the host is the real one, so earlier ones are percent-encoded."""
    scheme, sep, rest = url.partition("://")
    authority, slash, tail = rest.partition("/")
    userinfo, at, host = authority.rpartition("@")
    if not at or "@" not in userinfo:
        return url
    return f"{scheme}{sep}{userinfo.replace('@', '%40')}@{host}{slash}{tail}"


# Prisma-only query options (connection strings are often copied from a Prisma app); libpq rejects them.
PRISMA_OPTIONS = frozenset({
    "connection_limit", "pool_timeout", "pgbouncer", "schema", "statement_cache_size", "socket_timeout",
    "sslaccept", "sslidentity", "sslpassword",
})


def _drop_prisma_options(url: str) -> str:
    base, q, query = url.partition("?")
    if not q:
        return url
    kept = [kv for kv in query.split("&") if kv and kv.split("=", 1)[0] not in PRISMA_OPTIONS]
    return base + ("?" + "&".join(kept) if kept else "")


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
    conventions: list[str] = Field(default_factory=list)
    rules: list[str] = Field(default_factory=list)
    notes: str = ""  # shown to the agent verbatim: seeded accounts, how to log in, known limits
    allow_forks: bool = False


def load_repos(path: str | Path) -> dict[str, RepoConfig]:
    """Reads the old repos.yaml format; only `python -m mogo.tools.import_repos` uses it."""
    data = yaml.safe_load(Path(path).read_text()) or {}
    repos = [RepoConfig(**r) for r in data.get("repos", [])]
    return {r.name.lower(): r for r in repos}


@lru_cache
def get_settings() -> Settings:
    return Settings()
