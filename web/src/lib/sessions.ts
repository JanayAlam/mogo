import { createHash, randomBytes } from 'node:crypto'

import { db } from '@/lib/db'
import { COOKIE_MAX_AGE } from '@/lib/session-cookie'

/** Sessions: the cookie holds a random token, the sessions table only its sha256. */

export interface SessionUser {
  id: string
  login: string
  name: string
  avatar_url: string
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Returns the cookie value. */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db().session.create({
    data: { token_hash: hashToken(token), user_id: userId, expires_at: new Date(Date.now() + COOKIE_MAX_AGE * 1000) },
  })
  return token
}

export async function userForToken(token: string): Promise<SessionUser | null> {
  const s = await db().session.findFirst({
    where: { token_hash: hashToken(token), expires_at: { gt: new Date() } },
    select: { user: { select: { id: true, login: true, name: true, avatar_url: true } } },
  })
  return s?.user ?? null
}

export async function destroySession(token: string): Promise<void> {
  await db().session.deleteMany({ where: { token_hash: hashToken(token) } })
}
