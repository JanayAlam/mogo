import { Prisma } from '@/generated/prisma/client'
import { bigintString, db } from '@/lib/db'
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
  conventions: string[]
  rules: string[]
  notes: string
  allow_forks: boolean
  stack: string // what kind of app it is, an id of lib/stack.ts; '' = not set
  // Not in the runner's RepoConfig: what the form for this type was filled with. The runner reads the commands
  // they are compiled into (gates, test_cmd, prepare, start, healthcheck, services_down); these keep each field apart.
  scripts: NodeScripts // Node.js, TypeScript and JavaScript types
  docker_mode: string // 'dockerfile' (default) or 'compose'; Docker type
  docker_file: string // its name at the repo root; '' = the default
  docker_port: number // a Dockerfile app's port; 0 = the usual one
}

/** The commands of a Node.js, TypeScript or JavaScript repo, one field each (package.json scripts or free text). */
export interface NodeScripts {
  lint: string
  typecheck: string
  format: string
  other: string[] // more checks
  test: string
  build: string
  before: string[] // steps before the app starts: start a database, migrate
  run: string
}

export interface RepoRow {
  id: string
  project_id: string
  full_name: string
  installation_id: string | null // bigint, so postgres.js returns a string; null: the Mogo App no longer covers the repo
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
  suggestions?: Suggestions | null // only from getRepo
}

/** Run settings the runner read from the source branch (backend/mogo/profile/detect.py). */
export interface Suggestions {
  package_manager?: string
  install: string
  checks: string[]
  test_cmd: string
  start: string
  app_url: string
  env_names: string[]
  scripts?: { name: string; run: string; body: string }[] // package.json scripts, `run` is the command that runs one
  fields?: { lint: string; typecheck: string; format: string; test: string; build: string; run: string } // per form field
  dockerfiles?: string[] // Dockerfile-like names at the repo root
  compose_files?: string[]
  stack?: string | { language: string; frameworks: string[] } // an id; older profiles hold the first version's object
  dockerfile?: boolean // a Dockerfile at the repo root
  docker_port?: number // its first EXPOSE, 0 when none
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

/**
 * Every function takes the signed-in user's id and only sees that user's projects (and their repos): someone else's
 * id reads as "not found".
 */
export async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  const projects = await db().project.findMany({
    where: { owner_id: ownerId },
    orderBy: { created_at: 'asc' },
    select: {
      id: true, name: true, description: true, created_at: true,
      repos: { select: { id: true, full_name: true, role: true }, orderBy: { created_at: 'asc' } },
      _count: { select: { features: true } },
    },
  })
  return Promise.all(
    projects.map(async ({ _count, ...p }) => {
      const runs: Prisma.RunWhereInput = { featureRepo: { feature: { project_id: p.id } } }
      const [run_count, latest] = await Promise.all([
        db().run.count({ where: runs }),
        db().run.findFirst({ where: runs, orderBy: { created_at: 'desc' }, select: { status: true, verdict: true } }),
      ])
      return {
        ...p,
        created_at: p.created_at.toISOString(),
        feature_count: _count.features,
        run_count,
        latest_status: (latest?.status as RunStatus | undefined) ?? null,
        latest_verdict: latest?.verdict ?? null,
      }
    }),
  )
}

const REPO_FIELDS = {
  id: true, project_id: true, full_name: true, installation_id: true, role: true, default_branch: true, config: true,
  created_at: true, updated_at: true,
} satisfies Prisma.RepoSelect

type RepoFields = Prisma.RepoGetPayload<{ select: typeof REPO_FIELDS }>

/**
 * Profile summaries. File and type counts are computed in SQL: a type index can be large and only its length is
 * shown, so it is not loaded.
 */
async function profiles(repoIds: string[], detail: boolean): Promise<Map<string, ProfileInfo>> {
  if (repoIds.length === 0) return new Map()
  const rows = await db().$queryRaw<(ProfileInfo & { repo_id: string })[]>`
    select repo_id, main_sha, built_at, error, (structure->>'files')::int as files,
      json_array_length(type_index) as types, summary, suggestions
    from repo_profiles where repo_id in (${Prisma.join(repoIds)})`
  return new Map(
    rows.map(({ repo_id, summary, suggestions, ...p }) => [repo_id, detail ? { ...p, summary, suggestions } : p]),
  )
}

async function withProfiles(repos: RepoFields[], detail = false): Promise<RepoRow[]> {
  const found = await profiles(repos.map((r) => r.id), detail)
  return repos.map((r) => ({
    ...r,
    installation_id: bigintString(r.installation_id),
    config: r.config as Partial<RepoConfig>,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    profile: found.get(r.id) ?? null,
  }))
}

export async function getProject(id: string, ownerId: string): Promise<ProjectRow | null> {
  const project = await db().project.findFirst({
    where: { id, owner_id: ownerId },
    select: {
      id: true, name: true, description: true, settings: true, created_at: true,
      repos: { select: REPO_FIELDS, orderBy: { created_at: 'asc' } },
    },
  })
  if (!project) return null
  return {
    ...project,
    settings: project.settings as Record<string, unknown>,
    created_at: project.created_at.toISOString(),
    repos: await withProfiles(project.repos),
  }
}

export async function insertProject(ownerId: string, p: { name: string; description: string }): Promise<{ id: string }> {
  return db().project.create({ data: { owner_id: ownerId, ...p }, select: { id: true } })
}

export async function updateProject(
  id: string,
  ownerId: string,
  p: { name?: string; description?: string; settings?: Record<string, unknown> },
): Promise<boolean> {
  const { count } = await db().project.updateMany({
    where: { id, owner_id: ownerId },
    data: { name: p.name, description: p.description, settings: p.settings as Prisma.InputJsonObject | undefined },
  })
  return count > 0
}

export async function deleteProject(id: string, ownerId: string): Promise<boolean> {
  return (await db().project.deleteMany({ where: { id, owner_id: ownerId } })).count > 0
}

export interface RepoInput {
  full_name: string
  role: string
  default_branch: string
  config: Partial<RepoConfig>
}

const ownedRepo = (id: string, ownerId: string): Prisma.RepoWhereInput => ({ id, project: { owner_id: ownerId } })

export async function getRepo(id: string, ownerId: string): Promise<RepoRow | null> {
  const repo = await db().repo.findFirst({ where: ownedRepo(id, ownerId), select: REPO_FIELDS })
  return repo ? (await withProfiles([repo], true))[0] : null
}

/**
 * Null when the project does not exist; throws 'duplicate' when the repo is already in it. The caller has checked
 * that the user may use the repo through `installationId` (lib/github-app.ts accessibleRepo).
 */
export async function insertRepo(
  projectId: string,
  ownerId: string,
  r: RepoInput,
  installationId: number,
): Promise<{ id: string } | null> {
  const project = await db().project.findFirst({ where: { id: projectId, owner_id: ownerId }, select: { id: true } })
  if (!project) return null
  try {
    return await db().repo.create({
      data: {
        project_id: projectId, full_name: r.full_name, installation_id: BigInt(installationId), role: r.role,
        default_branch: r.default_branch, config: r.config as Prisma.InputJsonObject,
      },
      select: { id: true },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Error('duplicate')
    throw e
  }
}

export async function updateRepo(id: string, ownerId: string, r: Partial<RepoInput>): Promise<boolean> {
  const { count } = await db().repo.updateMany({
    where: ownedRepo(id, ownerId),
    data: {
      role: r.role, default_branch: r.default_branch, config: r.config as Prisma.InputJsonObject | undefined,
      updated_at: new Date(),
    },
  })
  return count > 0
}

export async function deleteRepo(id: string, ownerId: string): Promise<boolean> {
  return (await db().repo.deleteMany({ where: ownedRepo(id, ownerId) })).count > 0
}

/** After re-checking access: the installation that covers the owner's copies of a repo now (null: none). */
export async function setRepoInstallation(ownerId: string, fullName: string, installationId: number | null) {
  await db().repo.updateMany({
    where: { full_name: { equals: fullName, mode: 'insensitive' }, project: { owner_id: ownerId } },
    data: { installation_id: installationId === null ? null : BigInt(installationId) },
  })
}
