import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/users', () => ({
  loadGitHubTokens: vi.fn(async () => ({ access: 'ghu_x', refresh: null })),
  saveGitHubTokens: vi.fn(),
}))

import { GitHubReauthError, readRepoRoot, RepoReadError } from '@/lib/github-app'

afterEach(() => vi.unstubAllGlobals())

/** GitHub's contents API: the root listing, and a file's raw text. */
function stubContents(files: Record<string, string>, dirs: string[] = [], status = 200) {
  const calls: { path: string; accept: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(String(url))
      const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\/?/, ''))
      const accept = (init.headers as Record<string, string>).Accept
      calls.push({ path, accept })
      if (status !== 200) return new Response('{}', { status })
      if (path === '') {
        const entries = [...Object.keys(files).map((name) => ({ name, type: 'file' })), ...dirs.map((name) => ({ name, type: 'dir' }))]
        return new Response(JSON.stringify(entries), { status: 200 })
      }
      return path in files ? new Response(files[path], { status: 200 }) : new Response('{}', { status: 404 })
    }),
  )
  return calls
}

describe('readRepoRoot', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists the root files and reads only the ones the detection uses', async () => {
    const calls = stubContents(
      { 'package.json': '{"scripts":{}}', 'compose.yaml': 'big', README: 'x', Dockerfile: 'FROM x\nEXPOSE 80', '.env.example': 'A=1', '.env.sample': 'B=2' },
      ['src', 'docs'],
    )
    const { names, read } = await readRepoRoot('u', 'acme/api', 'main')
    expect([...names].sort()).toEqual(['.env.example', '.env.sample', 'Dockerfile', 'README', 'compose.yaml', 'package.json']) // not the folders
    expect(read('package.json')).toBeUndefined() // nothing in it is used any more
    expect(read('Dockerfile')).toContain('EXPOSE 80')
    expect(read('.env.example')).toBe('A=1')
    expect(read('.env.sample')).toBeUndefined() // only the first env example, like the runner
    expect(read('compose.yaml')).toBeUndefined() // names matter, contents of a compose file do not
    expect(calls.map((c) => c.path).sort()).toEqual(['', '.env.example', 'Dockerfile'])
    expect(calls[0].accept).toBe('application/vnd.github+json') // the listing
    expect(calls.slice(1).every((c) => c.accept === 'application/vnd.github.raw+json')).toBe(true) // raw text, not base64
  })

  it('asks for the branch and encodes it', async () => {
    stubContents({ Dockerfile: 'FROM x' })
    await readRepoRoot('u', 'acme/api', 'feature/x y')
    const url = String(vi.mocked(fetch).mock.calls[0][0])
    expect(url).toContain('/repos/acme/api/contents')
    expect(url).toContain('ref=feature%2Fx%20y')
  })

  it('caps what it keeps of a huge file', async () => {
    stubContents({ Dockerfile: 'x'.repeat(400_000) })
    expect((await readRepoRoot('u', 'acme/api', 'main')).read('Dockerfile')).toHaveLength(300_000)
  })

  it('says so when the repo or branch cannot be read', async () => {
    stubContents({}, [], 404)
    await expect(readRepoRoot('u', 'acme/api', 'nope')).rejects.toThrow(RepoReadError)
    await expect(readRepoRoot('u', 'acme/api', 'nope')).rejects.toThrow(/branch nope.*Mogo App/)
  })

  it('asks to sign in again when GitHub access expired', async () => {
    stubContents({}, [], 401)
    await expect(readRepoRoot('u', 'acme/api', 'main')).rejects.toThrow(GitHubReauthError)
  })

  it('reports other failures with the status', async () => {
    stubContents({}, [], 502)
    await expect(readRepoRoot('u', 'acme/api', 'main')).rejects.toThrow('GitHub API 502')
  })
})
