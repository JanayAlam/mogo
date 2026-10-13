import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { fail, readJson } from '@/lib/http'
import { OrderError, reorderLlmConnections } from '@/lib/llm'
import { validateLlmOrder } from '@/lib/validate'

/** The fallback order: runs try the switched-on connections first to last. Body: all the user's ids, in order. */
export const PUT = authed(async (user, req) => {
  const ids = validateLlmOrder(await readJson(req))
  if (typeof ids === 'string') return fail(422, ids)
  try {
    return NextResponse.json({ connections: await reorderLlmConnections(user.id, ids) })
  } catch (e) {
    if (e instanceof OrderError) return fail(409, e.message)
    throw e
  }
})
