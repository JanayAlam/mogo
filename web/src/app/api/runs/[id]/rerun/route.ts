import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { queueRun, startProblem } from '@/lib/dispatch'
import { githubFailure } from '@/lib/github-errors'
import { fail, type IdParams, notFound } from '@/lib/http'
import { getRun } from '@/lib/runs'

/** Queues a new run with the same inputs; the old one stays in the history. */
export const POST = authed(async (user, _req, { params }: IdParams) => {
  const old = await getRun((await params).id, user.id)
  if (!old) return notFound('run')
  if (old.status === 'queued' || old.status === 'running') return fail(409, 'run is still in progress')
  let problem
  try {
    problem = await startProblem(user.id, [old.repo])
  } catch (e) {
    return githubFailure(e)
  }
  if (problem) return fail(422, problem)
  const { run, error } = await queueRun({
    feature_repo_id: old.feature_repo_id, repo: old.repo, pr_url: old.pr_url, pr_number: old.pr_number,
    feature: old.feature, dry_run: old.dry_run, created_by: user.id,
  })
  return error ? fail(502, `dispatch failed: ${error}`) : NextResponse.json(run, { status: 201 })
})
