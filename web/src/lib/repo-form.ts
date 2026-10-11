import type { RepoConfig } from '@/lib/projects'

/** Repo roles the UI suggests. Any text is allowed: the LLM reads it as written. */
export const ROLE_SUGGESTIONS = ['backend', 'frontend', 'admin-frontend', 'mobile', 'shared-lib', 'infra', 'worker']

export const toLines = (v: string[] | undefined) => (v ?? []).join('\n')
export const fromLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** `NAME=value` per line. */
export const toPairs = (v: Record<string, string> | undefined) =>
  Object.entries(v ?? {})
    .map(([k, val]) => `${k}=${val}`)
    .join('\n')

export function fromPairs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of fromLines(s)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/** The editable text form of a repo's settings, one string per field. */
export type ConfigForm = Record<
  'setup' | 'gates' | 'prepare' | 'conventions' | 'rules' | 'env' | 'test_cmd' | 'services_cmd' |
  'services_down' | 'start' | 'healthcheck' | 'notes',
  string
> & { allow_forks: boolean }

export function configToForm(c: Partial<RepoConfig>): ConfigForm {
  return {
    setup: toLines(c.setup), gates: toLines(c.gates), prepare: toLines(c.prepare),
    conventions: toLines(c.conventions), rules: toLines(c.rules),
    env: toPairs(c.env),
    test_cmd: c.test_cmd ?? '', services_cmd: c.services_cmd ?? '', services_down: c.services_down ?? '',
    start: c.start ?? '', healthcheck: c.healthcheck ?? '', notes: c.notes ?? '', allow_forks: c.allow_forks ?? false,
  }
}

export function formToConfig(f: ConfigForm): Partial<RepoConfig> {
  return {
    setup: fromLines(f.setup), gates: fromLines(f.gates), prepare: fromLines(f.prepare),
    conventions: fromLines(f.conventions), rules: fromLines(f.rules),
    env: fromPairs(f.env),
    test_cmd: f.test_cmd.trim(), services_cmd: f.services_cmd.trim(), services_down: f.services_down.trim(),
    start: f.start.trim(), healthcheck: f.healthcheck.trim(), notes: f.notes, allow_forks: f.allow_forks,
  }
}

/** Names under the removed `env_from` key, so the UI can ask for them as Secrets. */
export function legacyEnvFrom(config: object): string[] {
  const old = (config as { env_from?: unknown }).env_from
  if (Array.isArray(old)) return old.filter((n): n is string => typeof n === 'string').sort()
  return old && typeof old === 'object' ? Object.keys(old).sort() : []
}
