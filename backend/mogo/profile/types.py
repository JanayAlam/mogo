"""Find type definitions (name, kind, line, field names) in TS/JS and Python with line-based patterns.

Good enough to spot likely duplicates; the agent confirms each candidate. Swap for tree-sitter when needed.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from pathlib import PurePosixPath

MAX_FIELDS = 40
TS_EXTS = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}

_TS_DECL = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?"
    r"(interface|type|enum|class)\s+([A-Z][A-Za-z0-9_]*)\b"
)
_TS_ZOD = re.compile(r"^\s*(?:export\s+)?const\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*z\s*\.\s*(?:object|strictObject)\s*\(")
_TS_MEMBER = re.compile(r"^\s*(?:readonly\s+|public\s+|private\s+|protected\s+|static\s+|declare\s+)*"
                        r"[\"']?([A-Za-z_$][\w$]*)[\"']?\s*[?!]?\s*[:=(]")
_TS_ENUM_MEMBER = re.compile(r"^\s*[\"']?([A-Za-z_$][\w$]*)[\"']?\s*(?:=|,|$)")

_PY_CLASS = re.compile(r"^class\s+([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*:")
_PY_DATA_BASES = re.compile(r"BaseModel|BaseSettings|TypedDict|NamedTuple|Enum|Protocol|Schema|Base\b|DeclarativeBase|Struct")
_PY_FIELD = re.compile(r"^\s+([A-Za-z_]\w*)\s*(?::|=)")


@dataclass
class TypeDef:
    name: str
    kind: str
    file: str
    line: int
    fields: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return asdict(self)


def extract_types(path: str, text: str) -> list[TypeDef]:
    ext = PurePosixPath(path).suffix
    if ext in TS_EXTS:
        return _ts(path, text.splitlines())
    if ext == ".py":
        return _py(path, text.splitlines())
    return []


def _ts(path: str, lines: list[str]) -> list[TypeDef]:
    out = []
    for i, line in enumerate(lines):
        m = _TS_DECL.match(line)
        if m:
            kind, name = m.group(1), m.group(2)
            if kind == "type" and "{" not in line and not line.rstrip().endswith("="):
                out.append(TypeDef(name, kind, path, i + 1))  # alias of another type or a union: no fields
                continue
            out.append(TypeDef(name, kind, path, i + 1, _ts_block_fields(lines, i, enum=kind == "enum")))
            continue
        m = _TS_ZOD.match(line)
        if m:
            out.append(TypeDef(m.group(1), "zod", path, i + 1, _ts_block_fields(lines, i)))
    return out


def _ts_block_fields(lines: list[str], start: int, enum: bool = False) -> list[str]:
    """Members at depth 1 of the first {...} block opened on or after `start`."""
    fields: list[str] = []
    depth, opened = 0, False
    for line in lines[start:start + 400]:
        if opened and depth == 1:
            m = (_TS_ENUM_MEMBER if enum else _TS_MEMBER).match(line)
            if m and m.group(1) not in ("constructor", "return", "if", "for", "const", "let"):
                fields.append(m.group(1))
        for ch in line:
            if ch == "{":
                depth += 1
                opened = True
            elif ch == "}":
                depth -= 1
        if opened and depth <= 0:
            break
    seen: dict[str, None] = dict.fromkeys(fields)
    return list(seen)[:MAX_FIELDS]


def _py(path: str, lines: list[str]) -> list[TypeDef]:
    out = []
    for i, line in enumerate(lines):
        m = _PY_CLASS.match(line)
        if not m:
            continue
        bases = m.group(2) or ""
        decorated = i > 0 and lines[i - 1].lstrip().startswith(("@dataclass", "@attr", "@define"))
        if not (decorated or _PY_DATA_BASES.search(bases)):
            continue
        kind = "enum" if "Enum" in bases else "dataclass" if decorated else "model"
        out.append(TypeDef(m.group(1), kind, path, i + 1, _py_fields(lines, i)))
    return out


def _py_fields(lines: list[str], start: int) -> list[str]:
    fields, indent = [], None
    for line in lines[start + 1:start + 300]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        cur = len(line) - len(line.lstrip())
        if indent is None:
            indent = cur
        if cur == 0:
            break
        if cur == indent:
            m = _PY_FIELD.match(line)
            if m and not m.group(1).startswith("__") and m.group(1) not in ("def", "class", "model_config"):
                fields.append(m.group(1))
    return list(dict.fromkeys(fields))[:MAX_FIELDS]
