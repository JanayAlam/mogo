import { NextResponse } from 'next/server'

import { getRun } from '@/lib/runs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const run = await getRun(id)
  if (!run) return NextResponse.json({ detail: 'run not found' }, { status: 404 })
  return NextResponse.json(run)
}
