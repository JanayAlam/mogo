"""Regenerates tests/data/detect_cases.json: repos (root file name -> text) and what `detect` makes of each.

    PYTHONPATH=. python tests/regen_detect_cases.py

The file is the contract between the two implementations of the detection: this one (the runner, mogo/profile/detect.py)
and the web app's (web/src/lib/detect.ts). tests/test_detect.py checks Python against it, web/tests/detect.test.ts the
TypeScript. Change the detection in one place and the other test fails until the other is changed too and this is
regenerated: the diff of the JSON shows what the change did.
"""
import json
from pathlib import Path

from mogo.profile.detect import detect

def j(v):
    return json.dumps(v)


CASES = {
    "nothing": {"README.md": ""},
    "no docker files": {"package.json": j({"scripts": {"dev": "vite"}}), "pnpm-lock.yaml": ""},
    "dockerfile only": {"Dockerfile": "FROM node:22\nCMD node x\n"},
    "dockerfile with expose": {"Dockerfile": "FROM node:22\nEXPOSE 8080\nEXPOSE 9229\n"},
    "dockerfile, lowercase expose with protocol": {"Dockerfile": "FROM x\n  expose 4000/tcp\n"},
    "dockerfile, commented expose": {"Dockerfile": "FROM x\n# EXPOSE 1234\n"},
    "dockerfile names": {"Dockerfile": "", "Dockerfile.dev": "", "api.Dockerfile": "", "notes.md": ""},
    "compose names": {"docker-compose.yaml": "", "compose.yml": "", "docker-compose.prod.yml": "", "package.json": "{}"},
    "dockerfile and compose": {"Dockerfile.dev": "FROM node\n", "docker-compose.yaml": "services: {}\n"},
    "env example variants": {"package.json": "{}", ".env.sample": "A=1\r\nexport B = 2\r\n# C=3\r\n  D=4\r\nA=9\r\n"},
    "convention files": {"AGENTS.md": "", "README.md": "", "CLAUDE.md": "", ".cursorrules": "", "docs.md": "", "claude.md": "", "src": ""},
    "env example next to docker": {"Dockerfile": "FROM x\nEXPOSE 3000\n", ".env.example": "# server\nPORT=8000\nDATABASE_URL=\nexport JWT_SECRET=x\n"},
}


def main() -> None:
    out = [{"name": n, "files": files, "expected": detect(set(files), files.get)} for n, files in CASES.items()]
    path = Path(__file__).parent / "data" / "detect_cases.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(out)} cases written to {path}")


if __name__ == "__main__":
    main()
