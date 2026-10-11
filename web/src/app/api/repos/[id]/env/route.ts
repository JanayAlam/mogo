import { NextResponse } from 'next/server'

import { parseEnv } from '@/lib/dotenv'
import { importEnv, listEnv, SecretKeyError } from '@/lib/env'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { getRepo } from '@/lib/projects'
import { validateEnvFile } from '@/lib/validate'

/** Plain values are returned, sensitive ones never are. */
export async function GET(_req: Request, { params }: IdParams) {
  const { id } = await params
  if (!(await getRepo(id))) return notFound('repo')
  return NextResponse.json({ vars: await listEnv(id), key_configured: !!process.env.MOGO_SECRET_KEY })
}

/**
 * Import a .env file: existing names are replaced (keeping their sensitivity), new ones added (sensitive when the
 * name looks like a credential), variables missing from the file are kept. Names and line problems only, no values.
 */
export async function POST(req: Request, { params }: IdParams) {
  const { id } = await params
  const input = validateEnvFile(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  if (!(await getRepo(id))) return notFound('repo')
  const { entries, problems } = parseEnv(input.content)
  if (entries.length === 0) return fail(422, 'no NAME=value lines found in the file')
  try {
    return NextResponse.json({ ...(await importEnv(id, entries)), skipped: problems })
  } catch (e) {
    if (e instanceof SecretKeyError) return fail(503, `${e.message}; sensitive variables need it`)
    throw e
  }
}
