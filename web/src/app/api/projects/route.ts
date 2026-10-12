import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { fail, readJson } from '@/lib/http'
import { insertProject, listProjects } from '@/lib/projects'
import { validateProjectInput } from '@/lib/validate'

export const GET = authed(async (user) => NextResponse.json(await listProjects(user.id)))

export const POST = authed(async (user, req) => {
  const input = validateProjectInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  return NextResponse.json(await insertProject(user.id, { name: input.name!, description: input.description ?? '' }), {
    status: 201,
  })
})
