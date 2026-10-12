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
