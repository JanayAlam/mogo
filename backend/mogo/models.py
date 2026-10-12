from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    """Signed in with GitHub (web app). The LLM key: AES-256-GCM, additional data "user:<id>:llm_api_key"."""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    github_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    login: Mapped[str] = mapped_column(String(100))
    llm_base_url: Mapped[str] = mapped_column(String(500), default="")
    llm_model: Mapped[str] = mapped_column(String(200), default="")
    llm_api_key_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # e.g. {"checks": {"no-duplicate-types": false}}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    owner: Mapped[User] = relationship()
    repos: Mapped[list["Repo"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    features: Mapped[list["Feature"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class Repo(Base):
    __tablename__ = "repos"
    __table_args__ = (UniqueConstraint("project_id", "full_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    full_name: Mapped[str] = mapped_column(String(200))  # owner/repo, as in PR urls
    role: Mapped[str] = mapped_column(String(100), default="")  # free text: backend, frontend, admin-frontend, ...
    default_branch: Mapped[str] = mapped_column(String(200), default="main")
    # Mogo App installation covering this repo; null when uninstalled (the runner then looks it up once more).
    installation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # RepoConfig fields except `name`
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="repos")


class RepoProfile(Base):
    """What the default branch looks like, cached per commit. Rebuilt when the branch head moves."""
    __tablename__ = "repo_profiles"

    repo_id: Mapped[str] = mapped_column(ForeignKey("repos.id", ondelete="CASCADE"), primary_key=True)
    main_sha: Mapped[str] = mapped_column(String(64), default="")
    structure: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    type_index: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    suggestions: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # settings read from the branch
    error: Mapped[str] = mapped_column(Text, default="")  # last failed rebuild; the profile above is still the last good one
    built_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class RepoEnvVar(Base):
    """One environment variable of a repo. Sensitive ones are encrypted (mogo/secrets.py), the rest plain text."""
    __tablename__ = "repo_env"

    repo_id: Mapped[str] = mapped_column(ForeignKey("repos.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), primary_key=True)
    sensitive: Mapped[bool] = mapped_column(Boolean, default=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)  # when not sensitive
    value_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # when sensitive
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Feature(Base):
    __tablename__ = "features"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped[Project] = relationship(back_populates="features")
    repos: Mapped[list["FeatureRepo"]] = relationship(back_populates="feature", cascade="all, delete-orphan")


class FeatureRepo(Base):
    """One repo's part of a feature: its PR and what to check there in particular."""
    __tablename__ = "feature_repos"
    __table_args__ = (UniqueConstraint("feature_id", "repo_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    feature_id: Mapped[str] = mapped_column(ForeignKey("features.id", ondelete="CASCADE"), index=True)
    repo_id: Mapped[str] = mapped_column(ForeignKey("repos.id", ondelete="CASCADE"), index=True)
    pr_url: Mapped[str] = mapped_column(String(500))
    pr_number: Mapped[int] = mapped_column(Integer)
    requirements: Mapped[str] = mapped_column(Text, default="")

    feature: Mapped[Feature] = relationship(back_populates="repos")
    repo: Mapped[Repo] = relationship()


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Null for runs created before projects existed, or from the CLI without a feature.
    feature_repo_id: Mapped[str | None] = mapped_column(
        ForeignKey("feature_repos.id", ondelete="CASCADE"), index=True, nullable=True
    )
    repo: Mapped[str] = mapped_column(String(200))
    pr_url: Mapped[str] = mapped_column(String(500))
    pr_number: Mapped[int] = mapped_column(Integer)
    feature: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued|running|succeeded|failed
    llm_used: Mapped[str] = mapped_column(String(100), default="")
    verdict: Mapped[str] = mapped_column(String(30), default="")
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    review_url: Mapped[str] = mapped_column(String(500), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    events: Mapped[list["RunEvent"]] = relationship(
        back_populates="run", order_by="RunEvent.id", cascade="all, delete-orphan"
    )


class RunEvent(Base):
    __tablename__ = "run_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    level: Mapped[str] = mapped_column(String(10), default="info")
    message: Mapped[str] = mapped_column(Text)

    run: Mapped[Run] = relationship(back_populates="events")


def make_session_factory(db_url: str) -> sessionmaker:
    engine = create_engine(db_url, pool_pre_ping=True)
    if engine.dialect.name == "sqlite":
        Base.metadata.create_all(engine)  # tests only; Postgres is set up by `python -m mogo.tools.migrate` (adds RLS)
    return sessionmaker(engine, expire_on_commit=False)
