import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { looksSensitive } from '@/lib/dotenv'

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

/** Only for values the web app itself needs back (a user's GitHub token); repo secrets are decrypted by the runner. */
export function decryptSecret(key: Buffer, repoId: string, name: string, token: string): string {
  if (!token.startsWith('v1:')) throw new SecretKeyError(`${name}: unknown secret format`)
  const raw = Buffer.from(token.slice(3), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
  decipher.setAAD(Buffer.from(`${repoId}:${name}`))
  decipher.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8')
}

export interface EnvVarInfo {
  name: string
  sensitive: boolean
  value: string | null // null when sensitive: never sent to the browser
  updated_at: string
}

export async function listEnv(repoId: string): Promise<EnvVarInfo[]> {
  const rows = await db().repoEnv.findMany({
    where: { repo_id: repoId },
    orderBy: { name: 'asc' },
    select: { name: true, sensitive: true, value: true, updated_at: true },
  })
  return rows.map((r) => ({ ...r, value: r.sensitive ? null : r.value, updated_at: r.updated_at.toISOString() }))
}

async function write(tx: Prisma.TransactionClient, repoId: string, name: string, value: string, sensitive: boolean) {
  const data = {
    sensitive,
    value: sensitive ? null : value,
    value_enc: sensitive ? encryptSecret(secretKey(), repoId, name, value) : null,
  }
  await tx.repoEnv.upsert({
    where: { repo_id_name: { repo_id: repoId, name } },
    create: { repo_id: repoId, name, ...data },
    update: { ...data, updated_at: new Date() },
  })
}

// Reads that lock the rows they return until the transaction ends (Prisma has no FOR UPDATE), so two edits of the
// same variables cannot interleave between the read and the write.
const lockVar = (tx: Prisma.TransactionClient, repoId: string, name: string) => tx.$queryRaw<
  { sensitive: boolean; value: string | null }[]
>`select sensitive, value from repo_env where repo_id = ${repoId} and name = ${name} for update`
const lockVars = (tx: Prisma.TransactionClient, repoId: string) =>
  tx.$queryRaw<{ name: string; sensitive: boolean }[]>`select name, sensitive from repo_env where repo_id = ${repoId} for update`

/**
 * Create or change one variable. `value` omitted keeps the current value: a plain variable can become sensitive
 * that way (it gets encrypted), but a sensitive one can only become plain with a new value.
 */
export async function setEnvVar(
  repoId: string,
  name: string,
  change: { value?: string; sensitive: boolean },
): Promise<void> {
  await db().$transaction(async (tx) => {
    const [cur] = await lockVar(tx, repoId, name)
    let value = change.value
    if (value === undefined) {
      if (!cur) throw new EnvRuleError('value is required for a new variable')
      if (cur.sensitive && !change.sensitive) {
        throw new EnvRuleError('enter a new value to make a sensitive variable plain (it cannot be revealed)')
      }
      if (cur.sensitive) return // unchanged
      value = cur.value as string
    }
    await write(tx, repoId, name, value, change.sensitive)
  })
}

export async function deleteEnvVar(repoId: string, name: string): Promise<boolean> {
  return (await db().repoEnv.deleteMany({ where: { repo_id: repoId, name } })).count > 0
}

/**
 * A .env import: existing names get the new value and keep their sensitivity, new names are added (sensitive if
 * their name looks like a credential), variables missing from the file are kept. One transaction. Names only back.
 */
export async function importEnv(
  repoId: string,
  entries: { name: string; value: string }[],
): Promise<{ added: string[]; replaced: string[]; sensitive: string[] }> {
  return db().$transaction(async (tx) => {
    const existing = new Map((await lockVars(tx, repoId)).map((r) => [r.name, r.sensitive]))
    const sensitive: string[] = []
    for (const e of entries) {
      const s = existing.get(e.name) ?? looksSensitive(e.name)
      if (s) sensitive.push(e.name)
      await write(tx, repoId, e.name, e.value, s)
    }
    const names = entries.map((e) => e.name)
    return { added: names.filter((n) => !existing.has(n)), replaced: names.filter((n) => existing.has(n)), sensitive }
  })
}
