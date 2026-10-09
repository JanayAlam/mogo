# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `env_from` per repo: pass secrets stored in the runner repo's Actions secrets to the sandbox without committing them. The runner's own credentials are refused.
  Entries can map a variable to a differently named secret (`DATABASE_URL: ANTROTRIP_SERVER_DATABASE_URL`).
- antrotrip-server: secrets come from `ANTROTRIP_SERVER_*` and Postgres is the shared development database (no `mogo-pg`
  container). mogo no longer migrates or seeds it; `prepare` only runs `prisma generate`.
- Seed fixtures for antrotrip-server (`seeds/antrotrip-server/seed.ts`): users in every login state, businesses in every verification state,
  listings in every claim/review state, restaurant menus and two trips, with known OTPs armed in Valkey.
- Per-repo `prepare` (commands after services and before the app starts, with `$MOGO_SEEDS_DIR`) and `notes` (shown to the agent).
- `repos.yaml` filled in for the antrotrip repos (server, client, admin client).
- Optional `services_down` per repo: runs at the end of every run to stop what `services_cmd` started.

### Changed

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
