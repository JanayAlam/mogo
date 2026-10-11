"""Apply db/migrations/*.sql to the database in DATABASE_URL, in file-name order, each once.

  python -m mogo.tools.migrate            apply pending migrations
  python -m mogo.tools.migrate --status   list applied and pending, change nothing

Applied files are recorded in `schema_migrations`. Each file runs in its own transaction, under an advisory lock so
two migrators cannot interleave. The files use `if not exists`, so a database created by hand before this tool
existed is brought under it without errors.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import Engine, create_engine, inspect, text

from mogo.config import Settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "db" / "migrations"
_LOCK_ID = 7_346_101  # arbitrary, constant: pg_advisory_xact_lock key for mogo migrations


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    return sorted(directory.glob("*.sql"))


def _ensure_table(engine: Engine) -> None:
    with engine.begin() as c:
        c.execute(text("create table if not exists schema_migrations ("
                       "name varchar(200) primary key, applied_at timestamp with time zone default current_timestamp)"))
        if engine.dialect.name == "postgresql":
            c.execute(text("alter table schema_migrations enable row level security"))


def applied(engine: Engine) -> set[str]:
    """Read-only: an untouched database simply has nothing applied yet."""
    if not inspect(engine).has_table("schema_migrations"):
        return set()
    with engine.connect() as c:
        return {r[0] for r in c.execute(text("select name from schema_migrations"))}


def pending(engine: Engine, directory: Path = MIGRATIONS_DIR) -> list[Path]:
    done = applied(engine)
    return [f for f in migration_files(directory) if f.name not in done]


def migrate(engine: Engine, directory: Path = MIGRATIONS_DIR, log=print) -> list[str]:
    """Applies what is pending; returns the names applied. Stops at the first failing file (it is rolled back)."""
    _ensure_table(engine)
    names = []
    for f in pending(engine, directory):
        with engine.begin() as c:
            if engine.dialect.name == "postgresql":
                c.execute(text(f"select pg_advisory_xact_lock({_LOCK_ID})"))
            # another migrator may have applied it while we waited for the lock
            if c.execute(text("select 1 from schema_migrations where name = :n"), {"n": f.name}).first():
                continue
            c.exec_driver_sql(f.read_text())
            c.execute(text("insert into schema_migrations (name) values (:n)"), {"n": f.name})
        log(f"applied {f.name}")
        names.append(f.name)
    return names


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mogo.tools.migrate")
    ap.add_argument("--status", action="store_true", help="list applied and pending migrations")
    args = ap.parse_args(argv)
    engine = create_engine(Settings().db_url)
    try:
        if args.status:
            done = applied(engine)
            for f in migration_files():
                print(f"{'applied ' if f.name in done else 'pending '} {f.name}")
            return 0
        names = migrate(engine)
        print(f"{len(names)} migration(s) applied" if names else "database is up to date")
        return 0
    except Exception as e:  # noqa: BLE001 - CLI: one line, non-zero exit
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
