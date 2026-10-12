import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { queueRun, startProblem } from '@/lib/dispatch'
import { getFeature } from '@/lib/features'
import { githubFailure } from '@/lib/github-errors'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { validateStartInput } from '@/lib/validate'

/** Starts one run per selected repo of the feature (all of them by default), with the user's LLM. */
export const POST = authed(async (user, req, { params }: IdParams) => {
  const input = validateStartInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  const feature = await getFeature((await params).id, user.id)
  if (!feature) return notFound('feature')

  const targets = input.repo_ids ? feature.repos.filter((r) => input.repo_ids!.includes(r.repo_id)) : feature.repos
  if (targets.length === 0) return fail(422, 'none of the given repos belong to this feature')
  const busy = targets.filter((r) => r.latest_run && ['queued', 'running'].includes(r.latest_run.status))
  if (busy.length) return fail(409, `already running for ${busy.map((r) => r.full_name).join(', ')}`)
  let problem
  try {
    problem = await startProblem(user.id, targets.map((r) => r.full_name))
  } catch (e) {
    return githubFailure(e)
  }
  if (problem) return fail(422, problem)

  const results = await Promise.all(
    targets.map((r) =>
      queueRun({
        feature_repo_id: r.id, repo: r.full_name, pr_url: r.pr_url, pr_number: r.pr_number,
        feature: feature.description, dry_run: input.dry_run, created_by: user.id,
      }),
    ),
  )
  const errors = results.filter((r) => r.error).map((r) => `${r.run.repo}: ${r.error}`)
  if (errors.length === results.length) return fail(502, `dispatch failed: ${errors.join('; ')}`)
  return NextResponse.json({ runs: results.map((r) => r.run), errors }, { status: 201 })
})
