import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface RunRow {
  id: string
  feature_repo_id: string | null
  repo: string
  pr_url: string
  pr_number: number
  feature: string
  dry_run: boolean
  status: RunStatus
  llm_used: string
  verdict: string
  review_url: string
  error: string
  created_at: string
  updated_at: string
}

export const RUN_FIELDS = {
  id: true, feature_repo_id: true, repo: true, pr_url: true, pr_number: true, feature: true, dry_run: true,
  status: true, llm_used: true, verdict: true, review_url: true, error: true, created_at: true, updated_at: true,
} satisfies Prisma.RunSelect

export const toRunRow = (r: Prisma.RunGetPayload<{ select: typeof RUN_FIELDS }>): RunRow => ({
  ...r,
  status: r.status as RunStatus,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
})

/** Runs the owner can see: those of features in their projects. */
const owned = (ownerId: string): Prisma.RunWhereInput => ({ featureRepo: { feature: { project: { owner_id: ownerId } } } })

export async function insertRun(r: {
  feature_repo_id: string | null
  repo: string
  pr_url: string
  pr_number: number
  feature: string
  dry_run: boolean
  created_by: string
}): Promise<RunRow> {
  return toRunRow(await db().run.create({ data: r, select: RUN_FIELDS }))
}

export async function listRuns(ownerId: string, limit = 50): Promise<RunRow[]> {
  const rows = await db().run.findMany({
    where: owned(ownerId), orderBy: { created_at: 'desc' }, take: Math.min(limit, 200), select: RUN_FIELDS,
  })
  return rows.map(toRunRow)
}

export async function getRun(id: string, ownerId: string) {
  const run = await db().run.findFirst({
    where: { id, ...owned(ownerId) },
    select: { ...RUN_FIELDS, result: true, events: { select: { ts: true, level: true, message: true }, orderBy: { id: 'asc' } } },
  })
  if (!run) return null
  const { result, events, ...row } = run
  return { ...toRunRow(row), result, events }
}

export async function markRunFailed(id: string, error: string): Promise<void> {
  await db().run.update({ where: { id }, data: { status: 'failed', error: error.slice(0, 2000), updated_at: new Date() } })
}

export async function getStats(
  ownerId: string,
): Promise<{ projects: number; queued: number; failed: number; done: number }> {
  const mine = owned(ownerId)
  const [projects, queued, failed, done] = await Promise.all([
    db().project.count({ where: { owner_id: ownerId } }),
    db().run.count({ where: { ...mine, status: { in: ['queued', 'running'] } } }),
    db().run.count({ where: { ...mine, OR: [{ status: 'failed' }, { verdict: 'changes_requested' }] } }),
    db().run.count({ where: { ...mine, status: 'succeeded', verdict: { not: 'changes_requested' } } }),
  ])
  return { projects, queued, failed, done }
}
