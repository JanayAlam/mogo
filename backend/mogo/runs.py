from __future__ import annotations

from sqlalchemy.orm import sessionmaker

from mogo.context import find_repo
from mogo.github.client import parse_pr_url
from mogo.models import Run


def create_run(
    sf: sessionmaker, pr_url: str, feature: str = "", dry_run: bool = False,
) -> str:
    """Insert a queued run without a feature (CLI); it uses the LLM of the project owner. Raises ValueError on bad input."""
    owner, repo, number = parse_pr_url(pr_url)
    with sf() as s:
        if find_repo(s, f"{owner}/{repo}") is None:
            raise ValueError(f"{owner}/{repo} is not configured in any project")
        run = Run(repo=f"{owner}/{repo}", pr_url=pr_url, pr_number=number, feature=feature,
                  dry_run=dry_run)
        s.add(run)
        s.commit()
        return run.id
