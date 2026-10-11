"""The repo profile: what the source of truth branch looks like (folders, file names, type definitions).

Built from git objects of that branch, never from the PR, and cached per commit in `repo_profiles`.
"""
from __future__ import annotations

import subprocess
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from mogo.profile.naming import is_source, is_test
from mogo.profile.structure import analyze, dominant, subtree
from mogo.profile.types import extract_types

MAX_TYPE_FILES = 4000
MAX_FILE_BYTES = 200_000
MAX_TYPES = 8000


class Tree(Protocol):
    def paths(self) -> list[str]: ...
    def read_many(self, paths: list[str]) -> dict[str, str]: ...


class GitTree:
    """Files of one commit, read from the object store: no checkout, so the PR's working tree stays as it is."""

    def __init__(self, root: Path, rev: str):
        self.root, self.rev = root, rev

    def _git(self, *args: str, stdin: bytes | None = None) -> bytes:
        p = subprocess.run(["git", *args], cwd=self.root, input=stdin, capture_output=True, timeout=300)
        if p.returncode:
            raise RuntimeError(f"git {args[0]} failed: {p.stderr.decode(errors='replace')[:300]}")
        return p.stdout

    def paths(self) -> list[str]:
        out = self._git("ls-tree", "-r", "-z", "--name-only", self.rev)
        return [p for p in out.decode(errors="replace").split("\0") if p]

    def read_many(self, paths: list[str]) -> dict[str, str]:
        if not paths:
            return {}
        out = self._git("cat-file", "--batch", stdin="".join(f"{self.rev}:{p}\n" for p in paths).encode())
        result, i = {}, 0
        for p in paths:
            nl = out.index(b"\n", i)
            header = out[i:nl].split()
            i = nl + 1
            if len(header) < 3 or header[1] == b"missing":
                continue
            size = int(header[2])
            if header[1] == b"blob" and size <= MAX_FILE_BYTES:
                result[p] = out[i:i + size].decode(errors="replace")
            i += size + 1
        return result


class DirTree:
    """A plain directory (tests, or a fresh clone)."""

    def __init__(self, root: Path):
        self.root = root

    def paths(self) -> list[str]:
        return sorted(
            str(p.relative_to(self.root)) for p in self.root.rglob("*")
            if p.is_file() and ".git" not in p.relative_to(self.root).parts
        )

    def read_many(self, paths: list[str]) -> dict[str, str]:
        out = {}
        for p in paths:
            f = self.root / p
            if f.is_file() and f.stat().st_size <= MAX_FILE_BYTES:
                out[p] = f.read_text(errors="replace")
        return out


@dataclass
class Profile:
    main_sha: str
    branch: str
    structure: dict = field(default_factory=dict)
    type_index: list[dict] = field(default_factory=list)
    summary: str = ""


def build_profile(tree: Tree, sha: str, branch: str) -> Profile:
    paths = tree.paths()
    structure = analyze(paths)
    typed = [p for p in paths if is_source(p) and not is_test(p) and p.endswith((".ts", ".tsx", ".py", ".js", ".mts"))]
    texts = tree.read_many(typed[:MAX_TYPE_FILES])
    types = [t.as_dict() for p, text in texts.items() for t in extract_types(p, text)][:MAX_TYPES]
    profile = Profile(main_sha=sha, branch=branch, structure=structure, type_index=types)
    profile.summary = render_summary(profile)
    return profile


def render_summary(p: Profile, max_dirs: int = 25) -> str:
    """Plain-text conventions for the agent's prompt. Only directories with a clear pattern are listed."""
    s = p.structure
    lines = [f"Learned from `{p.branch}` @ {p.main_sha[:7]}: {s.get('files', 0)} files, {len(p.type_index)} type definitions."]
    if s.get("top_dirs"):
        lines.append("Top-level folders: " + ", ".join(s["top_dirs"][:30]))
    overall = subtree(s, ".")
    if (st := dominant(overall["styles"], share=0.6)):
        lines.append(f"Dominant file-name style: {st}.")
    tests = s.get("tests", {})
    if (placement := dominant(tests, min_total=3, share=0.8)):
        lines.append("Tests are " + ("next to the code they test." if placement == "colocated" else "in separate test folders."))

    rows = []
    for d, v in sorted(s.get("dirs", {}).items(), key=lambda kv: -kv[1]["n"]):
        parts = []
        if (st := dominant(v["styles"])):
            parts.append(f"{st} names")
        common = [k for k, n in Counter(v["suffixes"]).most_common(3) if n >= 2]
        if common:
            parts.append("suffixes " + " ".join(common))
        if parts:
            rows.append(f"- {d}/ ({v['n']} files): {', '.join(parts)}")
        if len(rows) >= max_dirs:
            break
    if rows:
        lines += ["Per folder:", *rows]
    return "\n".join(lines)
