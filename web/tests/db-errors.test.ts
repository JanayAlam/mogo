import { afterEach, describe, expect, it, vi } from 'vitest'

import { describeDbError } from '@/lib/db-errors'

const pooler = new Error(
  'Invalid `db().user.upsert()` invocation in /x/chunk.js:1354:154\n\n  1351 avatar_url: p.avatar_url\n→ 1354 await db().user.upsert(\nDatabase error. Code: `XX000`. Message: `(ENOTFOUND) tenant/user postgres.abc not found`',
)

afterEach(() => vi.unstubAllEnvs())

describe('describeDbError', () => {
  it('recognises a paused Supabase project and logs one readable line', () => {
    const r = describeDbError(pooler)!
    expect(r.log).toContain('database unreachable')
    expect(r.log).toContain('ENOTFOUND')
    expect(r.log).not.toContain('chunk.js')
  })

  it('recognises Prisma connection codes', () => {
    expect(describeDbError(Object.assign(new Error('x'), { code: 'P1001' }))).not.toBeNull()
  })

  it('ignores other errors', () => {
    expect(describeDbError(new Error('Unique constraint failed'))).toBeNull()
  })

  it('hides details from users in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = describeDbError(pooler)!
    expect(r.detail).not.toMatch(/supabase|DATABASE_URL/i)
  })

  it('tells developers what to check outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(describeDbError(pooler)!.detail).toMatch(/Supabase/)
  })
})
