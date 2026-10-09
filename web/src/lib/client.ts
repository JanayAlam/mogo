import type { LlmMode, RunRow } from '@/lib/runs'

export type { LlmMode, RunRow as Run }

export interface RunDetail extends RunRow {
  events: { ts: string; level: string; message: string }[]
  result: { summary_md?: string } | null
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

export const api = {
  login: (password: string) => call<{ ok: true }>('/login', { method: 'POST', body: JSON.stringify({ password }) }),
  repos: () => call<string[]>('/repos'),
  runs: () => call<RunRow[]>('/runs'),
  run: (id: string) => call<RunDetail>(`/runs/${id}`),
  createRun: (body: { pr_url: string; feature: string; llm_mode: LlmMode; dry_run: boolean }) =>
    call<RunRow>('/runs', { method: 'POST', body: JSON.stringify(body) }),
}
