import { GitHubAppConfigError, GitHubReauthError } from '@/lib/github-app'
import { fail } from '@/lib/http'

/** A failed call to GitHub on the user's behalf, as a response. Expired access means signing in again: 401. */
export function githubFailure(e: unknown): Response {
  if (e instanceof GitHubReauthError) return fail(401, e.message)
  if (e instanceof GitHubAppConfigError) return fail(503, e.message)
  throw e
}
