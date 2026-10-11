import { createCipheriv, randomBytes } from 'node:crypto'

import type postgres from 'postgres'

import { looksSensitive } from '@/lib/dotenv'
import { sql } from '@/lib/db'

/**
 * A repo's environment variables (table repo_env). Sensitive values are encrypted here and decrypted only by the
 * runner (backend/mogo/secrets.py, same format): "v1:" + base64(iv[12] + ciphertext + tag[16]), AES-256-GCM,
 * additional data "<repo_id>:<name>". Other values are stored and shown as plain text.
 */
export class SecretKeyError extends Error {}
/** A change the rules do not allow (e.g. revealing a sensitive value). */
export class EnvRuleError extends Error {}

export function secretKey(raw = process.env.MOGO_SECRET_KEY): Buffer {
  if (!raw) throw new SecretKeyError('MOGO_SECRET_KEY is not set (create one with: openssl rand -base64 32)')
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== 32) throw new SecretKeyError('MOGO_SECRET_KEY must be 32 bytes, base64 (openssl rand -base64 32)')
  return key
}

export function encryptSecret(key: Buffer, repoId: string, name: string, value: string, iv = randomBytes(12)): string {
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${repoId}:${name}`))
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return 'v1:' + Buffer.concat([iv, enc, cipher.getAuthTag()]).toString('base64')
}

export interface EnvVarInfo {
  name: string
  sensitive: boolean
  value: string | null // null when sensitive: never sent to the browser
  updated_at: string
}

export async function listEnv(repoId: string): Promise<EnvVarInfo[]> {
  const rows = await sql()`
    select name, sensitive, case when sensitive then null else value end as value, updated_at
    from repo_env where repo_id = ${repoId} order by name`
  return rows as unknown as EnvVarInfo[]
}

async function write(tx: postgres.Sql, repoId: string, name: string, value: string, sensitive: boolean) {
  const enc = sensitive ? encryptSecret(secretKey(), repoId, name, value) : null
  const plain = sensitive ? null : value
  await tx`
    insert into repo_env (repo_id, name, sensitive, value, value_enc)
    values (${repoId}, ${name}, ${sensitive}, ${plain}, ${enc})
    on conflict (repo_id, name) do update
    set sensitive = excluded.sensitive, value = excluded.value, value_enc = excluded.value_enc, updated_at = now()`
}

/**
 * Create or change one variable. `value` omitted keeps the current value: a plain variable can become sensitive
 * that way (it gets encrypted), but a sensitive one can only become plain with a new value.
 */
export async function setEnvVar(
  repoId: string,
  name: string,
  change: { value?: string; sensitive: boolean },
): Promise<void> {
  await sql().begin(async (tx) => {
    const [cur] = await tx`select sensitive, value from repo_env where repo_id = ${repoId} and name = ${name} for update`
    let value = change.value
    if (value === undefined) {
      if (!cur) throw new EnvRuleError('value is required for a new variable')
      if (cur.sensitive && !change.sensitive) {
        throw new EnvRuleError('enter a new value to make a sensitive variable plain (it cannot be revealed)')
      }
      if (cur.sensitive) return // unchanged
      value = cur.value as string
    }
    await write(tx as unknown as postgres.Sql, repoId, name, value, change.sensitive)
  })
}

export async function deleteEnvVar(repoId: string, name: string): Promise<boolean> {
  return (await sql()`delete from repo_env where repo_id = ${repoId} and name = ${name} returning name`).length > 0
}

/**
 * A .env import: existing names get the new value and keep their sensitivity, new names are added (sensitive if
 * their name looks like a credential), variables missing from the file are kept. One transaction. Names only back.
 */
export async function importEnv(
  repoId: string,
  entries: { name: string; value: string }[],
): Promise<{ added: string[]; replaced: string[]; sensitive: string[] }> {
  return sql().begin(async (tx) => {
    const rows = await tx`select name, sensitive from repo_env where repo_id = ${repoId} for update`
    const existing = new Map(rows.map((r) => [r.name as string, r.sensitive as boolean]))
    const sensitive: string[] = []
    for (const e of entries) {
      const s = existing.get(e.name) ?? looksSensitive(e.name)
      if (s) sensitive.push(e.name)
      await write(tx as unknown as postgres.Sql, repoId, e.name, e.value, s)
    }
    const names = entries.map((e) => e.name)
    return { added: names.filter((n) => !existing.has(n)), replaced: names.filter((n) => existing.has(n)), sensitive }
  }) as Promise<{ added: string[]; replaced: string[]; sensitive: string[] }>
}
