"""Read a repo's own files and suggest its run settings: install, checks, test, start, app URL, env names.

Only the repo root is read (package.json, lockfiles, tsconfig.json, pyproject.toml, .env.example). The UI shows the
result for the user to accept; the runner also uses `install_command` when a repo sets no install override.
"""
from __future__ import annotations

import json
import re
from typing import Callable

ENV_EXAMPLES = (".env.example", ".env.sample", ".env.template", ".env.dist")
NPM_DEFAULT_TEST = "no test specified"

# First script found in each group becomes a check.
CHECK_GROUPS = (
    ("lint", "lint:check", "eslint"),
    ("typecheck", "type-check", "check-types", "types:check", "tsc"),
    ("format:check", "prettier:check", "fmt:check", "format-check"),
)
START_SCRIPTS = ("dev", "start:dev", "develop", "serve", "start")
FRAMEWORK_PORTS = (  # dependency -> default dev port
    ("next", 3000), ("nuxt", 3000), ("@remix-run/dev", 3000), ("@nestjs/core", 3000), ("astro", 4321),
    ("vite", 5173), ("express", 3000), ("fastify", 3000),
)


def package_manager(names: set[str]) -> str | None:
    for lock, pm in (("pnpm-lock.yaml", "pnpm"), ("bun.lock", "bun"), ("bun.lockb", "bun"), ("yarn.lock", "yarn"),
                     ("package-lock.json", "npm")):
        if lock in names:
            return pm
    return "npm" if "package.json" in names else None


def install_command(names: set[str]) -> str:
    """The install command for a repo root with these file names ('' when nothing is recognised)."""
    pm = package_manager(names)
    if pm == "pnpm":
        return "corepack enable && pnpm install --frozen-lockfile"
    if pm == "yarn":
        if ".yarnrc.yml" in names:  # Yarn 2+
            return "corepack enable && yarn install --immutable"
        return "yarn install --frozen-lockfile"
    if pm == "bun":
        return "bun install --frozen-lockfile"
    if pm == "npm":
        return "npm ci" if "package-lock.json" in names else "npm install"
    if "uv.lock" in names:
        return "uv sync"
    if "poetry.lock" in names:
        return "poetry install"
    if "requirements.txt" in names:
        return "pip install -r requirements.txt"
    return ""


def _run(pm: str, script: str) -> str:
    return {"pnpm": f"pnpm {script}", "yarn": f"yarn {script}", "bun": f"bun run {script}"}.get(pm, f"npm run {script}")


def _exec(pm: str, cmd: str) -> str:
    return {"pnpm": f"pnpm exec {cmd}", "yarn": f"yarn {cmd}", "bun": f"bunx {cmd}"}.get(pm, f"npx {cmd}")


def env_names(text: str) -> list[str]:
    names = []
    for line in text.splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m and m.group(1) not in names:
            names.append(m.group(1))
    return names


def _port(env_text: str, scripts: dict, deps: dict) -> int:
    m = re.search(r"^\s*PORT\s*=\s*[\"']?(\d{2,5})", env_text, re.M)
    if m:
        return int(m.group(1))
    for name in START_SCRIPTS:
        m = re.search(r"(?:--port[= ]|-p\s*)(\d{2,5})", scripts.get(name, ""))
        if m:
            return int(m.group(1))
    for dep, port in FRAMEWORK_PORTS:
        if dep in deps:
            return port
    return 3000


def detect(names: set[str], read: Callable[[str], str | None]) -> dict:
    """Suggested settings. `names` are the file names at the repo root, `read(name)` returns a root file's text."""
    out: dict = {"install": install_command(names), "checks": [], "test_cmd": "", "start": "", "app_url": "",
                 "env_names": []}
    env_file = next((n for n in ENV_EXAMPLES if n in names), None)
    env_text = (read(env_file) or "") if env_file else ""
    out["env_names"] = env_names(env_text)

    pm = package_manager(names)
    if pm:
        out["package_manager"] = pm
        try:
            pkg = json.loads(read("package.json") or "{}")
        except json.JSONDecodeError:
            pkg = {}
        scripts = pkg.get("scripts") or {}
        deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
        for group in CHECK_GROUPS:
            if found := next((s for s in group if s in scripts), None):
                out["checks"].append(_run(pm, found))
        has_types_check = any(s in scripts for s in CHECK_GROUPS[1])
        if not has_types_check and "tsconfig.json" in names and "typescript" in deps:
            out["checks"].append(_exec(pm, "tsc --noEmit"))
        test = scripts.get("test", "")
        if test and NPM_DEFAULT_TEST not in test:
            out["test_cmd"] = _run(pm, "test")
        if start := next((s for s in START_SCRIPTS if s in scripts), None):
            out["start"] = _run(pm, start)
            out["app_url"] = f"http://localhost:{_port(env_text, scripts, deps)}"
    elif "pyproject.toml" in names:
        out["package_manager"] = "python"
        py = read("pyproject.toml") or ""
        if "ruff" in py:
            out["checks"].append("ruff check .")
        if "mypy" in py:
            out["checks"].append("mypy .")
        if "pytest" in py:
            out["test_cmd"] = "pytest -q"
    return out
