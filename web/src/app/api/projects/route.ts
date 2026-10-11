import { NextResponse } from 'next/server'

import { fail, readJson } from '@/lib/http'
import { insertProject, listProjects } from '@/lib/projects'
import { validateProjectInput } from '@/lib/validate'

export async function GET() {
  return NextResponse.json(await listProjects())
}

export async function POST(req: Request) {
  const input = validateProjectInput(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  return NextResponse.json(await insertProject({ name: input.name!, description: input.description ?? '' }), {
    status: 201,
  })
}
