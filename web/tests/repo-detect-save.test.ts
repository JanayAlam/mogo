import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsert = vi.fn()
const update = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => ({ repoProfile: { upsert }, repo: { update } }) }))
vi.mock('@/lib/github-app', () => ({ readRepoRoot: vi.fn() }))

import { readRepoRoot } from '@/lib/github-app'
import { detectRepo } from '@/lib/repo-detect'

const express = (name: string) => (name === 'package.json' ? '{"dependencies":{"express":"4"},"scripts":{"dev":"tsx x.ts","lint":"eslint ."}}' : undefined)
const repo = () => ({ id: 'r1', full_name: 'acme/api', default_branch: 'main' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readRepoRoot).mockResolvedValue({ names: new Set(['package.json', 'pnpm-lock.yaml']), read: express })
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
    expect(arg.update.suggestions).toMatchObject({
      stack: 'express', start: 'pnpm dev', package_manager: 'pnpm',
      fields: { lint: 'pnpm lint', run: 'pnpm dev' },
    })
    expect(arg.update.suggestions.scripts.map((s: { name: string }) => s.name)).toEqual(['dev', 'lint'])
  })

  it('only suggests the type: it never sets or replaces the repo\'s own', async () => {
    await detectRepo('u', repo())
    expect(update).not.toHaveBeenCalled() // the repo's settings are not written at all
    expect(upsert.mock.calls[0][0].update.suggestions.stack).toBe('express') // it is in the suggestions
  })

  it('saves the suggestions even when nothing is recognised, so the page knows it has looked', async () => {
    vi.mocked(readRepoRoot).mockResolvedValue({ names: new Set(['README.md']), read: () => undefined })
    await detectRepo('u', repo())
    expect(upsert).toHaveBeenCalled()
    expect(upsert.mock.calls[0][0].update.suggestions.stack).toBe('')
  })

  it('does not write anything when GitHub cannot be read', async () => {
    vi.mocked(readRepoRoot).mockRejectedValue(new Error('GitHub API 502'))
    await expect(detectRepo('u', repo())).rejects.toThrow('502')
    expect(upsert).not.toHaveBeenCalled()
  })
})
