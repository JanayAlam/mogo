import { NextResponse } from 'next/server'

import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { insertRepo, type RepoInput } from '@/lib/projects'
import { validateRepoInput } from '@/lib/validate'

export async function POST(req: Request, { params }: IdParams) {
  const input = validateRepoInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  try {
    const repo = await insertRepo((await params).id, input as RepoInput)
    return repo ? NextResponse.json(repo, { status: 201 }) : notFound('project')
  } catch (e) {
    if (e instanceof Error && e.message === 'duplicate') return fail(409, `${input.full_name} is already in this project`)
    throw e
  }
}
