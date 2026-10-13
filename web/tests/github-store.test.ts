import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/client', () => ({ api: { githubAccess: vi.fn() } }))

import { api } from '@/lib/client'
import { useGitHub } from '@/lib/github-store'

const repo = (full_name: string) => ({ full_name, installation_id: 1, account: 'acme', default_branch: 'main', private: false })
const access = vi.mocked(api.githubAccess)

beforeEach(() => {
  vi.clearAllMocks()
  useGitHub.setState({ connected: null, repos: [], loading: false, error: '' })
})

describe('github store', () => {
  it('knows nothing until the first answer', () => {
    expect(useGitHub.getState()).toMatchObject({ connected: null, repos: [] })
  })

  it('remembers a connection and its repos', async () => {
    access.mockResolvedValue({ connected: true, repos: [repo('acme/api')] })
    await useGitHub.getState().load()
    expect(useGitHub.getState()).toMatchObject({ connected: true, loading: false, error: '' })
    expect(useGitHub.getState().repos.map((r) => r.full_name)).toEqual(['acme/api'])
  })

  it('remembers "not connected", and notices a later connection', async () => {
    access.mockResolvedValueOnce({ connected: false, repos: [] })
    await useGitHub.getState().load()
    expect(useGitHub.getState().connected).toBe(false)
    access.mockResolvedValueOnce({ connected: true, repos: [repo('acme/web')] })
    await useGitHub.getState().load()
    expect(useGitHub.getState().connected).toBe(true)
  })

  it('keeps the last answer when a refresh fails', async () => {
    access.mockResolvedValueOnce({ connected: true, repos: [repo('acme/api')] })
    await useGitHub.getState().load()
    access.mockRejectedValueOnce(new Error('GitHub API 502'))
    await useGitHub.getState().load()
    expect(useGitHub.getState()).toMatchObject({ connected: true, error: 'GitHub API 502', loading: false })
    expect(useGitHub.getState().repos).toHaveLength(1)
  })

  it('does not start a second request while one is running', async () => {
    let finish: (v: { connected: boolean; repos: never[] }) => void = () => {}
    access.mockReturnValue(new Promise((r) => (finish = r)))
    const first = useGitHub.getState().load()
    await useGitHub.getState().load()
    expect(access).toHaveBeenCalledTimes(1)
    finish({ connected: false, repos: [] })
    await first
    expect(useGitHub.getState().loading).toBe(false)
  })
})
