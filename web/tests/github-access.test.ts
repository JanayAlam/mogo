import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/users', () => ({
  loadGitHubTokens: vi.fn(async () => ({ access: 'ghu_x', refresh: null })),
  saveGitHubTokens: vi.fn(),
}))

import { githubAccess } from '@/lib/github-app'

afterEach(() => vi.unstubAllGlobals())

/** GitHub answers by path: installations, then each installation's repositories. */
function stubGitHub(installations: unknown[], repos: Record<number, unknown[]> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const m = String(url).match(/\/user\/installations\/(\d+)\/repositories/)
      const body = m ? { repositories: repos[Number(m[1])] ?? [] } : { installations }
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
}

const repo = (full_name: string) => ({ full_name, default_branch: 'main', private: false })

describe('githubAccess', () => {
  it('is not connected when the App is installed nowhere', async () => {
    stubGitHub([])
    expect(await githubAccess('u')).toEqual({ connected: false, repos: [] })
  })

  it('is not connected when every installation is suspended', async () => {
    stubGitHub([{ id: 1, account: { login: 'acme' }, suspended_at: '2026-01-01T00:00:00Z' }], { 1: [repo('acme/api')] })
    expect(await githubAccess('u')).toEqual({ connected: false, repos: [] })
  })

  it('is connected with no repos when the installation selected none', async () => {
    stubGitHub([{ id: 1, account: { login: 'acme' }, suspended_at: null }], { 1: [] })
    expect(await githubAccess('u')).toEqual({ connected: true, repos: [] })
  })

  it('lists the repos of every active installation, sorted', async () => {
    stubGitHub(
      [
        { id: 1, account: { login: 'zed' }, suspended_at: null },
        { id: 2, account: { login: 'acme' }, suspended_at: null },
      ],
      { 1: [repo('zed/web')], 2: [repo('acme/api'), repo('acme/web')] },
    )
    const a = await githubAccess('u')
    expect(a.connected).toBe(true)
    expect(a.repos.map((r) => [r.full_name, r.installation_id, r.account])).toEqual([
      ['acme/api', 2, 'acme'],
      ['acme/web', 2, 'acme'],
      ['zed/web', 1, 'zed'],
    ])
  })
})
