import { db } from '@/lib/db'
import { decryptSecret, encryptSecret, secretKey } from '@/lib/env'

/**
 * Users (table users). Encrypted columns use the repo_env format with additional data "user:<id>:<name>"
 * (github_token, github_refresh, llm_api_key); the runner (backend/mogo/llm/provider.py) decrypts the LLM key.
 */
const aad = (userId: string) => `user:${userId}`

export interface GitHubProfile {
  id: number
  login: string
  name: string | null
  avatar_url: string
  email: string | null
}

export interface GitHubTokens {
  access_token: string
  expires_in?: number // absent when the App does not expire user tokens
  refresh_token?: string
  refresh_token_expires_in?: number
}

/** Creates the user on first sign-in, refreshes the profile after. Keyed on the GitHub id: logins can be renamed. */
export async function upsertUser(p: GitHubProfile): Promise<string> {
  const profile = { login: p.login, name: p.name ?? '', avatar_url: p.avatar_url, email: p.email ?? '' }
  const u = await db().user.upsert({
    where: { github_id: BigInt(p.id) },
    create: { github_id: BigInt(p.id), ...profile },
    update: { ...profile, last_login_at: new Date() },
    select: { id: true },
  })
  return u.id
}

const inSeconds = (s: number | undefined) => (s ? new Date(Date.now() + s * 1000) : null)

export async function saveGitHubTokens(userId: string, t: GitHubTokens): Promise<void> {
  const key = secretKey()
  const access = encryptSecret(key, aad(userId), 'github_token', t.access_token)
  const refresh = t.refresh_token ? encryptSecret(key, aad(userId), 'github_refresh', t.refresh_token) : null
  await db().user.update({
    where: { id: userId },
    data: {
      github_token_enc: access,
      github_token_expires_at: inSeconds(t.expires_in),
      github_refresh_enc: refresh,
      github_refresh_expires_at: inSeconds(t.refresh_token_expires_in),
    },
  })
}

export interface StoredGitHubTokens {
  access: string | null // null when expired (or about to)
  refresh: string | null // null when missing or expired
}

export async function loadGitHubTokens(userId: string): Promise<StoredGitHubTokens> {
  const u = await db().user.findUnique({
    where: { id: userId },
    select: {
      github_token_enc: true, github_token_expires_at: true, github_refresh_enc: true, github_refresh_expires_at: true,
    },
  })
  if (!u) return { access: null, refresh: null }
  const key = secretKey()
  // "about to" expire: a token that dies during the next request is no better than an expired one
  const valid = (expires: Date | null, marginMs: number) => !expires || expires.getTime() > Date.now() + marginMs
  const open = (name: string, v: string | null, ok: boolean) => (v && ok ? decryptSecret(key, aad(userId), name, v) : null)
  return {
    access: open('github_token', u.github_token_enc, valid(u.github_token_expires_at, 60_000)),
    refresh: open('github_refresh', u.github_refresh_enc, valid(u.github_refresh_expires_at, 0)),
  }
}

// --- the user's LLM

export interface LlmSettings {
  base_url: string
  model: string
  has_key: boolean
}

export async function getLlmSettings(userId: string): Promise<LlmSettings> {
  const u = await db().user.findUnique({
    where: { id: userId },
    select: { llm_base_url: true, llm_model: true, llm_api_key_enc: true },
  })
  return { base_url: u?.llm_base_url ?? '', model: u?.llm_model ?? '', has_key: !!u?.llm_api_key_enc }
}

/** `api_key`: a string sets it, null removes it, undefined keeps it. The key is never read back. */
export async function setLlmSettings(
  userId: string,
  s: { base_url: string; model: string; api_key?: string | null },
): Promise<void> {
  const key =
    s.api_key === undefined
      ? {} // keep the stored key
      : { llm_api_key_enc: s.api_key ? encryptSecret(secretKey(), aad(userId), 'llm_api_key', s.api_key) : null }
  await db().user.update({ where: { id: userId }, data: { llm_base_url: s.base_url, llm_model: s.model, ...key } })
}

export const llmConfigured = (s: LlmSettings) => !!(s.base_url && s.model)
