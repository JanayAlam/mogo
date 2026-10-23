import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { detect } from '@/lib/detect'
import { readRepoRoot } from '@/lib/github-app'
import type { RepoRow } from '@/lib/projects'

/**
 * Reads a repo's source of truth branch from GitHub (no runner) and stores what the detection suggests (Docker files,
 * the Dockerfile's port, variable names) in its profile, which the repo page shows.
 *
 * Only the suggestions are written: what the runner learns (folders, types) and when it learned it stay as they are.
 */
export async function detectRepo(userId: string, repo: Pick<RepoRow, 'id' | 'full_name' | 'default_branch'>) {
  const { names, read } = await readRepoRoot(userId, repo.full_name, repo.default_branch)
  const suggestions = detect(names, read)
  const json = suggestions as unknown as Prisma.InputJsonObject // plain data: strings, numbers, lists
  await db().repoProfile.upsert({
    where: { repo_id: repo.id },
    create: { repo_id: repo.id, suggestions: json },
    update: { suggestions: json },
  })
  return suggestions
}
