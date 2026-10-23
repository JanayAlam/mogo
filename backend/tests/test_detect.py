"""Suggested Docker settings read from a repo's root files."""
import json

import pytest

from mogo.profile.detect import detect


def run_detect(files: dict[str, str]):
    return detect(set(files), files.get)


def test_env_names_from_the_example_file():
    s = run_detect({".env.example": "# server\nPORT=8000\nDATABASE_URL=\nexport JWT_SECRET=x\n"})
    assert s["env_names"] == ["PORT", "DATABASE_URL", "JWT_SECRET"]


def test_only_docker_and_convention_things_are_suggested():
    s = run_detect({"package.json": "{}", "pnpm-lock.yaml": "", "Dockerfile": "FROM node\n"})
    assert set(s) == {"env_names", "dockerfile", "docker_port", "dockerfiles", "compose_files", "convention_files", "markdown_files"}


def test_profile_carries_suggestions(tmp_path):
    from mogo.profile.build import DirTree, build_profile
    (tmp_path / "Dockerfile").write_text("FROM node\nEXPOSE 8080\n")
    (tmp_path / "docker-compose.yaml").write_text("services: {}\n")
    p = build_profile(DirTree(tmp_path), "sha", "main")
    assert p.suggestions["docker_port"] == 8080 and p.suggestions["compose_files"] == ["docker-compose.yaml"]


def test_import_puts_yaml_env_into_plain_variables(sf, tmp_path):
    from mogo.models import RepoEnvVar
    from mogo.tools.import_repos import import_repos
    f = tmp_path / "repos.yaml"
    f.write_text("repos:\n  - name: acme/api\n    env: {PORT: 8000, MODE: test}\n")
    from conftest import seed_user
    seed_user(sf)
    import_repos(sf, f, "Acme", "alice")
    with sf() as s:
        rows = {r.name: (r.sensitive, r.value) for r in s.query(RepoEnvVar)}
    assert rows == {"PORT": (False, "8000"), "MODE": (False, "test")}


@pytest.mark.parametrize("files,expected", [
    ({}, {"dockerfile": False, "docker_port": 0}),
    ({"Dockerfile": "FROM node:22\nCMD node x\n"}, {"dockerfile": True, "docker_port": 0}),
    ({"Dockerfile": "FROM node:22\nEXPOSE 8080\nEXPOSE 9229\n"}, {"dockerfile": True, "docker_port": 8080}),
    ({"Dockerfile": "FROM x\n  expose 4000/tcp\n"}, {"dockerfile": True, "docker_port": 4000}),
    ({"Dockerfile": "FROM x\n# EXPOSE 1234\n"}, {"dockerfile": True, "docker_port": 0}),  # a comment
])
def test_dockerfile(files, expected):
    s = run_detect(files)
    assert {k: s[k] for k in ("dockerfile", "docker_port")} == expected


@pytest.mark.parametrize("files,dockerfiles,compose", [
    ({}, [], []),
    ({"Dockerfile": "", "Dockerfile.dev": "", "api.Dockerfile": "", "notes.md": ""}, ["Dockerfile", "Dockerfile.dev", "api.Dockerfile"], []),
    ({"docker-compose.yaml": "", "compose.yml": "", "docker-compose.prod.yml": "", "package.json": "{}"}, [],
     ["compose.yml", "docker-compose.prod.yml", "docker-compose.yaml"]),
])
def test_docker_files_at_the_root(files, dockerfiles, compose):
    s = run_detect(files)
    assert (s["dockerfiles"], s["compose_files"]) == (dockerfiles, compose)
    assert s["dockerfile"] == ("Dockerfile" in files)  # only the default name counts as "has a Dockerfile"


# --- the contract with the web app's detection (web/src/lib/detect.ts)

def test_detection_matches_the_shared_cases():
    """tests/data/detect_cases.json is checked by web/tests/detect.test.ts too. After a deliberate change to the
    detection: PYTHONPATH=. python tests/regen_detect_cases.py, and make the same change in web/src/lib/detect.ts."""
    from pathlib import Path
    cases = json.loads((Path(__file__).parent / "data" / "detect_cases.json").read_text())
    assert len(cases) >= 10
    for c in cases:
        assert run_detect(c["files"]) == c["expected"], c["name"]


def test_convention_files_are_the_known_ones_in_reading_order():
    s = run_detect({"AGENTS.md": "", "README.md": "", "CLAUDE.md": "", ".cursorrules": "", "docs.md": "", "claude.md": ""})
    assert s["convention_files"] == ["CLAUDE.md", "AGENTS.md", ".cursorrules"]
    assert s["markdown_files"] == ["README.md", "claude.md", "docs.md"]  # the rest, for the dropdown


def test_no_convention_files():
    s = run_detect({"Dockerfile": ""})
    assert (s["convention_files"], s["markdown_files"]) == ([], [])
