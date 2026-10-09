"""Checkout and process helpers. Everything the PR's code touches goes through here
with a scrubbed environment: no GitHub token, no LLM keys, no DB credentials."""
from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

_SAFE_ENV = ("PATH", "HOME", "LANG", "LC_ALL", "TMPDIR")


def scrubbed_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = {k: os.environ[k] for k in _SAFE_ENV if k in os.environ}
    env["CI"] = "1"
    env.update(extra or {})
    return env


def resolve_repo_env(env: dict[str, str], env_from: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """Plain `env` plus the `env_from` secrets ({sandbox name: secret name}). A secret is read from the process
    environment, else from the JSON blob in MOGO_SECRETS_JSON (the Actions workflow passes toJSON(secrets)).
    Secrets override `env`. Returns (env, missing secret names)."""
    try:
        blob = json.loads(os.environ.get("MOGO_SECRETS_JSON") or "{}")
    except json.JSONDecodeError:
        blob = {}
    resolved, missing = dict(env), []
    for name, secret in env_from.items():
        value = os.environ.get(secret) or blob.get(secret)
        if value:
            resolved[name] = str(value)
        else:
            missing.append(secret)
    return resolved, missing


def run_cmd(cmd: str, cwd: Path, timeout: int = 600, env: dict[str, str] | None = None) -> tuple[int, str]:
    try:
        p = subprocess.run(
            ["bash", "-lc", cmd], cwd=cwd, env=scrubbed_env(env), capture_output=True,
            text=True, timeout=timeout, errors="replace",
        )
        return p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b"") if isinstance(e.stdout, bytes) else (e.stdout or "")
        return 124, f"timed out after {timeout}s\n{out if isinstance(out, str) else out.decode(errors='replace')}"


def tail(text: str, limit: int = 4000) -> str:
    return text if len(text) <= limit else "...[truncated]...\n" + text[-limit:]


def checkout_pr(owner: str, repo: str, number: int, token: str, dest: Path) -> None:
    """Fetch pull/N/head over HTTPS. The token goes in a one-off header, never into .git/config."""
    basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
    auth = ["-c", f"http.extraheader=AUTHORIZATION: basic {basic}"]
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    url = f"https://github.com/{owner}/{repo}.git"

    def git(*args: str) -> None:
        p = subprocess.run(["git", *auth, *args], cwd=dest, capture_output=True, text=True, timeout=300)
        if p.returncode:
            raise RuntimeError(f"git {args[0]} failed: {p.stderr.replace(basic, '***')[:500]}")

    git("init", "-q")
    git("remote", "add", "origin", url)
    git("fetch", "-q", "--depth", "50", "origin", f"pull/{number}/head")
    git("checkout", "-q", "FETCH_HEAD")


class AppProcess:
    """The target app, started in its own process group so we can kill the whole tree."""

    def __init__(self, cmd: str, cwd: Path, env: dict[str, str], healthcheck: str, timeout: int = 90):
        self.proc = subprocess.Popen(
            ["bash", "-lc", cmd], cwd=cwd, env=scrubbed_env(env), start_new_session=True,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
        )
        self.healthcheck, self.timeout = healthcheck, timeout

    def wait_healthy(self) -> bool:
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            if self.proc.poll() is not None:
                return False
            try:
                if httpx.get(self.healthcheck, timeout=2).status_code < 500:
                    return True
            except httpx.HTTPError:
                pass
            time.sleep(1.5)
        return False

    def stop(self) -> str:
        try:
            os.killpg(self.proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            out, _ = self.proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(self.proc.pid, signal.SIGKILL)
            out, _ = self.proc.communicate()
        return out or ""
