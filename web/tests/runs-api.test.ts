import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async (orig) => (await import('./signed-in')).signedIn(await orig()))
vi.mock('@/lib/users', () => ({ getLlmSettings: vi.fn(), llmConfigured: (s: { model: string }) => !!s.model }))
vi.mock('@/lib/github-app', () => ({ installedRepos: vi.fn() }))
vi.mock('@/lib/projects', () => ({ setRepoInstallation: vi.fn() }))
vi.mock('@/lib/runs', async (orig) => ({
  ...(await orig<typeof import('@/lib/runs')>()),
  insertRun: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  markRunFailed: vi.fn(),
  getStats: vi.fn(),
}))
vi.mock('@/lib/features', async (orig) => ({
  ...(await orig<typeof import('@/lib/features')>()),
  getFeature: vi.fn(),
}))

import { POST as startRuns } from '@/app/api/features/[id]/runs/route'
import { GET as getOne } from '@/app/api/runs/[id]/route'
import { POST as rerun } from '@/app/api/runs/[id]/rerun/route'
import { GET as list } from '@/app/api/runs/route'
import * as features from '@/lib/features'
import * as githubApp from '@/lib/github-app'
import * as projects from '@/lib/projects'
import * as runs from '@/lib/runs'
import * as users from '@/lib/users'

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

const fr = (repo_id: string, full_name: string, latest_run: unknown = null) => ({
  id: `fr-${repo_id}`, feature_id: 'f1', repo_id, full_name, role: '', requirements: '',
  pr_url: `https://github.com/${full_name}/pull/3`, pr_number: 3, latest_run,
})
const FEATURE = {
  id: 'f1', project_id: 'p1', title: 'Refunds', description: 'refund an order', state: 'idle',
  repos: [fr('r1', 'acme/api'), fr('r2', 'acme/web')],
}

beforeEach(() => {
  vi.stubEnv('GITHUB_TOKEN', 'tok')
  vi.stubEnv('RUNNER_REPO', 'me/mogo')
  vi.mocked(runs.insertRun).mockImplementation(async (r) => ({ id: `run-${r.repo}`, status: 'queued', ...r }) as never)
  vi.mocked(features.getFeature).mockResolvedValue(FEATURE as never)
  vi.mocked(users.getLlmSettings).mockResolvedValue({ base_url: 'https://api.openai.com/v1', model: 'm', has_key: true })
  vi.mocked(githubApp.installedRepos).mockResolvedValue([
    { full_name: 'acme/api', installation_id: 5, account: 'acme', default_branch: 'main', private: true },
    { full_name: 'acme/web', installation_id: 5, account: 'acme', default_branch: 'main', private: true },
  ])
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('POST /api/features/:id/runs', () => {
  it('queues and dispatches one run per repo of the feature', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await startRuns(post({ dry_run: true }), ctx('f1'))
    expect(res.status).toBe(201)
    expect(features.getFeature).toHaveBeenCalledWith('f1', 'u1')
    expect(vi.mocked(runs.insertRun)).toHaveBeenCalledWith(
      expect.objectContaining({ feature_repo_id: 'fr-r1', repo: 'acme/api', pr_number: 3, dry_run: true, created_by: 'u1' }),
    )
    expect(projects.setRepoInstallation).toHaveBeenCalledWith('u1', 'acme/api', 5)
    expect(fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).inputs.run_id).sort()).toEqual([
      'run-acme/api', 'run-acme/web',
    ])
  })

  it('runs only the chosen repos', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    await startRuns(post({ repo_ids: ['r2'] }), ctx('f1'))
    expect(vi.mocked(runs.insertRun)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runs.insertRun).mock.calls[0][0].repo).toBe('acme/web')
  })

  it('refuses while a repo is still running', async () => {
    vi.mocked(features.getFeature).mockResolvedValue({
      ...FEATURE, repos: [fr('r1', 'acme/api', { status: 'running', verdict: '' })],
    } as never)
    expect((await startRuns(post({}), ctx('f1'))).status).toBe(409)
    expect(runs.insertRun).not.toHaveBeenCalled()
  })

  it('422s for repo ids outside the feature', async () => {
    expect((await startRuns(post({ repo_ids: ['nope'] }), ctx('f1'))).status).toBe(422)
  })

  it('needs the user\'s LLM', async () => {
    vi.mocked(users.getLlmSettings).mockResolvedValue({ base_url: '', model: '', has_key: false })
    const res = await startRuns(post({}), ctx('f1'))
    expect(res.status).toBe(422)
    expect((await res.json()).detail).toContain('LLM')
    expect(runs.insertRun).not.toHaveBeenCalled()
  })

  it('refuses repos the user no longer reaches through the App, and forgets their installation', async () => {
    vi.mocked(githubApp.installedRepos).mockResolvedValue([
      { full_name: 'acme/api', installation_id: 5, account: 'acme', default_branch: 'main', private: true },
    ])
    const res = await startRuns(post({}), ctx('f1'))
    expect(res.status).toBe(422)
    expect((await res.json()).detail).toContain('acme/web')
    expect(projects.setRepoInstallation).toHaveBeenCalledWith('u1', 'acme/web', null)
    expect(runs.insertRun).not.toHaveBeenCalled()
  })

  it('404s for an unknown feature', async () => {
    vi.mocked(features.getFeature).mockResolvedValue(null)
    expect((await startRuns(post({}), ctx('x'))).status).toBe(404)
  })

  it('marks runs failed and returns 502 when every dispatch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    expect((await startRuns(post({}), ctx('f1'))).status).toBe(502)
    expect(runs.markRunFailed).toHaveBeenCalledWith('run-acme/api', expect.stringContaining('500'))
  })
})

describe('POST /api/runs/:id/rerun', () => {
  const OLD = {
    id: 'old', feature_repo_id: 'fr-r1', repo: 'acme/api', pr_url: 'https://github.com/acme/api/pull/3',
    pr_number: 3, feature: 'f', dry_run: false, status: 'failed',
  }
  it('queues a copy of a finished run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    vi.mocked(runs.getRun).mockResolvedValue(OLD as never)
    expect((await rerun(post({}), ctx('old'))).status).toBe(201)
    expect(vi.mocked(runs.insertRun)).toHaveBeenCalledWith(expect.objectContaining({ feature_repo_id: 'fr-r1' }))
  })
  it('refuses a run in progress', async () => {
    vi.mocked(runs.getRun).mockResolvedValue({ ...OLD, status: 'running' } as never)
    expect((await rerun(post({}), ctx('old'))).status).toBe(409)
  })
})

describe('GET', () => {
  it('lists runs', async () => {
    vi.mocked(runs.listRuns).mockResolvedValue([{ id: 'a' }] as never)
    expect(await (await list(new Request('http://x'))).json()).toEqual([{ id: 'a' }])
    expect(runs.listRuns).toHaveBeenCalledWith('u1')
  })
  it('404s for an unknown run, returns known ones', async () => {
    vi.mocked(runs.getRun).mockResolvedValueOnce(null)
    expect((await getOne(new Request('http://x'), ctx('nope'))).status).toBe(404)
    vi.mocked(runs.getRun).mockResolvedValueOnce({ id: 'r', events: [] } as never)
    expect(await (await getOne(new Request('http://x'), ctx('r'))).json()).toEqual({ id: 'r', events: [] })
  })
})
