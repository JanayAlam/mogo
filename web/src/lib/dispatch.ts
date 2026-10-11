import * as Sentry from '@sentry/nextjs'

import { dispatchWorkflow } from '@/lib/github'
import { logger } from '@/lib/log'
import { insertRun, markRunFailed, type RunRow } from '@/lib/runs'

/** Stores a queued run and starts the workflow. A failed dispatch marks the run failed and returns the error. */
export async function queueRun(input: Parameters<typeof insertRun>[0]): Promise<{ run: RunRow; error?: string }> {
  const run = await insertRun(input)
  try {
    await dispatchWorkflow(run.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('dispatch failed', { run_id: run.id, error: msg })
    Sentry.captureException(e, { tags: { run_id: run.id } })
    await markRunFailed(run.id, msg)
    return { run: { ...run, status: 'failed', error: msg }, error: msg }
  }
  logger.info('run dispatched', { run_id: run.id, repo: run.repo, pr: run.pr_number })
  return { run }
}
