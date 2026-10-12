import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { deleteProject, getProject, updateProject } from '@/lib/projects'
import { validateProjectInput } from '@/lib/validate'

export const GET = authed(async (user, _req, { params }: IdParams) => {
  const project = await getProject((await params).id, user.id)
  return project ? NextResponse.json(project) : notFound('project')
})

export const PATCH = authed(async (user, req, { params }: IdParams) => {
  const input = validateProjectInput(await readJson(req), true)
  if (typeof input === 'string') return fail(422, input)
  return (await updateProject((await params).id, user.id, input)) ? NextResponse.json({ ok: true }) : notFound('project')
})

export const DELETE = authed(async (user, _req, { params }: IdParams) =>
  (await deleteProject((await params).id, user.id)) ? NextResponse.json({ ok: true }) : notFound('project'),
)
