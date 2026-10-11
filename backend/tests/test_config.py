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


def test_database_url_is_trimmed_of_whitespace_and_quotes():
    s = Settings(_env_file=None, environment="test", database_url=' "postgresql://u:p@h:6543/db"\n')
    assert s.db_url == "postgresql+psycopg://u:p@h:6543/db"


@pytest.mark.parametrize("url,msg", [("", "is empty"), ("  ", "is empty"), ("db.example.com:5432", "must start with")])
def test_unusable_database_url_fails_clearly_without_echoing_it(url, msg):
    with pytest.raises(ValidationError, match=msg) as e:
        Settings(_env_file=None, environment="test", database_url=url)
    assert url.strip() == "" or url not in str(e.value)


def test_env_file_is_backend_dot_env_from_any_folder(tmp_path, monkeypatch):
    from mogo.config import BACKEND_DIR, ENV_FILE, Settings
    assert ENV_FILE == BACKEND_DIR / ".env" and (BACKEND_DIR / ".env.example").is_file()
    monkeypatch.chdir(tmp_path)  # a .env in the current folder is not what counts
    assert Settings.model_config["env_file"] == ENV_FILE


def test_an_unencoded_at_in_the_password_is_encoded():
    from sqlalchemy.engine import make_url
    from mogo.config import Settings
    s = Settings(_env_file=None, environment="t",
                 database_url="postgresql://postgres.abc:p@ss@w0rd@aws-0.pooler.supabase.com:5432/postgres?sslmode=require")
    url = make_url(s.db_url)
    assert (url.host, url.port, url.password, url.database) == ("aws-0.pooler.supabase.com", 5432, "p@ss@w0rd", "postgres")
    ok = "postgresql://u:already%40encoded@h:5432/db"
    assert Settings(_env_file=None, environment="t", database_url=ok).database_url == ok


def test_prisma_only_options_are_dropped():
    from mogo.config import Settings
    url = "postgresql://u:p@h:6543/db?pgbouncer=true&connection_limit=1&sslmode=require"
    assert Settings(_env_file=None, environment="t", database_url=url).database_url == "postgresql://u:p@h:6543/db?sslmode=require"
    assert Settings(_env_file=None, environment="t", database_url="postgresql://u:p@h/db?connection_limit=5").database_url == "postgresql://u:p@h/db"
