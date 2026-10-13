import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { RepoReadError } from '@/lib/github-app'
import { githubFailure } from '@/lib/github-errors'
import { fail, type IdParams, notFound } from '@/lib/http'
import { getRepo } from '@/lib/projects'
import { detectRepo } from '@/lib/repo-detect'

/**
 * Read the repo's package.json, pyproject.toml, Dockerfile and the like from GitHub right now and refresh what the repo
 * page suggests from them. No runner involved: this is quick and needs no Actions token.
 */
export const POST = authed(async (user, _req, { params }: IdParams) => {
  const { id } = await params
  const repo = await getRepo(id, user.id)
  if (!repo) return notFound('repo')
  try {
    const s = await detectRepo(user.id, repo)
    return NextResponse.json({ ok: true, stack: s.stack })
  } catch (e) {
    if (e instanceof RepoReadError) return fail(404, e.message)
    return githubFailure(e)
  }
})
