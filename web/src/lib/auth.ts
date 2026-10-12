import { fail } from '@/lib/http'
import { COOKIE, readCookie } from '@/lib/session-cookie'
import { type SessionUser, userForToken } from '@/lib/sessions'

/**
 * Sign-in is GitHub only (app/api/auth/github). The proxy only checks that a session cookie is there; route handlers
 * check it against the database through `authed`, so a deleted session or user stops working at once.
 */
export { COOKIE, COOKIE_MAX_AGE, cookieOptions, readCookie } from '@/lib/session-cookie'
export type { SessionUser } from '@/lib/sessions'

export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, COOKIE)
  return token ? userForToken(token) : null
}

/** Wraps a route handler: 401 without a valid session, else the handler gets the user first. */
export function authed<A extends unknown[]>(handler: (user: SessionUser, req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const user = await currentUser(req)
    if (!user) return fail(401, 'unauthorized')
    return handler(user, req, ...rest)
  }
}
