import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

import { dispatchWorkflow, parsePrUrl } from '@/lib/github'
import { logger } from '@/lib/log'
import { loadRepoNames } from '@/lib/repos'
import { insertRun, listRuns, markRunFailed } from '@/lib/runs'
import { validateRunInput } from '@/lib/validate'

const fail = (status: number, detail: string) => NextResponse.json({ detail }, { status })

export async function GET() {
  return NextResponse.json(await listRuns())
}

export async function POST(req: Request) {
  const input = validateRunInput(await req.json().catch(() => null))
  if (typeof input === 'string') return fail(422, input)

  const pr = parsePrUrl(input.pr_url)
  if (!pr) return fail(422, 'not a GitHub PR url')
  const repo = `${pr.owner}/${pr.repo}`
  const known = loadRepoNames()
  if (known && !known.some((n) => n.toLowerCase() === repo.toLowerCase())) {
    return fail(422, `${repo} is not in ALLOWED_REPOS (use owner/repo names)`)
  }

  const run = await insertRun({ ...input, repo, pr_number: pr.number })
  try {
    await dispatchWorkflow(run.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('dispatch failed', { run_id: run.id, error: msg })
    Sentry.captureException(e, { tags: { run_id: run.id } })
    await markRunFailed(run.id, msg)
    return fail(502, `dispatch failed: ${msg}`)
  }
  logger.info('run dispatched', { run_id: run.id, repo, pr: pr.number })
  return NextResponse.json(run, { status: 201 })
}
