import { authorizeUrl } from '@/lib/github-app'
import { redirectWithState } from '@/lib/oauth-state'

/** Starts "Sign in with GitHub". `?next=/path` is where to land afterwards. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const callback = new URL('/api/auth/github/callback', url).toString()
  return redirectWithState((state) => authorizeUrl(state, callback), url.searchParams.get('next'))
}
