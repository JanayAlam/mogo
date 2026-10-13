import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { SecretKeyError } from '@/lib/env'
import { fail, type IdParams, notFound } from '@/lib/http'
import { checkConnection, ConnectionCheckError, resolveForCheck } from '@/lib/llm'

/** Re-checks a stored connection (is the server up, does the key still work, is the model still there). */
export const POST = authed(async (user, _req, { params }: IdParams) => {
  const { id } = await params
  try {
    const target = await resolveForCheck(user.id, id, {})
    if (!target) return notFound('connection')
    await checkConnection(target)
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof ConnectionCheckError) return fail(422, e.message)
    if (e instanceof SecretKeyError) return fail(503, e.message)
    throw e
  }
})
