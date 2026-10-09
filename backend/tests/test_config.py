import pytest
from pydantic import ValidationError

from mogo.config import Settings


def test_environment_comes_from_env(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "staging")
    assert Settings(_env_file=None, database_url="postgresql://x/y").environment == "staging"


def test_environment_is_required(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    with pytest.raises(ValidationError, match="environment"):
        Settings(_env_file=None, database_url="postgresql://x/y")


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="database_url"):
        Settings(_env_file=None, environment="test")


@pytest.mark.parametrize("url", ["postgres://u:p@h:6543/db", "postgresql://u:p@h:6543/db"])
def test_database_url_uses_psycopg_driver(url):
    s = Settings(_env_file=None, environment="test", database_url=url)
    assert s.db_url == "postgresql+psycopg://u:p@h:6543/db"
