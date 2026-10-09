import * as Sentry from '@sentry/nextjs'

export function register() {
  if (!process.env.SENTRY_DSN) return
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  })
}

export const onRequestError = Sentry.captureRequestError
