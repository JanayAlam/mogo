import type { FeatureInput } from '@/lib/features'
import type { RepoConfig, RepoInput } from '@/lib/projects'
import type { LlmMode } from '@/lib/runs'

/** Each validator returns the clean value or an error message for a 422. */
type Result<T> = T | string

const MODES = ['auto', 'local', 'deepseek']
const FULL_NAME = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

class Invalid {
  constructor(readonly message: string) {}
}

/** Trimmed string field; undefined when absent. Throws Invalid, caught by `check`. */
function str(b: Record<string, unknown>, key: string, max: number, required = false): string | undefined {
  const v = b[key]
  if (v === undefined || v === null) {
    if (required) throw new Invalid(`${key} is required`)
    return undefined
  }
  if (typeof v !== 'string' || v.length > max) throw new Invalid(`${key} must be a string up to ${max} chars`)
  const t = v.trim()
  if (required && !t) throw new Invalid(`${key} is required`)
  return t
}

function check<T>(fn: () => T): Result<T> {
  try {
    return fn()
  } catch (e) {
    if (e instanceof Invalid) return e.message
    throw e
  }
}

const isErr = (v: unknown): v is string => typeof v === 'string'

export interface ProjectInput {
  name?: string
  description?: string
  settings?: Record<string, unknown>
}

export function validateProjectInput(body: unknown, partial = false): Result<ProjectInput> {
  if (!isObj(body)) return 'invalid JSON body'
  return check(() => {
    const name = str(body, 'name', 200, !partial)
    const description = str(body, 'description', 2000) ?? (partial ? undefined : '')
    if (body.settings !== undefined && !isObj(body.settings)) throw new Invalid('settings must be an object')
    return { name, description, settings: body.settings as Record<string, unknown> | undefined }
  })
}

// --- repos

const LIST_KEYS = ['setup', 'gates', 'prepare', 'conventions', 'rules'] as const
const TEXT_KEYS = ['test_cmd', 'services_cmd', 'services_down', 'start', 'healthcheck', 'notes'] as const

export function validateRepoConfig(c: unknown): Result<Partial<RepoConfig>> {
  if (!isObj(c)) return 'config must be an object'
  const out: Partial<RepoConfig> = {}
  for (const k of LIST_KEYS) {
    const v = c[k]
    if (v === undefined) continue
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.length <= 4000) || v.length > 50) {
      return `config.${k} must be a list of strings`
    }
    out[k] = v.map((x: string) => x.trim()).filter(Boolean)
  }
  for (const k of TEXT_KEYS) {
    const v = c[k]
    if (v === undefined) continue
    if (typeof v !== 'string' || v.length > 10000) return `config.${k} must be a string`
    out[k] = v
  }
  if (c.allow_forks !== undefined) {
    if (typeof c.allow_forks !== 'boolean') return 'config.allow_forks must be true or false'
    out.allow_forks = c.allow_forks
  }
  return out
}

export function validateRepoInput(body: unknown, partial = false): Result<Partial<RepoInput>> {
  if (!isObj(body)) return 'invalid JSON body'
  return check(() => repoInput(body, partial))
}

function repoInput(body: Record<string, unknown>, partial: boolean): Partial<RepoInput> {
  const out: Partial<RepoInput> = {}
  if (!partial) {
    const fn = typeof body.full_name === 'string' ? body.full_name.trim().replace(/^https?:\/\/github\.com\//, '') : ''
    const clean = fn.replace(/\.git$/, '').replace(/\/$/, '')
    if (!FULL_NAME.test(clean)) throw new Invalid('full_name must be owner/repo (or a github.com repo url)')
    out.full_name = clean
  }
  const role = str(body, 'role', 100)
  const branch = str(body, 'default_branch', 200)
  if (role !== undefined) out.role = role
  if (branch !== undefined) out.default_branch = branch || 'main'
  if (body.config !== undefined) {
    const cfg = validateRepoConfig(body.config)
    if (isErr(cfg)) throw new Invalid(cfg)
    out.config = cfg
  }
  if (!partial) {
    out.role ??= ''
    out.default_branch ??= 'main'
    out.config ??= {}
  }
  return out
}

// --- features

export function validateFeatureInput(body: unknown, partial = false): Result<Partial<FeatureInput>> {
  if (!isObj(body)) return 'invalid JSON body'
  return check(() => featureInput(body, partial))
}

function featureInput(body: Record<string, unknown>, partial: boolean): Partial<FeatureInput> {
  const title = str(body, 'title', 300, !partial)
  const description = str(body, 'description', 10000)
  const out: Partial<FeatureInput> = {}
  if (title !== undefined) out.title = title
  if (description !== undefined) out.description = description
  if (body.repos !== undefined || !partial) {
    if (!Array.isArray(body.repos) || body.repos.length === 0) throw new Invalid('repos must list at least one repo with a PR')
    const seen = new Set<string>()
    const repos = []
    for (const r of body.repos) {
      if (!isObj(r) || typeof r.repo_id !== 'string' || typeof r.pr_url !== 'string' || !r.pr_url.trim()) {
        throw new Invalid('each repo needs repo_id and pr_url')
      }
      if (seen.has(r.repo_id)) throw new Invalid('a repo can appear only once per feature')
      seen.add(r.repo_id)
      const req = r.requirements ?? ''
      if (typeof req !== 'string' || req.length > 5000) throw new Invalid('requirements must be a string up to 5000 chars')
      repos.push({ repo_id: r.repo_id, pr_url: r.pr_url.trim(), requirements: req.trim() })
    }
    out.repos = repos
  }
  if (!partial && !out.description && !out.repos?.some((r) => r.requirements)) {
    throw new Invalid('describe the feature or give requirements for at least one repo')
  }
  return out
}

// --- starting runs

export interface StartInput {
  repo_ids: string[] | null // null = every repo of the feature
  llm_mode: LlmMode
  dry_run: boolean
}

export function validateStartInput(body: unknown): Result<StartInput> {
  const b = isObj(body) ? body : {}
  const mode = b.llm_mode ?? 'auto'
  if (typeof mode !== 'string' || !MODES.includes(mode)) return `llm_mode must be one of ${MODES.join(', ')}`
  let repoIds: string[] | null = null
  if (b.repo_ids !== undefined && b.repo_ids !== null) {
    if (!Array.isArray(b.repo_ids) || !b.repo_ids.every((x) => typeof x === 'string')) {
      return 'repo_ids must be a list of repo ids'
    }
    repoIds = b.repo_ids
  }
  return { repo_ids: repoIds, llm_mode: mode as LlmMode, dry_run: b.dry_run === true }
}

// --- repo environment variables

/** Error message, or null when the name is fine. */
export function envNameError(name: string): string | null {
  return ENV_NAME.test(name) && name.length <= 200 ? null : 'variable names look like ENV names: letters, digits, _'
}

export function validateEnvVar(body: unknown): Result<{ value?: string; sensitive: boolean }> {
  if (!isObj(body)) return 'invalid JSON body'
  if (typeof body.sensitive !== 'boolean') return 'sensitive must be true or false'
  const v = body.value
  if (v === undefined || v === null) return { sensitive: body.sensitive }
  if (typeof v !== 'string' || !v) return 'value must be a non-empty string'
  if (v.length > 20000) return 'value must be up to 20000 chars'
  return { value: v, sensitive: body.sensitive }
}

export function validateEnvFile(body: unknown): Result<{ content: string }> {
  const c = isObj(body) ? body.content : undefined
  if (typeof c !== 'string' || !c.trim()) return 'content (the .env file text) is required'
  if (c.length > 200_000) return 'the file is too large (200 KB max)'
  return { content: c }
}
