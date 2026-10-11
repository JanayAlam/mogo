const PR_URL = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = PR_URL.exec(url.trim())
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null
}

/**
 * Starts the GitHub Actions workflow (see .github/workflows/run-agent.yml): a review for a run id,
 * or `{ profile_repo_id }` to re-learn a repo's conventions.
 */
export async function dispatchWorkflow(target: string | { profile_repo_id: string }): Promise<void> {
  const inputs = typeof target === 'string' ? { run_id: target } : target
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.RUNNER_REPO
  if (!token || !repo) throw new Error('GITHUB_TOKEN and RUNNER_REPO must be set')
  const workflow = process.env.RUNNER_WORKFLOW || 'run-agent.yml'
  const ref = process.env.RUNNER_REF || 'main'
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref, inputs }),
  })
  if (res.status !== 204) {
    const text = await res.text()
    let detail = text.slice(0, 200)
    try {
      detail = JSON.parse(text).message ?? detail
    } catch {}
    throw new Error(`GitHub dispatch failed (${res.status}): ${detail}`)
  }
}
