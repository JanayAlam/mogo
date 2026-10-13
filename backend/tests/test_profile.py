"""Learning a branch: names, types, structure, summary, git object reading, caching per commit."""
import subprocess

import pytest

from mogo.models import Project, Repo
from mogo.profile.build import DirTree, GitTree, build_profile
from mogo.profile.naming import fits, is_test, role_suffix, style
from mogo.profile.store import ensure_profile, load_profile
from mogo.profile.structure import analyze
from mogo.profile.types import extract_types

TS = """import { z } from 'zod'

export interface TripShare {
  id: string
  url: string
  expiresAt?: Date
  nested: { a: string }
}

export type Status = 'a' | 'b'

export type Point = {
  lat: number
  lng: number
}

export enum Role {
  Admin = 'admin',
  User,
}

export class CreateTripDto {
  @IsString()
  readonly title!: string
  private days: number
  constructor() {}
}

export const userSchema = z.object({
  email: z.string(),
  name: z.string(),
})
"""

PY = """from dataclasses import dataclass
from pydantic import BaseModel


class Service:
    x: int = 1


class User(BaseModel):
    id: int
    email: str
    model_config = {}

    def full(self):
        local: int = 1


@dataclass
class Point:
    x: float
    y: float
"""


def test_names():
    assert [style(s) for s in ["user-card", "user_card", "userCard", "UserCard", "user", "[id]", "X1-y"]] == [
        "kebab", "snake", "camel", "pascal", "flat", "flat", "other"]
    assert role_suffix("user.service.ts") == ".service.ts" and role_suffix("a.ts") == ""
    assert fits("flat", "kebab") and not fits("flat", "pascal") and not fits("camel", "kebab")
    assert fits("kebab", "flat") and not fits("pascal", "flat")
    assert is_test("src/a.test.ts") and is_test("tests/test_x.py") and is_test("src/__tests__/a.ts") and not is_test("src/a.ts")


def test_extract_ts():
    got = {t.name: (t.kind, t.line, t.fields) for t in extract_types("src/a.ts", TS)}
    assert got["TripShare"] == ("interface", 3, ["id", "url", "expiresAt", "nested"])
    assert got["Status"] == ("type", 10, [])
    assert got["Point"][2] == ["lat", "lng"]
    assert got["Role"][2] == ["Admin", "User"]
    assert got["CreateTripDto"][2] == ["title", "days"]
    assert got["userSchema"] == ("zod", 29, ["email", "name"])


def test_extract_python_data_classes_only():
    got = {t.name: (t.kind, t.fields) for t in extract_types("app/m.py", PY)}
    assert "Service" not in got
    assert got["User"] == ("model", ["id", "email"])
    assert got["Point"] == ("dataclass", ["x", "y"])


PATHS = [
    "src/modules/trip/trip.service.ts", "src/modules/trip/trip.controller.ts", "src/modules/trip/trip.module.ts",
    "src/modules/user/user.service.ts", "src/modules/user/user.controller.ts", "src/modules/user/user.module.ts",
    "src/common/utils/date-format.ts", "src/common/utils/slugify.ts", "src/common/utils/string-case.ts",
    "src/modules/trip/trip.service.spec.ts", "src/modules/user/user.service.spec.ts", "src/modules/x/x.spec.ts",
    "node_modules/lib/index.js", "README.md", "package.json",
]


def test_structure_and_summary(tmp_path):
    s = analyze(PATHS)
    assert s["top_dirs"] == ["src"] and s["files"] == 14
    trip = s["dirs"]["src/modules/trip"]
    assert trip["n"] == 4 and trip["suffixes"][".service.ts"] == 1 and trip["styles"] == {"flat": 4}
    assert s["dirs"]["src/common/utils"]["styles"] == {"kebab": 2, "flat": 1}
    assert s["tests"] == {"colocated": 2, "separate": 1}
    for p in PATHS:
        (tmp_path / p).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / p).write_text("export interface A { a: string; b: string; c: string }" if p.endswith(".ts") else "")
    prof = build_profile(DirTree(tmp_path), "abc1234def", "main")
    assert "Learned from `main` @ abc1234" in prof.summary and "Top-level folders: src" in prof.summary
    assert len(prof.type_index) == 9  # spec files are skipped


def _git(cwd, *args):
    subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *args], cwd=cwd, check=True, capture_output=True)


def test_git_tree_reads_another_commit_without_checkout(tmp_path):
    _git(tmp_path, "init", "-q", "-b", "main")
    (tmp_path / "src").mkdir()
    (tmp_path / "src/a.ts").write_text("export interface Main { x: string }\n")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-qm", "main")
    _git(tmp_path, "update-ref", "refs/mogo/base", "HEAD")
    (tmp_path / "src/a.ts").write_text("export interface Pr { y: string }\n")  # working tree = the PR
    tree = GitTree(tmp_path, "refs/mogo/base")
    assert tree.paths() == ["src/a.ts"]
    assert "Main" in tree.read_many(["src/a.ts", "missing.ts"])["src/a.ts"]


def test_profile_is_cached_per_commit(sf, tmp_path):
    (tmp_path / "a.ts").write_text("export interface A { a: string }")
    with sf() as s:
        from conftest import seed_user
        p = Project(owner_id=seed_user(sf), name="P")
        s.add(p)
        s.flush()
        r = Repo(project_id=p.id, full_name="a/b")
        s.add(r)
        s.commit()
        rid = r.id
    built = []

    def make():
        built.append(1)
        return DirTree(tmp_path)

    _, reused = ensure_profile(sf, rid, "main", "sha1", make)
    assert not reused
    _, reused = ensure_profile(sf, rid, "main", "sha1", make)
    assert reused and len(built) == 1
    _, reused = ensure_profile(sf, rid, "main", "sha2", make)
    assert not reused and load_profile(sf, rid, "main").main_sha == "sha2"


# --- the detected stack is only a suggestion: the runner never sets the repo's type

def _profile(stack="nextjs"):
    from mogo.profile.build import Profile
    return Profile(main_sha="abc", branch="main", structure={}, suggestions={"stack": stack})


@pytest.mark.parametrize("config", [{}, {"stack": ""}, {"stack": "docker"}, {"stack": "python", "gates": ["x"]}])
def test_learning_a_repo_never_changes_its_settings(sf, config):
    from conftest import seed_repos
    from mogo.config import RepoConfig
    from mogo.models import Repo
    from mogo.profile.store import load_profile, save_profile
    rid = seed_repos(sf, {"acme/api": RepoConfig(name="acme/api")})["acme/api"]
    with sf() as s:
        r = s.get(Repo, rid)
        r.config = dict(config)
        s.commit()
    save_profile(sf, rid, _profile())
    with sf() as s:
        assert s.get(Repo, rid).config == config  # not even a `stack` key added
    assert load_profile(sf, rid, "main").suggestions["stack"] == "nextjs"  # but it is offered
