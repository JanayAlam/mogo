import { NextResponse } from 'next/server'

import { db } from '@/lib/db'
import { validWebhookSignature } from '@/lib/github-app'
import { fail } from '@/lib/http'
import { logger } from '@/lib/log'

interface Payload {
  action?: string
  installation?: { id: number }
  repositories_removed?: { full_name: string }[]
}

/**
 * Events of the Mogo App. Only removals are acted on, so repo pages can say "not installed" before a run fails;
 * new access is picked up when a user adds a repo or starts a run (lib/dispatch.ts).
 */
export async function POST(req: Request) {
  const body = await req.text()
  if (!validWebhookSignature(body, req.headers.get('x-hub-signature-256'))) return fail(401, 'bad signature')
  const event = req.headers.get('x-github-event')
  const p = JSON.parse(body) as Payload
  const id = p.installation?.id
  if (!id) return NextResponse.json({ ok: true })

  if (event === 'installation' && (p.action === 'deleted' || p.action === 'suspend')) {
    const { count } = await db().repo.updateMany({ where: { installation_id: id }, data: { installation_id: null } })
    logger.info('installation removed', { installation_id: id, action: p.action, repos: count })
  } else if (event === 'installation_repositories' && p.action === 'removed' && p.repositories_removed?.length) {
    const { count } = await db().repo.updateMany({
      where: {
        installation_id: id,
        OR: p.repositories_removed.map((r) => ({ full_name: { equals: r.full_name, mode: 'insensitive' as const } })),
      },
      data: { installation_id: null },
    })
    logger.info('repos removed from installation', { installation_id: id, repos: count })
  }
  return NextResponse.json({ ok: true })
}
