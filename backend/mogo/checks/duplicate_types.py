"""No duplicate type definitions inside one repo: a type the PR adds that already exists on the source branch,
or that the PR adds twice. Other repos of the project are not compared (a frontend mirroring an API type is normal)."""
from __future__ import annotations

import re

from mogo.checks import Candidate, Check, CheckContext
from mogo.github.diffmap import added_lines, file_changes
from mogo.profile.naming import is_test
from mogo.profile.types import TS_EXTS, TypeDef, extract_types

_AFFIX = re.compile(r"(Dto|DTO|Type|Types|Schema|Model|Interface|Entity|Data|Props|Record|Shape|T)$")
MIN_FIELDS = 3
OVERLAP = 0.75


def normalize(name: str) -> str:
    n = name[1:] if re.match(r"I[A-Z]", name) else name  # IUser -> User
    while (m := _AFFIX.search(n)) and len(n) > len(m.group(0)):
        n = n[: m.start()]
    return n.lower()


def overlap(a: list[str], b: list[str]) -> float:
    sa, sb = {f.lower() for f in a}, {f.lower() for f in b}
    if min(len(sa), len(sb)) < MIN_FIELDS:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def language(path: str) -> str:
    """TS and Python types mirroring each other (API models in a monorepo) are not duplicates."""
    ext = "." + path.rsplit(".", 1)[-1]
    return "ts" if ext in TS_EXTS else ext


def why_similar(new: TypeDef, old: TypeDef) -> str | None:
    if language(new.file) != language(old.file):
        return None
    if new.name.lower() == old.name.lower():
        return "same name"
    if normalize(new.name) == normalize(old.name) and normalize(new.name):
        return "same name apart from a suffix/prefix"
    ratio = overlap(new.fields, old.fields)
    if ratio >= OVERLAP:
        shared = sorted({f.lower() for f in new.fields} & {f.lower() for f in old.fields})
        return f"{int(ratio * 100)}% of fields shared ({', '.join(shared[:8])})"
    return None


def new_definitions(ctx: CheckContext) -> list[TypeDef]:
    """Types whose declaration line the PR adds, read from the PR checkout."""
    added = added_lines(ctx.diff)
    out = []
    for path, status in file_changes(ctx.diff).items():
        if status == "deleted" or is_test(path) or path not in added:
            continue
        f = ctx.root / path
        if not f.is_file():
            continue
        out += [t for t in extract_types(path, f.read_text(errors="replace")) if t.line in added[path]]
    return out


def find(ctx: CheckContext) -> list[Candidate]:
    changes = file_changes(ctx.diff)
    gone = {p for p, s in changes.items() if s in ("deleted", "renamed")}
    new = new_definitions(ctx)
    existing = [TypeDef(**t) for t in ctx.profile.type_index]
    out: list[Candidate] = []
    for n in new:
        # The PR's own file on the branch is skipped: an edited or renamed type there is not a duplicate.
        for o in existing:
            if o.file == n.file or o.file in gone:
                continue
            if reason := why_similar(n, o):
                out.append(Candidate(n.file, n.line, f"{n.kind} `{n.name}` looks like {o.kind} `{o.name}` "
                                     f"already on the branch at {o.file}:{o.line} ({reason})"))
                break
    for i, a in enumerate(new):
        for b in new[i + 1:]:
            if a.file != b.file and (reason := why_similar(b, a)):
                out.append(Candidate(b.file, b.line, f"{b.kind} `{b.name}` looks like `{a.name}` that this PR also "
                                     f"adds at {a.file}:{a.line} ({reason})"))
    return out


CHECK = Check(
    id="no-duplicate-types",
    title="No duplicate type definitions (within this repo)",
    instructions=(
        "A type the PR adds must not repeat one that exists in this repo (same shape or the same concept under another "
        "name); it should import or extend the existing one. Do not compare with other repos of the project. Confirm "
        "real duplicates as findings anchored to the new definition and name the existing type to reuse."
    ),
    find=find,
)
