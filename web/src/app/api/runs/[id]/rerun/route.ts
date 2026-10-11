import { NextResponse } from 'next/server'

import { queueRun } from '@/lib/dispatch'
import { fail, type IdParams, notFound } from '@/lib/http'
import { getRun } from '@/lib/runs'

/** Queues a new run with the same inputs; the old one stays in the history. */
export async function POST(_req: Request, { params }: IdParams) {
  const old = await getRun((await params).id)
  if (!old) return notFound('run')
  if (old.status === 'queued' || old.status === 'running') return fail(409, 'run is still in progress')
  const { run, error } = await queueRun({
    feature_repo_id: old.feature_repo_id, repo: old.repo, pr_url: old.pr_url, pr_number: old.pr_number,
    feature: old.feature, llm_mode: old.llm_mode, dry_run: old.dry_run,
  })
  return error ? fail(502, `dispatch failed: ${error}`) : NextResponse.json(run, { status: 201 })
}
