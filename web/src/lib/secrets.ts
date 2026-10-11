import { createCipheriv, randomBytes } from 'node:crypto'

import { sql } from '@/lib/db'

/**
 * Repo secrets, encrypted here and decrypted only by the runner (backend/mogo/secrets.py, same format):
 * "v1:" + base64(iv[12] + ciphertext + tag[16]), AES-256-GCM, additional data "<repo_id>:<name>".
 */
export class SecretKeyError extends Error {}

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

export interface SecretInfo {
  name: string
  updated_at: string
}

/** Names only: values never leave the database through the web app. */
export async function listSecrets(repoId: string): Promise<SecretInfo[]> {
  const rows = await sql()`select name, updated_at from repo_secrets where repo_id = ${repoId} order by name`
  return rows as unknown as SecretInfo[]
}

export async function setSecret(repoId: string, name: string, value: string): Promise<void> {
  const enc = encryptSecret(secretKey(), repoId, name, value)
  await sql()`
    insert into repo_secrets (repo_id, name, value_enc) values (${repoId}, ${name}, ${enc})
    on conflict (repo_id, name) do update set value_enc = excluded.value_enc, updated_at = now()`
}

export async function deleteSecret(repoId: string, name: string): Promise<boolean> {
  return (await sql()`delete from repo_secrets where repo_id = ${repoId} and name = ${name} returning name`).length > 0
}

/**
 * Saves many secrets at once (a .env import): existing names get the new value, new names are added, and secrets
 * not in `entries` are left alone. One transaction: all or nothing. Returns names only.
 */
export async function importSecrets(
  repoId: string,
  entries: { name: string; value: string }[],
): Promise<{ added: string[]; replaced: string[] }> {
  const key = secretKey()
  return sql().begin(async (tx) => {
    const rows = await tx`select name from repo_secrets where repo_id = ${repoId} for update`
    const existing = new Set(rows.map((r) => r.name as string))
    for (const e of entries) {
      const enc = encryptSecret(key, repoId, e.name, e.value)
      await tx`
        insert into repo_secrets (repo_id, name, value_enc) values (${repoId}, ${e.name}, ${enc})
        on conflict (repo_id, name) do update set value_enc = excluded.value_enc, updated_at = now()`
    }
    const names = entries.map((e) => e.name)
    return { added: names.filter((n) => !existing.has(n)), replaced: names.filter((n) => existing.has(n)) }
  }) as Promise<{ added: string[]; replaced: string[] }>
}
