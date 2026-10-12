import { NextResponse, type NextRequest } from 'next/server'

import { COOKIE } from '@/lib/session-cookie'

/** Reachable without a session: the sign-in pages and GitHub's webhook (it carries its own signature). */
const PUBLIC = ['/login', '/api/auth/', '/api/github/webhook']

/** Cheap gate: a session cookie must be present. Route handlers validate it (lib/auth.ts `authed`). */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC.some((p) => pathname === p || (p.endsWith('/') && pathname.startsWith(p)))) return NextResponse.next()
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next()
  if (pathname.startsWith('/api/')) return NextResponse.json({ detail: 'unauthorized' }, { status: 401 })
  return NextResponse.redirect(new URL('/login', req.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
