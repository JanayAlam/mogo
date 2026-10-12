import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { getStats } from '@/lib/runs'

export const GET = authed(async (user) => NextResponse.json(await getStats(user.id)))
