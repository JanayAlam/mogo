"""Docker repos: which file a run needs, whether the repo has it, and where a Compose app can be reached."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from mogo.config import RepoConfig

DEFAULT_DOCKERFILE = "Dockerfile"
DEFAULT_COMPOSE = "docker-compose.yaml"
PROJECT = "mogo-app"  # the compose project name of a run (web/src/lib/stack.ts DOCKER_NAME)
_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")  # a file at the repo root, nothing a shell would read


def docker_problem(cfg: RepoConfig, root: Path) -> str | None:
    """Why a repo set to run in Docker cannot be started (the file is missing or its name is not acceptable), or None."""
    compose = cfg.docker_mode == "compose"
    if cfg.docker_file and not _FILE_NAME.match(cfg.docker_file):
        return f"{cfg.docker_file!r} is not a file name at the repo root"
    if compose:
        name = cfg.docker_file or DEFAULT_COMPOSE
        return None if (root / name).is_file() else f"there is no {name} at its root"
    name = cfg.docker_file or DEFAULT_DOCKERFILE
    return None if (root / name).is_file() else f"there is no {name} at its root"


def docker_requirement(cfg: RepoConfig, root: Path) -> str | None:
    """Why a repo cannot be run, in words for the person who owns it, or None when Docker can start it. Mogo only runs
    a project with Docker (a Dockerfile, or Docker Compose for several services): there is no other way."""
    if not cfg.start:
        return (
            "This project needs Docker to be run: Mogo starts it from a Dockerfile, or from a Docker Compose file for "
            "several services. Open the repo's settings, choose how it runs with Docker and save."
        )
    if problem := docker_problem(cfg, root):
        return (
            f"This project needs Docker to be run, but {problem}. Add a Dockerfile or a Docker Compose file to the "
            "repo, or name the right file in the repo's settings."
        )
    return None


def compose_ready_url(cfg: RepoConfig, root: Path, env: dict[str, str], run: Callable) -> str | None:
    """Where the app of a Compose repo answers, read from the compose file itself: the first port it publishes, taking
    a service that is built from the repo (the app) before one that only runs an image (a database). The file is
    resolved by `docker compose config`, so variables and overrides count. None when it publishes nothing or cannot be
    read: the caller falls back to its usual default. `run` is sandbox.run_cmd."""
    name = cfg.docker_file or DEFAULT_COMPOSE
    if not _FILE_NAME.match(name):
        return None
    code, out = run(f"docker compose -p {PROJECT} -f {name} config --format json 2>/dev/null", root, timeout=60, env=env)
    if code:
        return None
    try:
        services = json.loads(out).get("services") or {}
    except (json.JSONDecodeError, AttributeError):
        return None
    published: list[tuple[bool, int]] = []  # (built from the repo, host port), in file order
    for svc in services.values():
        for p in (svc or {}).get("ports") or []:
            host = str(p.get("published") or "") if isinstance(p, dict) else ""
            if host.isdigit() and int(host) > 0:
                published.append(("build" in svc, int(host)))
    built = [port for is_built, port in published if is_built]
    port = built[0] if built else (published[0][1] if published else None)
    return f"http://localhost:{port}" if port else None
