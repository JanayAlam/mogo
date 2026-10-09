import postgres from 'postgres'

const g = globalThis as { __sql?: postgres.Sql }

/** Lazy so `next build` works without env. Supabase pooler runs in transaction mode: no prepared statements. */
export function sql(): postgres.Sql {
  if (!g.__sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    const local = /@(localhost|127\.0\.0\.1)/.test(url)
    g.__sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : 'require' })
  }
  return g.__sql
}
