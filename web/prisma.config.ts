import { defineConfig } from 'prisma/config'

/**
 * The schema is owned by db/migrations/*.sql (applied by `python -m mogo.tools.migrate`; the runner shares it).
 * prisma/schema.prisma mirrors it for the typed client: after adding a migration, apply it to a database and run
 * `pnpm db:pull`. Never `prisma migrate` or `prisma db push` here.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
