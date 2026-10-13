import * as Sentry from '@sentry/nextjs'

import { dispatchWorkflow } from '@/lib/github'
import { installedRepos } from '@/lib/github-app'
import { activeLlmModel } from '@/lib/llm'
import { logger } from '@/lib/log'
import { setRepoInstallation } from '@/lib/projects'
import { insertRun, markRunFailed, type RunRow } from '@/lib/runs'

/** Why runs cannot start for this user, or null. Checked before anything is queued. */
export async function startProblem(userId: string, repos: string[]): Promise<string | null> {
  if (!(await activeLlmModel(userId))) return 'switch on an LLM connection first (Settings > LLM)'
  const lost = await recheckAccess(userId, repos)
  if (lost.length) return `Mogo is no longer installed on ${lost.join(', ')}, or your GitHub account lost access`
  return null
}

/**
 * Access is checked when a repo is added, and again before each run: the user may have left the org, or the App
 * may have been removed from the repo. Stores the installation that covers each repo now. Returns the lost repos.
 */
async function recheckAccess(userId: string, repos: string[]): Promise<string[]> {
  const installed = new Map((await installedRepos(userId)).map((r) => [r.full_name.toLowerCase(), r.installation_id]))
  const lost: string[] = []
  for (const name of new Set(repos)) {
    const id = installed.get(name.toLowerCase()) ?? null
    await setRepoInstallation(userId, name, id)
    if (id === null) lost.push(name)
  }
  return lost
}

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
