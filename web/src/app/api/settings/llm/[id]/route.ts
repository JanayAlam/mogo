import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { SecretKeyError } from '@/lib/env'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import {
  checkConnection, ConnectionCheckError, deleteLlmConnection, getLlmConnection, resolveForCheck, updateLlmConnection,
} from '@/lib/llm'
import { validateLlmPatch } from '@/lib/validate'

/**
 * Edit a connection or switch it on or off (on = part of the fallback chain). A change to the address,
 * model or key is checked against the provider first; the key may be omitted to keep the stored one.
 */
export const PATCH = authed(async (user, req, { params }: IdParams) => {
  const { id } = await params
  const current = await getLlmConnection(user.id, id)
  if (!current) return notFound('connection')
  const patch = validateLlmPatch(await readJson(req), current.provider)
  if (typeof patch === 'string') return fail(422, patch)
  try {
    if (patch.base_url !== undefined || patch.model !== undefined || patch.api_key !== undefined) {
      const target = await resolveForCheck(user.id, id, patch)
      if (!target) return notFound('connection')
      await checkConnection(target)
    }
    const updated = await updateLlmConnection(user.id, id, patch)
    return updated ? NextResponse.json(updated) : notFound('connection')
  } catch (e) {
    if (e instanceof ConnectionCheckError) return fail(422, e.message)
    if (e instanceof SecretKeyError) return fail(503, `${e.message}; API keys need it`)
    throw e
  }
})

export const DELETE = authed(async (user, _req, { params }: IdParams) => {
  const { id } = await params
  return (await deleteLlmConnection(user.id, id)) ? NextResponse.json({ ok: true }) : notFound('connection')
})
