import { NextResponse } from 'next/server'

import { COOKIE, COOKIE_MAX_AGE, cookieOptions, readCookie } from '@/lib/auth'
import { describeDbError } from '@/lib/db-errors'
import { exchangeCode, fetchProfile } from '@/lib/github-app'
import { logger } from '@/lib/log'
import { checkState, STATE_COOKIE } from '@/lib/oauth-state'
import { createSession } from '@/lib/sessions'
import { saveGitHubTokens, upsertUser } from '@/lib/users'

/**
 * GitHub sends the user back here after sign-in, and after installing the App (code + installation_id). A user is
 * created on first sign-in. An install started on github.com carries no state of ours: sign in again from here.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const p = url.searchParams
  const toLogin = (error: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, url))

  if (p.get('error')) return toLogin(p.get('error_description') || p.get('error')!)
  const code = p.get('code')
  if (!code) return NextResponse.redirect(new URL('/', url)) // e.g. an installation changed without sign-in
  const next = checkState(readCookie(req, STATE_COOKIE), p.get('state'))
  if (!next) {
    if (!p.get('state')) return NextResponse.redirect(new URL('/api/auth/github/login', url))
    return toLogin('The sign-in link expired or was opened in another browser. Try again.')
  }

  let userId: string
  try {
    const tokens = await exchangeCode(code, new URL('/api/auth/github/callback', url).toString())
    const profile = await fetchProfile(tokens.access_token)
    userId = await upsertUser(profile)
    await saveGitHubTokens(userId, tokens)
    logger.info('signed in', { user_id: userId, login: profile.login })
  } catch (e) {
    const db = describeDbError(e)
    if (db) {
      logger.error('sign-in failed', { error: db.log })
      return toLogin(db.detail)
    }
    logger.error('sign-in failed', { error: e instanceof Error ? e.message : String(e) })
    return toLogin(e instanceof Error ? e.message : 'GitHub sign-in failed')
  }
  const res = NextResponse.redirect(new URL(next, url))
  res.cookies.set(COOKIE, await createSession(userId), cookieOptions(COOKIE_MAX_AGE))
  res.cookies.set(STATE_COOKIE, '', cookieOptions(0))
  return res
}
