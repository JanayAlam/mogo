import { createHmac, timingSafeEqual } from 'node:crypto'

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

/** Every repo the user can see through an installation of the App: what they may add to a project. */
export async function installedRepos(userId: string): Promise<InstalledRepo[]> {
  const token = await userToken(userId)
  const out: InstalledRepo[] = []
  const { installations } = await gh<{ installations: Installation[] }>(token, '/user/installations?per_page=100')
  for (const inst of installations.filter((i) => !i.suspended_at)) {
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
  return out.sort((a, b) => a.full_name.localeCompare(b.full_name))
}

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
