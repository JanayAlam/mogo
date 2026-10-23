from __future__ import annotations

from mogo.agent.schemas import AgentReport, Finding
from mogo.github.diffmap import commentable_lines

_ICON = {"pass": "✅", "fail": "❌", "unverified": "⚠️"}
_CHECK_ICON = {"pass": "✅", "fail": "❌", "skipped": "➖"}
_SEV = {"blocker": "🛑 blocker", "major": "🔴 major", "minor": "🟡 minor", "nit": "⚪ nit"}


def split_findings(findings: list[Finding], diff: str) -> tuple[list[dict], list[Finding]]:
    """Findings on lines GitHub accepts become inline comments; the rest go in the summary."""
    valid = commentable_lines(diff)
    inline, general = [], []
    for f in findings:
        if f.line in valid.get(f.path, set()):
            rule = f" _(rule: {f.rule})_" if f.rule else ""
            inline.append({"path": f.path, "line": f.line, "side": "RIGHT",
                           "body": f"**{_SEV[f.severity]}**: {f.message}{rule}"})
        else:
            general.append(f)
    return inline, general


def verdict(report: AgentReport) -> str:
    if any(c.status == "fail" for c in report.criteria) or any(f.severity == "blocker" for f in report.findings):
        return "changes_requested"
    return "ok"


def render_summary(report: AgentReport, general: list[Finding], llm: str) -> str:
    parts = ["## mogo review", "", report.summary.strip(), ""]
    if report.criteria:
        parts += ["### Feature check", "| | Criterion | Evidence |", "|---|---|---|"]
        for c in report.criteria:
            ev = c.evidence.replace("\n", " ").replace("|", "\\|")[:300]
            parts.append(f"| {_ICON[c.status]} | {c.text.replace('|', '/')} | {ev} |")
        parts.append("")
    if report.checks:
        parts += ["### Built-in checks"]
        parts += [f"- {_CHECK_ICON[c.status]} `{c.id}`" + (f": {c.note}" if c.note else "") for c in report.checks]
        parts.append("")
    if general:
        parts += ["### Other findings"]
        parts += [f"- **{_SEV[f.severity]}** `{f.path}:{f.line}`: {f.message}" for f in general]
        parts.append("")
    parts.append(f"<sub>model: {llm}</sub>")
    return "\n".join(parts)
