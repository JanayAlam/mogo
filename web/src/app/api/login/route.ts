import { NextResponse } from 'next/server'

import { checkPassword, COOKIE, COOKIE_MAX_AGE, sessionToken } from '@/lib/auth'

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { password?: unknown } | null
  if (typeof body?.password !== 'string' || !checkPassword(body.password)) {
    return NextResponse.json({ detail: 'wrong password' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, await sessionToken(process.env.APP_PASSWORD!), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  })
  return res
}
