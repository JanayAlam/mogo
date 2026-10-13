import type { Suggestions } from '@/lib/projects'

/**
 * Reads a repo's own root files and suggests its settings: install, checks, test, start, app URL, env names, its stack
 * and Docker files. The same detection as the runner's (backend/mogo/profile/detect.py), so a repo can be read
 * straight from GitHub by the web app without starting the runner.
 *
 * The two must agree: backend/tests/data/detect_cases.json holds repos and what the Python detection makes of them,
 * and web/tests/detect.test.ts checks this one against it. Change one, change the other, regenerate the file
 * (PYTHONPATH=. python tests/regen_detect_cases.py in backend/).
 */
export const ENV_EXAMPLES = ['.env.example', '.env.sample', '.env.template', '.env.dist']
/** The root files `detect` may read. */
export const DETECT_FILES = ['package.json', 'pyproject.toml', 'requirements.txt', 'Dockerfile', ...ENV_EXAMPLES]

const NPM_DEFAULT_TEST = 'no test specified'

// First script found in each group becomes a check.
const CHECK_GROUPS = [
  ['lint', 'lint:check', 'eslint'],
  ['typecheck', 'type-check', 'check-types', 'types:check', 'tsc'],
  ['format:check', 'prettier:check', 'fmt:check', 'format-check'],
] as const
const START_SCRIPTS = ['dev', 'start:dev', 'develop', 'serve', 'start']
const FRAMEWORK_PORTS: [string, number][] = [
  ['next', 3000], ['nuxt', 3000], ['@remix-run/dev', 3000], ['@nestjs/core', 3000], ['astro', 4321],
  ['vite', 5173], ['express', 3000], ['fastify', 3000],
]
const COMPOSE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
const MAX_SCRIPTS = 80

type Dict = Record<string, unknown>
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v)

export type Read = (name: string) => string | undefined

export function packageManager(names: Set<string>): string | null {
  for (const [lock, pm] of [
    ['pnpm-lock.yaml', 'pnpm'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'],
  ]) {
    if (names.has(lock)) return pm
  }
  return names.has('package.json') ? 'npm' : null
}

/** The install command for a repo root with these file names ('' when nothing is recognised). */
export function installCommand(names: Set<string>): string {
  const pm = packageManager(names)
  if (pm === 'pnpm') return 'corepack enable && pnpm install --frozen-lockfile'
  if (pm === 'yarn') return names.has('.yarnrc.yml') ? 'corepack enable && yarn install --immutable' : 'yarn install --frozen-lockfile'
  if (pm === 'bun') return 'bun install --frozen-lockfile'
  if (pm === 'npm') return names.has('package-lock.json') ? 'npm ci' : 'npm install'
  if (names.has('uv.lock')) return 'uv sync'
  if (names.has('poetry.lock')) return 'poetry install'
  if (names.has('requirements.txt')) return 'pip install -r requirements.txt'
  return ''
}

const run = (pm: string, script: string) =>
  ({ pnpm: `pnpm ${script}`, yarn: `yarn ${script}`, bun: `bun run ${script}` })[pm] ?? `npm run ${script}`
const exec = (pm: string, cmd: string) =>
  ({ pnpm: `pnpm exec ${cmd}`, yarn: `yarn ${cmd}`, bun: `bunx ${cmd}` })[pm] ?? `npx ${cmd}`

export function envNames(text: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m && !names.includes(m[1])) names.push(m[1])
  }
  return names
}

function port(envText: string, scripts: Dict, deps: Dict): number {
  const env = /^\s*PORT\s*=\s*["']?(\d{2,5})/m.exec(envText)
  if (env) return Number(env[1])
  for (const name of START_SCRIPTS) {
    const body = scripts[name]
    const m = /(?:--port[= ]|-p\s*)(\d{2,5})/.exec(typeof body === 'string' ? body : '')
    if (m) return Number(m[1])
  }
  for (const [dep, p] of FRAMEWORK_PORTS) if (dep in deps) return p
  return 3000
}

function packageJson(read: Read): Dict {
  try {
    const pkg: unknown = JSON.parse(read('package.json') || '{}')
    return isDict(pkg) ? pkg : {}
  } catch {
    return {}
  }
}

const depsOf = (pkg: Dict): Dict => ({
  ...(isDict(pkg.dependencies) ? pkg.dependencies : {}),
  ...(isDict(pkg.devDependencies) ? pkg.devDependencies : {}),
})

/** A Python dependency named `name` in requirements or pyproject text (not `fastapi-utils`, not a comment). */
function mentions(text: string, name: string): boolean {
  return new RegExp(`^[^#\\n]*(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'im').test(text)
}

/**
 * What the repo is, as an id of lib/stack.ts ('' when not recognised). A framework dependency decides first (Next.js,
 * then NestJS, which sits on Express, then Express); Python project files come before a bare package.json, which a
 * Python repo may have for its tooling. Docker is never detected: it is chosen.
 */
export function detectStack(names: Set<string>, read: Read): string {
  const deps = names.has('package.json') ? depsOf(packageJson(read)) : {}
  for (const [dep, stack] of [['next', 'nextjs'], ['@nestjs/core', 'nestjs'], ['express', 'express']]) {
    if (dep in deps) return stack
  }
  if (['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].some((n) => names.has(n))) {
    const text = ['pyproject.toml', 'requirements.txt'].map((n) => read(n) ?? '').join('\n')
    return mentions(text, 'fastapi') ? 'fastapi' : 'python'
  }
  return names.has('package.json') ? 'nodejs' : ''
}

/** The root Docker files: the default Dockerfile (and its first EXPOSE port, 0 when none), every Dockerfile-like name and Compose file. */
export function detectDocker(names: Set<string>, read: Read) {
  const sorted = [...names].sort()
  const dockerfile = names.has('Dockerfile')
  const expose = dockerfile ? /^\s*EXPOSE\s+(\d{1,5})/im.exec(read('Dockerfile') ?? '') : null
  return {
    dockerfile,
    docker_port: expose ? Number(expose[1]) : 0,
    dockerfiles: sorted.filter((n) => n === 'Dockerfile' || n.startsWith('Dockerfile.') || n.endsWith('.Dockerfile')),
    compose_files: sorted.filter((n) => COMPOSE_NAMES.includes(n) || /^(docker-)?compose[.-].+\.ya?ml$/.test(n)),
  }
}

type Detected = Required<Pick<Suggestions, 'install' | 'checks' | 'test_cmd' | 'start' | 'app_url' | 'env_names' | 'fields' | 'scripts'>> &
  ReturnType<typeof detectDocker> & { stack: string; package_manager?: string }

/** Suggested settings. `names` are the file names at the repo root, `read(name)` returns a root file's text. */
export function detect(names: Set<string>, read: Read): Detected {
  const out: Detected = {
    install: installCommand(names),
    checks: [],
    test_cmd: '',
    start: '',
    app_url: '',
    env_names: [],
    stack: detectStack(names, read),
    ...detectDocker(names, read),
    // the same commands per form field (empty when the repo has no such script), and every script
    fields: { lint: '', typecheck: '', format: '', test: '', build: '', run: '' },
    scripts: [],
  }
  const envFile = ENV_EXAMPLES.find((n) => names.has(n))
  const envText = envFile ? (read(envFile) ?? '') : ''
  out.env_names = envNames(envText)

  const pm = packageManager(names)
  if (pm) {
    out.package_manager = pm
    const pkg = packageJson(read)
    const scripts = isDict(pkg.scripts) ? pkg.scripts : {}
    const deps = depsOf(pkg)
    const fields = out.fields
    ;(['lint', 'typecheck', 'format'] as const).forEach((field, i) => {
      const found = CHECK_GROUPS[i].find((s) => s in scripts)
      if (found) {
        fields[field] = run(pm, found)
        out.checks.push(fields[field])
      }
    })
    const hasTypesCheck = CHECK_GROUPS[1].some((s) => s in scripts)
    if (!hasTypesCheck && names.has('tsconfig.json') && 'typescript' in deps) {
      fields.typecheck = exec(pm, 'tsc --noEmit')
      out.checks.push(fields.typecheck)
    }
    const test = scripts.test
    if (typeof test === 'string' && test && !test.includes(NPM_DEFAULT_TEST)) fields.test = out.test_cmd = run(pm, 'test')
    if ('build' in scripts) fields.build = run(pm, 'build')
    const start = START_SCRIPTS.find((s) => s in scripts)
    if (start) {
      fields.run = out.start = run(pm, start)
      out.app_url = `http://localhost:${port(envText, scripts, deps)}`
    }
    out.scripts = Object.entries(scripts)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([name, body]) => ({ name, run: run(pm, name), body: body.slice(0, 120) }))
      .slice(0, MAX_SCRIPTS)
  } else if (names.has('pyproject.toml')) {
    out.package_manager = 'python'
    const py = read('pyproject.toml') ?? ''
    if (py.includes('ruff')) out.checks.push('ruff check .')
    if (py.includes('mypy')) out.checks.push('mypy .')
    if (py.includes('pytest')) out.test_cmd = 'pytest -q'
  }
  return out
}
