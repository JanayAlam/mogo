import { NextResponse } from 'next/server'

import { listRuns } from '@/lib/runs'

/** Runs are created per feature: POST /api/features/:id/runs. */
export async function GET() {
  return NextResponse.json(await listRuns())
}
