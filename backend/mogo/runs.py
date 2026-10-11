from __future__ import annotations

from sqlalchemy.orm import sessionmaker

from mogo.context import find_repo
from mogo.github.client import parse_pr_url
from mogo.models import Run


def create_run(
    sf: sessionmaker, pr_url: str, feature: str = "", llm_mode: str = "auto", dry_run: bool = False,
) -> str:
    """Insert a queued run without a feature (CLI). Raises ValueError on bad input."""
    owner, repo, number = parse_pr_url(pr_url)
    if llm_mode not in ("auto", "local", "deepseek"):
        raise ValueError(f"unknown llm mode '{llm_mode}'")
    with sf() as s:
        if find_repo(s, f"{owner}/{repo}") is None:
            raise ValueError(f"{owner}/{repo} is not configured in any project")
        run = Run(repo=f"{owner}/{repo}", pr_url=pr_url, pr_number=number, feature=feature,
                  llm_mode=llm_mode, dry_run=dry_run)
        s.add(run)
        s.commit()
        return run.id
