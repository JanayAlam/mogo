import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { dispatchWorkflow } from '@/lib/github'
import { accessibleRepo } from '@/lib/github-app'
import { githubFailure } from '@/lib/github-errors'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { logger } from '@/lib/log'
import { insertRepo, type RepoInput } from '@/lib/projects'
import { validateRepoInput } from '@/lib/validate'

/**
 * Adds the repo, then starts learning its source branch: conventions for the checks, and suggested settings
 * (install, checks, start) for the repo page. Learning is best effort; the repo is added either way.
 *
 * Only repos the user reaches through an installation of the Mogo App: the review is posted as mogo[bot], so without
 * this check anyone could have Mogo review a repo where somebody else installed it.
 */
export const POST = authed(async (user, req, { params }: IdParams) => {
  const input = validateRepoInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  let access
  try {
    access = await accessibleRepo(user.id, input.full_name!)
  } catch (e) {
    return githubFailure(e)
  }
  if (!access) return fail(403, `Mogo is not installed on ${input.full_name}, or your GitHub account cannot see it`)
  const repoInput = { ...input, full_name: access.full_name } as RepoInput // GitHub's spelling of owner/repo
  let repo: { id: string } | null
  try {
    repo = await insertRepo((await params).id, user.id, repoInput, access.installation_id)
  } catch (e) {
    if (e instanceof Error && e.message === 'duplicate') return fail(409, `${access.full_name} is already in this project`)
    throw e
  }
  if (!repo) return notFound('project')
  let learning = true
  try {
    await dispatchWorkflow({ profile_repo_id: repo.id })
  } catch (e) {
    learning = false
    logger.warn('profile dispatch after add failed', { repo_id: repo.id, error: e instanceof Error ? e.message : String(e) })
  }
  return NextResponse.json({ ...repo, learning }, { status: 201 })
})
