import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { type IdParams, notFound } from '@/lib/http'
import { getRun } from '@/lib/runs'

export const GET = authed(async (user, _req, { params }: IdParams) => {
  const run = await getRun((await params).id, user.id)
  return run ? NextResponse.json(run) : notFound('run')
})
