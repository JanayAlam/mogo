import { describe, expect, it } from 'vitest'

import { configToForm, formToConfig, fromPairs, legacyEnvFrom } from '@/lib/repo-form'

describe('repo settings form', () => {
  it('round-trips a config', () => {
    const cfg = {
      setup: ['corepack enable', 'pnpm i'], gates: ['pnpm lint'], prepare: [], conventions: ['CLAUDE.md'], rules: [],
      env: { PORT: '8000', URL: 'http://x?a=b' },
      test_cmd: '', services_cmd: 'docker run x', services_down: '', start: 'pnpm dev', healthcheck: 'http://localhost:8000',
      notes: 'log in as a', allow_forks: false,
    }
    const form = configToForm(cfg)
    expect(formToConfig(form)).toEqual(cfg)
  })
  it('keeps = inside values and skips junk lines', () => {
    expect(fromPairs('A=b=c\n\n  B = 2 \njunk\n=x')).toEqual({ A: 'b=c', B: '2' })
  })
  it('lists env_from names left over from the old setup', () => {
    expect(legacyEnvFrom({ env_from: { JWT: 'A_JWT', DB: 'A_DB' } })).toEqual(['DB', 'JWT'])
    expect(legacyEnvFrom({ env_from: ['X'] })).toEqual(['X'])
    expect(legacyEnvFrom({})).toEqual([])
  })
})
