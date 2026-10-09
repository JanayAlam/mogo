"""Tools the agent may call. All of them are confined to the checked-out repo."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from mogo.agent.schemas import AgentReport
from mogo.runner.sandbox import run_cmd, tail

MAX_OUT = 6000
ALLOWED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0"}

TOOL_SPECS = [
    {"type": "function", "function": {
        "name": "read_file", "description": "Read a text file from the repo (path relative to repo root).",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "start": {"type": "integer"}, "end": {"type": "integer"}},
            "required": ["path"]}}},
    {"type": "function", "function": {
        "name": "search", "description": "Regex search over repo files (like grep -rnE). Returns file:line:text.",
        "parameters": {"type": "object", "properties": {
            "pattern": {"type": "string"}, "path": {"type": "string"}}, "required": ["pattern"]}}},
    {"type": "function", "function": {
        "name": "run_shell", "description": "Run a shell command in the repo root (sandboxed, no secrets). "
        "Use for tests, curl, psql against the test DB, etc.",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string"}, "timeout_s": {"type": "integer"}}, "required": ["command"]}}},
    {"type": "function", "function": {
        "name": "http_request", "description": "HTTP request to the locally running app (localhost only).",
        "parameters": {"type": "object", "properties": {
            "method": {"type": "string"}, "url": {"type": "string"},
            "headers": {"type": "object"}, "json_body": {}}, "required": ["method", "url"]}}},
    {"type": "function", "function": {
        "name": "submit_report", "description": "Finish. Submit the final report exactly once.",
        "parameters": {"type": "object", "properties": {
            "summary": {"type": "string"},
            "criteria": {"type": "array", "items": {"type": "object", "properties": {
                "text": {"type": "string"}, "status": {"type": "string", "enum": ["pass", "fail", "unverified"]},
                "evidence": {"type": "string"}}, "required": ["text", "status"]}},
            "findings": {"type": "array", "items": {"type": "object", "properties": {
                "path": {"type": "string"}, "line": {"type": "integer"},
                "severity": {"type": "string", "enum": ["blocker", "major", "minor", "nit"]},
                "message": {"type": "string"}, "rule": {"type": "string"}},
                "required": ["path", "line", "severity", "message"]}}},
            "required": ["summary"]}}},
]


class ToolBox:
    def __init__(self, root: Path, env: dict[str, str] | None = None):
        self.root = root.resolve()
        self.env = env or {}
        self.report: AgentReport | None = None

    def _safe(self, rel: str) -> Path:
        p = (self.root / rel).resolve()
        if p != self.root and self.root not in p.parents:
            raise ValueError("path escapes the repo")
        return p

    def call(self, name: str, args: dict) -> str:
        try:
            fn = getattr(self, f"_t_{name}", None)
            if fn is None:
                return f"error: unknown tool {name}"
            return fn(**args)
        except (ValueError, TypeError, OSError, ValidationError, httpx.HTTPError) as e:
            return f"error: {e}"

    def _t_read_file(self, path: str, start: int = 1, end: int = 400) -> str:
        lines = self._safe(path).read_text(errors="replace").splitlines()
        chunk = lines[max(start, 1) - 1 : end]
        return "\n".join(f"{i}: {t}" for i, t in enumerate(chunk, start=max(start, 1)))[:MAX_OUT]

    def _t_search(self, pattern: str, path: str = ".") -> str:
        p = subprocess.run(
            ["grep", "-rnE", "--exclude-dir=node_modules", "--exclude-dir=.git", "-m", "20", pattern, str(self._safe(path))],
            capture_output=True, text=True, timeout=30, errors="replace",
        )
        return (p.stdout.replace(str(self.root) + "/", "") or "no matches")[:MAX_OUT]

    def _t_run_shell(self, command: str, timeout_s: int = 120) -> str:
        code, out = run_cmd(command, self.root, timeout=min(timeout_s, 300), env=self.env)
        return f"exit={code}\n{tail(out, MAX_OUT)}"

    def _t_http_request(self, method: str, url: str, headers: dict | None = None, json_body=None) -> str:
        if urlparse(url).hostname not in ALLOWED_HOSTS:
            raise ValueError("only localhost URLs are allowed")
        r = httpx.request(method.upper(), url, headers=headers, json=json_body, timeout=30)
        return f"status={r.status_code}\n{r.text[:MAX_OUT]}"

    def _t_submit_report(self, **kw) -> str:
        self.report = AgentReport(**kw)
        return "report accepted"


def parse_args(raw: str) -> dict:
    try:
        v = json.loads(raw or "{}")
        return v if isinstance(v, dict) else {}
    except json.JSONDecodeError:
        return {}
