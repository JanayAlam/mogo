import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { deleteRepo, getRepo, updateRepo } from '@/lib/projects'
import { validateRepoInput } from '@/lib/validate'

export const GET = authed(async (user, _req, { params }: IdParams) => {
  const repo = await getRepo((await params).id, user.id)
  return repo ? NextResponse.json(repo) : notFound('repo')
})

export const PATCH = authed(async (user, req, { params }: IdParams) => {
  const input = validateRepoInput(await readJson(req), true)
  if (typeof input === 'string') return fail(422, input)
  return (await updateRepo((await params).id, user.id, input)) ? NextResponse.json({ ok: true }) : notFound('repo')
})

export const DELETE = authed(async (user, _req, { params }: IdParams) =>
  (await deleteRepo((await params).id, user.id)) ? NextResponse.json({ ok: true }) : notFound('repo'),
)
