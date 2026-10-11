import { describe, expect, it } from 'vitest'

import { applySuggestions, configToForm, formError, formToConfig, legacyEnvFrom } from '@/lib/repo-form'

// antrotrip-server as imported from the old repos.yaml
const OLD = {
  setup: ['corepack enable', 'pnpm install --frozen-lockfile'],
  gates: ['pnpm lint', 'pnpm format:check'],
  test_cmd: '',
  services_cmd: 'docker run -d --name mogo-valkey valkey/valkey:8',
  services_down: 'docker rm -f mogo-valkey',
  prepare: ['pnpm exec prisma generate'],
  start: 'pnpm dev',
  healthcheck: 'http://localhost:8000/api/v1/health',
  conventions: ['CLAUDE.md'],
  rules: [],
  notes: 'log in with OTP',
  allow_forks: false,
}

describe('repo form', () => {
  it('shows services, prepare and start as one start script', () => {
    const f = configToForm(OLD)
    expect(f.startScript).toBe('docker run -d --name mogo-valkey valkey/valkey:8\npnpm exec prisma generate\npnpm dev')
    expect([f.runApp, f.appUrl, f.checks, f.install, f.stopCmd]).toEqual([
      true, 'http://localhost:8000/api/v1/health', 'pnpm lint\npnpm format:check',
      'corepack enable\npnpm install --frozen-lockfile', 'docker rm -f mogo-valkey',
    ])
  })
  it('saves the start script as prepare steps plus the last line as start', () => {
    const c = formToConfig(configToForm(OLD))
    expect([c.services_cmd, c.prepare, c.start]).toEqual([
      '', ['docker run -d --name mogo-valkey valkey/valkey:8', 'pnpm exec prisma generate'], 'pnpm dev',
    ])
    expect(c.gates).toEqual(OLD.gates)
    expect(c.setup).toEqual(OLD.setup)
    expect(c.healthcheck).toBe(OLD.healthcheck)
    expect('env' in c).toBe(false)
  })
  it('run the app off clears what boots the app', () => {
    const c = formToConfig({ ...configToForm(OLD), runApp: false })
    expect([c.start, c.prepare, c.healthcheck, c.services_cmd]).toEqual(['', [], '', ''])
    expect(configToForm({}).runApp).toBe(false)
  })
  it('validates the start script and URL when the app runs', () => {
    const f = configToForm({})
    expect(formError(f)).toBeNull()
    expect(formError({ ...f, runApp: true })).toContain('start script')
    expect(formError({ ...f, runApp: true, startScript: 'pnpm dev', appUrl: 'localhost' })).toContain('app URL')
    expect(formError({ ...f, runApp: true, startScript: 'pnpm dev', appUrl: 'http://localhost:3000' })).toBeNull()
  })
  it('suggestions fill only empty parts', () => {
    const s = { install: 'npm ci', checks: ['npm run lint'], test_cmd: 'npm test', start: 'npm run dev', app_url: 'http://localhost:3000', env_names: [] }
    const filled = applySuggestions(configToForm({}), s)
    expect([filled.checks, filled.testCmd, filled.runApp, filled.startScript, filled.appUrl]).toEqual([
      'npm run lint', 'npm test', true, 'npm run dev', 'http://localhost:3000',
    ])
    expect(applySuggestions(configToForm(OLD), s).checks).toBe('pnpm lint\npnpm format:check')
  })
  it('lists env_from names left over from the old setup', () => {
    expect(legacyEnvFrom({ env_from: { JWT: 'A_JWT', DB: 'A_DB' } })).toEqual(['DB', 'JWT'])
    expect(legacyEnvFrom({ env_from: ['X'] })).toEqual(['X'])
    expect(legacyEnvFrom({})).toEqual([])
  })
})
