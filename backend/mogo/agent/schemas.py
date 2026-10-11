from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class Criterion(BaseModel):
    text: str
    status: Literal["pass", "fail", "unverified"]
    evidence: str = ""


class Finding(BaseModel):
    path: str
    line: int = Field(ge=1)
    severity: Literal["blocker", "major", "minor", "nit"]
    message: str
    rule: str = ""


class CheckResult(BaseModel):
    """Outcome of one built-in check (mogo/checks)."""
    id: str
    status: Literal["pass", "fail", "skipped"]
    note: str = ""

    @field_validator("id")
    @classmethod
    def _bare_id(cls, v: str) -> str:
        return v.removeprefix("builtin:")


class AgentReport(BaseModel):
    summary: str
    criteria: list[Criterion] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    checks: list[CheckResult] = Field(default_factory=list)


class GateResult(BaseModel):
    cmd: str
    ok: bool
    output: str = ""
