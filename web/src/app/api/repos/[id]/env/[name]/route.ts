import { NextResponse } from 'next/server'

import { deleteEnvVar, EnvRuleError, SecretKeyError, setEnvVar } from '@/lib/env'
import { fail, notFound, readJson } from '@/lib/http'
import { getRepo } from '@/lib/projects'
import { envNameError, validateEnvVar } from '@/lib/validate'

type Params = { params: Promise<{ id: string; name: string }> }

/** Create or change. `value` may be omitted to only change `sensitive` (plain -> sensitive keeps the value). */
export async function PUT(req: Request, { params }: Params) {
  const { id, name } = await params
  const nameError = envNameError(name)
  if (nameError) return fail(422, nameError)
  const input = validateEnvVar(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  if (!(await getRepo(id))) return notFound('repo')
  try {
    await setEnvVar(id, name, input)
  } catch (e) {
    if (e instanceof SecretKeyError) return fail(503, `${e.message}; sensitive variables need it`)
    if (e instanceof EnvRuleError) return fail(422, e.message)
    throw e
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, name } = await params
  return (await deleteEnvVar(id, name)) ? NextResponse.json({ ok: true }) : notFound('variable')
}
