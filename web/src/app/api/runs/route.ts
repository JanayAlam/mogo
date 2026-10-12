import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { listRuns } from '@/lib/runs'

/** Runs are created per feature: POST /api/features/:id/runs. */
export const GET = authed(async (user) => NextResponse.json(await listRuns(user.id)))
