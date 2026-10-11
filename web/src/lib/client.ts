import type { FeatureInput, FeatureRow } from '@/lib/features'
import type { ProjectRow, ProjectSummary, RepoInput, RepoRow } from '@/lib/projects'
import type { LlmMode, RunRow } from '@/lib/runs'
import type { SecretInfo } from '@/lib/secrets'

export type { FeatureRow as Feature, LlmMode, ProjectRow as Project, ProjectSummary, RepoRow as Repo, RunRow as Run }

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
export interface Stats {
  projects: number
  queued: number
  failed: number
  done: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (res.status === 401 && path !== '/login') {
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
  login: (password: string) => call<{ ok: true }>('/login', send('POST', { password })),
  stats: () => call<Stats>('/stats'),

  projects: () => call<ProjectSummary[]>('/projects'),
  project: (id: string) => call<ProjectRow>(`/projects/${id}`),
  createProject: (body: { name: string; description: string }) => call<{ id: string }>('/projects', send('POST', body)),
  updateProject: (id: string, body: { name?: string; description?: string; settings?: Record<string, unknown> }) =>
    call<{ ok: true }>(`/projects/${id}`, send('PATCH', body)),
  deleteProject: (id: string) => call<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  repo: (id: string) => call<RepoRow>(`/repos/${id}`),
  addRepo: (projectId: string, body: Partial<RepoInput>) =>
    call<{ id: string }>(`/projects/${projectId}/repos`, send('POST', body)),
  updateRepo: (id: string, body: Partial<RepoInput>) => call<{ ok: true }>(`/repos/${id}`, send('PATCH', body)),
  deleteRepo: (id: string) => call<{ ok: true }>(`/repos/${id}`, { method: 'DELETE' }),
  relearn: (id: string) => call<{ ok: true }>(`/repos/${id}/profile`, send('POST')),
  secrets: (id: string) => call<{ secrets: SecretInfo[]; key_configured: boolean }>(`/repos/${id}/secrets`),
  setSecret: (id: string, name: string, value: string) =>
    call<{ ok: true }>(`/repos/${id}/secrets/${encodeURIComponent(name)}`, send('PUT', { value })),
  importSecrets: (id: string, content: string) =>
    call<{ added: string[]; replaced: string[]; skipped: { line: number; reason: string }[] }>(
      `/repos/${id}/secrets`,
      send('POST', { content }),
    ),
  deleteSecret: (id: string, name: string) =>
    call<{ ok: true }>(`/repos/${id}/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  features: (projectId: string) => call<FeatureRow[]>(`/projects/${projectId}/features`),
  feature: (id: string) => call<FeatureRow>(`/features/${id}`),
  createFeature: (projectId: string, body: FeatureInput) =>
    call<{ id: string }>(`/projects/${projectId}/features`, send('POST', body)),
  updateFeature: (id: string, body: Partial<FeatureInput>) => call<{ ok: true }>(`/features/${id}`, send('PATCH', body)),
  deleteFeature: (id: string) => call<{ ok: true }>(`/features/${id}`, { method: 'DELETE' }),
  startRuns: (featureId: string, body: { repo_ids?: string[]; llm_mode: LlmMode; dry_run: boolean }) =>
    call<{ runs: RunRow[]; errors: string[] }>(`/features/${featureId}/runs`, send('POST', body)),

  run: (id: string) => call<RunDetail>(`/runs/${id}`),
  rerun: (id: string) => call<RunRow>(`/runs/${id}/rerun`, send('POST')),
}
