"""Read a repo's own files and suggest its Docker run settings: the Dockerfile (and the port it EXPOSEs), the Compose
files and the names in .env.example.

Only the repo root is read. A repo is run with Docker (a Dockerfile, or Docker Compose for several services), so
nothing else about its language or tooling is looked at. The UI shows the result for the user to accept.
"""
from __future__ import annotations

import re
from typing import Callable

ENV_EXAMPLES = (".env.example", ".env.sample", ".env.template", ".env.dist")

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


def env_names(text: str) -> list[str]:
    names = []
    for line in text.splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
        if m and m.group(1) not in names:
            names.append(m.group(1))
    return names


def detect(names: set[str], read: Callable[[str], str | None]) -> dict:
    """Suggested settings. `names` are the file names at the repo root, `read(name)` returns a root file's text."""
    env_file = next((n for n in ENV_EXAMPLES if n in names), None)
    env_text = (read(env_file) or "") if env_file else ""
    return {"env_names": env_names(env_text), **detect_docker(names, read)}
