import { NextResponse } from 'next/server'

import { deleteFeature, FeatureInputError, getFeature, updateFeature } from '@/lib/features'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { validateFeatureInput } from '@/lib/validate'

export async function GET(_req: Request, { params }: IdParams) {
  const feature = await getFeature((await params).id)
  return feature ? NextResponse.json(feature) : notFound('feature')
}

export async function PATCH(req: Request, { params }: IdParams) {
  const input = validateFeatureInput(await readJson(req), true)
  if (typeof input === 'string') return fail(422, input)
  try {
    return (await updateFeature((await params).id, input)) ? NextResponse.json({ ok: true }) : notFound('feature')
  } catch (e) {
    if (e instanceof FeatureInputError) return fail(422, e.message)
    throw e
  }
}

export async function DELETE(_req: Request, { params }: IdParams) {
  return (await deleteFeature((await params).id)) ? NextResponse.json({ ok: true }) : notFound('feature')
}
