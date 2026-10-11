# mogo

Self-hosted agent that tests a feature across a project's GitHub PRs and posts a code review on each.
You group repos (backend, frontend, admin, ...) into a project, describe a feature and link its PR in each repo. It checks out the branch in a sandbox,
runs your linters and tests, exercises the feature over HTTP, reviews the diff against the repo's conventions,
and posts a GitHub review with inline comments.

```
web/ (Next.js on Vercel)  --projects, features, runs-->  Supabase Postgres  <--progress/result--+
        |                                                                         |
        +--workflow_dispatch--> GitHub Actions (run-agent.yml in the runner repo) +
                                  python -m mogo.runner <run_id>
                                  clone PR -> setup -> gates (tsc/eslint) -> boot app -> agent loop -> review
                                  LLM: local server (via tunnel) if reachable, else DeepSeek
```

Vercel is serverless and cannot run the agent, so the web app only creates runs and starts the workflow.
The Python runner does the work on a free GitHub-hosted VM. The same runner also runs on your own machine
through a CLI.

## Contents

- [Projects, repos and features](#projects-repos-and-features)
- [Run locally](#run-locally)
- [Deploy](#deploy)
- [Environment variables](#environment-variables)
- [Local LLM vs DeepSeek](#local-llm-vs-deepseek)
- [Troubleshooting](#troubleshooting)
- [Safety](#safety) · [Observability](#observability) · [Layout](#layout)

## Projects, repos and features

Everything is set up in the web app:

1. **Project**: a product, with a description the agent reads as context.
2. **Repos** in the project. Each has a **role** (free text; `backend`, `frontend`, `admin-frontend` are suggested),
   a **source of truth branch** (default `main`), and its run settings (below).
3. **Feature**: what to check. A title, a description, and one entry per repo it touches: the PR link and optional
   requirements for that repo. **Check all repos** starts one run per repo; each can be re-run on its own.

Each run's prompt includes the project description, the repo's role, the feature, that repo's requirements, and the
other repos of the feature (their roles and PRs, so contract mismatches are visible). The review is posted on each PR.

### Repo settings

When a repo is added, the runner reads its source of truth branch (`package.json`, the lockfile, `tsconfig.json`,
`pyproject.toml`, `.env.example`) and the repo page offers what it found under **Detected on main**: checks (lint,
type check, format check), test command, start script and app URL. **Use these** fills the empty fields; nothing is
saved until you click Save. **Re-learn now** reads the branch again.

| Section | What it is | Stored as (`repos.config`) |
| --- | --- | --- |
| **Checks** | commands run on every review after installing; any failure requests changes | `gates` |
| **Run the app** | off = review only. On: a start script (earlier lines run first, the last one starts the app) and the URL the run waits for before the agent tests | `prepare` + `start`, `healthcheck` |
| **Agent notes** | convention files, extra rules, testing notes (accounts, how to log in) | `conventions`, `rules`, `notes` |
| **Advanced** | install override, test command for the agent, stop command, fork PRs | `setup`, `test_cmd`, `services_down`, `allow_forks` |

Without an install override the runner installs from the lockfile: `pnpm install --frozen-lockfile` (with
`corepack enable`), `yarn install --immutable` or `--frozen-lockfile`, `npm ci`, `bun install --frozen-lockfile`,
`uv sync`, `poetry install` or `pip install -r requirements.txt`.

Order of a run: install, checks, then (feature given and the app runs) the start script lines, the app, the agent, and
finally the stop command. If a line before the last fails, the app is not started and the agent is told why.

Anyone who can sign in to the web app can change these commands, and the runner executes them. Treat the dashboard
password like push access to the runner repo.

### Built-in checks

Every review also runs these, on top of the repo's own rules. Switch them per project (Edit project).

| Check                  | What it catches                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `no-duplicate-types`   | a type the PR adds that already exists in the same repo (same name apart from `Dto`/`Schema`/`I`..., or 75%+ of fields shared), or that the PR adds twice. Other repos and other languages are not compared |
| `structure-convention` | new files whose name style, role suffix (`.service.ts`) or test placement differs from what the branch does in that folder, and new top-level folders |

The repo's **source of truth branch** (default `main`) defines the conventions. Before each review the runner asks
GitHub for the branch head; if it moved, it fetches that commit into the checkout (as `refs/mogo/base`, the PR's files
are untouched) and rebuilds the repo profile: folders, file-name styles and suffixes per folder, test placement, and
every type definition (TS/JS interfaces, types, enums, classes, zod objects; Python pydantic/dataclass/TypedDict/Enum
models). The profile is cached per commit in `repo_profiles` and shown on the repo page; **Re-learn now** rebuilds it as
a separate workflow job (`python -m mogo.runner --profile <repo id>` locally).

The checks only produce candidates. The agent confirms or dismisses each one, reports confirmed ones as findings with
rule `builtin:<id>`, and gives every check a pass/fail line in the review. If the branch cannot be read, the review goes on
and the agent judges the checks from the diff alone.

### Moving an old `repos.yaml` in

The runner reads repo settings only from the database. If you have settings in the old `repos.yaml` format, copy them
into a project once instead of retyping them (entries may also set `role` and `default_branch`):

```bash
cd backend
git show 0cd6fec:repos.yaml > /tmp/repos.yaml   # the last committed version, if the file is gone
python -m mogo.tools.import_repos /tmp/repos.yaml --project "My product" --description "..."
```

Re-running it updates the same project and repos by name.

### Environment variables

Each repo has one list of environment variables, set on its repo page. Its commands get only these, never the
runner's own credentials (see [Safety](#safety)); the runner repo's Actions secrets are for the runner only.

- **Plain** variables (`PORT=8000`, `SMTP_HOST=localhost`) are stored as text and can be viewed and edited.
- **Sensitive** variables are encrypted by the web app (AES-256-GCM with `MOGO_SECRET_KEY`) before they are stored,
  can't be shown again, only replaced, and are masked (`***`) in the run log, the stored result, the posted review and
  everything sent to the LLM. Each value is bound to its repo and name, so it can't be copied onto another one.
- A plain variable can be switched to sensitive in place (its value gets encrypted). A sensitive one becomes plain
  only with a new value, so a switch can't reveal it.
- **Import .env file** saves every `NAME=value` of a file: existing names get the new value and keep their kind, new
  names are sensitive when they look like credentials (`*_SECRET`, `*_PASSWORD`, `*_TOKEN`, `*_KEY`, `DATABASE_URL`,
  ...), and variables missing from the file are kept. A preview lists the names first; values are never shown.

Set the same `MOGO_SECRET_KEY` (create one with `openssl rand -base64 32`) on Vercel and as an Actions secret of the
runner repo (and in `backend/.env` for the CLI). Without it plain variables still work, sensitive ones can't be saved,
and runs warn that stored sensitive values are unavailable. Changing the key makes them unreadable: re-enter them.

**Use test-only credentials with spend limits**, never production ones: the PR's code can read every variable, and
masking catches accidents, not a PR built to leak.

Coming from `env_from` (repo values kept in the runner repo's Actions secrets): it is no longer read. Runs and the repo
page list the names still configured; add their values here, save the repo page (which drops the old list), then
delete those secrets from the runner repo.

### Seed data

`seeds/antrotrip-server/seed.ts` can fill a throwaway sandbox database with fixtures after migrations: 13 users (every login state), 5 businesses
(VERIFIED, PENDING, REJECTED, UNVERIFIED, and a multi-member one), 15 listings (unclaimed, claimed, claim PENDING/REJECTED/resubmitted, and every
review state), menus, and two trips. App users are passwordless, so the seed also arms the OTP `111111` for each of them in Valkey.
`prepare` copies it into the checkout (`$MOGO_SEEDS_DIR` points at `seeds/`) and runs it with the target repo's own Prisma client.
The seed is idempotent. It is **not** used for antrotrip-server right now: that repo runs against a shared development
database, so its `prepare` only runs `prisma generate` (no migrations, no seed) and its `notes` tell the agent to
only read, or create and clean up clearly labelled `mogo-test` data.

## Run locally

Prerequisites: Python 3.11+ (with `python3-venv`), Node 22+, Git, and optionally Docker.
You need a GitHub token, a DeepSeek key and/or a local LLM server (see below).

### The agent (CLI, no web app needed)

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env              # backend/.env (read from any folder): ENVIRONMENT, DATABASE_URL, GITHUB_TOKEN, ...
pytest                            # offline, no database needed

# the repo must be configured in a project (web app, or the importer above)

# review + test a PR; --dry-run prints/stores the result without posting to GitHub
python -m mogo.runner --pr https://github.com/org/backend/pull/12 \
  --feature "POST /orders with an empty cart returns 422 and creates no row" \
  --llm auto --dry-run
```

`python -m mogo.runner --profile <repo id>` re-learns a repo's conventions from its source of truth branch.

Drop `--dry-run` to post the review. `--llm` is `auto`, `local` or `deepseek`. The exit code is 0 on success.
Run history and repo settings are stored in your Supabase database, so the CLI needs `DATABASE_URL` too.
A CLI run has no feature record: `--feature` is the description and no sibling repos are shown to the agent.

For isolation, run it in the container (it has Git and Node for the target repos):

```bash
docker build -t mogo .
docker run --rm --env-file backend/.env mogo --pr <url> --dry-run
# local LLM on the host: LOCAL_LLM_BASE_URL=http://host.docker.internal:11434/v1
#   and add --add-host=host.docker.internal:host-gateway on Linux
```

#### Backend tests

`pytest` runs fully offline (fake GitHub, fake LLM, throwaway sqlite file per test). The app itself only supports Postgres.
The web app's SQL is Postgres-specific, so its one DB test (`web/tests/db.integration.test.ts`) only runs when
`TEST_DATABASE_URL` points at a throwaway Postgres (it also covers projects, repos and features):

```bash
docker run -d --name mogo-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=t -p 54329:5432 postgres:16-alpine
(cd backend && DATABASE_URL=postgresql://postgres:pw@localhost:54329/t ENVIRONMENT=test python -m mogo.tools.migrate)
cd web && TEST_DATABASE_URL=postgresql://postgres:pw@localhost:54329/t pnpm test
```

### The web app

```bash
cd web
corepack enable                   # once; gives you the pnpm version pinned in package.json
pnpm install
cp .env.example .env.local        # APP_PASSWORD, DATABASE_URL, GITHUB_TOKEN, RUNNER_REPO ...
pnpm dev                          # http://localhost:3000
pnpm test                         # unit + route tests; set TEST_DATABASE_URL to include the Postgres test
pnpm typecheck && pnpm lint && pnpm build
```

Starting a check from the web app always dispatches the GitHub Actions workflow, so the runner repo from the
[Deploy](#deploy) section must exist first. For a fully local loop use the CLI above. Without `APP_PASSWORD`
there is no login screen; production stays closed unless `AUTH_DISABLED=true`.

## Deploy

Three pieces: Supabase (database), a private GitHub repo (the runner), Vercel (the web app).

### 1. Supabase

1. Create a project and copy its connection string (Session pooler or direct connection for migrations).
   Create or upgrade the tables from your machine:

   ```bash
   cd backend && python -m mogo.tools.migrate     # uses DATABASE_URL from backend/.env
   ```

   It applies `db/migrations/*.sql` that are not yet recorded in `schema_migrations`; `--status` lists them without
   changing anything. The connection string can be pasted as Supabase or Prisma show it: a raw `@` in the password is
   handled and Prisma-only options (`connection_limit`, `pgbouncer`, ...) are dropped, in the runner and the web app. A database
   created earlier from the old `db/schema.sql` is picked up as is (the files use `if not exists`). Run it again after
   pulling changes that add a migration: the runner refuses to start while one is pending.
2. Copy the **connection pooler** string (Project Settings, Database, Connection string, "Transaction pooler").
   Use it as `DATABASE_URL` everywhere below. The pooler works from Vercel and GitHub Actions (both are IPv4-only for the direct host).

### 2. GitHub tokens

Create two fine-grained personal access tokens (Settings, Developer settings):

| Token          | Repository access           | Permissions                                   | Used by                             |
| -------------- | --------------------------- | --------------------------------------------- | ----------------------------------- |
| Runner token   | the repos you want reviewed | Contents: read, Pull requests: read and write | Actions secret `AGENT_GITHUB_TOKEN` |
| Dispatch token | the runner repo only        | Actions: read and write                       | Vercel env `GITHUB_TOKEN`           |

Actions secret names cannot start with `GITHUB_`, which is why the runner token is called `AGENT_GITHUB_TOKEN`.

### 3. Runner repo (GitHub Actions)

1. Create a **private** repo (e.g. `you/mogo`) and push this project to its `main` branch.
   The workflow file must exist on the branch named in `RUNNER_REF`.
2. Repo Settings, Secrets and variables, Actions. Add secrets:
   `AGENT_GITHUB_TOKEN`, `DEEPSEEK_API_KEY`, `DATABASE_URL`, `MOGO_SECRET_KEY` (for repo secrets; same value as on Vercel);
   optional: `SENTRY_DSN`, `LOCAL_LLM_BASE_URL` (tunnel URL, see below).
   Add the variable `LOCAL_LLM_MODEL` if you use a local model.
3. Repo settings live in the database and are edited in the web app; this repo only holds the code and workflow.

Private repos get 2,000 free Actions minutes a month. Review-only runs take a couple of minutes;
runs that boot the app take longer. The job has a 25 minute timeout.

### 4. Vercel (web app)

1. Import the runner repo into Vercel. Set **Root Directory** to `web`. Next.js and pnpm are detected automatically (`pnpm-lock.yaml`).
2. Add environment variables (Production, and Preview if you use it):

   | Variable        | Value                           |
   | --------------- | ------------------------------- |
   | `APP_PASSWORD`  | long random password for the UI |
   | `DATABASE_URL`  | Supabase pooler string          |
   | `GITHUB_TOKEN`  | the dispatch token              |
   | `RUNNER_REPO`   | `you/mogo`                      |
   | `MOGO_SECRET_KEY` | `openssl rand -base64 32`, same as the runner repo secret |
   | `SENTRY_DSN`    | optional                        |

3. Deploy. Open the URL, sign in, create a project, add its repos, create a feature, then **Check all repos** with
   **dry run** ticked and watch the runs progress.
   Check the run in the repo's Actions tab if it stays `queued`.

CLI alternative: `cd web && pnpm dlx vercel --prod` (set the same variables with `vercel env add`).

## Environment variables

**Web app** (Vercel / `web/.env.local`): see `web/.env.example`.

| Variable          | Required          | Purpose                                                     |
| ----------------- | ----------------- | ----------------------------------------------------------- |
| `APP_PASSWORD`    | yes in production | UI password; empty means no login (production: see below)   |
| `AUTH_DISABLED`   | no                | `true` opens production without a password (not advised)    |
| `MOGO_SECRET_KEY` | for secrets       | encrypts repo secrets; the runner needs the same value      |
| `DATABASE_URL`    | yes               | Supabase Postgres                                           |
| `GITHUB_TOKEN`    | yes               | dispatch token (Actions: read and write on the runner repo) |
| `RUNNER_REPO`     | yes               | `owner/name` of the runner repo                             |
| `RUNNER_WORKFLOW` | no                | default `run-agent.yml`                                     |
| `RUNNER_REF`      | no                | branch holding the workflow, default `main`                 |
| `SENTRY_DSN`      | no                | error reporting                                             |

**Runner** (Actions secrets, or `backend/.env` for the CLI): see `backend/.env.example`.

| Variable                                                  | Purpose                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                                            | runner token (Actions secret name: `AGENT_GITHUB_TOKEN`)                      |
| `LLM_MODE`                                                | `auto` (default), `local`, `deepseek`; the UI/CLI choice overrides it per run |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | DeepSeek (defaults: official URL, `deepseek-chat`)                            |
| `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`                   | any OpenAI-compatible server, e.g. `http://localhost:11434/v1`                |
| `ENVIRONMENT`                                             | required, e.g. `dev`, `staging`, `production`; sent to Sentry                 |
| `DATABASE_URL`                                            | required, Supabase pooler URL                                                 |
| `MOGO_SECRET_KEY`                                         | decrypts repo secrets (same value as the web app)                             |
| `SENTRY_DSN`, `LOG_LEVEL`                                 | observability                                                                 |
| `MAX_AGENT_STEPS`                                         | cap on agent tool-call rounds (default 25)                                    |

## Local LLM vs DeepSeek

The mode is chosen per run. `auto` probes `LOCAL_LLM_BASE_URL/models` (2 s timeout) when the run starts and uses the
local model if it answers, otherwise DeepSeek. `local` fails the run if the server is down (no silent fallback).

Any OpenAI-compatible server works (Ollama, LM Studio, vLLM, llama.cpp). The model must support tool calling;
small models are noticeably worse at it. Example with Ollama: `ollama pull qwen2.5-coder:14b`, then
`LOCAL_LLM_BASE_URL=http://localhost:11434/v1` and `LOCAL_LLM_MODEL=qwen2.5-coder:14b`.

- **CLI on your machine:** nothing else to do.
- **Runs on GitHub Actions:** the VM cannot reach your localhost. Expose the server with a tunnel
  (Tailscale, or `cloudflared tunnel --url http://localhost:11434`) and put the URL, ending in `/v1`, in the
  `LOCAL_LLM_BASE_URL` secret. When your machine or tunnel is off, `auto` falls back to DeepSeek.

## Troubleshooting

| Symptom                                         | Likely cause                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `502 dispatch failed ... 404`                   | wrong `RUNNER_REPO`, the dispatch token lacks access to it, or the workflow is not on `RUNNER_REF` |
| `502 dispatch failed ... 403`                   | dispatch token missing Actions: read and write                                                     |
| run stays `queued`                              | workflow did not start or failed early: open the Actions tab; check the secrets exist              |
| `failed: ... is not configured in any project`  | add the repo to a project in the web app                                                           |
| `failed: PR belongs to x/y, but ...`            | the feature's PR link points at another repo; fix it on the feature's edit page                    |
| `failed: PR comes from a fork`                  | enable "Allow PRs from forks" in the repo settings (only if you trust the fork)                    |
| `failed: local LLM not reachable`               | the tunnel or server is down; use `auto` or `deepseek`                                             |
| `git fetch failed`                              | runner token lacks Contents: read on that repo                                                     |
| `could not learn conventions from main`         | the branch name in the repo settings is wrong, or the runner token cannot read it; the review continues without it |
| review posted without inline comments           | those lines were outside the diff; findings are listed in the review body                          |
| `ModuleNotFoundError` / `venv` errors on Debian | `sudo apt install python3-venv`                                                                    |
| web 401 on every request                        | no `APP_PASSWORD` in production (set it, or `AUTH_DISABLED=true`), or sign in again after a change |

## Safety

- Commands from the PR (setup, tests, app, agent shell) run with a scrubbed environment: no GitHub token, no LLM keys,
  no DB URL. Only `PATH`, `HOME`, `CI` and that repo's env and secrets.
- The token reaches `git` through a one-off header and is never written to `.git/config`.
- Fork PRs are refused unless `allow_forks` is on. Only repos configured in a project are accepted, and a feature's PR
  link must belong to the repo it is listed under.
- The agent's `http_request` tool only reaches localhost; its file tools cannot leave the checkout.
- The web app sits behind `APP_PASSWORD` (HMAC session cookie). There is no login rate limit; use a long password.
  Signed-in users can edit the commands the runner executes.
- All tables have row level security enabled and the web app uses the server connection string,
  so Supabase's public API cannot read them.

## Observability

Python: JSON logs with the run id on every line; with `SENTRY_DSN` set, ERROR logs and failed runs go to Sentry tagged
`run_id`. Web: JSON logs plus `@sentry/nextjs` server instrumentation (`web/src/instrumentation.ts`).
Each run's event timeline is stored in `run_events` and shown in the UI.

## Layout

```
db/migrations/       schema, applied by python -m mogo.tools.migrate
backend/mogo/  runner (pipeline, sandbox, review), agent (loop, tools, prompts), context (project/feature for a run),
               profile/ (learn a branch: structure, types), checks/ (built-in checks), llm/provider, github/,
               tools/ (migrate, import_repos)
backend/tests/       unit + integration (fake GitHub, fake LLM, sqlite)
web/                 Next.js app router (projects, repo settings, features), API routes, password proxy, vitest tests
.github/workflows/run-agent.yml
CHANGELOG.md  LICENSE
```

## License

MIT, see [LICENSE](LICENSE).
