"""The migration CLI: order, once only, failures roll back. (The real SQL is Postgres-only; see README for that test.)"""
import pytest
from sqlalchemy import create_engine, text

from mogo.runner.__main__ import main as runner_main
from mogo.tools.migrate import MIGRATIONS_DIR, migrate, migration_files, pending


@pytest.fixture
def engine(tmp_path):
    return create_engine(f"sqlite:///{tmp_path / 'm.db'}")


def write(d, name, sql):
    d.mkdir(exist_ok=True)
    (d / name).write_text(sql)


def test_applies_in_order_once(engine, tmp_path):
    d = tmp_path / "migrations"
    write(d, "002_rows.sql", "insert into t (v) values ('two');")
    write(d, "001_table.sql", "create table t (v text);")
    assert migrate(engine, d, log=lambda _m: None) == ["001_table.sql", "002_rows.sql"]
    assert migrate(engine, d, log=lambda _m: None) == []
    with engine.connect() as c:
        assert c.execute(text("select v from t")).scalars().all() == ["two"]


def test_a_failing_file_is_not_recorded(engine, tmp_path):
    d = tmp_path / "migrations"
    write(d, "001_table.sql", "create table t (v text);")
    write(d, "002_broken.sql", "insert into missing values (1);")
    with pytest.raises(Exception):
        migrate(engine, d, log=lambda _m: None)
    assert [f.name for f in pending(engine, d)] == ["002_broken.sql"]
    write(d, "002_broken.sql", "insert into t (v) values ('fixed');")
    assert migrate(engine, d, log=lambda _m: None) == ["002_broken.sql"]


def test_repo_migrations_are_ordered():
    assert [f.name for f in migration_files(MIGRATIONS_DIR)][:2] == ["001_initial.sql", "002_projects.sql"]


def test_runner_refuses_an_unmigrated_database(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@localhost/x")
    monkeypatch.setenv("ENVIRONMENT", "test")
    import mogo.runner.__main__ as m
    from mogo.models import make_session_factory
    monkeypatch.setattr(m, "make_session_factory", lambda _url: make_session_factory(f"sqlite:///{tmp_path / 'r.db'}"))
    assert runner_main(["--pr", "https://github.com/a/b/pull/1"]) == 2
    assert "python -m mogo.tools.migrate" in capsys.readouterr().err


def test_status_changes_nothing(engine, tmp_path):
    from sqlalchemy import inspect
    write(tmp_path / "migrations", "001_table.sql", "create table t (v text);")
    assert [f.name for f in pending(engine, tmp_path / "migrations")] == ["001_table.sql"]
    assert inspect(engine).get_table_names() == []
