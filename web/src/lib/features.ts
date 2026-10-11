import type postgres from 'postgres'

import { sql } from '@/lib/db'
import { parsePrUrl } from '@/lib/github'
import type { RunRow } from '@/lib/runs'
import { featureState, type ReviewState } from '@/lib/status'

export interface FeatureRepoRow {
  id: string
  feature_id: string
  repo_id: string
  full_name: string
  role: string
  pr_url: string
  pr_number: number
  requirements: string
  latest_run: RunRow | null
}

export interface FeatureRow {
  id: string
  project_id: string
  title: string
  description: string
  created_at: string
  updated_at: string
  repos: FeatureRepoRow[]
  state: ReviewState
}

export interface FeatureRepoInput {
  repo_id: string
  pr_url: string
  requirements: string
}

export interface FeatureInput {
  title: string
  description: string
  repos: FeatureRepoInput[]
}

/** Bad input that only the database can detect (repo not in the project, PR of another repo). */
export class FeatureInputError extends Error {}

const RUN_COLUMNS = `x.id, x.feature_repo_id, x.repo, x.pr_url, x.pr_number, x.feature, x.llm_mode, x.dry_run, x.status,
  x.llm_used, x.verdict, x.review_url, x.error, x.created_at, x.updated_at`

async function featureRepos(db: postgres.Sql, featureIds: string[]): Promise<FeatureRepoRow[]> {
  if (featureIds.length === 0) return []
  const rows = await db`
    select fr.id, fr.feature_id, fr.repo_id, r.full_name, r.role, fr.pr_url, fr.pr_number, fr.requirements,
      (select row_to_json(l) from (select ${db.unsafe(RUN_COLUMNS)} from runs x where x.feature_repo_id = fr.id
        order by x.created_at desc limit 1) l) as latest_run
    from feature_repos fr join repos r on r.id = fr.repo_id
    where fr.feature_id in ${db(featureIds)}
    order by r.created_at`
  return rows as unknown as FeatureRepoRow[]
}

function assemble(features: Omit<FeatureRow, 'repos' | 'state'>[], repos: FeatureRepoRow[]): FeatureRow[] {
  return features.map((f) => {
    const mine = repos.filter((r) => r.feature_id === f.id)
    return { ...f, repos: mine, state: featureState(mine.map((r) => r.latest_run)) }
  })
}

export async function listFeatures(projectId: string): Promise<FeatureRow[]> {
  const db = sql()
  const features = await db`
    select id, project_id, title, description, created_at, updated_at from features
    where project_id = ${projectId} order by created_at desc`
  const rows = features as unknown as Omit<FeatureRow, 'repos' | 'state'>[]
  return assemble(rows, await featureRepos(db, rows.map((f) => f.id)))
}

export async function getFeature(id: string): Promise<FeatureRow | null> {
  const db = sql()
  const [f] = await db`select id, project_id, title, description, created_at, updated_at from features where id = ${id}`
  if (!f) return null
  return assemble([f as never], await featureRepos(db, [id]))[0]
}

/** Checks every entry against the project's repos; returns rows ready to store. */
async function resolveRepos(db: postgres.Sql, projectId: string, input: FeatureRepoInput[]) {
  const repos = (await db`select id, full_name from repos where project_id = ${projectId}`) as unknown as {
    id: string
    full_name: string
  }[]
  return input.map((e) => {
    const repo = repos.find((r) => r.id === e.repo_id)
    if (!repo) throw new FeatureInputError(`repo ${e.repo_id} is not part of this project`)
    const pr = parsePrUrl(e.pr_url)
    if (!pr) throw new FeatureInputError(`not a GitHub PR url: ${e.pr_url}`)
    if (`${pr.owner}/${pr.repo}`.toLowerCase() !== repo.full_name.toLowerCase()) {
      throw new FeatureInputError(`${e.pr_url} is a PR of ${pr.owner}/${pr.repo}, not ${repo.full_name}`)
    }
    return { ...e, pr_number: pr.number }
  })
}

/** Null when the project does not exist. */
export async function insertFeature(projectId: string, input: FeatureInput): Promise<{ id: string } | null> {
  return sql().begin(async (tx) => {
    const [project] = await tx`select id from projects where id = ${projectId}`
    if (!project) return null
    const repos = await resolveRepos(tx as unknown as postgres.Sql, projectId, input.repos)
    const id = crypto.randomUUID()
    await tx`insert into features (id, project_id, title, description)
      values (${id}, ${projectId}, ${input.title}, ${input.description})`
    for (const r of repos) {
      await tx`insert into feature_repos (id, feature_id, repo_id, pr_url, pr_number, requirements)
        values (${crypto.randomUUID()}, ${id}, ${r.repo_id}, ${r.pr_url}, ${r.pr_number}, ${r.requirements})`
    }
    return { id }
  }) as Promise<{ id: string } | null>
}

/**
 * Repos present before and after keep their row (and run history); removed repos lose theirs.
 * Returns false when the feature does not exist.
 */
export async function updateFeature(id: string, input: Partial<FeatureInput>): Promise<boolean> {
  return sql().begin(async (tx) => {
    const [f] = await tx`
      update features set title = coalesce(${input.title ?? null}, title),
        description = coalesce(${input.description ?? null}, description), updated_at = now()
      where id = ${id} returning project_id`
    if (!f) return false
    if (input.repos) {
      const repos = await resolveRepos(tx as unknown as postgres.Sql, f.project_id, input.repos)
      const keep = repos.map((r) => r.repo_id)
      if (keep.length) await tx`delete from feature_repos where feature_id = ${id} and repo_id not in ${tx(keep)}`
      else await tx`delete from feature_repos where feature_id = ${id}`
      for (const r of repos) {
        await tx`insert into feature_repos (id, feature_id, repo_id, pr_url, pr_number, requirements)
          values (${crypto.randomUUID()}, ${id}, ${r.repo_id}, ${r.pr_url}, ${r.pr_number}, ${r.requirements})
          on conflict (feature_id, repo_id) do update
          set pr_url = excluded.pr_url, pr_number = excluded.pr_number, requirements = excluded.requirements`
      }
    }
    return true
  }) as Promise<boolean>
}

export async function deleteFeature(id: string): Promise<boolean> {
  return (await sql()`delete from features where id = ${id} returning id`).length > 0
}
