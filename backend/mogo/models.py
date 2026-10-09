from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    repo: Mapped[str] = mapped_column(String(200))
    pr_url: Mapped[str] = mapped_column(String(500))
    pr_number: Mapped[int] = mapped_column(Integer)
    feature: Mapped[str] = mapped_column(Text, default="")
    llm_mode: Mapped[str] = mapped_column(String(20), default="auto")
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
    Base.metadata.create_all(engine)  # no-op once db/schema.sql has been applied
    return sessionmaker(engine, expire_on_commit=False)
