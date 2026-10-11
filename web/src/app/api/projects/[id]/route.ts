import { NextResponse } from 'next/server'

import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { deleteProject, getProject, updateProject } from '@/lib/projects'
import { validateProjectInput } from '@/lib/validate'

export async function GET(_req: Request, { params }: IdParams) {
  const project = await getProject((await params).id)
  return project ? NextResponse.json(project) : notFound('project')
}

export async function PATCH(req: Request, { params }: IdParams) {
  const input = validateProjectInput(await readJson(req), true)
  if (typeof input === 'string') return fail(422, input)
  return (await updateProject((await params).id, input)) ? NextResponse.json({ ok: true }) : notFound('project')
}

export async function DELETE(_req: Request, { params }: IdParams) {
  return (await deleteProject((await params).id)) ? NextResponse.json({ ok: true }) : notFound('project')
}
