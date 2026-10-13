import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { githubAccess } from '@/lib/github-app'
import { githubFailure } from '@/lib/github-errors'

/** Whether the Mogo App is installed, and the repos the user can add: those of its installations their account can see. */
export const GET = authed(async (user) => {
  try {
    return NextResponse.json(await githubAccess(user.id))
  } catch (e) {
    return githubFailure(e)
  }
})
