import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async (orig) => (await import('./signed-in')).signedIn(await orig()))
vi.mock('@/lib/projects', () => ({ getRepo: vi.fn() }))

import { POST as relearn } from '@/app/api/repos/[id]/profile/route'
import { checkEnabled, checkTitle } from '@/lib/checks'
import * as projects from '@/lib/projects'

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('POST /api/repos/:id/profile', () => {
  it('dispatches a profile job for the repo', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok')
    vi.stubEnv('RUNNER_REPO', 'me/mogo')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1', full_name: 'acme/api' } as never)
    expect((await relearn(new Request('http://x', { method: 'POST' }), ctx('r1'))).status).toBe(202)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).inputs).toEqual({ profile_repo_id: 'r1' })
    expect(projects.getRepo).toHaveBeenCalledWith('r1', 'u1') // only the signed-in user's repos
  })
  it('404s for an unknown repo and 502s when dispatch fails', async () => {
    vi.mocked(projects.getRepo).mockResolvedValueOnce(null)
    expect((await relearn(new Request('http://x'), ctx('x'))).status).toBe(404)
    vi.mocked(projects.getRepo).mockResolvedValueOnce({ id: 'r1' } as never)
    vi.stubEnv('GITHUB_TOKEN', '')
    expect((await relearn(new Request('http://x'), ctx('r1'))).status).toBe(502)
  })
})

describe('built-in check switches', () => {
  it('are on unless set to false', () => {
    expect(checkEnabled({}, 'no-duplicate-types')).toBe(true)
    expect(checkEnabled({ checks: { 'no-duplicate-types': false } }, 'no-duplicate-types')).toBe(false)
    expect(checkTitle('builtin:structure-convention')).toBe('File and folder conventions')
  })
})
