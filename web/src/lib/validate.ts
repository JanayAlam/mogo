import type { LlmMode } from '@/lib/runs'

export interface RunInput {
  pr_url: string
  feature: string
  llm_mode: LlmMode
  dry_run: boolean
}

const MODES = ['auto', 'local', 'deepseek']

export function validateRunInput(body: unknown): RunInput | string {
  if (typeof body !== 'object' || body === null) return 'invalid JSON body'
  const b = body as Record<string, unknown>
  if (typeof b.pr_url !== 'string' || !b.pr_url) return 'pr_url is required'
  const feature = b.feature ?? ''
  if (typeof feature !== 'string' || feature.length > 5000) return 'feature must be a string up to 5000 chars'
  const mode = b.llm_mode ?? 'auto'
  if (typeof mode !== 'string' || !MODES.includes(mode)) return `llm_mode must be one of ${MODES.join(', ')}`
  return { pr_url: b.pr_url.trim(), feature, llm_mode: mode as LlmMode, dry_run: b.dry_run === true }
}
