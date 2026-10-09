"""Two ways in:

  python -m mogo.runner <run_id>            run a row the web app created (GitHub Actions uses this)
  python -m mogo.runner --pr URL [options]  create a run and execute it here (local LLM, debugging)
"""
from __future__ import annotations

import argparse
import sys

from mogo.config import Settings, load_repos
from mogo.logging_setup import setup_logging
from mogo.models import Run, make_session_factory
from mogo.runner.pipeline import execute_run
from mogo.runs import create_run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mogo.runner")
    ap.add_argument("run_id", nargs="?", help="existing run id")
    ap.add_argument("--pr", help="PR url (creates a new run)")
    ap.add_argument("--feature", default="", help="expected feature description")
    ap.add_argument("--llm", default="auto", choices=["auto", "local", "deepseek"])
    ap.add_argument("--dry-run", action="store_true", help="do not post the review")
    args = ap.parse_args(argv)
    if bool(args.run_id) == bool(args.pr):
        ap.error("give either a run_id or --pr")

    s = Settings()
    setup_logging(s.log_level, s.sentry_dsn, s.environment)
    repos, sf = load_repos(s.repos_file), make_session_factory(s.db_url)
    try:
        run_id = args.run_id or create_run(sf, repos, args.pr, args.feature, args.llm, args.dry_run)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    execute_run(run_id, s, repos, sf)
    with sf() as session:
        run = session.get(Run, run_id)
        print(f"{run.status} {run.verdict} {run.review_url} {run.error}".strip())
        return 0 if run.status == "succeeded" else 1


if __name__ == "__main__":
    sys.exit(main())
