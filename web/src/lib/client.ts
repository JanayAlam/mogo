import type { FeatureInput, FeatureRow } from '@/lib/features'
import type { ProjectRow, ProjectSummary, RepoInput, RepoRow } from '@/lib/projects'
import type { RunRow } from '@/lib/runs'
import type { EnvVarInfo } from '@/lib/env'
import type { GitHubAccess, InstalledRepo } from '@/lib/github-app'
import type { SessionUser } from '@/lib/sessions'
import type { LlmConnection } from '@/lib/llm'
import type { Provider } from '@/lib/llm-providers'

export type { FeatureRow as Feature, ProjectRow as Project, ProjectSummary, RepoRow as Repo, RunRow as Run }
export type { GitHubAccess, InstalledRepo, LlmConnection }

export interface Criterion {
  text: string
  status: 'pass' | 'fail' | 'unverified'
  evidence: string
}
export interface Finding {
  path: string
  line: number
  severity: 'blocker' | 'major' | 'minor' | 'nit'
  message: string
  rule: string
}
export interface RunResult {
  summary?: string
  criteria?: Criterion[]
  findings?: Finding[]
  gates?: { cmd: string; ok: boolean; output: string }[]
  checks?: { id: string; status: 'pass' | 'fail' | 'skipped'; note: string }[]
  summary_md?: string
}
export interface RunDetail extends RunRow {
  events: { ts: string; level: string; message: string }[]
  result: RunResult | null
}
export interface Session {
  user: SessionUser
  llm: { configured: boolean; model: string }
  app_url: string // the Mogo App on GitHub
}
export interface Stats {
  projects: number
  queued: number
  failed: number
  done: number
}

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized')
  }
}

/** `unauthorized`: what a 401 means. 'login' (the default) sends the page to sign in; 'return' hands it back to the caller. */
async function call<T>(path: string, init?: RequestInit, unauthorized: 'login' | 'return' = 'login'): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (res.status === 401 && unauthorized === 'return') throw new UnauthorizedError()
  if (res.status === 401) {
    // full reload on purpose: drops any stale client state
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`)
  }
  return res.json()
}

const send = (method: string, body?: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) })

export const api = {
  stats: () => call<Stats>('/stats'),
  session: () => call<Session>('/session'),
  logout: () => call<{ ok: true }>('/auth/logout', send('POST')),
  llmConnections: () => call<{ connections: LlmConnection[] }>('/settings/llm'),
  addLlmConnection: (body: {
    provider: Provider
    base_url?: string
    model: string
    api_key?: string
    active?: boolean
  }) => call<LlmConnection>('/settings/llm', send('POST', body)),
  updateLlmConnection: (
    id: string,
    body: { base_url?: string; model?: string; api_key?: string | null; active?: boolean },
  ) => call<LlmConnection>(`/settings/llm/${id}`, send('PATCH', body)),
  reorderLlmConnections: (ids: string[]) =>
    call<{ connections: LlmConnection[] }>('/settings/llm/order', send('PUT', { ids })),
  deleteLlmConnection: (id: string) => call<{ ok: true }>(`/settings/llm/${id}`, { method: 'DELETE' }),
  testLlmConnection: (id: string) => call<{ ok: true }>(`/settings/llm/${id}/test`, send('POST')),
  /**
   * 401 here means GitHub access expired (the page itself is signed in): that is "connect GitHub again", not a reason
   * to leave the page, so it reads as not connected.
   */
  githubAccess: (): Promise<GitHubAccess> =>
    call<GitHubAccess>('/github/repos', undefined, 'return').catch((e) => {
      if (e instanceof UnauthorizedError) return { connected: false, repos: [] }
      throw e
    }),

  projects: () => call<ProjectSummary[]>('/projects'),
  project: (id: string) => call<ProjectRow>(`/projects/${id}`),
  createProject: (body: { name: string; description: string }) => call<{ id: string }>('/projects', send('POST', body)),
  updateProject: (id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }) =>
    call<{ ok: true }>(`/projects/${id}`, send('PATCH', body)),
  deleteProject: (id: string) => call<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  repo: (id: string) => call<RepoRow>(`/repos/${id}`),
  addRepo: (projectId: string, body: Partial<RepoInput>) =>
    call<{ id: string; learning: boolean }>(`/projects/${projectId}/repos`, send('POST', body)),
  updateRepo: (id: string, body: Partial<RepoInput>) => call<{ ok: true }>(`/repos/${id}`, send('PATCH', body)),
  deleteRepo: (id: string) => call<{ ok: true }>(`/repos/${id}`, { method: 'DELETE' }),
  /** Reads the repo's root files from GitHub for suggestions, no runner. A 401 (GitHub access expired) is thrown, not a redirect. */
  detectRepo: (id: string) =>
    call<{ ok: true; stack: string }>(`/repos/${id}/detect`, send('POST'), 'return').catch((e) => {
      throw e instanceof UnauthorizedError ? new Error('GitHub access expired; sign in again') : e
    }),
  relearn: (id: string) => call<{ ok: true }>(`/repos/${id}/profile`, send('POST')),
  env: (id: string) => call<{ vars: EnvVarInfo[]; key_configured: boolean }>(`/repos/${id}/env`),
  setEnvVar: (id: string, name: string, body: { value?: string; sensitive: boolean }) =>
    call<{ ok: true }>(`/repos/${id}/env/${encodeURIComponent(name)}`, send('PUT', body)),
  importEnv: (id: string, content: string) =>
    call<{ added: string[]; replaced: string[]; sensitive: string[]; skipped: { line: number; reason: string }[] }>(
      `/repos/${id}/env`,
      send('POST', { content }),
    ),
  deleteEnvVar: (id: string, name: string) =>
    call<{ ok: true }>(`/repos/${id}/env/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  features: (projectId: string) => call<FeatureRow[]>(`/projects/${projectId}/features`),
  feature: (id: string) => call<FeatureRow>(`/features/${id}`),
  createFeature: (projectId: string, body: FeatureInput) =>
    call<{ id: string }>(`/projects/${projectId}/features`, send('POST', body)),
  updateFeature: (id: string, body: Partial<FeatureInput>) => call<{ ok: true }>(`/features/${id}`, send('PATCH', body)),
  deleteFeature: (id: string) => call<{ ok: true }>(`/features/${id}`, { method: 'DELETE' }),
  startRuns: (featureId: string, body: { repo_ids?: string[]; dry_run: boolean }) =>
    call<{ runs: RunRow[]; errors: string[] }>(`/features/${featureId}/runs`, send('POST', body)),

  run: (id: string) => call<RunDetail>(`/runs/${id}`),
  rerun: (id: string) => call<RunRow>(`/runs/${id}/rerun`, send('POST')),
}
