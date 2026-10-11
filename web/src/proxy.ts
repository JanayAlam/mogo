import { NextResponse, type NextRequest } from 'next/server'

import { COOKIE, isAuthorized, loginRequired } from '@/lib/auth'

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname === '/login' && !loginRequired()) return NextResponse.redirect(new URL('/', req.url))
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next()
  if (await isAuthorized(req.cookies.get(COOKIE)?.value)) return NextResponse.next()
  if (pathname.startsWith('/api/')) return NextResponse.json({ detail: 'unauthorized' }, { status: 401 })
  return NextResponse.redirect(new URL('/login', req.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
