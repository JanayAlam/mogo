const PR_URL = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = PR_URL.exec(url.trim())
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null
}

/** Starts the GitHub Actions workflow that runs the agent (see .github/workflows/run-agent.yml). */
export async function dispatchWorkflow(runId: string): Promise<void> {
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
    body: JSON.stringify({ ref, inputs: { run_id: runId } }),
  })
  if (res.status !== 204) throw new Error(`GitHub dispatch failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
}
