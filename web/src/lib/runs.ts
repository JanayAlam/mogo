import { sql } from '@/lib/db'

export type LlmMode = 'auto' | 'local' | 'deepseek'

export interface RunRow {
  id: string
  repo: string
  pr_url: string
  pr_number: number
  feature: string
  llm_mode: LlmMode
  dry_run: boolean
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  llm_used: string
  verdict: string
  review_url: string
  error: string
  created_at: string
  updated_at: string
}


const COLUMNS =
  'id, repo, pr_url, pr_number, feature, llm_mode, dry_run, status, llm_used, verdict, review_url, error, created_at, updated_at'

export async function insertRun(r: {
  repo: string
  pr_url: string
  pr_number: number
  feature: string
  llm_mode: LlmMode
  dry_run: boolean
}): Promise<RunRow> {
  const db = sql()
  const [row] = await db`
    insert into runs (id, repo, pr_url, pr_number, feature, llm_mode, dry_run)
    values (${crypto.randomUUID()}, ${r.repo}, ${r.pr_url}, ${r.pr_number}, ${r.feature}, ${r.llm_mode}, ${r.dry_run})
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
  return { ...run, events }
}

export async function markRunFailed(id: string, error: string): Promise<void> {
  await sql()`update runs set status = 'failed', error = ${error.slice(0, 2000)}, updated_at = now() where id = ${id}`
}
