/**
 * Optional allow-list so typos fail fast instead of costing an Actions run.
 * ALLOWED_REPOS="org/api,org/web". Unset = no check here; the runner still validates against repos.yaml.
 */
export function loadRepoNames(): string[] | null {
  const raw = process.env.ALLOWED_REPOS?.trim()
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null
}
