import { NextResponse } from 'next/server'

import { FeatureInputError, type FeatureInput, insertFeature, listFeatures } from '@/lib/features'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { validateFeatureInput } from '@/lib/validate'

export async function GET(_req: Request, { params }: IdParams) {
  return NextResponse.json(await listFeatures((await params).id))
}

export async function POST(req: Request, { params }: IdParams) {
  const input = validateFeatureInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  try {
    const feature = await insertFeature((await params).id, input as FeatureInput)
    return feature ? NextResponse.json(feature, { status: 201 }) : notFound('project')
  } catch (e) {
    if (e instanceof FeatureInputError) return fail(422, e.message)
    throw e
  }
}
