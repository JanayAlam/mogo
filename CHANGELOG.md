# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Users: sign in with GitHub through the Mogo GitHub App; the first sign-in creates the user (`users`, `sessions`,
  migration 005). Each project belongs to one user, and every API route only sees the signed-in user's projects,
  repos, features and runs.
- Reviews are posted by the GitHub App (`mogo[bot]`) with an installation token per run, scoped to the one repo
  (Contents: read, Pull requests: write). The repo picker lists repos of installations the user can access; access
  is checked again before each run, and the App's webhook marks repos it no longer covers.
- Each user adds their own LLM connections under Settings (`llm_connections`, migration 006): OpenAI, Claude, DeepSeek,
  OpenRouter or Local / Custom (any OpenAI-compatible server, with tunnel steps for Cloudflare and ngrok). Keys are
  stored encrypted (write-only), checked with the provider when saved, and a connection can be tested, switched on or
  off, edited and deleted. The LLM that users had under the old single setting becomes their first connection.
- Add repository: the repo is picked from a select of the repos the Mogo App can see (those already in the project are left out) instead of typed. With none left it says "No repo available"; when the App is installed nowhere (or GitHub access expired) it opens a Connect GitHub dialog. Connecting GitHub (or installing Mogo on more repos) opens GitHub in a popup, so the page and the dialog stay put; the dialog refreshes when the popup finishes (`/github/connected`, BroadcastChannel), and a blocked popup falls back to the full-page redirect. The dialog opens at once: a zustand store remembers whether GitHub is connected and the repo list, learned when the project page loads and refreshed whenever the dialog opens. `GET /api/github/repos` now returns `{connected, repos}`.
- Type per repo (repo `config.stack`, one pick): Node.js (raw), Express, NestJS, Next.js, Python (raw), FastAPI or Docker,
  listed in `web/src/lib/stack.ts`. The runner and the web app detect it from `package.json`, `pyproject.toml` and
  `requirements.txt`; it can be changed in the repo
  settings (Type, the first card) and shows as a tag on the project page. A new repo starts as Docker Compose (`docker-compose.yaml`, the card is titled "Run the project"); the detected type is only suggested next to the select ("Use Express"), never set by detection, in the web app or the runner. The type decides what the rest of the form asks for:
  - Node.js, Express, NestJS, Next.js: one field per command, each a free-text input with a dropdown of the repo's
    package.json scripts (the likely ones first): Lint, Type check, Format check, Other checks, Test, Build, Before
    running, Run. The checks are the review's checks, the build and the steps before running happen before the app
    starts. Saved as `config.scripts` and compiled into `gates`, `test_cmd`, `prepare`, `start`.
  - Docker: no checks and no scripts. Run with Docker Compose (the default, `docker-compose.yaml`) or a Dockerfile
    (`Dockerfile`, published on its port, the Dockerfile's `EXPOSE` by default), each with an optional other file name at
    the repo root; the repo page lists the files it found and, when the one it needs is missing, offers the other file or
    kind. The repo's variables are passed in (`$MOGO_DOCKER_ENV` is `-e NAME` for each), a Compose project is named
    `mogo-app` so a run removes exactly what it started, and a run without the file reports "NOT started" instead of
    failing. The ready URL (the address the runner polls until the app answers) is optional: for Compose the runner asks
    `docker compose config` for the first port the app publishes (a service built from the repo before a database), so
    a repo needs no per-repo setup. Saved as `docker_mode`, `docker_file`, `docker_port` and compiled into `prepare`,
    `start`, `services_down`.
  - Python and not set: the generic Checks and Run the app form.
  The profile now also suggests each field (`fields`), the package.json scripts (`scripts`) and the Docker files at
  the root (`dockerfiles`, `compose_files`). Migration 008 converts the first version of this setting (language and
  frameworks).
- The web app reads a repo's package.json, pyproject.toml, requirements.txt, Dockerfile and root file list itself,
  straight from GitHub with the user's access (`POST /api/repos/:id/detect`), with no runner and no Actions token: the
  type, scripts, Docker files and suggestions appear at once. The repo page does it by itself the first time it opens
  a repo whose profile has no script list, and the empty script dropdowns offer "Read from GitHub now". The detection is
  ported to TypeScript (`web/src/lib/detect.ts`); it and the runner's (`backend/mogo/profile/detect.py`) are checked
  against the same repos in `backend/tests/data/detect_cases.json`. The runner is still what learns folders, types and
  conventions (Re-learn now) and runs the reviews.
- The repo settings form is rebuilt from the saved settings whenever they changed since the page was last shown (pages stay
  mounted while you are elsewhere, and a form kept the state it was first built with).
- The repo's stop command now runs after any start script, not only after `services_cmd`, and from the repo's folder
  (a compose file named with a relative path is only found there).
- LLM fallback (`llm_connections.position`, migration 007): the switched-on connections are an ordered chain, set by
  dragging the cards in Settings. A run reviews with the first one and, when it fails, starts over with the next; when
  all fail the run fails with each reason. Only LLM failures fall back (API errors, timeouts, a model that never
  submits a report), and the retries inside one client are reduced to one while there is a fallback.

- Projects: group repos into a project, give each repo a free-text role (`backend`, `frontend`, `admin-frontend`, ...)
  and a source of truth branch. Repo settings (commands, env, conventions, notes) are edited in the web app
  and stored in Postgres (`projects`, `repos`, `repo_profiles`, `features`, `feature_repos`; `db/migrations/002_projects.sql`).
- Features: a description plus one PR and optional requirements per repo. One run per repo, started together or one by one.
  The agent sees the project description, the repo's role, its requirements, and the feature's other repos.
- Per-repo secrets in the web app (`repo_secrets`, migration 003): encrypted with AES-256-GCM (`MOGO_SECRET_KEY`, shared by
  the web app and the runner), bound to repo and name, write-only in the UI. They override `env`. The
  runner masks secret values in the run log, stored result, posted review, and everything sent to the LLM.
- Import a .env file into a repo's secrets (repo page): existing names replaced, new names added, others kept, with a
  names-only preview. `POST /api/repos/:id/secrets` with `{content}`.
- `DATABASE_URL` may contain a raw `@` in the password and Prisma-only options (`connection_limit`, `pgbouncer`, ...);
  both apps normalise it.
- `python -m mogo.tools.migrate` applies `db/migrations/*.sql` once each (tracked in `schema_migrations`, `--status`
  to list). `db/schema.sql` is replaced by `001_initial.sql`; the runner refuses to start while a migration is pending,
  and no longer creates tables itself on Postgres (that skipped row level security).
- `python -m mogo.tools.import_repos FILE --project NAME` copies settings in the old repos.yaml format into a project.
- Built-in checks on every review, switchable per project: `no-duplicate-types` (within one repo and language) and
  `structure-convention` (file names, role suffixes, test placement, new top-level folders). Candidates come from a
  repo profile learned from the source of truth branch (cached per commit in `repo_profiles`); the agent confirms them
  and reports a pass/fail per check (`checks` in the report, a "Built-in checks" section in the review).
- "Re-learn now" on the repo page and `python -m mogo.runner --profile <repo id>`; the workflow takes `profile_repo_id`.
- Web app redesigned after the Lovable "PR Genius Dashboard" design: projects dashboard, project page, repo settings,
  feature form and feature page with criteria, findings, gates and the live log.
- The web app uses the Lovable design system: its shadcn (new-york, Radix) components and theme tokens, with Poppins as
  the sans font. Confirm dialogs replace browser prompts; toasts report saves, imports and started runs.
- "Log out" in the header when the deployment has a login (`APP_PASSWORD`); nothing is shown otherwise.
- Top loading bar on navigation, skeleton placeholders while pages load, pointer cursor on everything clickable.
- One environment variable list per repo (migration 004: `repo_secrets` becomes `repo_env` with a `sensitive` flag;
  the plain `env` values of repo settings move into it). Plain values are viewable and editable, sensitive ones
  encrypted and write-only; a plain variable can turn sensitive in place, the reverse needs a new value. The .env
  import marks names that look like credentials as sensitive.
- Repo settings detected from the source branch (package.json, lockfile, tsconfig.json, pyproject.toml,
  .env.example) when a repo is added or re-learned, offered as "Detected on main" with "Use these".
- Simpler repo form: Checks, Run the app (start script + ready URL), Agent notes, and a collapsed Advanced section.
- "App URL" is now "Ready URL" and optional: any answer counts (a frontend's home page works); empty waits for
  `http://localhost:<PORT>` using the repo's PORT variable, else 3000.
- Repo page: one save bar at the bottom instead of two Save buttons, shown only with unsaved changes (Discard, Save,
  Ctrl/⌘+S; leaving the page asks first). Validation errors show in the bar.
- Badges render as `<span>`: a `<div>` inside text caused a hydration error on the project page.
  Without an install override the runner installs from the lockfile.
- `Button` takes `loading`: a spinner replaces its icon and it is disabled. Used for every action button; only the
  button that started an action spins.
- Create dialogs (project, repo) and the new-feature form clear themselves after creating; previously the dialog
  reappeared with the old values after navigating back.
- `AUTH_DISABLED=true` opens a production deployment that has no `APP_PASSWORD`.
- antrotrip-server: Postgres is the shared development database (no `mogo-pg`
  container). mogo no longer migrates or seeds it; `prepare` only runs `prisma generate`.
- Seed fixtures for antrotrip-server (`seeds/antrotrip-server/seed.ts`): users in every login state, businesses in every verification state,
  listings in every claim/review state, restaurant menus and two trips, with known OTPs armed in Valkey.
- Per-repo `prepare` (commands after services and before the app starts, with `$MOGO_SEEDS_DIR`) and `notes` (shown to the agent).
- `repos.yaml` filled in for the antrotrip repos (server, client, admin client).
- Optional `services_down` per repo: runs at the end of every run to stop what `services_cmd` started.

### Changed

- **Breaking:** migration 005 deletes all existing projects, repos, features and runs (they had no owner).
- **Breaking:** `APP_PASSWORD`, `AUTH_DISABLED`, `/api/login` and `/api/logout` are removed (now `/api/auth/*`).
  The runner's `AGENT_GITHUB_TOKEN` is replaced by the Actions secrets `MOGO_APP_ID` and `MOGO_APP_PRIVATE_KEY`.
  `LLM_MODE`, `DEEPSEEK_*`, `LOCAL_LLM_*`, the per-run LLM choice (`runs.llm_mode`) and the CLI's `--llm` are gone.
- `python -m mogo.tools.import_repos` needs `--owner <github login>`.
- Removed the Antrotrip seed fixtures (`seeds/`) and `$MOGO_SEEDS_DIR`: Mogo ships no project-specific data. A repo that
  needs fixtures keeps them in its own tree and runs them from `prepare`.
- The web app uses Prisma 7 (driver adapter `@prisma/adapter-pg`) instead of postgres.js. `db/migrations` stays the
  source of truth; `web/prisma/schema.prisma` is pulled from it (`pnpm db:pull`).
- The runner reads repo settings from the database; `repos.yaml` (removed), `REPOS_FILE` and the web `ALLOWED_REPOS` allow-list are gone.
  `POST /api/runs` is replaced by `POST /api/features/:id/runs` and `POST /api/runs/:id/rerun`.
- A repo's environment comes only from its settings (env and secrets). `env_from` is removed and the workflow no longer
  hands the runner every Actions secret (`MOGO_SECRETS_JSON`): runner secrets are for the runner. Runs and the repo page
  list leftover `env_from` names to re-enter as secrets.
- Agent loop accepts tool calls that local models write as JSON text (`{"name": ..., "arguments": ...}`, fenced or in
  `<tool_call>`), and nudges up to 3 times before failing; the failure now quotes the model's last reply.
- Run log shows the output of failing gates and the app's output when it does not become healthy.
- antrotrip-server: Valkey image pinned to `valkey/valkey:8`, pulled with retries.

- Convention files are read up to 20,000 characters each (was 6,000), so long `CLAUDE.md` files are not cut off.
- Web app uses pnpm (pinned via `packageManager`) instead of npm.
- Fixed the Python package name (`mogo-server`); a scoped npm-style name is invalid for pip.
- `/api/repos` reads its env at request time (Cache Components would otherwise prerender it).
- Supabase Postgres only: removed the sqlite fallback. `DATABASE_URL` and `ENVIRONMENT` are now required settings with no defaults.
- Backend tests use a throwaway sqlite file (test fixtures only), so they run offline.

## [0.1.0] - 2026-10-09

First version.

### Added

- Python runner (`python -m mogo.runner`): checks out a PR, runs setup and lint/type gates, optionally boots the
  target app, runs a tool-calling agent, and posts a GitHub review with inline comments and a summary.
  Runs by run id (GitHub Actions) or creates one from `--pr` (local CLI, `--dry-run` supported).
- LLM selection: local OpenAI-compatible server when reachable, otherwise DeepSeek (`auto`), or force one per run.
- Agent tools: read file, search, sandboxed shell, localhost-only HTTP, and a validated `submit_report`.
- Diff-to-line mapping so inline comments only land on lines GitHub accepts; fallback to a summary-only review.
- Multi-repo configuration in `repos.yaml` (setup, gates, services, start command, conventions, extra rules).
- Next.js (App Router) web app with shadcn/ui for Vercel: submit a PR and feature, pick the LLM mode, follow run progress.
  API routes store runs in Supabase and dispatch the GitHub Actions workflow.
- Password gate for the web app (HMAC session cookie, fails closed in production).
- Supabase schema (`db/schema.sql`) with row level security enabled.
- GitHub Actions workflow `run-agent.yml` as the free sandbox.
- JSON logging with run ids and Sentry integration (Python and Next.js server side).
- Tests: Python (unit and pipeline integration with fake GitHub/LLM) and 20 web (auth, proxy, routes, optional
  Postgres integration test).
- Dockerfile for isolated local runs.

### Security

- Untrusted PR commands run with a scrubbed environment; fork PRs refused by default; the agent HTTP tool is
  restricted to localhost and file tools to the checkout.
