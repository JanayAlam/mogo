"""Everything a run needs to know about where it belongs: repo settings, project, feature, sibling PRs."""
from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from mogo.config import RepoConfig
from mogo.llm.provider import Connection, OwnerLLM
from mogo.models import Feature, FeatureRepo, LlmConnection, Project, Repo, RepoEnvVar, Run


class ContextError(ValueError):
    pass


@dataclass
class Sibling:
    """Another repo's part of the same feature."""
    full_name: str
    role: str
    pr_url: str
    requirements: str = ""


@dataclass
class RunContext:
    cfg: RepoConfig
    repo_id: str = ""
    installation_id: int | None = None  # the Mogo App installation on the repo
    owner: OwnerLLM | None = None  # the project owner and their LLM chain
    role: str = ""
    default_branch: str = "main"
    project_name: str = ""
    project_description: str = ""
    project_settings: dict = field(default_factory=dict)
    feature_title: str = ""
    feature: str = ""  # what to verify; empty means review only
    requirements: str = ""  # this repo's part of the feature
    siblings: list[Sibling] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)  # non-sensitive variables, plain
    secrets: dict[str, str] = field(default_factory=dict)  # sensitive: name -> ciphertext; decrypted by the pipeline
    legacy_env_from: list[str] = field(default_factory=list)  # names a repo still lists under the removed env_from


def repo_config(repo: Repo) -> RepoConfig:
    try:
        return RepoConfig(name=repo.full_name, **(repo.config or {}))
    except ValidationError as e:
        raise ContextError(f"settings of {repo.full_name} are invalid: {e}") from e


def find_repo(s: Session, full_name: str) -> Repo | None:
    """Oldest configured repo with this owner/repo (a repo may sit in several projects)."""
    return s.scalars(
        select(Repo).where(func.lower(Repo.full_name) == full_name.lower()).order_by(Repo.created_at).limit(1)
    ).first()


def load_context(sf: sessionmaker, run_id: str) -> RunContext:
    with sf() as s:
        run = s.get(Run, run_id)
        if run is None:
            raise ContextError(f"run {run_id} not found")
        fr = s.get(FeatureRepo, run.feature_repo_id) if run.feature_repo_id else None
        if fr is None:
            repo = find_repo(s, run.repo)
            if repo is None:
                raise ContextError(f"{run.repo} is not configured in any project")
            ctx = _base(s, repo, s.get(Project, repo.project_id), feature=run.feature)
            ctx.env, ctx.secrets = _env(s, repo.id)
            return ctx

        feature: Feature = fr.feature
        ctx = _base(s, fr.repo, feature.project, feature=feature.description.strip() or run.feature)
        ctx.feature_title, ctx.requirements = feature.title, fr.requirements
        if not ctx.feature and ctx.requirements:
            ctx.feature = ctx.requirements
        ctx.siblings = [
            Sibling(o.repo.full_name, o.repo.role, o.pr_url, o.requirements) for o in feature.repos if o.id != fr.id
        ]
        ctx.env, ctx.secrets = _env(s, fr.repo_id)
        return ctx


def _env(s: Session, repo_id: str) -> tuple[dict[str, str], dict[str, str]]:
    """(plain variables, sensitive name -> ciphertext)."""
    plain, secret = {}, {}
    for r in s.scalars(select(RepoEnvVar).where(RepoEnvVar.repo_id == repo_id)):
        if r.sensitive:
            secret[r.name] = r.value_enc or ""
        else:
            plain[r.name] = r.value or ""
    return plain, secret


def legacy_env_from(config: dict | None) -> list[str]:
    """Names under the removed `env_from` key (a dict of name -> secret, or a list). Ignored, reported to the user."""
    old = (config or {}).get("env_from") or {}
    return sorted(old if isinstance(old, (dict, list)) else [])


def _owner(s: Session, project: Project) -> OwnerLLM | None:
    """The project owner and the LLM connections they have switched on, in their order."""
    u = project.owner
    if u is None:
        return None
    rows = s.scalars(
        select(LlmConnection).where(LlmConnection.user_id == u.id, LlmConnection.active.is_(True))
        .order_by(LlmConnection.position, LlmConnection.created_at, LlmConnection.id)
    ).all()
    return OwnerLLM(user_id=u.id, login=u.login,
                    connections=tuple(Connection(c.base_url, c.model, c.api_key_enc) for c in rows))


def _base(s: Session, repo: Repo, project: Project, feature: str) -> RunContext:
    return RunContext(
        cfg=repo_config(repo), repo_id=repo.id, installation_id=repo.installation_id, owner=_owner(s, project),
        role=repo.role, default_branch=repo.default_branch or "main",
        project_name=project.name, project_description=project.description,
        project_settings=project.settings or {}, feature=feature, legacy_env_from=legacy_env_from(repo.config),
    )
