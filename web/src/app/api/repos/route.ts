import { connection, NextResponse } from 'next/server'

import { loadRepoNames } from '@/lib/repos'

export async function GET() {
  await connection() // read env at request time, not at build time (Cache Components would prerender this)
  return NextResponse.json(loadRepoNames() ?? [])
}
