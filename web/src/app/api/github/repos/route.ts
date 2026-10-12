import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { installedRepos } from '@/lib/github-app'
import { githubFailure } from '@/lib/github-errors'

/** Repos the user can add: those of Mogo App installations their GitHub account can see. */
export const GET = authed(async (user) => {
  try {
    return NextResponse.json(await installedRepos(user.id))
  } catch (e) {
    return githubFailure(e)
  }
})
