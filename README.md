# mogo

Self-hosted agent that tests a feature across a project's GitHub PRs and posts a code review on each.
You group repos (backend, frontend, admin, ...) into a project, describe a feature and link its PR in each repo. It checks out the branch in a sandbox,
runs your linters and tests, exercises the feature over HTTP, reviews the diff against the repo's conventions,
and posts a GitHub review with inline comments.

Anyone can sign up with GitHub. Each user installs the Mogo GitHub App on the repos they want reviewed, sets up their
own LLM (any OpenAI-compatible API), and Mogo posts its reviews there as `mogo[bot]`.

```
web/ (Next.js on Vercel)  --projects, features, runs-->  Supabase Postgres  <--progress/result--+
        |                                                                         |
        +--workflow_dispatch--> GitHub Actions (run-agent.yml in the runner repo) +
                                  python -m mogo.runner <run_id>
                                  clone PR -> setup -> gates (tsc/eslint) -> boot app -> agent loop -> review
                                  repo access: Mogo GitHub App token for that repo; LLM: the project owner's
```

Vercel is serverless and cannot run the agent, so the web app only creates runs and starts the workflow.
The Python runner does the work on a free GitHub-hosted VM. The same runner also runs on your own machine
through a CLI.

## Contents

- [Projects, repos and features](#projects-repos-and-features)
- [Run locally](#run-locally)
- [Deploy](#deploy)
- [Environment variables](#environment-variables)
- [The LLM](#the-llm)
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

When a repo's page is opened, the web app reads the root files of its source of truth branch straight from GitHub
(`package.json`, the lockfile names, `tsconfig.json`, `pyproject.toml`, `requirements.txt`, `Dockerfile`, `.env.example`; no
runner and no Actions token needed) and offers what it found under **Detected on main**: checks (lint,
type check, format check), test command, start script and ready URL. **Use these** fills the empty fields; nothing is
saved until you click Save. **Re-learn now** has the runner read the whole branch (folders, type definitions, conventions).
The two detections are the same code in two languages (`web/src/lib/detect.ts`, `backend/mogo/profile/detect.py`), kept
in step by `backend/tests/data/detect_cases.json`.

Under **Type** (the first card) you say what the repo is: Node.js, Express, NestJS, Next.js, Python, FastAPI or Docker. A new
repo starts as **Docker**; what the repo looks like is detected and suggested next to the select ("Use Express"), but never
chosen for you. The type shows as a tag on the project page. The type decides
what the rest of the form asks for:

- **Node.js, Express, NestJS, Next.js** keep their commands in `package.json`, so each command has its own field with a
  dropdown of the repo's scripts (and free text): **Lint**, **Type check**, **Format check**, **Other checks**, **Test**,
  **Build**, **Before running** (start a database, migrate) and **Run**. The checks fail the review when they fail; the
  build and the steps before running happen before the app starts (with no Run command the build is a check instead).
- **Docker** has no checks and no scripts. The project is started from **Docker Compose** (the default, file
  `docker-compose.yaml`) or a **Dockerfile** (`Dockerfile`); name another file at the repo root if it is called
  something else. A Compose project is brought up with `docker compose up -d --build` under the project name `mogo-app`
  and taken down with its volumes afterwards; a Dockerfile app is built and run with its port published (the
  Dockerfile's `EXPOSE`, or the Port you enter). The repo's environment variables are passed in (Compose reads them
  from the environment; for a Dockerfile `$MOGO_DOCKER_ENV` is `-e NAME` for each). The **Ready URL** is the address the
  runner polls after starting, until the app answers (any answer counts, even a 404), before the agent tests it;
  leave it empty and the runner uses the first port the compose file publishes (a service built from the repo before a
  database), or the Port of a Dockerfile app. The runner host needs Docker with the Compose plugin (GitHub's runners
  have both). Docker is chosen, never detected.
- **Python** and **not set** use the generic Checks and Run the app form.

Another type is added in `web/src/lib/stack.ts` and `detect_stack` in `backend/mogo/profile/detect.py`.

| Section | What it is | Stored as (`repos.config`) |
| --- | --- | --- |
| **Checks** | commands run on every review after installing; any failure requests changes | `gates` |
| **Run the app** | off = review only. On: a start script (earlier lines run first, the last one starts the app) and an optional ready URL: the agent starts once it answers (any status below 500, so a frontend's home page works; empty = `http://localhost:<PORT>`) | `prepare` + `start`, `healthcheck` |
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
python -m mogo.tools.import_repos /tmp/repos.yaml --owner <your github login> --project "My product" --description "..."
```

The owner must have signed in to the web app once. Re-running it updates the same project and repos by name.

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

## Run locally

Prerequisites: Python 3.11+ (with `python3-venv`), Node 22+, Git, and optionally Docker.
You need the Mogo GitHub App ([Deploy](#2-the-mogo-github-app)) and an LLM set up in your account (web app, Settings).

### The agent (CLI, no web app needed)

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env              # backend/.env (read from any folder): ENVIRONMENT, DATABASE_URL, GITHUB_APP_*, ...
pytest                            # offline, no database needed

# the repo must be configured in a project (web app, or the importer above)

# review + test a PR; --dry-run prints/stores the result without posting to GitHub
python -m mogo.runner --pr https://github.com/org/backend/pull/12 \
  --feature "POST /orders with an empty cart returns 422 and creates no row" \
  --dry-run
```

`python -m mogo.runner --profile <repo id>` re-learns a repo's conventions from its source of truth branch.

Drop `--dry-run` to post the review. The run uses the LLM of the project's owner. The exit code is 0 on success.
Run history and repo settings are stored in your Supabase database, so the CLI needs `DATABASE_URL` too.
A CLI run has no feature record: `--feature` is the description and no sibling repos are shown to the agent.

For isolation, run it in the container (it has Git and Node for the target repos):

```bash
docker build -t mogo .
docker run --rm --env-file backend/.env mogo --pr <url> --dry-run
```

#### Backend tests

`pytest` runs fully offline (fake GitHub, fake LLM, throwaway sqlite file per test). The app itself only supports Postgres.
The web app's SQL is Postgres-specific, so its one DB test (`web/tests/db.integration.test.ts`) only runs when
`TEST_DATABASE_URL` points at a throwaway Postgres (it also covers users, sessions, and that one user cannot see
another's projects):

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
cp .env.example .env.local        # GITHUB_APP_CLIENT_ID/SECRET, DATABASE_URL, MOGO_SECRET_KEY, GITHUB_TOKEN, RUNNER_REPO ...
pnpm dev                          # http://localhost:3000
pnpm test                         # unit + route tests; set TEST_DATABASE_URL to include the Postgres test
pnpm typecheck && pnpm lint && pnpm build
```

The web app reads and writes the database through Prisma (`web/prisma/schema.prisma`, client generated into
`web/src/generated/` by `pnpm install`). The schema itself is owned by `db/migrations/*.sql`, which the runner shares:
after adding a migration, apply it (`python -m mogo.tools.migrate`) and run `pnpm db:pull` to refresh the Prisma
schema. Do not use `prisma migrate` or `prisma db push`.

Starting a check from the web app always dispatches the GitHub Actions workflow, so the runner repo from the
[Deploy](#deploy) section must exist first. For a fully local loop use the CLI above. Sign-in needs the GitHub App
with `http://localhost:3000/api/auth/github/callback` among its callback URLs.

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

### 2. The Mogo GitHub App

Users sign in with it, choose the repos Mogo may review by installing it, and reviews are posted as `<app>[bot]`.
Create it under the GitHub account (or organization) that should own Mogo: Settings, Developer settings,
GitHub Apps, **New GitHub App**.

| Field                                                  | Value                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| GitHub App name                                        | e.g. `Mogo`; becomes the slug (`github.com/apps/<slug>`) and the bot's name |
| Homepage URL                                           | your Vercel URL                                                             |
| Callback URL                                           | `https://<your app>/api/auth/github/callback`; add `http://localhost:3000/api/auth/github/callback` for local dev |
| Expire user authorization tokens                       | on                                                                          |
| Request user authorization (OAuth) during installation | on (installing also signs the user in)                                      |
| Enable Device Flow                                     | off                                                                         |
| Setup URL                                              | leave empty; tick **Redirect on update**                                    |
| Webhook                                                | active, URL `https://<your app>/api/github/webhook`, secret `openssl rand -hex 32` |
| Repository permissions                                 | Contents: **Read-only**, Pull requests: **Read and write**, Metadata: Read-only (required) |
| Account permissions                                    | none needed (Email addresses: Read-only if you want users' private emails)  |
| Subscribe to events                                    | none (installation events are always sent)                                  |
| Where can this GitHub App be installed?                | **Any account**                                                             |

After creating it, on the App's page:

1. Note the **App ID**, the **Client ID** and the slug.
2. **Generate a new client secret**: `GITHUB_APP_CLIENT_SECRET` on Vercel.
3. **Generate a private key** (a `.pem` download): `MOGO_APP_PRIVATE_KEY` in the runner repo. Only the runner holds it.
4. Optional: upload a logo; it is the avatar on every review.

One more token starts the runner: a fine-grained personal access token with **Actions: read and write** on the runner
repo only, as `GITHUB_TOKEN` on Vercel.

### 3. Runner repo (GitHub Actions)

1. Create a **private** repo (e.g. `you/mogo`) and push this project to its `main` branch.
   The workflow file must exist on the branch named in `RUNNER_REF`.
2. Repo Settings, Secrets and variables, Actions. Add secrets:
   `MOGO_APP_ID` (the App ID), `MOGO_APP_PRIVATE_KEY` (the whole `.pem` file), `DATABASE_URL`, `MOGO_SECRET_KEY`
   (same value as on Vercel); optional: `SENTRY_DSN`. Add the variable `MOGO_APP_SLUG` for "install Mogo" links in
   run errors. Actions names cannot start with `GITHUB_`, hence `MOGO_APP_*`.
3. Repo settings live in the database and are edited in the web app; this repo only holds the code and workflow.

Private repos get 2,000 free Actions minutes a month. Review-only runs take a couple of minutes;
runs that boot the app take longer. The job has a 25 minute timeout.

### 4. Vercel (web app)

1. Import the runner repo into Vercel. Set **Root Directory** to `web`. Next.js and pnpm are detected automatically (`pnpm-lock.yaml`).
2. Add environment variables (Production, and Preview if you use it):

   | Variable                   | Value                                                     |
   | -------------------------- | --------------------------------------------------------- |
   | `GITHUB_APP_CLIENT_ID`     | the App's Client ID                                       |
   | `GITHUB_APP_CLIENT_SECRET` | the App's client secret                                   |
   | `GITHUB_APP_SLUG`          | the App's slug                                            |
   | `GITHUB_WEBHOOK_SECRET`    | the App's webhook secret                                  |
   | `DATABASE_URL`             | Supabase pooler string                                    |
   | `MOGO_SECRET_KEY`          | `openssl rand -base64 32`, same as the runner repo secret |
   | `GITHUB_TOKEN`             | the dispatch token                                        |
   | `RUNNER_REPO`              | `you/mogo`                                                |
   | `SENTRY_DSN`               | optional                                                  |

3. Deploy. Open the URL, **Continue with GitHub** (this creates your user), set your LLM under Settings, create a
   project, add repos (the picker lists repos where the App is installed; "Install Mogo on more repos" adds some),
   create a feature, then **Check all repos** with **dry run** ticked and watch the runs progress.
   Check the run in the repo's Actions tab if it stays `queued`.

CLI alternative: `cd web && pnpm dlx vercel --prod` (set the same variables with `vercel env add`).

## Environment variables

**Web app** (Vercel / `web/.env.local`): see `web/.env.example`.

| Variable                   | Required | Purpose                                                          |
| -------------------------- | -------- | ---------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`     | yes      | sign-in with the Mogo GitHub App                                 |
| `GITHUB_APP_CLIENT_SECRET` | yes      | sign-in with the Mogo GitHub App                                 |
| `GITHUB_APP_SLUG`          | yes      | `github.com/apps/<slug>`: install links                          |
| `GITHUB_WEBHOOK_SECRET`    | yes      | checks the App's webhook deliveries                              |
| `MOGO_SECRET_KEY`          | yes      | encrypts users' GitHub tokens and LLM keys, and repo secrets; the runner needs the same value |
| `DATABASE_URL`             | yes      | Supabase Postgres                                                |
| `GITHUB_TOKEN`             | yes      | dispatch token (Actions: read and write on the runner repo)      |
| `RUNNER_REPO`              | yes      | `owner/name` of the runner repo                                  |
| `RUNNER_WORKFLOW`          | no       | default `run-agent.yml`                                          |
| `RUNNER_REF`               | no       | branch holding the workflow, default `main`                      |
| `SENTRY_DSN`               | no       | error reporting                                                  |

**Runner** (Actions secrets, or `backend/.env` for the CLI): see `backend/.env.example`.

| Variable                                       | Purpose                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`      | the Mogo App (Actions secrets `MOGO_APP_ID`, `MOGO_APP_PRIVATE_KEY`)      |
| `GITHUB_APP_SLUG`                              | optional, for install links in errors (Actions variable `MOGO_APP_SLUG`) |
| `ENVIRONMENT`                                  | required, e.g. `dev`, `staging`, `production`; sent to Sentry            |
| `DATABASE_URL`                                 | required, Supabase pooler URL                                            |
| `MOGO_SECRET_KEY`                              | decrypts repo secrets and LLM keys (same value as the web app)           |
| `SENTRY_DSN`, `LOG_LEVEL`                      | observability                                                            |
| `MAX_AGENT_STEPS`                              | cap on agent tool-call rounds (default 25)                               |

## The LLM

Each user adds their own LLM connections under **Settings > LLM connections**: OpenAI, Claude, DeepSeek, OpenRouter,
or **Local / Custom** (any OpenAI-compatible server). A connection has a model and an API key (stored encrypted,
never shown again; optional for local servers) and an on/off switch. The switched-on connections form a fallback
chain in the order of the cards (drag a card by its handle to reorder; the first is "primary"). A run of a project
uses its owner's chain: it reviews with the first connection, and when that one fails (unreachable, key or model
rejected, rate limited, or the model never submits a report) it starts the review again with the next. When every
connection fails the run fails and lists each reason. Usage is billed to the owner. The model must support tool calling.

Adding or editing a connection is checked with the provider first (`GET <base url>/models`): the key format, that the
key is accepted, that the model exists, and for custom servers that the address is public https. The **Test** button
on a card repeats the check. Hosted providers have a fixed base URL, so a key can only be sent to its own provider.

A local server (Ollama, LM Studio, vLLM, llama.cpp) works too, but runs execute on GitHub Actions, which cannot reach
your localhost: expose it with a tunnel and use that https address, ending in `/v1`, as the base URL. The Local /
Custom card shows the steps:

```
ollama serve
cloudflared tunnel --url http://localhost:11434          # or: ngrok http 11434 --host-header=localhost:11434
```

## Troubleshooting

| Symptom                                         | Likely cause                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `502 dispatch failed ... 404`                   | wrong `RUNNER_REPO`, the dispatch token lacks access to it, or the workflow is not on `RUNNER_REF` |
| `502 dispatch failed ... 403`                   | dispatch token missing Actions: read and write                                                     |
| run stays `queued`                              | workflow did not start or failed early: open the Actions tab; check the secrets exist              |
| `failed: ... is not configured in any project`  | add the repo to a project in the web app                                                           |
| `failed: PR belongs to x/y, but ...`            | the feature's PR link points at another repo; fix it on the feature's edit page                    |
| `failed: PR comes from a fork`                  | enable "Allow PRs from forks" in the repo settings (only if you trust the fork)                    |
| `failed: ... has no LLM switched on`            | the project owner has no switched-on connection under Settings > LLM connections                   |
| `failed: every LLM failed. ...`                 | each connection in the chain failed; the message gives the reason for each                         |
| LLM errors (401, 404 model)                     | wrong API key, base URL or model id under Settings                                                 |
| `Mogo is not installed on x/y`                  | install the App on that repo (repo page, or Settings, Choose repos for Mogo)                       |
| `GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set` | the `MOGO_APP_ID` / `MOGO_APP_PRIVATE_KEY` Actions secrets are missing                     |
| `could not learn conventions from main`         | the branch name in the repo settings is wrong; the review continues without it                     |
| sign-in fails with `redirect_uri` mismatch      | add `https://<this URL>/api/auth/github/callback` to the App's callback URLs                       |
| review posted without inline comments           | those lines were outside the diff; findings are listed in the review body                          |
| `ModuleNotFoundError` / `venv` errors on Debian | `sudo apt install python3-venv`                                                                    |
| `422 ... no longer installed ... or your GitHub account lost access` | the App was removed from the repo, or you lost access to it on GitHub        |

## Safety

- Commands from the PR (setup, tests, app, agent shell) run with a scrubbed environment: no GitHub token, no LLM keys,
  no DB URL. Only `PATH`, `HOME`, `CI` and that repo's env and secrets. They do run as the same OS user as the runner,
  so this is not isolation against a hostile repo: see the note below before opening sign-up to strangers.
- Each run gets an installation token for that one repo (Contents: read, Pull requests: write), valid one hour. It
  reaches `git` through a one-off header and is never written to `.git/config`. The App's private key stays in the
  runner and never reaches the web app.
- A user can add only repos their own GitHub account reaches through an installation of the App, checked again before
  every run. Otherwise anyone could have `mogo[bot]` review a repo where somebody else installed it.
- Fork PRs are refused unless `allow_forks` is on. Only repos configured in a project are accepted, and a feature's PR
  link must belong to the repo it is listed under.
- The agent's `http_request` tool only reaches localhost; its file tools cannot leave the checkout.
- Sign-in is GitHub only. Sessions are random tokens (only their sha256 is stored), 30 days, httpOnly cookie; the OAuth
  round trip carries a `state` checked against a cookie. Every API route checks the session and returns 404 for other
  users' projects, repos, features and runs.
- Users' GitHub tokens and LLM keys are AES-256-GCM encrypted with `MOGO_SECRET_KEY`, bound to the user.
- Signed-in users choose the commands the runner executes for their repos, and those commands run on the shared runner
  next to its secrets (`DATABASE_URL`, `MOGO_SECRET_KEY`, the App's private key). Until the sandbox runs them as another
  OS user or in a container, only let people you trust sign up.
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
web/                 Next.js app router (projects, repo settings, features, settings), API routes, GitHub sign-in,
                     Prisma client (prisma/schema.prisma mirrors db/migrations), vitest tests
.github/workflows/run-agent.yml
CHANGELOG.md  LICENSE
```

## License

MIT, see [LICENSE](LICENSE).
