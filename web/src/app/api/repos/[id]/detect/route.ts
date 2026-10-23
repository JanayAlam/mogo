import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { describeDbError } from '@/lib/db-errors'
import { GitHubAppConfigError, GitHubReauthError, RepoReadError } from '@/lib/github-app'
import { githubFailure } from '@/lib/github-errors'
import { fail, type IdParams, notFound } from '@/lib/http'
import { logger } from '@/lib/log'
import { getRepo } from '@/lib/projects'
import { detectRepo } from '@/lib/repo-detect'

/**
 * Read the repo's Dockerfile, Compose files and .env.example from GitHub right now and refresh what the repo
 * page suggests from them. No runner involved: this is quick and needs no Actions token.
 */
export const POST = authed(async (user, _req, { params }: IdParams) => {
  const { id } = await params
  const repo = await getRepo(id, user.id)
  if (!repo) return notFound('repo')
  try {
    const s = await detectRepo(user.id, repo)
    return NextResponse.json({ ok: true, dockerfile: s.dockerfile })
  } catch (e) {
    if (e instanceof RepoReadError) return fail(404, e.message)
    if (e instanceof GitHubReauthError || e instanceof GitHubAppConfigError) return githubFailure(e)
    // anything else (GitHub answered 403/5xx, the database write failed): say what happened instead of a bare 500
    const db = describeDbError(e)
    const detail = db?.detail ?? (e instanceof Error ? e.message : 'Could not read the repo from GitHub')
    logger.error('repo detect failed', { repo: repo.full_name, error: db?.log ?? (e instanceof Error ? e.message : String(e)) })
    return fail(db ? 503 : 502, detail)
  }
})
