"""Two ways in:

  python -m mogo.runner <run_id>            run a row the web app created (GitHub Actions uses this)
  python -m mogo.runner --pr URL [options]  create a run and execute it here (local LLM, debugging)
  python -m mogo.runner --profile REPO_ID   re-learn a repo's conventions from its source of truth branch
"""
from __future__ import annotations

import argparse
import sys

from mogo.config import Settings
from mogo.logging_setup import setup_logging
from mogo.models import Run, make_session_factory
from mogo.profile.job import rebuild_profile
from mogo.tools.migrate import pending
from mogo.runner.pipeline import execute_run
from mogo.runs import create_run


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mogo.runner")
    ap.add_argument("run_id", nargs="?", help="existing run id")
    ap.add_argument("--pr", help="PR url (creates a new run)")
    ap.add_argument("--feature", default="", help="expected feature description")
    ap.add_argument("--llm", default="auto", choices=["auto", "local", "deepseek"])
    ap.add_argument("--dry-run", action="store_true", help="do not post the review")
    ap.add_argument("--profile", metavar="REPO_ID", help="re-learn a repo's conventions and exit")
    args = ap.parse_args(argv)
    if sum(map(bool, (args.run_id, args.pr, args.profile))) != 1:
        ap.error("give exactly one of: run_id, --pr, --profile")

    s = Settings()
    setup_logging(s.log_level, s.sentry_dsn, s.environment)
    sf = make_session_factory(s.db_url)
    behind = pending(sf.kw["bind"])
    if behind:
        print(f"error: database is missing migrations {', '.join(f.name for f in behind)}; "
              "run `python -m mogo.tools.migrate` with this DATABASE_URL", file=sys.stderr)
        return 2
    if args.profile:
        try:
            p = rebuild_profile(sf, s, args.profile)
        except Exception as e:  # noqa: BLE001 - reported in the profile row and the exit code
            print(f"error: {e}", file=sys.stderr)
            return 1
        print(f"learned {p.branch} @ {p.main_sha[:7]}: {p.structure.get('files', 0)} files, {len(p.type_index)} types")
        return 0
    try:
        run_id = args.run_id or create_run(sf, args.pr, args.feature, args.llm, args.dry_run)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    execute_run(run_id, s, sf)
    with sf() as session:
        run = session.get(Run, run_id)
        print(f"{run.status} {run.verdict} {run.review_url} {run.error}".strip())
        return 0 if run.status == "succeeded" else 1


if __name__ == "__main__":
    sys.exit(main())
