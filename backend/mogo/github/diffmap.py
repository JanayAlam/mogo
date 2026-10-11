"""Map a unified diff to the lines GitHub lets us comment on (right side only)."""
from __future__ import annotations

import re

_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")


def commentable_lines(diff: str) -> dict[str, set[int]]:
    result: dict[str, set[int]] = {}
    path: str | None = None
    in_hunk = False
    new_line = 0
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            path, in_hunk = None, False
            continue
        if not in_hunk:
            if line.startswith("+++ "):
                p = line[4:].strip()
                path = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
                if path:
                    result.setdefault(path, set())
                continue
            m = _HUNK.match(line)
            if m:
                in_hunk, new_line = True, int(m.group(1))
            continue
        m = _HUNK.match(line)
        if m:
            new_line = int(m.group(1))
        elif line.startswith("+") or line.startswith(" ") or line == "":
            if path:
                result[path].add(new_line)
            new_line += 1
        # '-' lines and '\ No newline' do not advance the new-file counter
    return result


def file_changes(diff: str) -> dict[str, str]:
    """{path: 'added' | 'modified' | 'deleted' | 'renamed'} for every file in the diff (new path; old path if deleted)."""
    result: dict[str, str] = {}
    old = new = None
    status = "modified"
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            if new or old:
                result[new or old] = status
            old = new = None
            status = "modified"
        elif line.startswith("new file mode"):
            status = "added"
        elif line.startswith("deleted file mode"):
            status = "deleted"
        elif line.startswith("rename to "):
            status, new = "renamed", line[len("rename to "):].strip()
        elif line.startswith("rename from "):
            old = line[len("rename from "):].strip()
        elif line.startswith("--- ") and old is None:
            p = line[4:].strip()
            old = None if p == "/dev/null" else (p[2:] if p.startswith("a/") else p)
        elif line.startswith("+++ ") and new is None:
            p = line[4:].strip()
            new = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
    if new or old:
        result[new or old] = status
    return result


def added_lines(diff: str) -> dict[str, set[int]]:
    """New-side line numbers of '+' lines only (no context lines)."""
    result: dict[str, set[int]] = {}
    path: str | None = None
    new_line = 0
    in_hunk = False
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            path, in_hunk = None, False
            continue
        m = _HUNK.match(line)
        if m:
            in_hunk, new_line = True, int(m.group(1))
            continue
        if not in_hunk:
            if line.startswith("+++ "):
                p = line[4:].strip()
                path = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
            continue
        if line.startswith("+"):
            if path:
                result.setdefault(path, set()).add(new_line)
            new_line += 1
        elif line.startswith(" ") or line == "":
            new_line += 1
    return result
