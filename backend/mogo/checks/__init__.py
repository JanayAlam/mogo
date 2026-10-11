"""Built-in checks: part of every review, on top of the repo's own rules.

Each check finds candidates without the LLM (cheap, deterministic). The agent confirms or dismisses them, reports
confirmed ones as findings with rule `builtin:<id>`, and gives every check a pass/fail line.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from mogo.profile.build import Profile


@dataclass
class Candidate:
    path: str
    line: int
    message: str


@dataclass
class CheckContext:
    root: Path  # PR checkout
    diff: str
    profile: Profile


@dataclass
class Check:
    id: str
    title: str
    instructions: str  # what the agent should judge, shown above the candidates
    find: Callable[[CheckContext], list[Candidate]]


@dataclass
class CheckOutcome:
    check: Check
    candidates: list[Candidate] = field(default_factory=list)
    error: str = ""


def registry() -> list[Check]:
    from mogo.checks.duplicate_types import CHECK as DUPLICATE_TYPES
    from mogo.checks.structure import CHECK as STRUCTURE
    return [DUPLICATE_TYPES, STRUCTURE]


def enabled_checks(project_settings: dict) -> list[Check]:
    """All checks unless the project turned one off: settings = {"checks": {"<id>": false}}."""
    switches = (project_settings or {}).get("checks") or {}
    return [c for c in registry() if switches.get(c.id, True) is not False]


MAX_CANDIDATES = 20


def run_checks(checks: list[Check], ctx: CheckContext) -> list[CheckOutcome]:
    outcomes = []
    for c in checks:
        try:
            outcomes.append(CheckOutcome(c, c.find(ctx)[:MAX_CANDIDATES]))
        except Exception as e:  # noqa: BLE001 - a broken heuristic must not fail the review
            outcomes.append(CheckOutcome(c, error=f"{type(e).__name__}: {e}"))
    return outcomes


def render_section(outcomes: list[CheckOutcome], profile: Profile | None) -> str:
    if not outcomes:
        return ""
    parts = ["## Built-in checks"]
    if profile:
        parts.append(f"The `{profile.branch}` branch is the source of truth for conventions.\n\n"
                     f"### Conventions learned from `{profile.branch}`\n{profile.summary}")
    for o in outcomes:
        parts.append(f"### builtin:{o.check.id}: {o.check.title}\n{o.check.instructions}")
        if o.error:
            parts.append(f"(static analysis unavailable: {o.error}; judge from the diff and the repo files)")
        elif o.candidates:
            parts.append("Candidates from static analysis (may be false positives):\n"
                         + "\n".join(f"- {c.path}:{c.line}: {c.message}" for c in o.candidates))
        else:
            parts.append("Static analysis found no candidates. Still flag clear cases you notice in the diff.")
    return "\n\n".join(parts)
