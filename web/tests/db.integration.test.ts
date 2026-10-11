// Runs against a real Postgres only when TEST_DATABASE_URL is set (migrated with python -m mogo.tools.migrate).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sql } from '@/lib/db'
import { deleteFeature, FeatureInputError, getFeature, insertFeature, listFeatures, updateFeature } from '@/lib/features'
import { deleteProject, getProject, getRepo, insertProject, insertRepo, listProjects, updateRepo } from '@/lib/projects'
import { getRun, getStats, insertRun, listRuns, markRunFailed } from '@/lib/runs'
import { deleteEnvVar, importEnv, listEnv, setEnvVar } from '@/lib/env'

describe.skipIf(!process.env.TEST_DATABASE_URL)('runs queries (postgres)', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  })
  afterAll(async () => {
    await sql().end()
  })

  it('inserts, lists, reads with events, and marks failed', async () => {
    const run = await insertRun({
      feature_repo_id: null, repo: 'acme/api', pr_url: 'https://github.com/acme/api/pull/1', pr_number: 1,
      feature: 'f', llm_mode: 'auto', dry_run: false,
    })
    expect(run.status).toBe('queued')
    expect((await listRuns()).some((r) => r.id === run.id)).toBe(true)

    await sql()`insert into run_events (run_id, level, message) values (${run.id}, 'info', 'hello')`
    await markRunFailed(run.id, 'boom')
    const got = await getRun(run.id)
    expect(got).toMatchObject({ status: 'failed', error: 'boom', events: [{ message: 'hello' }] })
    expect(await getRun('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('projects, repos and features with their latest runs', async () => {
    const { id: pid } = await insertProject({ name: 'Integration', description: 'd' })
    const api = (await insertRepo(pid, { full_name: 'acme/api', role: 'backend', default_branch: 'main', config: { gates: ['x'] } }))!
    const web = (await insertRepo(pid, { full_name: 'acme/web', role: 'frontend', default_branch: 'main', config: {} }))!
    await expect(insertRepo(pid, { full_name: 'acme/api', role: '', default_branch: 'main', config: {} })).rejects.toThrow('duplicate')
    expect(await insertRepo('00000000-0000-0000-0000-000000000000', { full_name: 'a/b', role: '', default_branch: 'main', config: {} })).toBeNull()
    await updateRepo(api.id, { config: { gates: ['pnpm lint'] } })
    process.env.MOGO_SECRET_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
    await setEnvVar(api.id, 'PORT', { value: '8000', sensitive: false })
    await setEnvVar(api.id, 'API_KEY', { value: 'plain-secret-1', sensitive: true })
    const [stored] = await sql()`select value, value_enc from repo_env where repo_id = ${api.id} and name = 'API_KEY'`
    expect(stored.value === null && stored.value_enc.startsWith('v1:') && !stored.value_enc.includes('plain-secret')).toBe(true)
    expect(await listEnv(api.id)).toMatchObject([
      { name: 'API_KEY', sensitive: true, value: null },
      { name: 'PORT', sensitive: false, value: '8000' },
    ])
    // plain -> sensitive keeps the value (encrypted); sensitive -> plain needs a new one
    await setEnvVar(api.id, 'PORT', { sensitive: true })
    const [port] = await sql()`select value, value_enc from repo_env where repo_id = ${api.id} and name = 'PORT'`
    expect(port.value === null && port.value_enc.startsWith('v1:')).toBe(true)
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
    await sql()`insert into repo_profiles (repo_id, main_sha, structure, type_index, summary)
      values (${api.id}, 'abc1234', ${sql().json({ files: 12 } as never)}::json, ${sql().json([{ name: 'A' }] as never)}::json, 'conv')`
    expect((await getRepo(api.id))!.profile).toMatchObject({ main_sha: 'abc1234', files: 12, types: 1, summary: 'conv', error: '' })
    expect((await getProject(pid))!.repos.find((r) => r.id === api.id)!.profile).toMatchObject({ files: 12, types: 1 })
    expect((await getProject(pid))!.repos.map((r) => [r.full_name, r.config.gates ?? []])).toEqual([
      ['acme/api', ['pnpm lint']], ['acme/web', []],
    ])

    await expect(insertFeature(pid, {
      title: 'T', description: 'd', repos: [{ repo_id: api.id, pr_url: 'https://github.com/acme/web/pull/1', requirements: '' }],
    })).rejects.toThrow(FeatureInputError)
    const { id: fid } = (await insertFeature(pid, {
      title: 'Refunds', description: 'refund', repos: [
        { repo_id: api.id, pr_url: 'https://github.com/acme/api/pull/4', requirements: 'idempotent' },
        { repo_id: web.id, pr_url: 'https://github.com/acme/web/pull/9', requirements: '' },
      ],
    }))!
    const f = (await getFeature(fid))!
    expect(f.state).toBe('idle')
    const frApi = f.repos.find((r) => r.repo_id === api.id)!
    expect([frApi.pr_number, frApi.requirements, frApi.role]).toEqual([4, 'idempotent', 'backend'])

    const run = await insertRun({
      feature_repo_id: frApi.id, repo: 'acme/api', pr_url: frApi.pr_url, pr_number: 4, feature: 'refund', llm_mode: 'auto', dry_run: false,
    })
    expect((await listFeatures(pid))[0]).toMatchObject({ id: fid, state: 'queued' })
    expect((await getStats()).queued).toBeGreaterThan(0)
    expect((await listProjects()).find((p) => p.id === pid)).toMatchObject({ feature_count: 1, run_count: 1, latest_status: 'queued' })

    // web dropped: its row goes, the api row (and its run) stays
    await updateFeature(fid, { repos: [{ repo_id: api.id, pr_url: 'https://github.com/acme/api/pull/5', requirements: 'x' }] })
    const after = (await getFeature(fid))!
    expect(after.repos.map((r) => [r.id, r.pr_number])).toEqual([[frApi.id, 5]])
    expect(after.repos[0].latest_run?.id).toBe(run.id)

    expect(await deleteFeature(fid)).toBe(true)
    expect(await getRun(run.id)).toBeNull()
    expect(await deleteProject(pid)).toBe(true)
  })
})
