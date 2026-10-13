"""Read a repo's own files and suggest its run settings: install, checks, test, start, app URL, env names, its
stack (what kind of app it is) and whether it has a Dockerfile.

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


def _deps(pkg: dict) -> dict:
    return {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}


def _package_json(read: Callable[[str], str | None]) -> dict:
    try:
        pkg = json.loads(read("package.json") or "{}")
    except json.JSONDecodeError:
        return {}
    return pkg if isinstance(pkg, dict) else {}


def _mentions(text: str, name: str) -> bool:
    """A Python dependency named `name` in requirements or pyproject text (not `fastapi-utils`, not a comment)."""
    return bool(re.search(rf"(?im)^[^#\n]*(?<![\w-]){re.escape(name)}(?![\w-])", text))


def detect_stack(names: set[str], read: Callable[[str], str | None]) -> str:
    """What the repo is, as an id of web/src/lib/stack.ts ('' when not recognised). A framework dependency decides
    first (Next.js, then NestJS, which sits on Express, then Express); Python project files come before a bare
    package.json, which a Python repo may have for its tooling. Docker is never detected: it is chosen."""
    deps = _deps(_package_json(read)) if "package.json" in names else {}
    for dep, stack in (("next", "nextjs"), ("@nestjs/core", "nestjs"), ("express", "express")):
        if dep in deps:
            return stack
    if names & {"pyproject.toml", "requirements.txt", "setup.py", "Pipfile"}:
        text = "\n".join(read(n) or "" for n in ("pyproject.toml", "requirements.txt"))
        return "fastapi" if _mentions(text, "fastapi") else "python"
    return "nodejs" if "package.json" in names else ""


COMPOSE_NAMES = ("compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml")


def detect_docker(names: set[str], read: Callable[[str], str | None]) -> dict:
    """The root Docker files: the default `Dockerfile` (and the first port it EXPOSEs, 0 when none), every
    Dockerfile-like name and every Compose file, for the repo page to offer."""
    out: dict = {
        "dockerfile": "Dockerfile" in names, "docker_port": 0,
        "dockerfiles": sorted(n for n in names if n == "Dockerfile" or n.startswith("Dockerfile.") or n.endswith(".Dockerfile")),
        "compose_files": sorted(n for n in names if n in COMPOSE_NAMES or re.fullmatch(r"(docker-)?compose[.-].+\.ya?ml", n)),
    }
    if out["dockerfile"]:
        m = re.search(r"(?im)^\s*EXPOSE\s+(\d{1,5})", read("Dockerfile") or "")
        out["docker_port"] = int(m.group(1)) if m else 0
    return out


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
                 "env_names": [], "stack": detect_stack(names, read), **detect_docker(names, read),
                 # the same commands per form field (empty when the repo has no such script), and every script
                 "fields": {"lint": "", "typecheck": "", "format": "", "test": "", "build": "", "run": ""},
                 "scripts": []}
    env_file = next((n for n in ENV_EXAMPLES if n in names), None)
    env_text = (read(env_file) or "") if env_file else ""
    out["env_names"] = env_names(env_text)

    pm = package_manager(names)
    if pm:
        out["package_manager"] = pm
        pkg = _package_json(read)
        scripts = pkg.get("scripts") or {}
        deps = _deps(pkg)
        fields = out["fields"]
        for field, group in zip(("lint", "typecheck", "format"), CHECK_GROUPS):
            if found := next((s for s in group if s in scripts), None):
                fields[field] = _run(pm, found)
                out["checks"].append(fields[field])
        has_types_check = any(s in scripts for s in CHECK_GROUPS[1])
        if not has_types_check and "tsconfig.json" in names and "typescript" in deps:
            fields["typecheck"] = _exec(pm, "tsc --noEmit")
            out["checks"].append(fields["typecheck"])
        test = scripts.get("test", "")
        if test and NPM_DEFAULT_TEST not in test:
            fields["test"] = out["test_cmd"] = _run(pm, "test")
        if "build" in scripts:
            fields["build"] = _run(pm, "build")
        if start := next((s for s in START_SCRIPTS if s in scripts), None):
            fields["run"] = out["start"] = _run(pm, start)
            out["app_url"] = f"http://localhost:{_port(env_text, scripts, deps)}"
        out["scripts"] = [
            {"name": n, "run": _run(pm, n), "body": body[:120]}
            for n, body in scripts.items() if isinstance(n, str) and isinstance(body, str)
        ][:80]
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
