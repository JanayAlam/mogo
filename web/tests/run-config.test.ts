import { describe, expect, it } from 'vitest'

import { applySuggestions, configToForm, formError, formToConfig, type ConfigForm } from '@/lib/repo-form'
import { compileDocker, DOCKER_FILE_NAME, isDockerStack, isNodeStack } from '@/lib/stack'
import { validateRepoConfig } from '@/lib/validate'

const form = (patch: Partial<ConfigForm> = {}): ConfigForm => ({ ...configToForm({}), ...patch })
const withScripts = (stack: string, scripts: Partial<ConfigForm['scripts']>, patch: Partial<ConfigForm> = {}) =>
  form({ stack, scripts: { ...configToForm({}).scripts, ...scripts }, ...patch })

describe('which kinds use package.json scripts, which Docker', () => {
  it.each(['nodejs', 'express', 'nestjs', 'nextjs'])('%s is a Node kind', (id) => expect(isNodeStack(id)).toBe(true))
  it.each(['python', 'fastapi', 'docker', ''])('%s is not', (id) => expect(isNodeStack(id)).toBe(false))
  it('knows Docker', () => {
    expect(isDockerStack('docker')).toBe(true)
    expect(isDockerStack('express')).toBe(false)
  })
})

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

describe('Node form: one field per command', () => {
  const s = {
    lint: 'pnpm lint', typecheck: 'pnpm exec tsc --noEmit', format: 'pnpm format:check', other: 'pnpm audit\npnpm knip',
    test: 'pnpm test', build: 'pnpm build', before: 'docker compose up -d db\npnpm prisma migrate deploy', run: 'pnpm dev',
  }
  it('compiles into what the runner reads', () => {
    const c = formToConfig(withScripts('express', s, { appUrl: 'http://localhost:8000' }))
    expect(c.gates).toEqual(['pnpm lint', 'pnpm exec tsc --noEmit', 'pnpm format:check', 'pnpm audit', 'pnpm knip'])
    expect(c.test_cmd).toBe('pnpm test')
    expect(c.prepare).toEqual(['pnpm build', 'docker compose up -d db', 'pnpm prisma migrate deploy']) // build first
    expect([c.start, c.healthcheck, c.stack]).toEqual(['pnpm dev', 'http://localhost:8000', 'express'])
  })
  it('keeps every field apart for the next time it is opened', () => {
    const saved = formToConfig(withScripts('nestjs', s))
    expect(saved.scripts).toEqual({ ...s, other: ['pnpm audit', 'pnpm knip'], before: ['docker compose up -d db', 'pnpm prisma migrate deploy'] })
    expect(configToForm(saved).scripts).toEqual(s)
  })
  it('does not run the build or the steps before when there is nothing to run', () => {
    const c = formToConfig(withScripts('nodejs', { ...s, run: '' }, { appUrl: 'http://x' }))
    expect([c.start, c.prepare, c.healthcheck]).toEqual(['', [], ''])
    expect(c.gates).toContain('pnpm build') // so the build is still verified
    expect(c.gates).toHaveLength(6)
  })
  it('leaves out empty fields', () => {
    const c = formToConfig(withScripts('express', { lint: ' pnpm lint ' }))
    expect([c.gates, c.test_cmd, c.prepare, c.start]).toEqual([['pnpm lint'], '', [], ''])
  })
  it('opens a config saved before the fields existed, each check in its own field', () => {
    const f = configToForm({
      stack: 'express', gates: ['pnpm lint', 'pnpm format:check', 'pnpm exec tsc --noEmit', 'pnpm audit', 'eslint .'],
      test_cmd: 'pnpm test', prepare: ['pnpm prisma migrate deploy'], start: 'pnpm dev',
    })
    expect(f.scripts).toMatchObject({
      lint: 'pnpm lint', format: 'pnpm format:check', typecheck: 'pnpm exec tsc --noEmit',
      other: 'pnpm audit\neslint .', // a second lint, and one that is none of the three
      test: 'pnpm test', before: 'pnpm prisma migrate deploy', run: 'pnpm dev',
    })
  })
  it('a ready URL is checked only when something runs', () => {
    expect(formError(withScripts('express', { run: 'pnpm dev' }, { appUrl: 'localhost:3000' }))).toMatch(/http/)
    expect(formError(withScripts('express', { run: '' }, { appUrl: 'localhost:3000' }))).toBeNull()
    expect(formError(withScripts('express', { run: 'pnpm dev' }, { appUrl: 'http://localhost:3000' }))).toBeNull()
  })
})

describe('Docker form: no checks, no scripts', () => {
  const docker = (patch: Partial<ConfigForm> = {}) => form({ stack: 'docker', ...patch })
  it('starts as Docker Compose', () => {
    expect(configToForm({ stack: 'docker' })).toMatchObject({ dockerMode: 'compose', dockerFile: '', dockerPort: '' })
  })
  it('compiles a Compose repo and drops everything a Docker repo does not use', () => {
    const c = formToConfig(docker({
      checks: 'pnpm lint', testCmd: 'pnpm test', install: 'pnpm i', dockerPort: '9',
      scripts: { ...configToForm({}).scripts, lint: 'pnpm lint', run: 'pnpm dev' },
    }))
    expect([c.gates, c.setup, c.test_cmd]).toEqual([[], [], ''])
    expect(c).not.toHaveProperty('scripts')
    expect([c.docker_mode, c.docker_file, c.docker_port]).toEqual(['compose', '', 0]) // a port is a Dockerfile's
    expect(c.start).toBe('docker compose -p mogo-app -f docker-compose.yaml logs -f')
    expect(c.healthcheck).toBe('')
  })
  it('compiles a Compose repo with its own file and ready URL', () => {
    const c = formToConfig(docker({ dockerFile: 'compose.prod.yaml', appUrl: 'http://localhost:4000' }))
    expect([c.docker_file, c.healthcheck]).toEqual(['compose.prod.yaml', 'http://localhost:4000'])
    expect(c.start).toBe('docker compose -p mogo-app -f compose.prod.yaml logs -f')
  })
  it('compiles a Dockerfile repo', () => {
    const c = formToConfig(docker({ dockerMode: 'dockerfile', dockerPort: '8080' }))
    expect([c.docker_mode, c.docker_file, c.docker_port]).toEqual(['dockerfile', '', 8080])
    expect(c.start).toContain('-p 8080:8080')
  })
  it('round-trips', () => {
    for (const patch of [{}, { dockerFile: 'x.yml', appUrl: 'http://localhost:4000' }, { dockerMode: 'dockerfile' as const, dockerPort: '8080' }]) {
      const f = docker(patch)
      expect(configToForm(formToConfig(f))).toMatchObject({ stack: 'docker', dockerMode: f.dockerMode, dockerFile: f.dockerFile, dockerPort: f.dockerPort })
    }
    expect(configToForm(formToConfig(docker({ appUrl: 'http://localhost:4000' }))).appUrl).toBe('http://localhost:4000')
    expect(configToForm(formToConfig(docker())).appUrl).toBe('') // Compose: left empty, the runner reads the port
    expect(configToForm(formToConfig(docker({ dockerMode: 'dockerfile', dockerPort: '8080' }))).appUrl).toBe('http://localhost:8080') // a Dockerfile's is its port
  })
  it('reads a Docker repo saved as commands only: a `docker run` is a Dockerfile, anything else Compose', () => {
    const f = configToForm({ stack: 'docker', start: 'docker run --rm --name mogo-app -p 8080:8080 $MOGO_DOCKER_ENV mogo-app' })
    expect([f.dockerMode, f.dockerFile, f.dockerPort]).toEqual(['dockerfile', '', '8080'])
    expect(configToForm({ stack: 'docker', start: 'docker compose logs -f' }).dockerMode).toBe('compose')
  })
  it.each([
    [{ dockerFile: '../Dockerfile' }, /file name/],
    [{ dockerFile: 'a b' }, /file name/],
    [{ dockerMode: 'dockerfile' as const, dockerPort: '70000' }, /port/],
    [{ dockerMode: 'dockerfile' as const, dockerPort: '0' }, /port/],
    [{ appUrl: 'localhost' }, /http/],
  ])('refuses %j', (patch, message) => {
    expect(formError(docker(patch))).toMatch(message)
  })
  it('accepts the plain cases, with no ready URL at all', () => {
    expect(formError(docker())).toBeNull() // the runner finds the port in the compose file
    expect(formError(docker({ dockerFile: 'docker-compose.prod.yaml', appUrl: 'http://localhost:4000' }))).toBeNull()
    expect(formError(docker({ dockerMode: 'dockerfile', dockerFile: 'Dockerfile.dev', dockerPort: '8080' }))).toBeNull()
  })
})

describe('other kinds keep the generic form', () => {
  it('python and not set compile as before', () => {
    const f = form({ stack: 'python', checks: 'ruff check .', testCmd: 'pytest', runApp: true, startScript: 'make db\nuvicorn app:app', appUrl: 'http://localhost:8000' })
    const c = formToConfig(f)
    expect([c.gates, c.test_cmd, c.prepare, c.start, c.healthcheck]).toEqual([['ruff check .'], 'pytest', ['make db'], 'uvicorn app:app', 'http://localhost:8000'])
    expect(c).not.toHaveProperty('scripts')
    expect(formError(form({ stack: 'python', runApp: true }))).toMatch(/start script/)
  })
})

describe('applySuggestions fills the Node fields', () => {
  const s = {
    install: '', checks: ['pnpm lint'], test_cmd: 'pnpm test', start: 'pnpm dev', app_url: 'http://localhost:8000', env_names: [],
    fields: { lint: 'pnpm lint', typecheck: 'pnpm exec tsc --noEmit', format: '', test: 'pnpm test', build: 'pnpm build', run: 'pnpm dev' },
    docker_port: 8080,
  }
  it('only the empty ones', () => {
    const f = applySuggestions(withScripts('express', { lint: 'eslint .' }), s)
    expect(f.scripts).toMatchObject({ lint: 'eslint .', typecheck: 'pnpm exec tsc --noEmit', format: '', test: 'pnpm test', build: 'pnpm build', run: 'pnpm dev' })
    expect(f.dockerPort).toBe('8080')
    expect(applySuggestions(form({ dockerPort: '9000' }), s).dockerPort).toBe('9000')
  })
  it('copes with suggestions from before the fields existed', () => {
    const old = { ...s, fields: undefined, docker_port: undefined }
    expect(applySuggestions(form(), old).scripts).toMatchObject({ lint: '', run: '' })
  })
})

describe('validateRepoConfig: run settings', () => {
  const scripts = { lint: ' pnpm lint ', typecheck: '', format: '', other: [' a ', ''], test: '', build: '', before: ['b'], run: 'pnpm dev' }
  it('accepts and tidies the scripts', () => {
    expect(validateRepoConfig({ scripts })).toEqual({ scripts: { ...scripts, lint: 'pnpm lint', other: ['a'] } })
    expect(validateRepoConfig({ scripts: { lint: 'x' } })).toMatchObject({ scripts: { lint: 'x', other: [], before: [], run: '' } }) // missing = empty
  })
  it.each([[{ scripts: 'x' }], [{ scripts: { lint: 5 } }], [{ scripts: { other: 'a' } }], [{ scripts: { before: [1] } }],
    [{ scripts: { run: 'x'.repeat(4001) } }]])('rejects %j', (c) => expect(typeof validateRepoConfig(c)).toBe('string'))
  it('accepts the Docker settings', () => {
    expect(validateRepoConfig({ docker_mode: 'compose', docker_file: 'compose.prod.yaml', docker_port: 0 })).toEqual({
      docker_mode: 'compose', docker_file: 'compose.prod.yaml', docker_port: 0,
    })
    expect(validateRepoConfig({ docker_mode: '', docker_file: '', docker_port: 65535 })).toMatchObject({ docker_port: 65535 })
  })
  it.each([[{ docker_mode: 'swarm' }], [{ docker_file: '../x' }], [{ docker_file: 'a b' }], [{ docker_file: 5 }],
    [{ docker_file: 'a'.repeat(101) }], [{ docker_port: -1 }], [{ docker_port: 65536 }], [{ docker_port: 1.5 }], [{ docker_port: '80' }]])(
    'rejects %j', (c) => expect(typeof validateRepoConfig(c)).toBe('string'))
})

describe('a new repo starts as Docker Compose', () => {
  it('its settings bring up docker-compose.yaml without anyone opening the form', async () => {
    const { defaultRepoConfig } = await import('@/lib/repo-form')
    const c = defaultRepoConfig()
    expect([c.stack, c.docker_mode, c.docker_file, c.docker_port]).toEqual(['docker', 'compose', '', 0])
    expect(c.prepare).toEqual(['docker compose -p mogo-app -f docker-compose.yaml up -d --build'])
    expect(c.start).toBe('docker compose -p mogo-app -f docker-compose.yaml logs -f')
    expect([c.healthcheck, c.services_down, c.gates, c.test_cmd]).toEqual(['', 'docker compose -p mogo-app -f docker-compose.yaml down -v --remove-orphans', [], ''])
  })
  it('is what a repo gets when it is added without settings, and only then', async () => {
    const { validateRepoInput } = await import('@/lib/validate')
    const added = validateRepoInput({ full_name: 'acme/api' })
    expect(typeof added).toBe('object')
    expect((added as { config: { stack: string } }).config.stack).toBe('docker')
    const own = validateRepoInput({ full_name: 'acme/api', config: { stack: 'express', gates: ['x'] } }) as { config: object }
    expect(own.config).toEqual({ stack: 'express', gates: ['x'] })
    expect(validateRepoInput({ role: 'x' }, true)).not.toHaveProperty('config') // an edit does not add settings
  })
})
