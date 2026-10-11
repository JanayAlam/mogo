import { NextResponse } from 'next/server'

import { parseEnv } from '@/lib/dotenv'
import { fail, type IdParams, notFound, readJson } from '@/lib/http'
import { getRepo } from '@/lib/projects'
import { importSecrets, listSecrets, SecretKeyError } from '@/lib/secrets'
import { validateEnvFile } from '@/lib/validate'

/** Names and dates only; values cannot be read back. */
export async function GET(_req: Request, { params }: IdParams) {
  const { id } = await params
  if (!(await getRepo(id))) return notFound('repo')
  return NextResponse.json({ secrets: await listSecrets(id), key_configured: !!process.env.MOGO_SECRET_KEY })
}

/**
 * Import a .env file: every NAME=value becomes a secret of this repo. Existing names are replaced, new ones added,
 * secrets missing from the file are kept. The response lists names and line problems, never values.
 */
export async function POST(req: Request, { params }: IdParams) {
  const { id } = await params
  const input = validateEnvFile(await readJson(req))
  if (typeof input === 'string') return fail(422, input)
  if (!(await getRepo(id))) return notFound('repo')
  const { entries, problems } = parseEnv(input.content)
  if (entries.length === 0) return fail(422, 'no NAME=value lines found in the file')
  try {
    const result = await importSecrets(id, entries)
    return NextResponse.json({ ...result, skipped: problems })
  } catch (e) {
    if (e instanceof SecretKeyError) return fail(503, e.message)
    throw e
  }
}
