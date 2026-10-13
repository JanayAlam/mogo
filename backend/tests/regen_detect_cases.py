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

PKG_NEST = {
    "scripts": {"dev": "nest start --watch", "lint": "eslint .", "format:check": "prettier -c .", "test": "jest",
                "build": "nest build"},
    "devDependencies": {"typescript": "5", "@nestjs/core": "10"},
}
PKG_ANTROTRIP = {
    "scripts": {"preinstall": "node scripts/verify-pnpm.mjs", "dev": "tsx watch --env-file-if-exists=.env src/server.ts",
                "build": "tsup", "start": "NODE_ENV=production node dist/server.js", "lint": 'eslint "src/**/*.ts"',
                "format": "prettier --write .", "format:check": "prettier --check ."},
    "dependencies": {"express": "^5.2.1", "zod": "^4.3.6"}, "devDependencies": {"typescript": "^5", "@types/node": "^25"},
    "engines": {"node": ">=22"},
}


def j(v):
    return json.dumps(v)


CASES = {
    "pnpm nest repo": {"package.json": j(PKG_NEST), "pnpm-lock.yaml": "", "tsconfig.json": "{}",
                       ".env.example": "# server\nPORT=8000\nDATABASE_URL=\nexport JWT_SECRET=x\n"},
    "npm vite, typecheck script, default test": {
        "package.json": j({"scripts": {"dev": "vite", "typecheck": "tsc -b", "test": 'echo "Error: no test specified" && exit 1'},
                           "devDependencies": {"vite": "5", "typescript": "5"}}),
        "package-lock.json": "", "tsconfig.json": "{}"},
    "port from the dev script": {"package.json": j({"scripts": {"dev": "next dev -p 4000"}, "dependencies": {"next": "16"}}),
                                 "yarn.lock": ""},
    "port from --port": {"package.json": j({"scripts": {"start": "node s.js --port=9100"}}), "bun.lock": ""},
    "yarn 2+": {"package.json": "{}", "yarn.lock": "", ".yarnrc.yml": ""},
    "yarn 1": {"package.json": j({"scripts": {"lint": "eslint ."}}), "yarn.lock": ""},
    "bun": {"package.json": j({"scripts": {"dev": "bun run x.ts", "test": "bun test"}}), "bun.lock": ""},
    "bun lockb": {"package.json": "{}", "bun.lockb": ""},
    "npm without a lockfile": {"package.json": j({"scripts": {"build": "tsc"}})},
    "python with uv": {"pyproject.toml": "[tool.ruff]\n[project.optional-dependencies]\ndev = ['pytest', 'mypy']\n", "uv.lock": ""},
    "python with poetry": {"pyproject.toml": "[tool.poetry]\n", "poetry.lock": ""},
    "python requirements": {"requirements.txt": "django\n"},
    "broken package.json": {"package.json": "{not json", "pnpm-lock.yaml": ""},
    "package.json that is a list": {"package.json": "[1, 2]", "package-lock.json": ""},
    "nothing": {"README.md": ""},
    "antrotrip-like express": {"package.json": j(PKG_ANTROTRIP), "pnpm-lock.yaml": "", "tsconfig.json": "{}",
                               "Dockerfile.dev": "FROM node\n", "docker-compose.yaml": "services: {}\n"},
    "next with scripts": {"package.json": j({"scripts": {"dev": "next dev", "build": "next build", "lint": "next lint"},
                                             "dependencies": {"next": "15", "react": "19"}}), "pnpm-lock.yaml": ""},
    "next with an express server": {"package.json": j({"dependencies": {"next": "15", "express": "4"}})},
    "nest on express": {"package.json": j({"dependencies": {"@nestjs/core": "10", "express": "4"}})},
    "plain express, no typescript": {"package.json": j({"dependencies": {"express": "4"}})},
    "raw node": {"package.json": j({"scripts": {"start": "node index.js"}})},
    "typescript library": {"package.json": j({"devDependencies": {"typescript": "5"}}), "tsconfig.json": "{}",
                           "package-lock.json": ""},
    "tsc fallback": {"package.json": j({"devDependencies": {"typescript": "5"}}), "tsconfig.json": "{}", "pnpm-lock.yaml": ""},
    "fastapi in pyproject": {"pyproject.toml": "[project]\ndependencies = ['fastapi>=0.110', 'uvicorn']\n"},
    "fastapi in requirements": {"requirements.txt": "uvicorn\nFastAPI==0.110.0\n"},
    "fastapi lookalikes": {"requirements.txt": "fastapi-utils==0.2\n# fastapi\n"},
    "setup.py": {"setup.py": ""},
    "python repo with a package.json for tooling": {"package.json": j({"scripts": {"lint": "prettier ."}}),
                                                    "pyproject.toml": "[project]\n"},
    "next beats python files": {"package.json": j({"dependencies": {"next": "15"}}), "pyproject.toml": "[project]\n"},
    "dockerfile only": {"Dockerfile": "FROM node:22\nCMD node x\n"},
    "dockerfile with expose": {"Dockerfile": "FROM node:22\nEXPOSE 8080\nEXPOSE 9229\n"},
    "dockerfile, lowercase expose with protocol": {"Dockerfile": "FROM x\n  expose 4000/tcp\n"},
    "dockerfile, commented expose": {"Dockerfile": "FROM x\n# EXPOSE 1234\n"},
    "dockerfile names": {"Dockerfile": "", "Dockerfile.dev": "", "api.Dockerfile": "", "notes.md": ""},
    "compose names": {"docker-compose.yaml": "", "compose.yml": "", "docker-compose.prod.yml": "", "package.json": "{}"},
    "env example variants": {"package.json": "{}", ".env.sample": "A=1\r\nexport B = 2\r\n# C=3\r\n  D=4\r\nA=9\r\n"},
    "port from the env file": {"package.json": j({"scripts": {"dev": "vite"}}), ".env.example": "PORT='3333'\n",
                               "package-lock.json": ""},
    "many scripts": {"package.json": j({"scripts": {f"s{i}": "x" * 300 for i in range(100)} | {"weird": {"a": 1}}}),
                     "package-lock.json": ""},
    "script order": {"package.json": j({"scripts": {"zeta": "z", "alpha": "a", "lint": "eslint", "typecheck": "tsc"}}),
                     "pnpm-lock.yaml": ""},
}


def main() -> None:
    out = [{"name": n, "files": files, "expected": detect(set(files), files.get)} for n, files in CASES.items()]
    path = Path(__file__).parent / "data" / "detect_cases.json"
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"{len(out)} cases written to {path}")


if __name__ == "__main__":
    main()
