import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { deleteFeature, FeatureInputError, getFeature, updateFeature } from '@/lib/features'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { validateFeatureInput } from '@/lib/validate'

export const GET = authed(async (user, _req, { params }: IdParams) => {
  const feature = await getFeature((await params).id, user.id)
  return feature ? NextResponse.json(feature) : notFound('feature')
})

export const PATCH = authed(async (user, req, { params }: IdParams) => {
  const input = validateFeatureInput(await readJson(req), true)
  if (typeof input === 'string') return fail(422, input)
  try {
    return (await updateFeature((await params).id, user.id, input)) ? NextResponse.json({ ok: true }) : notFound('feature')
  } catch (e) {
    if (e instanceof FeatureInputError) return fail(422, e.message)
    throw e
  }
})

export const DELETE = authed(async (user, _req, { params }: IdParams) =>
  (await deleteFeature((await params).id, user.id)) ? NextResponse.json({ ok: true }) : notFound('feature'),
)
