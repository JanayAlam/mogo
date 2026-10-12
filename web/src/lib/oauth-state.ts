import { randomBytes } from 'node:crypto'

import { NextResponse } from 'next/server'

import { cookieOptions } from '@/lib/session-cookie'

/** CSRF state for the GitHub round trip, plus where to land afterwards. Cookie value: "<state>:<path>". */
export const STATE_COOKIE = 'mogo_oauth_state'
const STATE_MAX_AGE = 10 * 60

/** Only paths on this site: "/x", never "//evil.com" or "/\evil.com". */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

export function redirectWithState(target: (state: string) => string, next: string | null): NextResponse {
  const state = randomBytes(24).toString('base64url')
  const res = NextResponse.redirect(target(state))
  res.cookies.set(STATE_COOKIE, `${state}:${safeNext(next)}`, cookieOptions(STATE_MAX_AGE))
  return res
}

/** The landing path when `state` matches the cookie, else null. */
export function checkState(cookie: string | undefined, state: string | null): string | null {
  if (!cookie || !state) return null
  const i = cookie.indexOf(':')
  return i > 0 && cookie.slice(0, i) === state ? safeNext(cookie.slice(i + 1)) : null
}
