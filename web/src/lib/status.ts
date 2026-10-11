import type { RunStatus } from '@/lib/runs'

/** What the UI shows. A run that finished but asked for changes counts as failed: the feature is not done. */
export type ReviewState = 'idle' | 'queued' | 'running' | 'failed' | 'done'

export function runState(r: { status: RunStatus; verdict: string } | null | undefined): ReviewState {
  if (!r) return 'idle'
  if (r.status === 'succeeded') return r.verdict === 'changes_requested' ? 'failed' : 'done'
  return r.status
}

/** A feature is as far as its slowest repo: anything in flight wins, then any failure, then done. */
export function featureState(latest: ({ status: RunStatus; verdict: string } | null)[]): ReviewState {
  const states = latest.map(runState).filter((s) => s !== 'idle')
  if (states.length === 0) return 'idle'
  for (const s of ['running', 'queued', 'failed'] as const) if (states.includes(s)) return s
  return 'done'
}
