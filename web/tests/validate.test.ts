import { describe, expect, it } from 'vitest'

import { featureState } from '@/lib/status'
import { validateFeatureInput, validateProjectInput, validateRepoInput } from '@/lib/validate'

describe('validateProjectInput', () => {
  it('needs a name on create, not on patch', () => {
    expect(validateProjectInput({})).toBe('name is required')
    expect(validateProjectInput({ description: 'x' }, true)).toEqual({ description: 'x', name: undefined, settings: undefined })
  })
  it('keeps text that merely contains error words', () => {
    expect(validateProjectInput({ name: 'P', description: 'must be required' })).toMatchObject({
      description: 'must be required',
    })
  })
})

describe('validateRepoInput', () => {
  it('accepts a github url and fills defaults', () => {
    expect(validateRepoInput({ full_name: 'https://github.com/acme/api.git', role: 'backend' })).toEqual({
      full_name: 'acme/api', role: 'backend', default_branch: 'main', config: {},
    })
  })
  it.each([
    [{ full_name: 'not a repo' }, 'owner/repo'],
    [{ full_name: 'a/b', config: { gates: 'pnpm lint' } }, 'config.gates'],
    [{ full_name: 'a/b', config: { env: { 'BAD NAME': 'x' } } }, 'config.env'],
  ])('rejects %j', (body, msg) => {
    expect(validateRepoInput(body)).toContain(msg)
  })
  it('drops the removed env_from key', () => {
    expect(validateRepoInput({ full_name: 'a/b', config: { env: { A: '1' }, env_from: { X: 'Y' } } })).toMatchObject({
      config: { env: { A: '1' } },
    })
    expect(JSON.stringify(validateRepoInput({ full_name: 'a/b', config: { env_from: ['X'] } }))).not.toContain('env_from')
  })
})

describe('validateFeatureInput', () => {
  const repo = { repo_id: 'r1', pr_url: 'https://github.com/a/b/pull/1' }
  it('needs a title, a repo and something to check', () => {
    expect(validateFeatureInput({ repos: [repo] })).toBe('title is required')
    expect(validateFeatureInput({ title: 'T', repos: [] })).toContain('at least one repo')
    expect(validateFeatureInput({ title: 'T', repos: [repo] })).toContain('describe the feature')
    expect(validateFeatureInput({ title: 'T', repos: [{ ...repo, requirements: 'only here' }] })).toMatchObject({
      repos: [{ requirements: 'only here' }],
    })
  })
  it('rejects the same repo twice', () => {
    expect(validateFeatureInput({ title: 'T', description: 'd', repos: [repo, repo] })).toContain('only once')
  })
})

describe('featureState', () => {
  const r = (status: string, verdict = '') => ({ status, verdict }) as never
  it('in flight beats failed beats done; changes requested is a failure', () => {
    expect(featureState([null, null])).toBe('idle')
    expect(featureState([r('succeeded', 'ok'), r('running')])).toBe('running')
    expect(featureState([r('succeeded', 'ok'), r('succeeded', 'changes_requested')])).toBe('failed')
    expect(featureState([r('succeeded', 'ok'), null])).toBe('done')
  })
})
