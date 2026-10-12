import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { SecretKeyError } from '@/lib/env'
import { fail, readJson } from '@/lib/http'
import { getLlmSettings, setLlmSettings } from '@/lib/users'
import { validateLlmInput } from '@/lib/validate'

/** The user's LLM (any OpenAI-compatible API). The key is write-only: `has_key` says whether one is stored. */
export const GET = authed(async (user) => NextResponse.json(await getLlmSettings(user.id)))

export const PUT = authed(async (user, req) => {
  const input = validateLlmInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  try {
    await setLlmSettings(user.id, input)
  } catch (e) {
    if (e instanceof SecretKeyError) return fail(503, `${e.message}; API keys need it`)
    throw e
  }
  return NextResponse.json(await getLlmSettings(user.id))
})
