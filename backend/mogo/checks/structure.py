"""File and folder conventions: new files compared with what the source branch does in the same place."""
from __future__ import annotations

from pathlib import PurePosixPath

from mogo.checks import Candidate, Check, CheckContext
from mogo.github.diffmap import file_changes
from mogo.profile.naming import FIXED_STEMS, TEST_DIRS, fits, is_source, is_test, role_suffix, split_name, style
from mogo.profile.structure import dominant, subtree


def _nearest_known(dirs: dict, d: str) -> str:
    while d not in dirs and d not in (".", ""):
        d = str(PurePosixPath(d).parent)
    return d or "."


def find(ctx: CheckContext) -> list[Candidate]:
    s = ctx.profile.structure
    dirs = s.get("dirs", {})
    top = set(s.get("top_dirs", []))
    tests = dominant(s.get("tests", {}), min_total=3, share=0.8)
    out: list[Candidate] = []
    new_top_reported: set[str] = set()

    for path, status in file_changes(ctx.diff).items():
        if status != "added" or not is_source(path):
            continue
        pp = PurePosixPath(path)
        parent = str(pp.parent)
        stem, _ = split_name(pp.name)

        if len(pp.parts) > 1 and top and pp.parts[0] not in top and pp.parts[0] not in new_top_reported:
            new_top_reported.add(pp.parts[0])
            out.append(Candidate(path, 1, f"new top-level folder `{pp.parts[0]}/`; the branch has: {', '.join(sorted(top)[:15])}"))

        # Name style: the folder itself if the branch has it, else the nearest existing ancestor's subtree.
        known = _nearest_known(dirs, parent)
        stats = dirs.get(parent) or subtree(s, known)
        where = f"`{parent}/`" if parent in dirs else f"under `{known}/`"
        if stem not in FIXED_STEMS and (dom := dominant(stats.get("styles", {}))) and not fits(style(stem), dom):
            out.append(Candidate(path, 1, f"file name `{pp.name}` is {style(stem)}; files {where} are {dom}"))

        # Role suffix: siblings mostly share one (`user.service.ts`) and this file has a different one or none.
        if parent in dirs and not is_test(path):
            sib = dirs[parent]
            if (suf := dominant(sib.get("suffixes", {}), share=0.7)) and sum(sib["suffixes"].values()) >= 0.7 * sib["n"]:
                mine = role_suffix(pp.name)
                if mine != suf:
                    out.append(Candidate(path, 1, f"`{pp.name}` has {'suffix ' + mine if mine else 'no role suffix'}; "
                                         f"files in `{parent}/` use `{suf}`"))

        if is_test(path) and tests:
            in_test_dir = any(p in TEST_DIRS for p in pp.parts[:-1])
            if tests == "separate" and not in_test_dir:
                out.append(Candidate(path, 1, "test file next to the code; tests on the branch live in separate test folders"))
            elif tests == "colocated" and in_test_dir and parent not in dirs:
                out.append(Candidate(path, 1, "test file in a separate test folder; tests on the branch sit next to the code"))
    return out


CHECK = Check(
    id="structure-convention",
    title="File and folder conventions",
    instructions=(
        "New files must follow how the source branch organises code: folder placement, file-name style, role suffixes "
        "(e.g. `.service.ts`), and where tests live. Use the conventions above and the repo's convention files. "
        "Confirm real violations as findings anchored to line 1 of the new file and say where it should go or how it "
        "should be named. Framework-dictated names (page.tsx, route.ts, __init__.py, ...) are fine."
    ),
    find=find,
)
