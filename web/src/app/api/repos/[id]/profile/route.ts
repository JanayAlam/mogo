import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { dispatchWorkflow } from '@/lib/github'
import { fail, type IdParams, notFound } from '@/lib/http'
import { logger } from '@/lib/log'
import { getRepo } from '@/lib/projects'

/** Re-learn the repo's conventions from its source of truth branch (runs as a workflow job). */
export const POST = authed(async (user, _req, { params }: IdParams) => {
  const repo = await getRepo((await params).id, user.id)
  if (!repo) return notFound('repo')
  try {
    await dispatchWorkflow({ profile_repo_id: repo.id })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('profile dispatch failed', { repo_id: repo.id, error: msg })
    Sentry.captureException(e, { tags: { repo_id: repo.id } })
    return fail(502, `dispatch failed: ${msg}`)
  }
  logger.info('profile rebuild dispatched', { repo_id: repo.id, repo: repo.full_name })
  return NextResponse.json({ ok: true }, { status: 202 })
})
