import type { NodeScripts, RepoConfig, Suggestions } from '@/lib/projects'
import {
  compileDocker, defaultPort, DOCKER_FILE_NAME, type DockerMode, isDockerStack, isNodeStack,
} from '@/lib/stack'

/** Repo roles the UI suggests. Any text is allowed: the LLM reads it as written. */
export const ROLE_SUGGESTIONS = ['backend', 'frontend', 'admin-frontend', 'mobile', 'shared-lib', 'infra', 'worker']

export const toLines = (v: string[] | undefined) => (v ?? []).join('\n')
export const fromLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** The commands of a Node.js, TypeScript or JavaScript repo as the form holds them (lists as one line per entry). */
export interface NodeScriptsForm {
  lint: string
  typecheck: string
  format: string
  other: string
  test: string
  build: string
  before: string
  run: string
}

/**
 * The repo form as the user sees it. It maps onto the runner's settings (RepoConfig) without changing them. What the
 * form shows depends on the type (`stack`), and so does the mapping:
 *  - Node.js, TypeScript, JavaScript (Node.js, Express, NestJS, Next.js): one field per command. Lint, type check,
 *    format and other checks are the checks (gates); test is the test command; build and "before running" run before
 *    the app starts; run starts it.
 *  - Docker: a Dockerfile or Compose file; the commands that build, run and stop it are compiled from that.
 *  - otherwise (Python, not set): checks = gates; the start script's last line is `start`, earlier lines run first as
 *    `prepare`; install, test and stop commands are advanced overrides.
 */
export interface ConfigForm {
  checks: string
  runApp: boolean
  startScript: string
  appUrl: string
  conventions: string
  rules: string
  notes: string
  install: string // empty: the runner installs from the lockfile
  testCmd: string
  stopCmd: string
  allowForks: boolean
  stack: string // '' = not set
  scripts: NodeScriptsForm
  dockerMode: DockerMode
  dockerFile: string // '' = the default name
  dockerPort: string // '' = the Dockerfile's / the usual port
}

const EMPTY_SCRIPTS: NodeScriptsForm = { lint: '', typecheck: '', format: '', other: '', test: '', build: '', before: '', run: '' }

/** Checks saved before the form had a field per command: put each where it belongs, the rest under "other". */
function classifyChecks(gates: string[]): Pick<NodeScriptsForm, 'lint' | 'typecheck' | 'format' | 'other'> {
  const out = { lint: '', typecheck: '', format: '', other: [] as string[] }
  for (const g of gates) {
    const field = /\b(tsc|type-?check|check-types)\b/i.test(g)
      ? 'typecheck'
      : /\b(format|prettier|fmt)\b/i.test(g)
        ? 'format'
        : /lint/i.test(g)
          ? 'lint'
          : null
    if (field && !out[field]) out[field] = g
    else out.other.push(g)
  }
  return { ...out, other: out.other.join('\n') }
}

function scriptsToForm(c: Partial<RepoConfig>): NodeScriptsForm {
  if (c.scripts) {
    return { ...c.scripts, other: toLines(c.scripts.other), before: toLines(c.scripts.before) }
  }
  // saved before the fields existed: derive them from what the runner reads
  return {
    ...EMPTY_SCRIPTS,
    ...classifyChecks(c.gates ?? []),
    test: c.test_cmd ?? '',
    before: toLines([c.services_cmd ?? '', ...(c.prepare ?? [])].map((l) => l.trim()).filter(Boolean)),
    run: c.start ?? '',
  }
}

/** A Docker repo saved by an earlier version has only commands: its port is in the `docker run` line. */
const portOf = (c: Partial<RepoConfig>) => c.docker_port || Number(/-p\s+(\d{2,5}):/.exec(c.start ?? '')?.[1]) || 0

export function configToForm(c: Partial<RepoConfig>): ConfigForm {
  const startLines = [c.services_cmd ?? '', ...(c.prepare ?? []), c.start ?? ''].map((l) => l.trim()).filter(Boolean)
  return {
    checks: toLines(c.gates),
    runApp: !!c.start,
    startScript: c.start ? startLines.join('\n') : '',
    appUrl: c.healthcheck ?? '',
    conventions: toLines(c.conventions),
    rules: toLines(c.rules),
    notes: c.notes ?? '',
    install: toLines(c.setup),
    testCmd: c.test_cmd ?? '',
    stopCmd: c.services_down ?? '',
    allowForks: c.allow_forks ?? false,
    stack: c.stack ?? '',
    scripts: scriptsToForm(c),
    // Compose unless it is a Dockerfile (a Docker repo saved as commands only has no mode: its `docker run` says)
    dockerMode: c.docker_mode === 'dockerfile' || (!c.docker_mode && /\bdocker run\b/.test(c.start ?? '')) ? 'dockerfile' : 'compose',
    dockerFile: c.docker_file ?? '',
    dockerPort: portOf(c) ? String(portOf(c)) : '',
  }
}

const trimmed = (v: string[]) => v.map((x) => x.trim()).filter(Boolean)

export function formToConfig(f: ConfigForm): Partial<RepoConfig> {
  const shared = {
    conventions: fromLines(f.conventions),
    rules: fromLines(f.rules),
    notes: f.notes,
    allow_forks: f.allowForks,
    stack: f.stack,
    services_cmd: '',
  }

  if (isDockerStack(f.stack)) {
    const port = Number(f.dockerPort) || 0
    const d = compileDocker({ mode: f.dockerMode, file: f.dockerFile.trim(), port }, f.appUrl)
    return {
      ...shared,
      gates: [],
      setup: [],
      test_cmd: '',
      prepare: d.prepare,
      start: d.start,
      healthcheck: d.healthcheck,
      services_down: d.services_down,
      docker_mode: f.dockerMode,
      docker_file: f.dockerFile.trim(),
      docker_port: f.dockerMode === 'dockerfile' ? port : 0,
    }
  }

  if (isNodeStack(f.stack)) {
    const s = f.scripts
    const run = s.run.trim()
    const build = s.build.trim()
    const scripts: NodeScripts = {
      lint: s.lint.trim(),
      typecheck: s.typecheck.trim(),
      format: s.format.trim(),
      other: fromLines(s.other),
      test: s.test.trim(),
      build,
      before: fromLines(s.before),
      run,
    }
    const checks = trimmed([scripts.lint, scripts.typecheck, scripts.format, ...scripts.other])
    return {
      ...shared,
      scripts,
      // the build is a step before the app starts; with no app to start it is a check, so it still runs
      gates: run || !build ? checks : [...checks, build],
      setup: fromLines(f.install),
      test_cmd: scripts.test,
      prepare: run ? trimmed([build, ...scripts.before]) : [],
      start: run,
      healthcheck: run ? f.appUrl.trim() : '',
      services_down: f.stopCmd.trim(),
    }
  }

  const start = f.runApp ? fromLines(f.startScript) : []
  return {
    ...shared,
    gates: fromLines(f.checks),
    setup: fromLines(f.install),
    test_cmd: f.testCmd.trim(),
    prepare: start.slice(0, -1),
    start: start.at(-1) ?? '',
    healthcheck: f.runApp ? f.appUrl.trim() : '',
    services_down: f.stopCmd.trim(),
  }
}

const URL_OK = /^https?:\/\/\S+$/

/** What is wrong with the form before saving, or null. */
export function formError(f: ConfigForm): string | null {
  const url = f.appUrl.trim()
  if (isDockerStack(f.stack)) {
    if (f.dockerFile.trim() && !DOCKER_FILE_NAME.test(f.dockerFile.trim())) {
      return 'The Docker file name must be a file at the repo root: letters, digits, . - _'
    }
    const port = f.dockerPort.trim()
    if (f.dockerMode === 'dockerfile' && port && !(Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535)) {
      return 'The port must be a number from 1 to 65535.'
    }
    return url && !URL_OK.test(url) ? 'The ready URL must start with http:// or https://' : null
  }
  if (isNodeStack(f.stack)) {
    return f.scripts.run.trim() && url && !URL_OK.test(url) ? 'The ready URL must start with http:// or https://' : null
  }
  if (!f.runApp) return null
  if (!fromLines(f.startScript).length) return 'Run the app is on: add the start script, or switch it off.'
  return url && !URL_OK.test(url) ? 'The ready URL must start with http:// or https://' : null
}

/** Fills the form from settings detected on the branch; only empty parts are filled. */
export function applySuggestions(f: ConfigForm, s: Suggestions): ConfigForm {
  const fields = s.fields
  const fill = (cur: string, found: string | undefined) => (cur.trim() ? cur : (found ?? ''))
  return {
    ...f,
    checks: f.checks.trim() ? f.checks : s.checks.join('\n'),
    testCmd: f.testCmd.trim() ? f.testCmd : s.test_cmd,
    runApp: f.runApp || !!s.start,
    startScript: f.startScript.trim() ? f.startScript : s.start,
    appUrl: f.appUrl.trim() ? f.appUrl : s.app_url,
    scripts: {
      ...f.scripts,
      lint: fill(f.scripts.lint, fields?.lint),
      typecheck: fill(f.scripts.typecheck, fields?.typecheck),
      format: fill(f.scripts.format, fields?.format),
      test: fill(f.scripts.test, fields?.test),
      build: fill(f.scripts.build, fields?.build),
      run: fill(f.scripts.run, fields?.run),
    },
    dockerPort: f.dockerPort || (s.docker_port ? String(s.docker_port) : ''),
  }
}

/**
 * The settings a new repo starts with: Docker Compose, from docker-compose.yaml, so that it runs without anyone opening
 * the settings. The detected type is suggested on the repo page; it is never chosen for the user.
 */
export const defaultRepoConfig = (): Partial<RepoConfig> => formToConfig(configToForm({ stack: 'docker' }))

/** The port shown for a Docker repo when none is typed. */
export const dockerPortHint = (s: Suggestions | null | undefined) => s?.docker_port || defaultPort('docker')

/** Names under the removed `env_from` key, so the UI can ask for them as Secrets. */
export function legacyEnvFrom(config: object): string[] {
  const old = (config as { env_from?: unknown }).env_from
  if (Array.isArray(old)) return old.filter((n): n is string => typeof n === 'string').sort()
  return old && typeof old === 'object' ? Object.keys(old).sort() : []
}
