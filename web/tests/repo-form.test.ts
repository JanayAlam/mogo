import { describe, expect, it } from 'vitest'

import { configToForm, defaultRepoConfig, dockerPortHint, formError, formToConfig, legacyEnvFrom, type ConfigForm } from '@/lib/repo-form'
import { compileDocker, DOCKER_FILE_NAME } from '@/lib/stack'
import { validateRepoConfig, validateRepoInput } from '@/lib/validate'

const form = (patch: Partial<ConfigForm> = {}): ConfigForm => ({ ...configToForm({}), ...patch })

// a repo as saved before Docker was the only way to run: commands, a stack and scripts
const OLD = {
  setup: ['corepack enable', 'pnpm install --frozen-lockfile'],
  gates: ['pnpm lint', 'pnpm format:check'],
  test_cmd: 'pnpm test',
  services_cmd: 'docker run -d --name mogo-valkey valkey/valkey:8',
  services_down: 'docker rm -f mogo-valkey',
  prepare: ['pnpm exec prisma generate'],
  start: 'pnpm dev',
  healthcheck: 'http://localhost:8000/api/v1/health',
  conventions: ['CLAUDE.md'],
  rules: ['no console.log'],
  notes: 'log in with OTP',
  allow_forks: true,
  stack: 'express',
  scripts: { lint: 'pnpm lint' },
}

describe('compileDocker', () => {
  it('Compose, the default file: up, follow the logs while the ready URL is polled, down with volumes', () => {
    expect(compileDocker({ mode: 'compose', file: '', port: 0 }, '')).toEqual({
      prepare: ['docker compose -p mogo-app -f docker-compose.yaml up -d --build'],
      start: 'docker compose -p mogo-app -f docker-compose.yaml logs -f',
      services_down: 'docker compose -p mogo-app -f docker-compose.yaml down -v --remove-orphans',
      healthcheck: '', // empty: the runner reads the published port from the compose file
    })
  })
  it('Compose with its own file and a ready URL', () => {
    const c = compileDocker({ mode: 'compose', file: 'docker-compose.prod.yml', port: 0 }, ' http://localhost:8000/health ')
    expect([c.prepare[0], c.start, c.services_down, c.healthcheck]).toEqual([
      'docker compose -p mogo-app -f docker-compose.prod.yml up -d --build',
      'docker compose -p mogo-app -f docker-compose.prod.yml logs -f',
      'docker compose -p mogo-app -f docker-compose.prod.yml down -v --remove-orphans',
      'http://localhost:8000/health',
    ])
  })
  it('Dockerfile, default name: build, run with the port published and the variables passed in, remove it', () => {
    expect(compileDocker({ mode: 'dockerfile', file: '', port: 8080 }, '')).toEqual({
      prepare: ['docker build -t mogo-app .'],
      start: 'docker run --rm --name mogo-app -p 8080:8080 $MOGO_DOCKER_ENV mogo-app',
      services_down: 'docker rm -f mogo-app',
      healthcheck: 'http://localhost:8080',
    })
  })
  it('Dockerfile with its own name and ready URL, the usual port when none is given', () => {
    const c = compileDocker({ mode: 'dockerfile', file: 'Dockerfile.dev', port: 0 }, ' http://localhost:3000/health ')
    expect(c.prepare).toEqual(['docker build -f Dockerfile.dev -t mogo-app .'])
    expect(c.start).toContain('-p 3000:3000')
    expect(c.healthcheck).toBe('http://localhost:3000/health')
  })
  it('accepts only file names at the repo root', () => {
    for (const ok of ['Dockerfile', 'Dockerfile.dev', 'docker-compose.prod.yml', 'api.Dockerfile']) expect(DOCKER_FILE_NAME.test(ok)).toBe(true)
    for (const bad of ['', '../x', '/etc/x', 'a/b', 'a b', 'x;y', '$(id)', '-f', '.env', 'a\nb']) expect(DOCKER_FILE_NAME.test(bad)).toBe(false)
  })
})

describe('repo form: Docker only', () => {
  it('starts as Docker Compose', () => {
    expect(configToForm({})).toMatchObject({ dockerMode: 'compose', dockerFile: '', dockerPort: '', appUrl: '' })
  })
  it('compiles a Compose repo and writes none of the removed keys', () => {
    const c = formToConfig(form({ dockerPort: '9' }))
    for (const k of ['setup', 'gates', 'test_cmd', 'services_cmd', 'stack', 'scripts']) expect(c).not.toHaveProperty(k)
    expect([c.docker_mode, c.docker_file, c.docker_port]).toEqual(['compose', '', 0]) // a port is a Dockerfile's
    expect(c.start).toBe('docker compose -p mogo-app -f docker-compose.yaml logs -f')
    expect(c.healthcheck).toBe('')
  })
  it('compiles a Compose repo with its own file and ready URL', () => {
    const c = formToConfig(form({ dockerFile: 'compose.prod.yaml', appUrl: 'http://localhost:4000' }))
    expect([c.docker_file, c.healthcheck]).toEqual(['compose.prod.yaml', 'http://localhost:4000'])
    expect(c.start).toBe('docker compose -p mogo-app -f compose.prod.yaml logs -f')
  })
  it('compiles a Dockerfile repo', () => {
    const c = formToConfig(form({ dockerMode: 'dockerfile', dockerPort: '8080' }))
    expect([c.docker_mode, c.docker_file, c.docker_port]).toEqual(['dockerfile', '', 8080])
    expect(c.start).toContain('-p 8080:8080')
  })
  it('keeps conventions, rules, notes and allow_forks', () => {
    const c = formToConfig(form({ conventions: 'CLAUDE.md\n', rules: 'a\n\nb', notes: 'n', allowForks: true }))
    expect([c.conventions, c.rules, c.notes, c.allow_forks]).toEqual([['CLAUDE.md'], ['a', 'b'], 'n', true])
  })
  it('round-trips', () => {
    for (const patch of [{}, { dockerFile: 'x.yml', appUrl: 'http://localhost:4000' }, { dockerMode: 'dockerfile' as const, dockerPort: '8080' }]) {
      const f = form(patch)
      expect(configToForm(formToConfig(f))).toMatchObject({ dockerMode: f.dockerMode, dockerFile: f.dockerFile, dockerPort: f.dockerPort })
    }
    expect(configToForm(formToConfig(form({ appUrl: 'http://localhost:4000' }))).appUrl).toBe('http://localhost:4000')
    expect(configToForm(formToConfig(form())).appUrl).toBe('') // Compose: left empty, the runner reads the port
    expect(configToForm(formToConfig(form({ dockerMode: 'dockerfile', dockerPort: '8080' }))).appUrl).toBe('http://localhost:8080') // a Dockerfile's is its port
  })
  it('reads a Docker repo saved as commands only: a `docker run` is a Dockerfile, anything else Compose', () => {
    const f = configToForm({ start: 'docker run --rm --name mogo-app -p 8080:8080 $MOGO_DOCKER_ENV mogo-app' })
    expect([f.dockerMode, f.dockerFile, f.dockerPort]).toEqual(['dockerfile', '', '8080'])
    expect(configToForm({ start: 'docker compose logs -f' }).dockerMode).toBe('compose')
  })
  it('opens a config from before Docker-only as Compose, keeping what is still used', () => {
    const f = configToForm(OLD)
    expect(f).toEqual({
      appUrl: '', conventions: 'CLAUDE.md', rules: 'no console.log', notes: 'log in with OTP', allowForks: true,
      dockerMode: 'compose', dockerFile: '', dockerPort: '',
    })
    const c = formToConfig(f)
    expect([c.start, c.docker_mode]).toEqual(['docker compose -p mogo-app -f docker-compose.yaml logs -f', 'compose'])
  })
  it.each([
    [{ dockerFile: '../Dockerfile' }, /file name/],
    [{ dockerFile: 'a b' }, /file name/],
    [{ dockerMode: 'dockerfile' as const, dockerPort: '70000' }, /port/],
    [{ dockerMode: 'dockerfile' as const, dockerPort: '0' }, /port/],
    [{ appUrl: 'localhost' }, /http/],
  ])('refuses %j', (patch, message) => {
    expect(formError(form(patch))).toMatch(message)
  })
  it('accepts the plain cases, with no ready URL at all', () => {
    expect(formError(form())).toBeNull() // the runner finds the port in the compose file
    expect(formError(form({ dockerFile: 'docker-compose.prod.yaml', appUrl: 'http://localhost:4000' }))).toBeNull()
    expect(formError(form({ dockerMode: 'dockerfile', dockerFile: 'Dockerfile.dev', dockerPort: '8080' }))).toBeNull()
  })
  it('shows the Dockerfile\'s port, else 3000, as the port hint', () => {
    expect(dockerPortHint({ env_names: [], docker_port: 8080 })).toBe(8080)
    expect(dockerPortHint(null)).toBe(3000)
  })
  it('lists env_from names left over from the old setup', () => {
    expect(legacyEnvFrom({ env_from: { JWT: 'A_JWT', DB: 'A_DB' } })).toEqual(['DB', 'JWT'])
    expect(legacyEnvFrom({ env_from: ['X'] })).toEqual(['X'])
    expect(legacyEnvFrom({})).toEqual([])
  })
})

describe('validateRepoConfig: Docker settings', () => {
  it('accepts the Docker settings', () => {
    expect(validateRepoConfig({ docker_mode: 'compose', docker_file: 'compose.prod.yaml', docker_port: 0 })).toEqual({
      docker_mode: 'compose', docker_file: 'compose.prod.yaml', docker_port: 0,
    })
    expect(validateRepoConfig({ docker_mode: '', docker_file: '', docker_port: 65535 })).toMatchObject({ docker_port: 65535 })
  })
  it.each([[{ docker_mode: 'swarm' }], [{ docker_file: '../x' }], [{ docker_file: 'a b' }], [{ docker_file: 5 }],
    [{ docker_file: 'a'.repeat(101) }], [{ docker_port: -1 }], [{ docker_port: 65536 }], [{ docker_port: 1.5 }], [{ docker_port: '80' }]])(
    'rejects %j', (c) => expect(typeof validateRepoConfig(c)).toBe('string'))
  it('drops the removed keys instead of failing, so an old client or config still saves', () => {
    expect(validateRepoConfig(OLD)).toEqual({
      services_down: OLD.services_down, prepare: OLD.prepare, start: OLD.start, healthcheck: OLD.healthcheck,
      conventions: OLD.conventions, rules: OLD.rules, notes: OLD.notes, allow_forks: true,
    })
  })
})

describe('a new repo starts as Docker Compose', () => {
  it('its settings bring up docker-compose.yaml without anyone opening the form', () => {
    const c = defaultRepoConfig()
    expect([c.docker_mode, c.docker_file, c.docker_port]).toEqual(['compose', '', 0])
    expect(c.prepare).toEqual(['docker compose -p mogo-app -f docker-compose.yaml up -d --build'])
    expect(c.start).toBe('docker compose -p mogo-app -f docker-compose.yaml logs -f')
    expect([c.healthcheck, c.services_down]).toEqual(['', 'docker compose -p mogo-app -f docker-compose.yaml down -v --remove-orphans'])
  })
  it('is what a repo gets when it is added without settings, and only then', () => {
    const added = validateRepoInput({ full_name: 'acme/api' }) as { config: { docker_mode: string } }
    expect(added.config.docker_mode).toBe('compose')
    const own = validateRepoInput({ full_name: 'acme/api', config: { docker_mode: 'dockerfile' } }) as { config: object }
    expect(own.config).toEqual({ docker_mode: 'dockerfile' })
    expect(validateRepoInput({ role: 'x' }, true)).not.toHaveProperty('config') // an edit does not add settings
  })
})
