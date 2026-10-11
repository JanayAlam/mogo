import { NextResponse } from 'next/server'

import { getStats } from '@/lib/runs'

export async function GET() {
  return NextResponse.json(await getStats())
}
