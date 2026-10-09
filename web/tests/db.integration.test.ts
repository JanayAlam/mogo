// Runs against a real Postgres only when TEST_DATABASE_URL is set (schema from ../db/schema.sql applied).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sql } from '@/lib/db'
import { getRun, insertRun, listRuns, markRunFailed } from '@/lib/runs'

describe.skipIf(!process.env.TEST_DATABASE_URL)('runs queries (postgres)', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  })
  afterAll(async () => {
    await sql().end()
  })

  it('inserts, lists, reads with events, and marks failed', async () => {
    const run = await insertRun({
      repo: 'acme/api', pr_url: 'https://github.com/acme/api/pull/1', pr_number: 1,
      feature: 'f', llm_mode: 'auto', dry_run: false,
    })
    expect(run.status).toBe('queued')
    expect((await listRuns()).some((r) => r.id === run.id)).toBe(true)

    await sql()`insert into run_events (run_id, level, message) values (${run.id}, 'info', 'hello')`
    await markRunFailed(run.id, 'boom')
    const got = await getRun(run.id)
    expect(got).toMatchObject({ status: 'failed', error: 'boom', events: [{ message: 'hello' }] })
    expect(await getRun('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
