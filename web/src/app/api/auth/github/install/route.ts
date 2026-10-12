import { installUrl } from '@/lib/github-app'
import { redirectWithState } from '@/lib/oauth-state'

/** Install the Mogo App on more repos (or change the selection). GitHub comes back through the sign-in callback. */
export async function GET(req: Request) {
  return redirectWithState(installUrl, new URL(req.url).searchParams.get('next'))
}
