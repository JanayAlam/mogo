import { NextResponse } from 'next/server'

import { COOKIE, cookieOptions, readCookie } from '@/lib/auth'
import { destroySession } from '@/lib/sessions'

export async function POST(req: Request) {
  const token = readCookie(req, COOKIE)
  if (token) await destroySession(token)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, '', cookieOptions(0))
  return res
}
