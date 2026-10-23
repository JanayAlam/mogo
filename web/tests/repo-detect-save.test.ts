import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsert = vi.fn()
const update = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => ({ repoProfile: { upsert }, repo: { update } }) }))
vi.mock('@/lib/github-app', () => ({ readRepoRoot: vi.fn() }))

import { readRepoRoot } from '@/lib/github-app'
import { detectRepo } from '@/lib/repo-detect'

const files = (name: string) => (name === 'Dockerfile' ? 'FROM node\nEXPOSE 4000' : name === '.env.example' ? 'PORT=4000\nDB_URL=x' : undefined)
const repo = () => ({ id: 'r1', full_name: 'acme/api', default_branch: 'main' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readRepoRoot).mockResolvedValue({ names: new Set(['Dockerfile', 'compose.yaml', '.env.example', 'package.json']), read: files })
})

describe('detectRepo', () => {
  it('reads the repo on its source of truth branch with the user\'s access', async () => {
    await detectRepo('user-1', repo())
    expect(readRepoRoot).toHaveBeenCalledWith('user-1', 'acme/api', 'main')
  })

  it('stores the suggestions, touching nothing else of the profile', async () => {
    await detectRepo('u', repo())
    const arg = upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ repo_id: 'r1' })
    expect(Object.keys(arg.update)).toEqual(['suggestions']) // what the runner learned stays
    expect(arg.create).toMatchObject({ repo_id: 'r1' })
    expect(arg.update.suggestions).toEqual({
      env_names: ['PORT', 'DB_URL'], dockerfile: true, docker_port: 4000, dockerfiles: ['Dockerfile'], compose_files: ['compose.yaml'],
    })
  })

  it("never writes the repo's own settings", async () => {
    await detectRepo('u', repo())
    expect(update).not.toHaveBeenCalled()
  })

  it('saves the suggestions even when nothing is recognised, so the page knows it has looked', async () => {
    vi.mocked(readRepoRoot).mockResolvedValue({ names: new Set(['README.md']), read: () => undefined })
    await detectRepo('u', repo())
    expect(upsert).toHaveBeenCalled()
    expect(upsert.mock.calls[0][0].update.suggestions).toMatchObject({ dockerfiles: [], compose_files: [] })
  })

  it('does not write anything when GitHub cannot be read', async () => {
    vi.mocked(readRepoRoot).mockRejectedValue(new Error('GitHub API 502'))
    await expect(detectRepo('u', repo())).rejects.toThrow('502')
    expect(upsert).not.toHaveBeenCalled()
  })
})
