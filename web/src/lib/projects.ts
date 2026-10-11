import { sql } from '@/lib/db'
import type { RunStatus } from '@/lib/runs'

/** Run settings of a repo. Mirrors RepoConfig in backend/mogo/config.py (minus `name`). Never secret values. */
export interface RepoConfig {
  setup: string[]
  gates: string[]
  test_cmd: string
  services_cmd: string
  services_down: string
  prepare: string[]
  start: string
  healthcheck: string
  env: Record<string, string>
  conventions: string[]
  rules: string[]
  notes: string
  allow_forks: boolean
}

export interface RepoRow {
  id: string
  project_id: string
  full_name: string
  role: string
  default_branch: string
  config: Partial<RepoConfig>
  created_at: string
  updated_at: string
  profile: ProfileInfo | null
}

/** What the runner learned from the repo's source of truth branch (repo_profiles). */
export interface ProfileInfo {
  main_sha: string
  built_at: string
  error: string
  files: number | null
  types: number | null
  summary?: string // only from getRepo
}

export interface ProjectSummary {
  id: string
  name: string
  description: string
  created_at: string
  repos: { id: string; full_name: string; role: string }[]
  feature_count: number
  run_count: number
  latest_status: RunStatus | null
  latest_verdict: string | null
}

export interface ProjectRow {
  id: string
  name: string
  description: string
  settings: Record<string, unknown>
  created_at: string
  repos: RepoRow[]
}

const PROJECT_RUNS = `runs x join feature_repos fr on fr.id = x.feature_repo_id join features f on f.id = fr.feature_id
  where f.project_id = p.id`

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = sql()
  const rows = await db`
    select p.id, p.name, p.description, p.created_at,
      coalesce((select json_agg(json_build_object('id', r.id, 'full_name', r.full_name, 'role', r.role)
                order by r.created_at) from repos r where r.project_id = p.id), '[]') as repos,
      (select count(*)::int from features f where f.project_id = p.id) as feature_count,
      (select count(*)::int from ${db.unsafe(PROJECT_RUNS)}) as run_count,
      (select x.status from ${db.unsafe(PROJECT_RUNS)} order by x.created_at desc limit 1) as latest_status,
      (select x.verdict from ${db.unsafe(PROJECT_RUNS)} order by x.created_at desc limit 1) as latest_verdict
    from projects p order by p.created_at`
  return rows as unknown as ProjectSummary[]
}

const PROFILE_FIELDS = `'main_sha', rp.main_sha, 'built_at', rp.built_at, 'error', rp.error,
  'files', (rp.structure->>'files')::int, 'types', json_array_length(rp.type_index)`
const REPO_COLUMNS = `r.id, r.project_id, r.full_name, r.role, r.default_branch, r.config, r.created_at, r.updated_at,
  (select json_build_object(${PROFILE_FIELDS}) from repo_profiles rp where rp.repo_id = r.id) as profile`
const REPO_DETAIL_COLUMNS = `r.id, r.project_id, r.full_name, r.role, r.default_branch, r.config, r.created_at, r.updated_at,
  (select json_build_object(${PROFILE_FIELDS}, 'summary', rp.summary)
   from repo_profiles rp where rp.repo_id = r.id) as profile`

export async function getProject(id: string): Promise<ProjectRow | null> {
  const db = sql()
  const [project] = await db`select id, name, description, settings, created_at from projects where id = ${id}`
  if (!project) return null
  const repos = await db`
    select ${db.unsafe(REPO_COLUMNS)} from repos r where r.project_id = ${id} order by r.created_at`
  return { ...project, repos } as unknown as ProjectRow
}

export async function insertProject(p: { name: string; description: string }): Promise<{ id: string }> {
  const [row] = await sql()`
    insert into projects (id, name, description) values (${crypto.randomUUID()}, ${p.name}, ${p.description})
    returning id`
  return row as { id: string }
}

export async function updateProject(
  id: string,
  p: { name?: string; description?: string; settings?: Record<string, unknown> },
): Promise<boolean> {
  const db = sql()
  const rows = await db`
    update projects set
      name = coalesce(${p.name ?? null}, name),
      description = coalesce(${p.description ?? null}, description),
      settings = coalesce(${p.settings ? db.json(p.settings as never) : null}::json, settings)
    where id = ${id} returning id`
  return rows.length > 0
}

export async function deleteProject(id: string): Promise<boolean> {
  return (await sql()`delete from projects where id = ${id} returning id`).length > 0
}

export interface RepoInput {
  full_name: string
  role: string
  default_branch: string
  config: Partial<RepoConfig>
}

export async function getRepo(id: string): Promise<RepoRow | null> {
  const db = sql()
  const [row] = await db`select ${db.unsafe(REPO_DETAIL_COLUMNS)} from repos r where r.id = ${id}`
  return (row as unknown as RepoRow) ?? null
}

/** Null when the project does not exist; throws 'duplicate' when the repo is already in it. */
export async function insertRepo(projectId: string, r: RepoInput): Promise<{ id: string } | null> {
  const db = sql()
  try {
    const [row] = await db`
      insert into repos (id, project_id, full_name, role, default_branch, config)
      select ${crypto.randomUUID()}, p.id, ${r.full_name}, ${r.role}, ${r.default_branch}, ${db.json(r.config as never)}::json
      from projects p where p.id = ${projectId}
      returning id`
    return (row as { id: string }) ?? null
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new Error('duplicate')
    throw e
  }
}

export async function updateRepo(id: string, r: Partial<RepoInput>): Promise<boolean> {
  const db = sql()
  const rows = await db`
    update repos set
      role = coalesce(${r.role ?? null}, role),
      default_branch = coalesce(${r.default_branch ?? null}, default_branch),
      config = coalesce(${r.config ? db.json(r.config as never) : null}::json, config),
      updated_at = now()
    where id = ${id} returning id`
  return rows.length > 0
}

export async function deleteRepo(id: string): Promise<boolean> {
  return (await sql()`delete from repos where id = ${id} returning id`).length > 0
}
