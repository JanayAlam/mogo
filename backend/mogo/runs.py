from __future__ import annotations

from sqlalchemy.orm import sessionmaker

from mogo.config import RepoConfig
from mogo.github.client import parse_pr_url
from mogo.models import Run


def create_run(
    sf: sessionmaker, repos: dict[str, RepoConfig], pr_url: str,
    feature: str = "", llm_mode: str = "auto", dry_run: bool = False,
) -> str:
    """Insert a queued run (what the web app does for Actions runs). Raises ValueError on bad input."""
    owner, repo, number = parse_pr_url(pr_url)
    if f"{owner}/{repo}".lower() not in repos:
        raise ValueError(f"{owner}/{repo} is not configured in repos.yaml")
    if llm_mode not in ("auto", "local", "deepseek"):
        raise ValueError(f"unknown llm mode '{llm_mode}'")
    with sf() as s:
        run = Run(repo=f"{owner}/{repo}", pr_url=pr_url, pr_number=number, feature=feature,
                  llm_mode=llm_mode, dry_run=dry_run)
        s.add(run)
        s.commit()
        return run.id
