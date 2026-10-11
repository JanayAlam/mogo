import { NextResponse } from 'next/server'

import { dispatchWorkflow } from '@/lib/github'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { logger } from '@/lib/log'
import { insertRepo, type RepoInput } from '@/lib/projects'
import { validateRepoInput } from '@/lib/validate'

/**
 * Adds the repo, then starts learning its source branch: conventions for the checks, and suggested settings
 * (install, checks, start) for the repo page. Learning is best effort; the repo is added either way.
 */
export async function POST(req: Request, { params }: IdParams) {
  const input = validateRepoInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  let repo: { id: string } | null
  try {
    repo = await insertRepo((await params).id, input as RepoInput)
  } catch (e) {
    if (e instanceof Error && e.message === 'duplicate') return fail(409, `${input.full_name} is already in this project`)
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
}
