/** Cookie helpers with no database import, so the proxy stays light. */
export const COOKIE = 'mogo_session'
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
})

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i <= 0 || part.slice(0, i).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}
