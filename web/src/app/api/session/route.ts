import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { appSlug } from '@/lib/github-app'
import { activeLlmModel } from '@/lib/llm'

/** Who is signed in, and whether an LLM connection is switched on (runs need it). */
export const GET = authed(async (user) => {
  const model = await activeLlmModel(user.id)
  return NextResponse.json({
    user,
    llm: { configured: !!model, model: model ?? '' },
    app_url: `https://github.com/apps/${appSlug()}`,
  })
})
