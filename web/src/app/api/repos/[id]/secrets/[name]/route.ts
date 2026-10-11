import { NextResponse } from 'next/server'

import { fail, notFound, readJson } from '@/lib/http'
import { getRepo } from '@/lib/projects'
import { deleteSecret, SecretKeyError, setSecret } from '@/lib/secrets'
import { secretNameError, validateSecretValue } from '@/lib/validate'

type Params = { params: Promise<{ id: string; name: string }> }

/** Create or replace. The value is encrypted before it reaches the database and is never returned. */
export async function PUT(req: Request, { params }: Params) {
  const { id, name } = await params
  const nameError = secretNameError(name)
  if (nameError) return fail(422, nameError)
  const input = validateSecretValue(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  if (!(await getRepo(id))) return notFound('repo')
  try {
    await setSecret(id, name, input.value)
  } catch (e) {
    if (e instanceof SecretKeyError) return fail(503, e.message)
    throw e
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, name } = await params
  return (await deleteSecret(id, name)) ? NextResponse.json({ ok: true }) : notFound('secret')
}
