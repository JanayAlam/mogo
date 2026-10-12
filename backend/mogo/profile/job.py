"""Rebuild one repo's profile outside a review (the "Re-learn" button, or the CLI)."""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from sqlalchemy.orm import sessionmaker

from mogo.config import Settings
from mogo.github.app import repo_token as app_repo_token
from mogo.github.client import GitHubClient
from mogo.models import Repo
from mogo.profile.build import GitTree, Profile
from mogo.profile.store import ensure_profile, save_profile_error
from mogo.runner import sandbox


def rebuild_profile(
    sf: sessionmaker, settings: Settings, repo_id: str, gh: GitHubClient | None = None,
    clone=sandbox.checkout_branch, token_for=None,
) -> Profile:
    with sf() as s:
        repo = s.get(Repo, repo_id)
        if repo is None:
            raise ValueError(f"repo {repo_id} not found")
        full_name, branch, installation_id = repo.full_name, repo.default_branch or "main", repo.installation_id
    owner, name = full_name.split("/", 1)
    workdir = Path(tempfile.mkdtemp(prefix="mogo-profile-"))
    try:
        token = (token_for or app_repo_token)(settings, owner, name, installation_id)
        gh = gh or GitHubClient(token)
        head = gh.branch_sha(owner, name, branch)
        root = workdir / "repo"
        clone(owner, name, branch, token, root)
        profile, _ = ensure_profile(sf, repo_id, branch, head, lambda: GitTree(root, sandbox.BASE_REF), force=True)
        return profile
    except Exception as e:
        save_profile_error(sf, repo_id, f"re-learning {branch} failed: {e}")
        raise
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
