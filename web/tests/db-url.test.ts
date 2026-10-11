import { describe, expect, it } from 'vitest'

import { cleanDatabaseUrl } from '@/lib/db'

describe('cleanDatabaseUrl', () => {
  it('drops Prisma-only options and keeps the rest', () => {
    expect(cleanDatabaseUrl('postgresql://u:p@h:6543/db?pgbouncer=true&connection_limit=1&sslmode=require')).toBe(
      'postgresql://u:p@h:6543/db?sslmode=require',
    )
  })
  it('keeps a raw @ in the password as part of the password', () => {
    const url = new URL(cleanDatabaseUrl('postgresql://postgres.abc:p@ss@aws-0.pooler.supabase.com:5432/postgres'))
    expect([url.hostname, decodeURIComponent(url.password)]).toEqual(['aws-0.pooler.supabase.com', 'p@ss'])
  })
})
