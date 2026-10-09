from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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


class AgentReport(BaseModel):
    summary: str
    criteria: list[Criterion] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)


class GateResult(BaseModel):
    cmd: str
    ok: bool
    output: str = ""
