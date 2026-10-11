import { connection, NextResponse } from 'next/server'

import { loginRequired } from '@/lib/auth'

/** Whether this deployment has a login, so the UI knows to offer "Log out". */
export async function GET() {
  await connection() // read env at request time, not at build time
  return NextResponse.json({ login_required: loginRequired() })
}
