import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { FeatureInputError, type FeatureInput, insertFeature, listFeatures } from '@/lib/features'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { validateFeatureInput } from '@/lib/validate'

export const GET = authed(async (user, _req, { params }: IdParams) =>
  NextResponse.json(await listFeatures((await params).id, user.id)),
)

export const POST = authed(async (user, req, { params }: IdParams) => {
  const input = validateFeatureInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  try {
    const feature = await insertFeature((await params).id, user.id, input as FeatureInput)
    return feature ? NextResponse.json(feature, { status: 201 }) : notFound('project')
  } catch (e) {
    if (e instanceof FeatureInputError) return fail(422, e.message)
    throw e
  }
})
