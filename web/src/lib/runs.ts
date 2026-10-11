import { sql } from '@/lib/db'

export type LlmMode = 'auto' | 'local' | 'deepseek'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface RunRow {
  id: string
  feature_repo_id: string | null
  repo: string
  pr_url: string
  pr_number: number
  feature: string
  llm_mode: LlmMode
  dry_run: boolean
  status: RunStatus
  llm_used: string
  verdict: string
  review_url: string
  error: string
  created_at: string
  updated_at: string
}

const COLUMNS =
  'id, feature_repo_id, repo, pr_url, pr_number, feature, llm_mode, dry_run, status, llm_used, verdict, review_url, error, created_at, updated_at'

export async function insertRun(r: {
  feature_repo_id: string | null
  repo: string
  pr_url: string
  pr_number: number
  feature: string
  llm_mode: LlmMode
  dry_run: boolean
}): Promise<RunRow> {
  const db = sql()
  const [row] = await db`
    insert into runs (id, feature_repo_id, repo, pr_url, pr_number, feature, llm_mode, dry_run)
    values (${crypto.randomUUID()}, ${r.feature_repo_id}, ${r.repo}, ${r.pr_url}, ${r.pr_number}, ${r.feature}, ${r.llm_mode}, ${r.dry_run})
    returning ${db.unsafe(COLUMNS)}`
  return row as unknown as RunRow
}

export async function listRuns(limit = 50): Promise<RunRow[]> {
  const db = sql()
  const rows = await db`select ${db.unsafe(COLUMNS)} from runs order by created_at desc limit ${Math.min(limit, 200)}`
  return rows as unknown as RunRow[]
}

export async function getRun(id: string) {
  const db = sql()
  const [run] = await db`select ${db.unsafe(COLUMNS)}, result from runs where id = ${id}`
  if (!run) return null
  const events = await db`select ts, level, message from run_events where run_id = ${id} order by id`
  return { ...(run as unknown as RunRow & { result: unknown }), events }
}

export async function markRunFailed(id: string, error: string): Promise<void> {
  await sql()`update runs set status = 'failed', error = ${error.slice(0, 2000)}, updated_at = now() where id = ${id}`
}

export async function getStats(): Promise<{ projects: number; queued: number; failed: number; done: number }> {
  const [row] = await sql()`
    select (select count(*)::int from projects) as projects,
      count(*) filter (where status in ('queued', 'running'))::int as queued,
      count(*) filter (where status = 'failed' or verdict = 'changes_requested')::int as failed,
      count(*) filter (where status = 'succeeded' and verdict <> 'changes_requested')::int as done
    from runs where feature_repo_id is not null`
  return row as never
}
