import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { SecretKeyError } from '@/lib/env'
import { fail, readJson } from '@/lib/http'
import { checkConnection, ConnectionCheckError, createLlmConnection, listLlmConnections } from '@/lib/llm'
import { validateLlmCreate } from '@/lib/validate'

/** The user's LLM connections. Keys are write-only: `has_key` says whether one is stored. */
export const GET = authed(async (user) => NextResponse.json({ connections: await listLlmConnections(user.id) }))

/** Checks the connection against the provider first, so a wrong key or address is refused here and not on a run. */
export const POST = authed(async (user, req) => {
  const input = validateLlmCreate(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  try {
    await checkConnection({ ...input, api_key: input.api_key ?? '' })
    return NextResponse.json(await createLlmConnection(user.id, input), { status: 201 })
  } catch (e) {
    if (e instanceof ConnectionCheckError) return fail(422, e.message)
    if (e instanceof SecretKeyError) return fail(503, `${e.message}; API keys need it`)
    throw e
  }
})
