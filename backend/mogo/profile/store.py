"""Read and write repo profiles; rebuild only when the branch head moved."""
from __future__ import annotations

from typing import Callable

from sqlalchemy.orm import sessionmaker

from mogo.models import RepoProfile
from mogo.profile.build import Profile, Tree, build_profile, render_summary


def load_profile(sf: sessionmaker, repo_id: str, branch: str) -> Profile | None:
    with sf() as s:
        row = s.get(RepoProfile, repo_id)
        if row is None or row.structure is None:
            return None
        p = Profile(main_sha=row.main_sha, branch=branch, structure=row.structure, type_index=row.type_index or [],
                    suggestions=row.suggestions or {})
        p.summary = row.summary or render_summary(p)
        return p


def save_profile(sf: sessionmaker, repo_id: str, p: Profile) -> None:
    with sf() as s:
        row = s.get(RepoProfile, repo_id) or RepoProfile(repo_id=repo_id)
        row.main_sha, row.structure, row.type_index, row.summary, row.suggestions, row.error = (
            p.main_sha, p.structure, p.type_index, p.summary, p.suggestions, ""
        )
        s.add(row)
        s.commit()


def save_profile_error(sf: sessionmaker, repo_id: str, error: str) -> None:
    """Keeps the last good profile; the UI shows the error next to it."""
    with sf() as s:
        row = s.get(RepoProfile, repo_id) or RepoProfile(repo_id=repo_id)
        row.error = error[:2000]
        s.add(row)
        s.commit()


def ensure_profile(
    sf: sessionmaker, repo_id: str, branch: str, head_sha: str, make_tree: Callable[[], Tree], force: bool = False,
) -> tuple[Profile, bool]:
    """Returns (profile, reused). Builds from `make_tree()` when there is none for `head_sha`."""
    if not force:
        cached = load_profile(sf, repo_id, branch)
        if cached and cached.main_sha == head_sha:
            return cached, True
    profile = build_profile(make_tree(), head_sha, branch)
    save_profile(sf, repo_id, profile)
    return profile, False
