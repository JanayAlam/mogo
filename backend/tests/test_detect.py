"""Suggested run settings read from a repo's root files."""
import json

import pytest

from mogo.profile.detect import detect, install_command


def run_detect(files: dict[str, str]):
    return detect(set(files), files.get)


PKG = {
    "scripts": {"dev": "nest start --watch", "lint": "eslint .", "format:check": "prettier -c .", "test": "jest",
                "build": "nest build"},
    "devDependencies": {"typescript": "5", "@nestjs/core": "10"},
}


def test_pnpm_nest_repo():
    s = run_detect({"package.json": json.dumps(PKG), "pnpm-lock.yaml": "", "tsconfig.json": "{}",
                    ".env.example": "# server\nPORT=8000\nDATABASE_URL=\nexport JWT_SECRET=x\n"})
    assert s["install"] == "corepack enable && pnpm install --frozen-lockfile"
    assert s["checks"] == ["pnpm lint", "pnpm format:check", "pnpm exec tsc --noEmit"]  # no typecheck script: tsc
    assert (s["test_cmd"], s["start"], s["app_url"]) == ("pnpm test", "pnpm dev", "http://localhost:8000")
    assert s["env_names"] == ["PORT", "DATABASE_URL", "JWT_SECRET"]


def test_npm_vite_repo_with_typecheck_script_and_default_test():
    pkg = {"scripts": {"dev": "vite", "typecheck": "tsc -b", "test": 'echo "Error: no test specified" && exit 1'},
           "devDependencies": {"vite": "5", "typescript": "5"}}
    s = run_detect({"package.json": json.dumps(pkg), "package-lock.json": "", "tsconfig.json": "{}"})
    assert s["install"] == "npm ci"
    assert s["checks"] == ["npm run typecheck"]
    assert s["test_cmd"] == "" and s["app_url"] == "http://localhost:5173"


def test_port_from_the_dev_script():
    pkg = {"scripts": {"dev": "next dev -p 4000"}, "dependencies": {"next": "16"}}
    assert run_detect({"package.json": json.dumps(pkg), "yarn.lock": ""})["app_url"] == "http://localhost:4000"


@pytest.mark.parametrize("names,cmd", [
    ({"package.json", "yarn.lock", ".yarnrc.yml"}, "corepack enable && yarn install --immutable"),
    ({"package.json", "yarn.lock"}, "yarn install --frozen-lockfile"),
    ({"package.json", "bun.lock"}, "bun install --frozen-lockfile"),
    ({"package.json"}, "npm install"),
    ({"pyproject.toml", "uv.lock"}, "uv sync"),
    ({"requirements.txt"}, "pip install -r requirements.txt"),
    ({"README.md"}, ""),
])
def test_install_command(names, cmd):
    assert install_command(names) == cmd


def test_python_repo():
    s = run_detect({"pyproject.toml": "[tool.ruff]\n[project.optional-dependencies]\ndev = ['pytest', 'mypy']\n",
                    "uv.lock": ""})
    assert s["checks"] == ["ruff check .", "mypy ."] and s["test_cmd"] == "pytest -q" and s["install"] == "uv sync"


def test_broken_package_json_is_not_fatal():
    s = run_detect({"package.json": "{not json", "pnpm-lock.yaml": ""})
    assert s["checks"] == [] and s["install"].endswith("pnpm install --frozen-lockfile")


def test_profile_carries_suggestions(tmp_path):
    from mogo.profile.build import DirTree, build_profile
    (tmp_path / "package.json").write_text(json.dumps(PKG))
    (tmp_path / "pnpm-lock.yaml").write_text("")
    (tmp_path / "src").mkdir()
    (tmp_path / "src/package.json").write_text('{"scripts": {"lint": "nested, ignored"}}')
    p = build_profile(DirTree(tmp_path), "sha", "main")
    assert p.suggestions["start"] == "pnpm dev" and "pnpm lint" in p.suggestions["checks"]


def test_runner_installs_from_the_lockfile_when_no_override(settings, sf, tmp_path):
    from mogo.config import RepoConfig
    from mogo.models import RunEvent
    from mogo.runner.pipeline import execute_run
    from conftest import FakeLLM, seed_repos, tool_call
    from test_pipeline import fake_checkout, fake_github, make_run

    def checkout(*a):
        fake_checkout(*a)
        a[-1].joinpath("requirements.txt").write_text("")  # empty: the detected install has nothing to do
    seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})
    llm = FakeLLM([[tool_call("submit_report", {"summary": "ok"})]])
    execute_run(make_run(sf), settings, sf, gh=fake_github([]),
                llm_factory=lambda _c: llm, checkout=checkout)
    with sf() as s:
        msgs = [e.message for e in s.query(RunEvent)]
    assert "install (from the lockfile): pip install -r requirements.txt" in msgs


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


# --- the stack: what kind of app the repo is

def stack(files):
    return run_detect(files)["stack"]


@pytest.mark.parametrize("files,expected", [
    ({"package.json": json.dumps({"dependencies": {"next": "15", "react": "19"}})}, "nextjs"),
    ({"package.json": json.dumps({"dependencies": {"@nestjs/core": "10", "express": "4"}})}, "nestjs"),  # on Express
    ({"package.json": json.dumps({"dependencies": {"express": "4"}}), "tsconfig.json": "{}"}, "express"),
    ({"package.json": json.dumps({"dependencies": {"next": "15", "express": "4"}})}, "nextjs"),  # custom server
    ({"package.json": json.dumps({"scripts": {"start": "node index.js"}})}, "nodejs"),  # raw Node.js
    ({"package.json": json.dumps({"devDependencies": {"typescript": "5"}})}, "nodejs"),
    ({"package.json": "{not json"}, "nodejs"),
    ({"pyproject.toml": "[project]\ndependencies = ['fastapi>=0.110', 'uvicorn']\n"}, "fastapi"),
    ({"requirements.txt": "uvicorn\nFastAPI==0.110.0\n"}, "fastapi"),
    ({"requirements.txt": "fastapi-utils==0.2\n# fastapi\n"}, "python"),  # another package, and a comment
    ({"requirements.txt": "django\n"}, "python"),  # raw Python
    ({"setup.py": ""}, "python"),
    # a Python repo with a package.json for tooling is still Python; a framework dependency beats Python files
    ({"package.json": json.dumps({"scripts": {"lint": "prettier ."}}), "pyproject.toml": "[project]\n"}, "python"),
    ({"package.json": json.dumps({"dependencies": {"next": "15"}}), "pyproject.toml": "[project]\n"}, "nextjs"),
    ({"README.md": ""}, ""),
    ({"Dockerfile": "FROM node:22\n"}, ""),  # Docker is chosen, never detected
])
def test_stack(files, expected):
    assert stack(files) == expected


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


# --- per-field suggestions and the scripts of package.json

def test_fields_and_scripts_of_a_package_json():
    pkg = {"scripts": {"dev": "tsx watch src/server.ts", "build": "tsup", "lint": "eslint src", "format:check": "prettier --check .",
                       "test": "vitest run", "typecheck": "tsc -b", "start": "node dist/server.js"}}
    s = run_detect({"package.json": json.dumps(pkg), "pnpm-lock.yaml": ""})
    assert s["fields"] == {"lint": "pnpm lint", "typecheck": "pnpm typecheck", "format": "pnpm format:check",
                           "test": "pnpm test", "build": "pnpm build", "run": "pnpm dev"}
    assert s["checks"] == ["pnpm lint", "pnpm typecheck", "pnpm format:check"]  # the old list is unchanged
    names = [x["name"] for x in s["scripts"]]
    assert names == list(pkg["scripts"])  # all of them, in package.json order
    assert s["scripts"][0] == {"name": "dev", "run": "pnpm dev", "body": "tsx watch src/server.ts"}


def test_fields_stay_empty_for_what_the_repo_does_not_have():
    s = run_detect({"package.json": json.dumps({"scripts": {"build": "tsc"}}), "package-lock.json": ""})
    assert s["fields"] == {"lint": "", "typecheck": "", "format": "", "test": "", "build": "npm run build", "run": ""}
    assert s["scripts"] == [{"name": "build", "run": "npm run build", "body": "tsc"}]


def test_a_missing_typecheck_script_falls_back_to_tsc():
    s = run_detect({"package.json": json.dumps({"devDependencies": {"typescript": "5"}}), "tsconfig.json": "{}",
                    "pnpm-lock.yaml": ""})
    assert s["fields"]["typecheck"] == "pnpm exec tsc --noEmit"


def test_scripts_are_capped_and_non_strings_ignored():
    scripts = {f"s{i}": "x" * 500 for i in range(120)} | {"weird": {"a": 1}}
    s = run_detect({"package.json": json.dumps({"scripts": scripts}), "package-lock.json": ""})
    assert len(s["scripts"]) == 80 and len(s["scripts"][0]["body"]) == 120
    assert "weird" not in [x["name"] for x in s["scripts"]]


def test_not_a_node_repo_has_no_script_suggestions():
    s = run_detect({"pyproject.toml": "[project]\n"})
    assert s["scripts"] == [] and set(s["fields"].values()) == {""}


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
    assert len(cases) > 30
    for c in cases:
        assert run_detect(c["files"]) == c["expected"], c["name"]
