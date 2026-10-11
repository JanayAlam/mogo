import { NextResponse } from 'next/server'

import { queueRun } from '@/lib/dispatch'
import { getFeature } from '@/lib/features'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { validateStartInput } from '@/lib/validate'

/** Starts one run per selected repo of the feature (all of them by default). */
export async function POST(req: Request, { params }: IdParams) {
  const input = validateStartInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  const feature = await getFeature((await params).id)
  if (!feature) return notFound('feature')

  const targets = input.repo_ids ? feature.repos.filter((r) => input.repo_ids!.includes(r.repo_id)) : feature.repos
  if (targets.length === 0) return fail(422, 'none of the given repos belong to this feature')
  const busy = targets.filter((r) => r.latest_run && ['queued', 'running'].includes(r.latest_run.status))
  if (busy.length) return fail(409, `already running for ${busy.map((r) => r.full_name).join(', ')}`)

  const results = await Promise.all(
    targets.map((r) =>
      queueRun({
        feature_repo_id: r.id, repo: r.full_name, pr_url: r.pr_url, pr_number: r.pr_number,
        feature: feature.description, llm_mode: input.llm_mode, dry_run: input.dry_run,
      }),
    ),
  )
  const errors = results.filter((r) => r.error).map((r) => `${r.run.repo}: ${r.error}`)
  if (errors.length === results.length) return fail(502, `dispatch failed: ${errors.join('; ')}`)
  return NextResponse.json({ runs: results.map((r) => r.run), errors }, { status: 201 })
}
