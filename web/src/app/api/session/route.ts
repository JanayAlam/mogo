import { NextResponse } from 'next/server'

import { authed } from '@/lib/auth'
import { appSlug } from '@/lib/github-app'
import { getLlmSettings, llmConfigured } from '@/lib/users'

/** Who is signed in, and whether their LLM is set up (runs need it). */
export const GET = authed(async (user) => {
  const llm = await getLlmSettings(user.id)
  return NextResponse.json({
    user,
    llm: { configured: llmConfigured(llm), model: llm.model },
    app_url: `https://github.com/apps/${appSlug()}`,
  })
})
