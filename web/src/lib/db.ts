import postgres from 'postgres'

const g = globalThis as { __sql?: postgres.Sql }

// Prisma-only query options (connection strings are often copied from a Prisma app). postgres.js would send them
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

/** Lazy so `next build` works without env. Supabase pooler runs in transaction mode: no prepared statements. */
export function sql(): postgres.Sql {
  if (!g.__sql) {
    const raw = process.env.DATABASE_URL
    if (!raw) throw new Error('DATABASE_URL is not set')
    const url = cleanDatabaseUrl(raw)
    const local = /@(localhost|127\.0\.0\.1)/.test(url)
    g.__sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : 'require' })
  }
  return g.__sql
}
