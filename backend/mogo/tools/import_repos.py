"""Copy repo settings from a YAML file in the old repos.yaml format into a project (after `mogo.tools.migrate`).

  python -m mogo.tools.import_repos repos.yaml --owner <github login> --project "My product" [--description "..."]

The owner must have signed in to the web app once. No App installation is stored; the runner looks it up.

The old file is in git history: git show 0cd6fec:repos.yaml > /tmp/repos.yaml

Safe to re-run: the project is matched by owner and name, repos by owner/repo; their settings are overwritten.
Optional per-entry keys `role` and `default_branch` set those columns.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from mogo.config import RepoConfig, Settings
from mogo.context import legacy_env_from
from mogo.models import Project, Repo, RepoEnvVar, User, make_session_factory

_COLUMNS = ("role", "default_branch")


def import_repos(
    sf: sessionmaker, path: str | Path, project_name: str, owner_login: str, description: str = "", warn=print,
) -> list[str]:
    entries = (yaml.safe_load(Path(path).read_text()) or {}).get("repos", [])
    parsed = []
    for e in entries:
        cols = {k: e.pop(k) for k in _COLUMNS if k in e}
        if names := legacy_env_from(e):
            # Old files pointed at runner repo secrets. Those stay with the runner: re-enter the values as Secrets.
            warn(f"{e.get('name')}: env_from is not imported; add under Secrets on the repo page: {', '.join(names)}")
        e.pop("env_from", None)
        env = {str(k): str(v) for k, v in (e.pop("env", None) or {}).items()}  # plain variables
        cfg = RepoConfig(**e)  # validates before anything is written
        parsed.append((cfg, cols, env))

    with sf() as s:
        owner = s.scalars(select(User).where(func.lower(User.login) == owner_login.lower())).first()
        if owner is None:
            raise LookupError(f"no user '{owner_login}': sign in to the web app with that GitHub account first")
        project = s.scalars(select(Project).where(
            Project.owner_id == owner.id, func.lower(Project.name) == project_name.lower(),
        )).first()
        if project is None:
            project = Project(owner_id=owner.id, name=project_name, description=description)
            s.add(project)
            s.flush()
        elif description:
            project.description = description
        names = []
        for cfg, cols, env in parsed:
            repo = s.scalars(select(Repo).where(
                Repo.project_id == project.id, func.lower(Repo.full_name) == cfg.name.lower(),
            )).first()
            if repo is None:
                repo = Repo(project_id=project.id, full_name=cfg.name)
                s.add(repo)
            repo.config = cfg.model_dump(exclude={"name"})
            repo.role = cols.get("role", repo.role or "")
            repo.default_branch = cols.get("default_branch", repo.default_branch or "main")
            s.flush()
            for k, v in env.items():
                row = s.get(RepoEnvVar, (repo.id, k))
                if row is None:
                    s.add(RepoEnvVar(repo_id=repo.id, name=k, sensitive=False, value=v))
                elif not row.sensitive:  # never overwrite a secret with a plain value
                    row.value = v
            names.append(cfg.name)
        s.commit()
        return names


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mogo.tools.import_repos")
    ap.add_argument("path", help="repos.yaml")
    ap.add_argument("--owner", required=True, help="GitHub login of the user who owns the project")
    ap.add_argument("--project", required=True, help="project name (created if missing)")
    ap.add_argument("--description", default="")
    args = ap.parse_args(argv)
    sf = make_session_factory(Settings().db_url)
    try:
        names = import_repos(sf, args.path, args.project, args.owner, args.description)
    except (ValidationError, OSError, LookupError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    print(f"imported into '{args.project}': {', '.join(names) or 'nothing'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
