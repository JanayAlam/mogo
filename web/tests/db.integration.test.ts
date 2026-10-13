// Runs against a real Postgres only when TEST_DATABASE_URL is set (migrated with python -m mogo.tools.migrate).
import { createHmac } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { POST as webhook } from '@/app/api/github/webhook/route'

import { db } from '@/lib/db'
import { deleteFeature, FeatureInputError, getFeature, insertFeature, listFeatures, updateFeature } from '@/lib/features'
import {
  deleteProject, getProject, getRepo, insertProject, insertRepo, listProjects, setRepoInstallation, updateRepo,
} from '@/lib/projects'
import { getRun, getStats, insertRun, listRuns, markRunFailed } from '@/lib/runs'
import { decryptSecret, deleteEnvVar, importEnv, listEnv, secretKey, setEnvVar } from '@/lib/env'
import { createSession, destroySession, userForToken } from '@/lib/sessions'
import {
  activeLlmModel, createLlmConnection, deleteLlmConnection, listLlmConnections, OrderError, reorderLlmConnections,
  updateLlmConnection,
} from '@/lib/llm'
import { loadGitHubTokens, saveGitHubTokens, upsertUser } from '@/lib/users'

const KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
const gh = (id: number, login: string) => ({ id, login, name: null, avatar_url: '', email: null })

describe.skipIf(!process.env.TEST_DATABASE_URL)('queries (postgres)', () => {
  let alice = ''
  let bob = ''
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.MOGO_SECRET_KEY = KEY
    alice = await upsertUser(gh(9_000_001, 'alice'))
    bob = await upsertUser(gh(9_000_002, 'bob'))
  })
  afterAll(async () => {
    await db().user.deleteMany({ where: { id: { in: [alice, bob] } } })
    await db().$disconnect()
  })

  it('users: one row per GitHub id, sessions, encrypted tokens', async () => {
    expect(await upsertUser(gh(9_000_001, 'alice-renamed'))).toBe(alice)
    const token = await createSession(alice)
    expect(await userForToken(token)).toMatchObject({ id: alice, login: 'alice-renamed' })
    const [s] = await db().session.findMany({ where: { user_id: alice } })
    expect(s.token_hash).not.toContain(token)
    await destroySession(token)
    expect(await userForToken(token)).toBeNull()

    await saveGitHubTokens(alice, { access_token: 'ghu_a', expires_in: 3600, refresh_token: 'ghr_a', refresh_token_expires_in: 99 })
    expect(await loadGitHubTokens(alice)).toEqual({ access: 'ghu_a', refresh: 'ghr_a' })
    await saveGitHubTokens(alice, { access_token: 'ghu_b', expires_in: 30 }) // about to expire: refresh instead
    expect(await loadGitHubTokens(alice)).toEqual({ access: null, refresh: null })
  })

  it('llm connections: an ordered fallback chain, encrypted keys, isolated between users', async () => {
    const make = (model: string, api_key: string | null, active = true) => createLlmConnection(alice, {
      provider: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', model, api_key, active,
    })
    const first = await make('m1', 'sk-1')
    const second = await make('m2', null)
    const third = await make('m3', null, false)
    const order = async () => (await listLlmConnections(alice)).map((c) => [c.model, c.active])
    expect(await order()).toEqual([['m1', true], ['m2', true], ['m3', false]]) // new ones join the end; several are on
    expect(await activeLlmModel(alice)).toBe('m1')

    // the runner decrypts with additional data "user:<id>:llm_api_key" (backend/mogo/llm/provider.py)
    const row = (await db().llmConnection.findUnique({ where: { id: first.id } }))!
    expect(row.api_key_enc).not.toContain('sk-1')
    expect(decryptSecret(secretKey(), `user:${alice}`, 'llm_api_key', row.api_key_enc!)).toBe('sk-1')

    // reorder: the chain changes, the on/off state does not
    const moved = await reorderLlmConnections(alice, [third.id, second.id, first.id])
    expect(moved.map((c) => [c.model, c.active])).toEqual([['m3', false], ['m2', true], ['m1', true]])
    expect(await activeLlmModel(alice)).toBe('m2') // first one that is switched on
    await expect(reorderLlmConnections(alice, [first.id, second.id])).rejects.toBeInstanceOf(OrderError) // stale list
    await expect(reorderLlmConnections(alice, [first.id, second.id, 'x'])).rejects.toBeInstanceOf(OrderError)
    await expect(reorderLlmConnections(bob, [first.id, second.id, third.id])).rejects.toBeInstanceOf(OrderError)

    expect(await updateLlmConnection(alice, third.id, { active: true })).toMatchObject({ active: true }) // others stay on
    expect((await listLlmConnections(alice)).filter((c) => c.active)).toHaveLength(3)
    expect(await updateLlmConnection(alice, first.id, { model: 'm1b' })).toMatchObject({ model: 'm1b', has_key: true }) // key kept
    expect(await updateLlmConnection(alice, first.id, { api_key: null })).toMatchObject({ has_key: false })

    expect(await updateLlmConnection(bob, first.id, { active: false })).toBeNull() // not bob's
    expect(await deleteLlmConnection(bob, first.id)).toBe(false)
    for (const c of [first, second, third]) expect(await deleteLlmConnection(alice, c.id)).toBe(true)
    expect(await activeLlmModel(alice)).toBeNull()
  })

  it('projects, repos and features with their latest runs, seen by their owner only', async () => {
    const { id: pid } = await insertProject(alice, { name: 'Integration', description: 'd' })
    const repo = (full_name: string, role: string, config = {}) => ({ full_name, role, default_branch: 'main', config })
    const api = (await insertRepo(pid, alice, repo('acme/api', 'backend', { gates: ['x'] }), 5))!
    const web = (await insertRepo(pid, alice, repo('acme/web', 'frontend'), 5))!
    await expect(insertRepo(pid, alice, repo('acme/api', ''), 5)).rejects.toThrow('duplicate')
    expect(await insertRepo('00000000-0000-0000-0000-000000000000', alice, repo('a/b', ''), 5)).toBeNull()
    expect(await insertRepo(pid, bob, repo('bob/x', ''), 5)).toBeNull() // not bob's project
    expect(await updateRepo(api.id, bob, { role: 'hijacked' })).toBe(false)
    await updateRepo(api.id, alice, { config: { gates: ['pnpm lint'] } })
    await setEnvVar(api.id, 'PORT', { value: '8000', sensitive: false })
    await setEnvVar(api.id, 'API_KEY', { value: 'plain-secret-1', sensitive: true })
    const stored = (await db().repoEnv.findUnique({ where: { repo_id_name: { repo_id: api.id, name: 'API_KEY' } } }))!
    expect(stored.value === null && stored.value_enc!.startsWith('v1:') && !stored.value_enc!.includes('plain-secret')).toBe(true)
    expect(await listEnv(api.id)).toMatchObject([
      { name: 'API_KEY', sensitive: true, value: null },
      { name: 'PORT', sensitive: false, value: '8000' },
    ])
    // plain -> sensitive keeps the value (encrypted); sensitive -> plain needs a new one
    await setEnvVar(api.id, 'PORT', { sensitive: true })
    const port = (await db().repoEnv.findUnique({ where: { repo_id_name: { repo_id: api.id, name: 'PORT' } } }))!
    expect(port.value === null && port.value_enc!.startsWith('v1:')).toBe(true)
    await expect(setEnvVar(api.id, 'PORT', { sensitive: false })).rejects.toThrow('new value')
    await setEnvVar(api.id, 'PORT', { value: '9000', sensitive: false })
    expect((await listEnv(api.id)).find((v) => v.name === 'PORT')).toMatchObject({ sensitive: false, value: '9000' })
    await expect(setEnvVar(api.id, 'NOPE', { sensitive: false })).rejects.toThrow('required')
    expect(await listEnv(web.id)).toEqual([])
    expect(await deleteEnvVar(web.id, 'API_KEY')).toBe(false)
    // .env import: existing keep their sensitivity, new ones by name, others kept
    expect(await importEnv(api.id, [{ name: 'PORT', value: '1' }, { name: 'NEW_TOKEN', value: 't' }, { name: 'MODE', value: 'm' }]))
      .toEqual({ added: ['NEW_TOKEN', 'MODE'], replaced: ['PORT'], sensitive: ['NEW_TOKEN'] })
    expect((await listEnv(api.id)).map((v) => [v.name, v.sensitive])).toEqual([
      ['API_KEY', true], ['MODE', false], ['NEW_TOKEN', true], ['PORT', false],
    ])
    await db().repoProfile.create({
      data: { repo_id: api.id, main_sha: 'abc1234', structure: { files: 12 }, type_index: [{ name: 'A' }], summary: 'conv' },
    })
    expect((await getRepo(api.id, alice))!.profile).toMatchObject({ main_sha: 'abc1234', files: 12, types: 1, summary: 'conv', error: '' })
    expect(await getRepo(api.id, bob)).toBeNull()
    expect(await getProject(pid, bob)).toBeNull()
    expect(await listProjects(bob)).toEqual([])
    expect((await getProject(pid, alice))!.repos.find((r) => r.id === api.id)!).toMatchObject({ installation_id: '5', profile: { files: 12, types: 1 } })

    // access re-checks: case-insensitive, and only within the owner's projects
    await setRepoInstallation(alice, 'ACME/API', null)
    await setRepoInstallation(bob, 'acme/api', 7)
    expect((await getRepo(api.id, alice))!.installation_id).toBeNull()
    await setRepoInstallation(alice, 'acme/api', 5)
    // the App loses acme/web: its row forgets the installation, acme/api keeps it
    process.env.GITHUB_WEBHOOK_SECRET = 'hook'
    const body = JSON.stringify({
      action: 'removed', installation: { id: 5 }, repositories_removed: [{ full_name: 'Acme/Web' }],
    })
    const sig = 'sha256=' + createHmac('sha256', 'hook').update(body).digest('hex')
    const res = await webhook(new Request('http://x', {
      method: 'POST', body, headers: { 'x-hub-signature-256': sig, 'x-github-event': 'installation_repositories' },
    }))
    expect(res.status).toBe(200)
    expect([(await getRepo(api.id, alice))!.installation_id, (await getRepo(web.id, alice))!.installation_id])
      .toEqual(['5', null])

    expect((await getProject(pid, alice))!.repos.map((r) => [r.full_name, r.config.gates ?? []])).toEqual([
      ['acme/api', ['pnpm lint']], ['acme/web', []],
    ])

    await expect(insertFeature(pid, alice, {
      title: 'T', description: 'd', repos: [{ repo_id: api.id, pr_url: 'https://github.com/acme/web/pull/1', requirements: '' }],
    })).rejects.toThrow(FeatureInputError)
    expect(await insertFeature(pid, bob, { title: 'T', description: 'd', repos: [] })).toBeNull()
    const { id: fid } = (await insertFeature(pid, alice, {
      title: 'Refunds', description: 'refund', repos: [
        { repo_id: api.id, pr_url: 'https://github.com/acme/api/pull/4', requirements: 'idempotent' },
        { repo_id: web.id, pr_url: 'https://github.com/acme/web/pull/9', requirements: '' },
      ],
    }))!
    expect(await getFeature(fid, bob)).toBeNull()
    const f = (await getFeature(fid, alice))!
    expect(f.state).toBe('idle')
    const frApi = f.repos.find((r) => r.repo_id === api.id)!
    expect([frApi.pr_number, frApi.requirements, frApi.role]).toEqual([4, 'idempotent', 'backend'])

    const run = await insertRun({
      feature_repo_id: frApi.id, repo: 'acme/api', pr_url: frApi.pr_url, pr_number: 4, feature: 'refund', dry_run: false,
      created_by: alice,
    })
    expect((await listFeatures(pid, alice))[0]).toMatchObject({ id: fid, state: 'queued' })
    expect(await listFeatures(pid, bob)).toEqual([])
    expect(await getStats(alice)).toMatchObject({ projects: 1, queued: 1 })
    expect(await getStats(bob)).toMatchObject({ projects: 0, queued: 0 })
    expect((await listProjects(alice)).find((p) => p.id === pid)).toMatchObject({ feature_count: 1, run_count: 1, latest_status: 'queued' })
    expect((await listRuns(alice)).map((r) => r.id)).toEqual([run.id])
    expect(await listRuns(bob)).toEqual([])
    expect(await getRun(run.id, bob)).toBeNull()
    await db().runEvent.create({ data: { run_id: run.id, level: 'info', message: 'hello' } })
    await markRunFailed(run.id, 'boom')
    expect(await getRun(run.id, alice)).toMatchObject({ status: 'failed', error: 'boom', events: [{ message: 'hello' }] })

    // web dropped: its row goes, the api row (and its run) stays
    expect(await updateFeature(fid, bob, { title: 'x' })).toBe(false)
    await updateFeature(fid, alice, { repos: [{ repo_id: api.id, pr_url: 'https://github.com/acme/api/pull/5', requirements: 'x' }] })
    const after = (await getFeature(fid, alice))!
    expect(after.repos.map((r) => [r.id, r.pr_number])).toEqual([[frApi.id, 5]])
    expect(after.repos[0].latest_run?.id).toBe(run.id)

    expect(await deleteFeature(fid, bob)).toBe(false)
    expect(await deleteFeature(fid, alice)).toBe(true)
    expect(await getRun(run.id, alice)).toBeNull()
    expect(await deleteProject(pid, bob)).toBe(false)
    expect(await deleteProject(pid, alice)).toBe(true)
  })
})
