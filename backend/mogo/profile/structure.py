"""Folder and file-name conventions of a branch, from its file list alone."""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import PurePosixPath

from mogo.profile.naming import FIXED_STEMS, is_ignored, is_source, is_test, role_suffix, split_name, style

MAX_DIRS = 400


def analyze(paths: list[str]) -> dict:
    """{
      "top_dirs": [...], "files": n,
      "dirs": {dir: {"n": files, "styles": {style: n}, "suffixes": {".service.ts": n}}},
      "tests": {"colocated": n, "separate": n},
    }"""
    files = [p for p in paths if not is_ignored(p)]
    top = sorted({PurePosixPath(p).parts[0] for p in files if len(PurePosixPath(p).parts) > 1})
    dirs: dict[str, dict] = defaultdict(lambda: {"n": 0, "styles": Counter(), "suffixes": Counter()})
    src_dirs = {str(PurePosixPath(p).parent) for p in files if is_source(p) and not is_test(p)}
    tests = Counter()

    for p in files:
        if not is_source(p):
            continue
        pp = PurePosixPath(p)
        d = dirs[str(pp.parent)]
        d["n"] += 1
        stem, _ = split_name(pp.name)
        if stem not in FIXED_STEMS:
            d["styles"][style(stem)] += 1
        if suf := role_suffix(pp.name):
            d["suffixes"][suf] += 1
        if is_test(p):
            tests["colocated" if str(pp.parent) in src_dirs else "separate"] += 1

    biggest = sorted(dirs.items(), key=lambda kv: -kv[1]["n"])[:MAX_DIRS]
    return {
        "files": len(files),
        "top_dirs": top,
        "dirs": {k: {"n": v["n"], "styles": dict(v["styles"]), "suffixes": dict(v["suffixes"])} for k, v in biggest},
        "tests": dict(tests),
    }


def dominant(counts: dict[str, int], min_total: int = 3, share: float = 0.7) -> str | None:
    total = sum(counts.values())
    if total < min_total:
        return None
    name, n = max(counts.items(), key=lambda kv: kv[1])
    return name if n / total >= share else None


def subtree(structure: dict, root: str) -> dict:
    """Styles and suffixes of every analysed dir at or below `root` ('.' = whole repo)."""
    styles, suffixes, n = Counter(), Counter(), 0
    for d, v in structure.get("dirs", {}).items():
        if root == "." or d == root or d.startswith(root + "/"):
            styles.update(v["styles"])
            suffixes.update(v["suffixes"])
            n += v["n"]
    return {"n": n, "styles": dict(styles), "suffixes": dict(suffixes)}
