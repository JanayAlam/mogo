import { createHmac, timingSafeEqual } from 'node:crypto'

import { DETECT_FILES, ENV_EXAMPLES, type Read } from '@/lib/detect'
import { type GitHubProfile, type GitHubTokens, loadGitHubTokens, saveGitHubTokens } from '@/lib/users'

/**
 * The Mogo GitHub App as seen by the web app: sign-in (user-to-server OAuth) and which repos a user may add (repos
 * of installations the user can access). Installation tokens for reading repos and posting reviews are minted by the
 * runner (backend/mogo/github/app.py); the App's private key is not needed here.
 */
const API = 'https://api.github.com'
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }

export class GitHubAppConfigError extends Error {}
/** The stored user token is gone or expired beyond refresh: the user must sign in again. */
export class GitHubReauthError extends Error {}

function clientCredentials() {
  const id = process.env.GITHUB_APP_CLIENT_ID
  const secret = process.env.GITHUB_APP_CLIENT_SECRET
  if (!id || !secret) throw new GitHubAppConfigError('GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET must be set')
  return { id, secret }
}

export const appSlug = () => process.env.GITHUB_APP_SLUG || 'mogo'

export function authorizeUrl(state: string, redirectUri: string): string {
  const u = new URL('https://github.com/login/oauth/authorize')
  u.searchParams.set('client_id', clientCredentials().id)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('state', state)
  return u.toString()
}

/** Install (or change which repos) the App; GitHub signs the user in on the way back to the callback. */
export function installUrl(state: string): string {
  return `https://github.com/apps/${appSlug()}/installations/new?state=${encodeURIComponent(state)}`
}

async function tokenRequest(params: Record<string, string>): Promise<GitHubTokens> {
  const { id, secret } = clientCredentials()
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, ...params }),
  })
  const body = (await res.json().catch(() => ({}))) as GitHubTokens & { error?: string; error_description?: string }
  if (!res.ok || body.error || !body.access_token) {
    throw new Error(`GitHub sign-in failed: ${body.error_description || body.error || `HTTP ${res.status}`}`)
  }
  return body
}

export const exchangeCode = (code: string, redirectUri: string) =>
  tokenRequest({ code, redirect_uri: redirectUri })

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { ...HEADERS, Authorization: `Bearer ${token}` } })
  if (res.status === 401) throw new GitHubReauthError('GitHub access expired; sign in again')
  if (!res.ok) throw new Error(`GitHub API ${res.status} on ${path}`)
  return res.json() as Promise<T>
}

export const fetchProfile = (token: string) => gh<GitHubProfile>(token, '/user')

/** A working user token: the stored one, or a refreshed one (saved). */
export async function userToken(userId: string): Promise<string> {
  const t = await loadGitHubTokens(userId)
  if (t.access) return t.access
  if (!t.refresh) throw new GitHubReauthError('GitHub access expired; sign in again')
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }).catch(() => {
    throw new GitHubReauthError('GitHub access expired; sign in again')
  })
  await saveGitHubTokens(userId, fresh)
  return fresh.access_token
}

export interface InstalledRepo {
  full_name: string
  installation_id: number
  account: string
  default_branch: string
  private: boolean
}

interface Installation {
  id: number
  account: { login: string } | null
  suspended_at: string | null
}
interface RepoPayload {
  full_name: string
  default_branch: string
  private: boolean
}

const MAX_PAGES = 10 // 1000 repos per installation is plenty for a picker

export interface GitHubAccess {
  connected: boolean // the Mogo App is installed on at least one account the user can see
  repos: InstalledRepo[]
}

/**
 * Every repo the user can see through an installation of the App: what they may add to a project. `connected` tells
 * "the App is installed nowhere yet" (connect GitHub) from "installed, but no repo to offer".
 */
export async function githubAccess(userId: string): Promise<GitHubAccess> {
  const token = await userToken(userId)
  const out: InstalledRepo[] = []
  const { installations } = await gh<{ installations: Installation[] }>(token, '/user/installations?per_page=100')
  const active = installations.filter((i) => !i.suspended_at)
  for (const inst of active) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { repositories } = await gh<{ repositories: RepoPayload[] }>(
        token,
        `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`,
      )
      for (const r of repositories) {
        out.push({
          full_name: r.full_name,
          installation_id: inst.id,
          account: inst.account?.login ?? '',
          default_branch: r.default_branch,
          private: r.private,
        })
      }
      if (repositories.length < 100) break
    }
  }
  return { connected: active.length > 0, repos: out.sort((a, b) => a.full_name.localeCompare(b.full_name)) }
}

export const installedRepos = async (userId: string): Promise<InstalledRepo[]> => (await githubAccess(userId)).repos

/** The installation through which this user may use `fullName`, or null (not installed, or no access). */
export async function accessibleRepo(userId: string, fullName: string): Promise<InstalledRepo | null> {
  const want = fullName.toLowerCase()
  return (await installedRepos(userId)).find((r) => r.full_name.toLowerCase() === want) ?? null
}

/** GitHub signs webhook bodies with the App's webhook secret (X-Hub-Signature-256). */
export function validWebhookSignature(body: string, header: string | null, secret = process.env.GITHUB_WEBHOOK_SECRET) {
  if (!secret || !header?.startsWith('sha256=')) return false
  const expected = Buffer.from('sha256=' + createHmac('sha256', secret).update(body).digest('hex'))
  const given = Buffer.from(header)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The repo or its branch cannot be read with the user's access (it does not exist, or the Mogo App is not on it). */
export class RepoReadError extends Error {}

const MAX_FILE_CHARS = 300_000

/**
 * The root of a repo's branch as the user's access sees it: which files are there, and the text of those the
 * detection reads (lib/detect.ts DETECT_FILES). Straight from GitHub, no clone and no runner: a handful of requests.
 */
export async function readRepoRoot(userId: string, fullName: string, ref: string): Promise<{ names: Set<string>; read: Read }> {
  const token = await userToken(userId)
  const base = `/repos/${fullName.split('/').map(encodeURIComponent).join('/')}/contents`
  const query = `?ref=${encodeURIComponent(ref)}`
  const get = async (path: string, accept: string) => {
    const res = await fetch(`${API}${base}${path}${query}`, {
      headers: { ...HEADERS, Accept: accept, Authorization: `Bearer ${token}` },
    })
    if (res.status === 401) throw new GitHubReauthError('GitHub access expired; sign in again')
    if (res.status === 404) throw new RepoReadError(`${fullName} (branch ${ref}) was not found, or the Mogo App cannot read it`)
    if (!res.ok) throw new Error(`GitHub API ${res.status} reading ${fullName}`)
    return res
  }

  const listing = (await (await get('', HEADERS.Accept)).json()) as { name: string; type: string }[]
  if (!Array.isArray(listing)) throw new RepoReadError(`${fullName} (branch ${ref}) has no files at its root`)
  const names = new Set(listing.filter((e) => e.type === 'file').map((e) => e.name))

  // the detection reads the first env example only, like the runner
  const envExample = ENV_EXAMPLES.find((n) => names.has(n))
  const wanted = DETECT_FILES.filter((n) => names.has(n) && (!ENV_EXAMPLES.includes(n) || n === envExample))
  const texts = new Map<string, string>()
  await Promise.all(
    wanted.map(async (n) => {
      const res = await get(`/${encodeURIComponent(n)}`, 'application/vnd.github.raw+json')
      texts.set(n, (await res.text()).slice(0, MAX_FILE_CHARS))
    }),
  )
  return { names, read: (n) => texts.get(n) }
}
