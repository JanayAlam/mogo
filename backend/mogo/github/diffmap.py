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
