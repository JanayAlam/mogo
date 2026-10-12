import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { parsePrUrl } from '@/lib/github'
import { RUN_FIELDS, type RunRow, toRunRow } from '@/lib/runs'
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

const FEATURE_FIELDS = {
  id: true, project_id: true, title: true, description: true, created_at: true, updated_at: true,
  repos: {
    orderBy: { repo: { created_at: 'asc' } },
    select: {
      id: true, feature_id: true, repo_id: true, pr_url: true, pr_number: true, requirements: true,
      repo: { select: { full_name: true, role: true } },
      runs: { orderBy: { created_at: 'desc' }, take: 1, select: RUN_FIELDS },
    },
  },
} satisfies Prisma.FeatureSelect

function toFeatureRow(f: Prisma.FeatureGetPayload<{ select: typeof FEATURE_FIELDS }>): FeatureRow {
  const repos = f.repos.map(({ repo, runs, ...fr }) => ({
    ...fr,
    full_name: repo.full_name,
    role: repo.role,
    latest_run: runs[0] ? toRunRow(runs[0]) : null,
  }))
  return {
    ...f,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
    repos,
    state: featureState(repos.map((r) => r.latest_run)),
  }
}

/** Like lib/projects.ts, every function only sees features of the given owner's projects. */
const owned = (ownerId: string): Prisma.FeatureWhereInput => ({ project: { owner_id: ownerId } })

export async function listFeatures(projectId: string, ownerId: string): Promise<FeatureRow[]> {
  const rows = await db().feature.findMany({
    where: { project_id: projectId, ...owned(ownerId) }, orderBy: { created_at: 'desc' }, select: FEATURE_FIELDS,
  })
  return rows.map(toFeatureRow)
}

export async function getFeature(id: string, ownerId: string): Promise<FeatureRow | null> {
  const f = await db().feature.findFirst({ where: { id, ...owned(ownerId) }, select: FEATURE_FIELDS })
  return f ? toFeatureRow(f) : null
}

/** Checks every entry against the project's repos; returns rows ready to store. */
async function resolveRepos(tx: Prisma.TransactionClient, projectId: string, input: FeatureRepoInput[]) {
  const repos = await tx.repo.findMany({ where: { project_id: projectId }, select: { id: true, full_name: true } })
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
export async function insertFeature(
  projectId: string,
  ownerId: string,
  input: FeatureInput,
): Promise<{ id: string } | null> {
  return db().$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, owner_id: ownerId }, select: { id: true } })
    if (!project) return null
    const repos = await resolveRepos(tx, projectId, input.repos)
    return tx.feature.create({
      data: { project_id: projectId, title: input.title, description: input.description, repos: { create: repos } },
      select: { id: true },
    })
  })
}

/**
 * Repos present before and after keep their row (and run history); removed repos lose theirs.
 * Returns false when the feature does not exist.
 */
export async function updateFeature(id: string, ownerId: string, input: Partial<FeatureInput>): Promise<boolean> {
  return db().$transaction(async (tx) => {
    const f = await tx.feature.findFirst({ where: { id, ...owned(ownerId) }, select: { project_id: true } })
    if (!f) return false
    await tx.feature.update({
      where: { id },
      data: { title: input.title, description: input.description, updated_at: new Date() },
    })
    if (input.repos) {
      const repos = await resolveRepos(tx, f.project_id, input.repos)
      await tx.featureRepo.deleteMany({ where: { feature_id: id, repo_id: { notIn: repos.map((r) => r.repo_id) } } })
      for (const { repo_id, ...r } of repos) {
        await tx.featureRepo.upsert({
          where: { feature_id_repo_id: { feature_id: id, repo_id } },
          create: { feature_id: id, repo_id, ...r },
          update: r,
        })
      }
    }
    return true
  })
}

export async function deleteFeature(id: string, ownerId: string): Promise<boolean> {
  return (await db().feature.deleteMany({ where: { id, ...owned(ownerId) } })).count > 0
}
