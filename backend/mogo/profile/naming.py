"""File-name helpers shared by the profile and the checks."""
from __future__ import annotations

import re
from pathlib import PurePosixPath

IGNORED_DIRS = frozenset({
    "node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", ".cache", "coverage", "vendor",
    "__pycache__", ".venv", "venv", ".git", ".idea", ".vscode", "generated", "__generated__", ".pnpm-store",
})
SOURCE_EXTS = frozenset({
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py", ".go", ".rb", ".java", ".kt", ".rs",
    ".vue", ".svelte", ".css", ".scss", ".sql", ".prisma", ".graphql",
})
# Names a framework dictates; their style says nothing about the repo's convention.
FIXED_STEMS = frozenset({
    "index", "__init__", "__main__", "main", "app", "page", "layout", "route", "loading", "error", "not-found",
    "middleware", "proxy", "conftest", "setup", "manage", "default", "template", "mod", "lib",
})
_TEST = re.compile(r"(\.(test|spec)\.[^.]+$)|(^test_.+\.py$)|(_test\.(py|go)$)")
TEST_DIRS = frozenset({"test", "tests", "__tests__", "spec", "specs", "e2e"})


def is_ignored(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return any(p in IGNORED_DIRS for p in parts[:-1]) or path.endswith((".d.ts", ".min.js", ".lock"))


def is_source(path: str) -> bool:
    return PurePosixPath(path).suffix in SOURCE_EXTS and not is_ignored(path)


def is_test(path: str) -> bool:
    p = PurePosixPath(path)
    return bool(_TEST.search(p.name)) or any(part in TEST_DIRS for part in p.parts[:-1])


def split_name(filename: str) -> tuple[str, str]:
    """'user.service.ts' -> ('user', '.service.ts'); 'Button.tsx' -> ('Button', '.tsx')."""
    if filename.startswith("."):
        return filename, ""
    stem, _, rest = filename.partition(".")
    return stem, ("." + rest) if rest else ""


def role_suffix(filename: str) -> str:
    """The part between the stem and the extension: 'user.service.ts' -> '.service.ts', 'a.ts' -> ''."""
    _, suffix = split_name(filename)
    return suffix if suffix.count(".") >= 2 else ""


def style(stem: str) -> str:
    """kebab | snake | camel | pascal | flat (one lowercase word, fits most styles) | other"""
    s = stem.strip("[]()_")  # Next.js [id], (group), _private
    if not s:
        return "other"
    if re.fullmatch(r"[a-z0-9]+", s):
        return "flat"
    if re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)+", s):
        return "kebab"
    if re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)+", s):
        return "snake"
    if re.fullmatch(r"[a-z][a-z0-9]*([A-Z][a-z0-9]*)+", s):
        return "camel"
    if re.fullmatch(r"([A-Z][a-z0-9]*)+", s):
        return "pascal"
    return "other"


def fits(file_style: str, dominant: str) -> bool:
    if file_style == dominant or dominant == "other" or file_style == "other":
        return True
    if dominant == "flat":  # all lowercase words: separators are unknown, capitals are not
        return file_style not in ("pascal", "camel")
    return file_style == "flat" and dominant != "pascal"
