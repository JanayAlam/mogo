import { NextResponse } from 'next/server'

import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { deleteRepo, getRepo, updateRepo } from '@/lib/projects'
import { validateRepoInput } from '@/lib/validate'

export async function GET(_req: Request, { params }: IdParams) {
  const repo = await getRepo((await params).id)
  return repo ? NextResponse.json(repo) : notFound('repo')
}

export async function PATCH(req: Request, { params }: IdParams) {
  const input = validateRepoInput(await readJson(req), true)
  if (typeof input === 'string') return fail(422, input)
  return (await updateRepo((await params).id, input)) ? NextResponse.json({ ok: true }) : notFound('repo')
}

export async function DELETE(_req: Request, { params }: IdParams) {
  return (await deleteRepo((await params).id)) ? NextResponse.json({ ok: true }) : notFound('repo')
}
