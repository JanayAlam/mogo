import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '@/generated/prisma/client'

const g = globalThis as { __prisma?: PrismaClient }

// Prisma-only query options (connection strings are often copied from a Prisma app). node-postgres would send them
// to the server as settings, which it rejects. Same list as PRISMA_OPTIONS in backend/mogo/config.py.
const PRISMA_OPTIONS = [
  'connection_limit', 'pool_timeout', 'pgbouncer', 'schema', 'statement_cache_size', 'socket_timeout',
  'sslaccept', 'sslidentity', 'sslpassword',
]

/** Drops Prisma-only options. new URL() takes the last '@' as the host separator, so a raw '@' in the password works. */
export function cleanDatabaseUrl(raw: string): string {
  const url = new URL(raw.trim())
  for (const k of PRISMA_OPTIONS) url.searchParams.delete(k)
  return url.toString()
}

/**
 * The Prisma client, created on first use so `next build` works without env. One connection: on Vercel each instance
 * serves one request at a time, and the Supabase pooler multiplexes. TLS without certificate checks (Supabase's
 * pooler certificate is not in Node's store); `sslmode` in the URL is dropped because node-postgres would read it as
 * verify-full. Schema: db/migrations, mirrored in prisma/schema.prisma (see prisma.config.ts).
 */
export function db(): PrismaClient {
  if (!g.__prisma) {
    const raw = process.env.DATABASE_URL
    if (!raw) throw new Error('DATABASE_URL is not set')
    const url = new URL(cleanDatabaseUrl(raw))
    url.searchParams.delete('sslmode')
    const local = ['localhost', '127.0.0.1'].includes(url.hostname)
    const adapter = new PrismaPg({ connectionString: url.toString(), max: 1, ssl: local ? false : { rejectUnauthorized: false } })
    g.__prisma = new PrismaClient({ adapter })
  }
  return g.__prisma
}

/** bigint columns (GitHub ids) come back as BigInt, which JSON cannot carry: the API sends them as strings. */
export const bigintString = (v: bigint | null) => (v === null ? null : v.toString())
