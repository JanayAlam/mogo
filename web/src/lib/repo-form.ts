import type { RepoConfig, Suggestions } from '@/lib/projects'
import { compileDocker, DEFAULT_PORT, DOCKER_FILE_NAME, type DockerMode } from '@/lib/stack'

/** Repo roles the UI suggests. Any text is allowed: the LLM reads it as written. */
export const ROLE_SUGGESTIONS = ['backend', 'frontend', 'admin-frontend', 'mobile', 'shared-lib', 'infra', 'worker']

export const toLines = (v: string[] | undefined) => (v ?? []).join('\n')
export const fromLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * The repo form as the user sees it. A repo runs only with Docker: a Compose file or a Dockerfile at its root. The
 * commands that build, run and stop it are compiled from the Docker fields (see compileDocker); the runner only
 * executes them.
 */
export interface ConfigForm {
  appUrl: string
  conventions: string
  rules: string
  notes: string
  allowForks: boolean
  dockerMode: DockerMode
  dockerFile: string // '' = the default name
  dockerPort: string // '' = the Dockerfile's / the usual port
}

/** A Docker repo saved by an earlier version has only commands: its port is in the `docker run` line. */
const portOf = (c: Partial<RepoConfig>) => c.docker_port || Number(/-p\s+(\d{2,5}):/.exec(c.start ?? '')?.[1]) || 0

/**
 * Settings saved before Docker was the only way to run (setup, gates, test_cmd, stack, scripts, ...) are ignored. A
 * config that never ran in Docker opens as Docker Compose, without the ready URL it had for another way of running.
 */
export function configToForm(c: Partial<RepoConfig>): ConfigForm {
  const docker = !!c.docker_mode || /\bdocker\b/.test(c.start ?? '')
  return {
    appUrl: docker ? (c.healthcheck ?? '') : '',
    conventions: toLines(c.conventions),
    rules: toLines(c.rules),
    notes: c.notes ?? '',
    allowForks: c.allow_forks ?? false,
    // Compose unless it is a Dockerfile (a Docker repo saved as commands only has no mode: its `docker run` says)
    dockerMode: c.docker_mode === 'dockerfile' || (!c.docker_mode && /\bdocker run\b/.test(c.start ?? '')) ? 'dockerfile' : 'compose',
    dockerFile: docker ? (c.docker_file ?? '') : '',
    dockerPort: docker && portOf(c) ? String(portOf(c)) : '',
  }
}

export function formToConfig(f: ConfigForm): Partial<RepoConfig> {
  const port = Number(f.dockerPort) || 0
  const d = compileDocker({ mode: f.dockerMode, file: f.dockerFile.trim(), port }, f.appUrl)
  return {
    conventions: fromLines(f.conventions),
    rules: fromLines(f.rules),
    notes: f.notes,
    allow_forks: f.allowForks,
    prepare: d.prepare,
    start: d.start,
    healthcheck: d.healthcheck,
    services_down: d.services_down,
    docker_mode: f.dockerMode,
    docker_file: f.dockerFile.trim(),
    docker_port: f.dockerMode === 'dockerfile' ? port : 0,
  }
}

const URL_OK = /^https?:\/\/\S+$/

/** What is wrong with the form before saving, or null. */
export function formError(f: ConfigForm): string | null {
  const url = f.appUrl.trim()
  if (f.dockerFile.trim() && !DOCKER_FILE_NAME.test(f.dockerFile.trim())) {
    return 'The Docker file name must be a file at the repo root: letters, digits, . - _'
  }
  const port = f.dockerPort.trim()
  if (f.dockerMode === 'dockerfile' && port && !(Number.isInteger(Number(port)) && Number(port) >= 1 && Number(port) <= 65535)) {
    return 'The port must be a number from 1 to 65535.'
  }
  return url && !URL_OK.test(url) ? 'The ready URL must start with http:// or https://' : null
}

/** The settings a new repo starts with: Docker Compose, from docker-compose.yaml, so that it runs without anyone opening the settings. */
export const defaultRepoConfig = (): Partial<RepoConfig> => formToConfig(configToForm({}))

/** The port shown for a Dockerfile repo when none is typed. */
export const dockerPortHint = (s: Suggestions | null | undefined) => s?.docker_port || DEFAULT_PORT

/** Names under the removed `env_from` key, so the UI can ask for them as Secrets. */
export function legacyEnvFrom(config: object): string[] {
  const old = (config as { env_from?: unknown }).env_from
  if (Array.isArray(old)) return old.filter((n): n is string => typeof n === 'string').sort()
  return old && typeof old === 'object' ? Object.keys(old).sort() : []
}
