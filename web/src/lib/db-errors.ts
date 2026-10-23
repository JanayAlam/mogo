export interface DbFailure {
  /** One readable line for the logs. */
  log: string
  /** What the person using the app sees. */
  detail: string
}

/** Prisma codes for "no usable connection": can't reach (P1001), timed out (P1002), closed (P1017), pool timeout (P2024). */
const CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024'])

/** Text a driver or the Supabase pooler uses when the database is down, paused or its host does not resolve. */
const CONNECTION_TEXT =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|tenant\/user .* not found|can't reach database|connection terminated|timeout exceeded when trying to connect|server closed the connection/i

const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The first line of an error that Prisma wraps in a multi-line "Invalid `...` invocation" banner. */
function rootMessage(e: unknown): string {
  const lines = text(e).split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.find((l) => /database error|code:|can't reach|enotfound|econn|timeout/i.test(l)) ?? lines.at(-1) ?? 'unknown error'
}

export function isDbConnectionError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code
  if (typeof code === 'string' && CONNECTION_CODES.has(code)) return true
  return CONNECTION_TEXT.test(text(e))
}

/**
 * Turns a database connection error into a short log line and a message for the UI. Production users only learn the
 * service is unavailable; elsewhere the message says what to check. Returns null for any other error.
 */
export function describeDbError(e: unknown): DbFailure | null {
  if (!isDbConnectionError(e)) return null
  const log = `database unreachable: ${rootMessage(e)}. Check that the database is running (a free Supabase project pauses when idle) and that DATABASE_URL is correct.`
  const detail =
    process.env.NODE_ENV === 'production'
      ? 'Mogo is temporarily unavailable. Please try again in a few minutes.'
      : 'Cannot reach the database. If you use Supabase, restore the paused project and check DATABASE_URL. See the server log for details.'
  return { log, detail }
}
