# mogo

Self-hosted agent that tests a feature on a GitHub PR and posts a code review.
You give it a PR link and a description of the expected feature. It checks out the branch in a sandbox,
runs your linters and tests, exercises the feature over HTTP, reviews the diff against the repo's conventions,
and posts a GitHub review with inline comments.

```
web/ (Next.js on Vercel)  --insert run-->  Supabase Postgres  <--progress/result--+
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

- [Configure your repos](#configure-your-repos)
- [Run locally](#run-locally)
- [Deploy](#deploy)
- [Environment variables](#environment-variables)
- [Local LLM vs DeepSeek](#local-llm-vs-deepseek)
- [Troubleshooting](#troubleshooting)
- [Safety](#safety) · [Observability](#observability) · [Layout](#layout)

## Configure your repos

Edit `repos.yaml`. One entry per repo the agent may review:

```yaml
repos:
  - name: org/backend
    setup: ["npm ci"] # install deps
    gates: ["npx tsc --noEmit", "npx eslint ."] # deterministic checks, run before the LLM
    test_cmd: "npm test --silent"
    services_cmd: "docker compose up -d db redis" # optional
    services_down: "docker compose down" # optional: always run when the run ends
    prepare: ["npx prisma migrate deploy", "npm run seed"] # optional: after services, before start (migrate, seed)
    start: "npm run dev" # optional: boots the app for feature tests
    healthcheck: "http://localhost:3000/health"
    env: { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/test" } # test values only
    conventions: ["CONVENTIONS.md", "CLAUDE.md"] # files in the target repo
    rules: ["Controllers must not contain business logic."]
    notes: "Seeded login: test@example.com / ..." # optional: shown to the agent (accounts, how to log in)
```

Without `start`, the run is review-only plus whatever the agent can verify with `test_cmd`.

Order of a run: `setup`, `gates`, then (feature given and `start` set) `services_cmd`, `prepare`, `start`, the agent, and finally `services_down`.
If a `prepare` command fails the app is not started and the agent is told why.

### Test environment variables

Commands from a PR run with a scrubbed environment (see [Safety](#safety)), so a repo only gets the variables you give it:

- `env:` in `repos.yaml`: plain test values, committed (ports, local URLs, fake secrets).
- `env_from:` in `repos.yaml`: names of variables whose **values stay out of git**. Store each as a secret in the runner repo
  (Settings, Secrets and variables, Actions, name exactly as listed). The workflow hands them to the runner
  (`MOGO_SECRETS_JSON`) and the runner forwards only the names you list. For local CLI runs, export them in your shell.
  Names not set are reported as a warning in the run log; values are never logged.

```yaml
env_from: [LLM_API_KEY, SMTP_PASSWORD]            # secret name = variable name
env_from:                                         # or: variable name in the app -> secret name
  DATABASE_URL: MYAPP_DATABASE_URL
  LLM_API_KEY: MYAPP_LLM_API_KEY
```

Use the mapping form when the app needs a name the runner already uses (`DATABASE_URL`) or when two repos need
different values for the same name: prefix the secret per repo. Secrets override `env:` values with the same name.

Use **test-only** credentials with spend limits, never production ones, because the PR's code can read them.
`env_from` refuses to read the runner's own credentials (`GITHUB_TOKEN`, `DEEPSEEK_API_KEY`, `DATABASE_URL`, ...) as secrets;
exposing a different secret under one of those names (`DATABASE_URL: MYAPP_DATABASE_URL`) is fine.
GitHub secrets are free; no extra service is needed.

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
cp ../.env.example .env           # fill ENVIRONMENT, DATABASE_URL (Supabase), GITHUB_TOKEN, DEEPSEEK_API_KEY, LOCAL_LLM_*
pytest                            # offline, no database needed

# review + test a PR; --dry-run prints/stores the result without posting to GitHub
python -m mogo.runner --pr https://github.com/org/backend/pull/12 \
  --feature "POST /orders with an empty cart returns 422 and creates no row" \
  --llm auto --dry-run
```

Drop `--dry-run` to post the review. `--llm` is `auto`, `local` or `deepseek`. The exit code is 0 on success.
Run history is stored in your Supabase database, so the CLI needs `DATABASE_URL` too.

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
`TEST_DATABASE_URL` points at a throwaway Postgres:

```bash
docker run -d --name mogo-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=t -p 54329:5432 postgres:16-alpine
psql postgresql://postgres:pw@localhost:54329/t -f db/schema.sql
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

Creating a run from the web app always dispatches the GitHub Actions workflow, so the runner repo from the
[Deploy](#deploy) section must exist first. For a fully local loop use the CLI above. Without `APP_PASSWORD`
the dev server is open (production denies everyone).

## Deploy

Three pieces: Supabase (database), a private GitHub repo (the runner), Vercel (the web app).

### 1. Supabase

1. Create a project. In the SQL editor, run `db/schema.sql`.
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
   `AGENT_GITHUB_TOKEN`, `DEEPSEEK_API_KEY`, `DATABASE_URL`;
   optional: `SENTRY_DSN`, `LOCAL_LLM_BASE_URL` (tunnel URL, see below).
   Add the variable `LOCAL_LLM_MODEL` if you use a local model.
3. `repos.yaml` is read from this repo, so commit changes to it here.

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
   | `ALLOWED_REPOS` | optional, `org/backend,org/web` |
   | `SENTRY_DSN`    | optional                        |

3. Deploy. Open the URL, sign in, submit a PR URL with **dry run** ticked, and watch the run progress.
   Check the run in the repo's Actions tab if it stays `queued`.

CLI alternative: `cd web && pnpm dlx vercel --prod` (set the same variables with `vercel env add`).

## Environment variables

**Web app** (Vercel / `web/.env.local`): see `web/.env.example`.

| Variable          | Required          | Purpose                                                     |
| ----------------- | ----------------- | ----------------------------------------------------------- |
| `APP_PASSWORD`    | yes in production | UI password; unset in production means nobody can sign in   |
| `DATABASE_URL`    | yes               | Supabase Postgres                                           |
| `GITHUB_TOKEN`    | yes               | dispatch token (Actions: read and write on the runner repo) |
| `RUNNER_REPO`     | yes               | `owner/name` of the runner repo                             |
| `RUNNER_WORKFLOW` | no                | default `run-agent.yml`                                     |
| `RUNNER_REF`      | no                | branch holding the workflow, default `main`                 |
| `ALLOWED_REPOS`   | no                | comma-separated allow-list checked before dispatch          |
| `SENTRY_DSN`      | no                | error reporting                                             |

**Runner** (Actions secrets, or `backend/.env` for the CLI): see `.env.example`.

| Variable                                                  | Purpose                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                                            | runner token (Actions secret name: `AGENT_GITHUB_TOKEN`)                      |
| `LLM_MODE`                                                | `auto` (default), `local`, `deepseek`; the UI/CLI choice overrides it per run |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | DeepSeek (defaults: official URL, `deepseek-chat`)                            |
| `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`                   | any OpenAI-compatible server, e.g. `http://localhost:11434/v1`                |
| `ENVIRONMENT`                                             | required, e.g. `dev`, `staging`, `production`; sent to Sentry                 |
| `DATABASE_URL`                                            | required, Supabase pooler URL                                                 |
| `SENTRY_DSN`, `LOG_LEVEL`                                 | observability                                                                 |
| `REPOS_FILE`                                              | path to `repos.yaml` (default `../repos.yaml`)                                |
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
| `failed: ... is not configured in repos.yaml`   | add the repo to `repos.yaml` in the runner repo and push                                           |
| `failed: PR comes from a fork`                  | set `allow_forks: true` for that repo (only if you trust the fork)                                 |
| `failed: local LLM not reachable`               | the tunnel or server is down; use `auto` or `deepseek`                                             |
| `git fetch failed`                              | runner token lacks Contents: read on that repo                                                     |
| review posted without inline comments           | those lines were outside the diff; findings are listed in the review body                          |
| `ModuleNotFoundError` / `venv` errors on Debian | `sudo apt install python3-venv`                                                                    |
| web 401 on every request                        | `APP_PASSWORD` not set in production, or sign in again after changing it                           |

## Safety

- Commands from the PR (setup, tests, app, agent shell) run with a scrubbed environment: no GitHub token, no LLM keys,
  no DB URL. Only `PATH`, `HOME`, `CI` and that repo's `env:` from `repos.yaml`.
- The token reaches `git` through a one-off header and is never written to `.git/config`.
- Fork PRs are refused unless `allow_forks: true`. Only repos in `repos.yaml` are accepted.
- The agent's `http_request` tool only reaches localhost; its file tools cannot leave the checkout.
- The web app sits behind `APP_PASSWORD` (HMAC session cookie). There is no login rate limit; use a long password.
- The `runs` tables have row level security enabled and the web app uses the server connection string,
  so Supabase's public API cannot read them.

## Observability

Python: JSON logs with the run id on every line; with `SENTRY_DSN` set, ERROR logs and failed runs go to Sentry tagged
`run_id`. Web: JSON logs plus `@sentry/nextjs` server instrumentation (`web/src/instrumentation.ts`).
Each run's event timeline is stored in `run_events` and shown in the UI.

## Layout

```
db/schema.sql        Supabase tables
repos.yaml           per-repo config (commands, conventions, rules)
backend/mogo/  runner (pipeline, sandbox, review), agent (loop, tools, prompts), llm/provider, github/
backend/tests/       unit + integration (fake GitHub, fake LLM, sqlite)
web/                 Next.js app router + shadcn/ui, API routes, password proxy, vitest tests
.github/workflows/run-agent.yml
CHANGELOG.md  LICENSE
```

## License

MIT, see [LICENSE](LICENSE).
