import type { RepoConfig, Suggestions } from '@/lib/projects'

/** Repo roles the UI suggests. Any text is allowed: the LLM reads it as written. */
export const ROLE_SUGGESTIONS = ['backend', 'frontend', 'admin-frontend', 'mobile', 'shared-lib', 'infra', 'worker']

export const toLines = (v: string[] | undefined) => (v ?? []).join('\n')
export const fromLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * The repo form as the user sees it. It maps onto the runner's settings (RepoConfig) without changing them:
 * checks = gates; the start script's last line is `start`, earlier lines run first as `prepare`; install, test and
 * stop commands are advanced overrides.
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
}

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
  }
}

export function formToConfig(f: ConfigForm): Partial<RepoConfig> {
  const start = f.runApp ? fromLines(f.startScript) : []
  return {
    gates: fromLines(f.checks),
    setup: fromLines(f.install),
    test_cmd: f.testCmd.trim(),
    services_cmd: '',
    prepare: start.slice(0, -1),
    start: start.at(-1) ?? '',
    healthcheck: f.runApp ? f.appUrl.trim() : '',
    services_down: f.stopCmd.trim(),
    conventions: fromLines(f.conventions),
    rules: fromLines(f.rules),
    notes: f.notes,
    allow_forks: f.allowForks,
  }
}

/** What is wrong with the form before saving, or null. */
export function formError(f: ConfigForm): string | null {
  if (!f.runApp) return null
  if (!fromLines(f.startScript).length) return 'Run the app is on: add the start script, or switch it off.'
  const url = f.appUrl.trim()
  if (url && !/^https?:\/\/\S+$/.test(url)) return 'The ready URL must start with http:// or https://'
  return null
}

/** Fills the form from settings detected on the branch; only empty parts are filled. */
export function applySuggestions(f: ConfigForm, s: Suggestions): ConfigForm {
  return {
    ...f,
    checks: f.checks.trim() ? f.checks : s.checks.join('\n'),
    testCmd: f.testCmd.trim() ? f.testCmd : s.test_cmd,
    runApp: f.runApp || !!s.start,
    startScript: f.startScript.trim() ? f.startScript : s.start,
    appUrl: f.appUrl.trim() ? f.appUrl : s.app_url,
  }
}

/** Names under the removed `env_from` key, so the UI can ask for them as Secrets. */
export function legacyEnvFrom(config: object): string[] {
  const old = (config as { env_from?: unknown }).env_from
  if (Array.isArray(old)) return old.filter((n): n is string => typeof n === 'string').sort()
  return old && typeof old === 'object' ? Object.keys(old).sort() : []
}
