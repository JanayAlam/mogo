import type { FeatureInput } from '@/lib/features'
import { DOCKER_FILE_NAME, isStack, STACK_IDS } from '@/lib/stack'
import { defaultRepoConfig } from '@/lib/repo-form'
import { isProvider, PROVIDER_INFO, PROVIDERS, type Provider } from '@/lib/llm-providers'
import { isInternalHost } from '@/lib/net-guard'
import type { RepoConfig, RepoInput } from '@/lib/projects'

/** Each validator returns the clean value or an error message for a 422. */
type Result<T> = T | string

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
  if (c.stack !== undefined) {
    if (c.stack !== '' && !isStack(c.stack)) return `config.stack must be empty or one of: ${STACK_IDS.join(', ')}`
    out.stack = c.stack
  }
  const extra = validateRunConfig(c)
  if (typeof extra === 'string') return extra
  Object.assign(out, extra)
  return out
}

const SCRIPT_TEXT = ['lint', 'typecheck', 'format', 'test', 'build', 'run'] as const
const SCRIPT_LISTS = ['other', 'before'] as const

/** The Node `scripts` fields and the Docker settings of a repo's config. */
function validateRunConfig(c: Record<string, unknown>): Result<Partial<RepoConfig>> {
  const out: Partial<RepoConfig> = {}
  if (c.scripts !== undefined) {
    if (!isObj(c.scripts)) return 'config.scripts must be an object'
    const sc: Record<string, unknown> = {}
    for (const k of SCRIPT_TEXT) {
      const v = c.scripts[k] ?? ''
      if (typeof v !== 'string' || v.length > 4000) return `config.scripts.${k} must be a string`
      sc[k] = v.trim()
    }
    for (const k of SCRIPT_LISTS) {
      const v = c.scripts[k] ?? []
      if (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === 'string' && x.length <= 4000)) {
        return `config.scripts.${k} must be a list of strings`
      }
      sc[k] = v.map((x: string) => x.trim()).filter(Boolean)
    }
    out.scripts = sc as unknown as RepoConfig['scripts']
  }
  if (c.docker_mode !== undefined) {
    if (c.docker_mode !== '' && c.docker_mode !== 'dockerfile' && c.docker_mode !== 'compose') {
      return "config.docker_mode must be 'dockerfile' or 'compose'"
    }
    out.docker_mode = c.docker_mode
  }
  if (c.docker_file !== undefined) {
    if (typeof c.docker_file !== 'string' || (c.docker_file !== '' && !DOCKER_FILE_NAME.test(c.docker_file)) || c.docker_file.length > 100) {
      return 'config.docker_file must be a file name at the repo root: letters, digits, . - _'
    }
    out.docker_file = c.docker_file
  }
  if (c.docker_port !== undefined) {
    if (!Number.isInteger(c.docker_port) || (c.docker_port as number) < 0 || (c.docker_port as number) > 65535) {
      return 'config.docker_port must be a port number'
    }
    out.docker_port = c.docker_port as number
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
    out.config ??= defaultRepoConfig()
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
  dry_run: boolean
}

export function validateStartInput(body: unknown): Result<StartInput> {
  const b = isObj(body) ? body : {}
  let repoIds: string[] | null = null
  if (b.repo_ids !== undefined && b.repo_ids !== null) {
    if (!Array.isArray(b.repo_ids) || !b.repo_ids.every((x) => typeof x === 'string')) {
      return 'repo_ids must be a list of repo ids'
    }
    repoIds = b.repo_ids
  }
  return { repo_ids: repoIds, dry_run: b.dry_run === true }
}

// --- the user's LLM connections

export interface LlmCreateInput {
  provider: Provider
  name: string
  base_url: string
  model: string
  api_key: string | null
  active: boolean // in the fallback chain; new connections are on unless the body says otherwise
}
export interface LlmPatchInput {
  base_url?: string // custom connections only
  model?: string
  api_key?: string | null // a string sets the key, null removes it, absent keeps it
  active?: boolean
}

/** The base URL of a custom connection: https, no credentials in it, and not an address inside our own network. */
function customBaseUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim().replace(/\/+$/, ''))
  } catch {
    throw new Invalid('base_url must be a URL, e.g. https://my-tunnel.trycloudflare.com/v1')
  }
  if (url.protocol !== 'https:') {
    throw new Invalid('base_url must be https (a tunnel from Cloudflare or ngrok gives you one)')
  }
  if (url.username || url.password) throw new Invalid('put the API key in api_key, not in the URL')
  if (url.search || url.hash) throw new Invalid('base_url must not have a query or fragment')
  if (isInternalHost(url.hostname)) {
    throw new Invalid('base_url must be a public address: runs execute on GitHub Actions and cannot reach localhost, see the tunnel steps')
  }
  return url.toString().replace(/\/+$/, '')
}

function llmKey(provider: Provider, key: string | undefined): string | null {
  if (!key) return null
  if (/\s/.test(key)) throw new Invalid('api_key must not contain spaces or line breaks')
  const prefix = PROVIDER_INFO[provider].key_prefix
  if (prefix && !key.startsWith(prefix)) {
    throw new Invalid(`a ${PROVIDER_INFO[provider].label} API key starts with ${prefix}`)
  }
  return key
}

export function validateLlmCreate(body: unknown): Result<LlmCreateInput> {
  if (!isObj(body)) return 'invalid JSON body'
  return check(() => {
    if (!isProvider(body.provider)) throw new Invalid(`provider must be one of: ${PROVIDERS.join(', ')}`)
    const provider = body.provider
    const info = PROVIDER_INFO[provider]
    const model = str(body, 'model', 200, true) as string
    const key = llmKey(provider, str(body, 'api_key', 1000))
    if (!key && provider !== 'custom') throw new Invalid(`api_key is required for ${info.label}`)
    let baseUrl = info.base_url
    if (provider === 'custom') baseUrl = customBaseUrl(str(body, 'base_url', 500, true) as string)
    if (body.active !== undefined && typeof body.active !== 'boolean') throw new Invalid('active must be true or false')
    return { provider, name: info.label, base_url: baseUrl, model, api_key: key, active: body.active !== false }
  })
}

/** The new order: every connection id once. Whether it is the user's complete set is checked against the database. */
export function validateLlmOrder(body: unknown): Result<string[]> {
  const ids = isObj(body) ? body.ids : undefined
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 36)) {
    return 'ids must be the list of connection ids in the new order'
  }
  if (new Set(ids).size !== ids.length) return 'ids must not repeat'
  return ids
}

export function validateLlmPatch(body: unknown, provider: Provider): Result<LlmPatchInput> {
  if (!isObj(body)) return 'invalid JSON body'
  return check(() => {
    const out: LlmPatchInput = {}
    const model = str(body, 'model', 200)
    if (model !== undefined) {
      if (!model) throw new Invalid('model is required')
      out.model = model
    }
    if (body.base_url !== undefined) {
      if (provider !== 'custom') throw new Invalid(`the base URL of ${PROVIDER_INFO[provider].label} cannot be changed`)
      out.base_url = customBaseUrl(str(body, 'base_url', 500, true) as string)
    }
    if (body.api_key === null) {
      if (provider !== 'custom') throw new Invalid(`api_key is required for ${PROVIDER_INFO[provider].label}`)
      out.api_key = null
    } else if (body.api_key !== undefined) {
      const key = llmKey(provider, str(body, 'api_key', 1000))
      if (!key) throw new Invalid('api_key cannot be empty (send null to remove it)')
      out.api_key = key
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw new Invalid('active must be true or false')
      out.active = body.active
    }
    return out
  })
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
