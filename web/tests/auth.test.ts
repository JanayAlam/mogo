import { createHmac } from 'node:crypto'

import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sessions', () => ({ userForToken: vi.fn(), createSession: vi.fn(), destroySession: vi.fn() }))
vi.mock('@/lib/users', () => ({ upsertUser: vi.fn(), saveGitHubTokens: vi.fn() }))

import { GET as callback } from '@/app/api/auth/github/callback/route'
import { GET as login } from '@/app/api/auth/github/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'
import { POST as webhook } from '@/app/api/github/webhook/route'
import { authed, COOKIE, readCookie } from '@/lib/auth'
import { validWebhookSignature } from '@/lib/github-app'
import { checkState, safeNext, STATE_COOKIE } from '@/lib/oauth-state'
import * as sessions from '@/lib/sessions'
import * as users from '@/lib/users'
import { proxy } from '@/proxy'

const ALICE = { id: 'u1', login: 'alice', name: 'Alice', avatar_url: '' }

beforeEach(() => {
  vi.stubEnv('GITHUB_APP_CLIENT_ID', 'Iv1.client')
  vi.stubEnv('GITHUB_APP_CLIENT_SECRET', 'shh')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('proxy', () => {
  it('lets sign-in routes and the webhook through without a session', async () => {
    for (const path of ['/login', '/api/auth/github/login', '/api/auth/github/callback', '/api/github/webhook']) {
      expect((await proxy(new NextRequest(`http://x${path}`))).headers.get('x-middleware-next')).toBe('1')
    }
  })
  it('401s the API and sends pages to /login without a session cookie', async () => {
    expect((await proxy(new NextRequest('http://x/api/projects'))).status).toBe(401)
    const page = await proxy(new NextRequest('http://x/'))
    expect(page.headers.get('location')).toBe('http://x/login')
    expect((await proxy(new NextRequest('http://x/api/authx'))).status).toBe(401) // not a prefix match on "auth"
  })
  it('passes requests with a session cookie on to the handlers', async () => {
    const req = new NextRequest('http://x/api/projects', { headers: { cookie: `${COOKIE}=t` } })
    expect((await proxy(req)).headers.get('x-middleware-next')).toBe('1')
  })
})

describe('authed', () => {
  const handler = authed(async (user) => Response.json({ login: user.login }))
  it('401s without a cookie or with an unknown session', async () => {
    expect((await handler(new Request('http://x'))).status).toBe(401)
    vi.mocked(sessions.userForToken).mockResolvedValue(null)
    expect((await handler(new Request('http://x', { headers: { cookie: `${COOKIE}=old` } }))).status).toBe(401)
  })
  it('hands the session user to the handler', async () => {
    vi.mocked(sessions.userForToken).mockResolvedValue(ALICE)
    const res = await handler(new Request('http://x', { headers: { cookie: `a=1; ${COOKIE}=tok` } }))
    expect(await res.json()).toEqual({ login: 'alice' })
    expect(sessions.userForToken).toHaveBeenCalledWith('tok')
  })
  it('reads cookies, ignoring malformed ones', () => {
    const req = new Request('http://x', { headers: { cookie: `x=%E0; ${COOKIE}=a%3Ab` } })
    expect(readCookie(req, COOKIE)).toBe('a:b')
    expect(readCookie(req, 'x')).toBeUndefined()
  })
})

describe('oauth state', () => {
  it('only lands on paths of this site', () => {
    expect(safeNext('/projects/1')).toBe('/projects/1')
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', null]) expect(safeNext(bad)).toBe('/')
  })
  it('matches the cookie', () => {
    expect(checkState('abc:/settings', 'abc')).toBe('/settings')
    expect(checkState('abc:/settings', 'abd')).toBeNull()
    expect(checkState(undefined, 'abc')).toBeNull()
  })
})

describe('sign-in', () => {
  it('redirects to GitHub with a state that is also in a cookie', async () => {
    const res = await login(new Request('http://x/api/auth/github/login?next=/settings'))
    const to = new URL(res.headers.get('location')!)
    expect(to.origin + to.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(to.searchParams.get('client_id')).toBe('Iv1.client')
    expect(to.searchParams.get('redirect_uri')).toBe('http://x/api/auth/github/callback')
    expect(res.headers.get('set-cookie')).toContain(
      `${STATE_COOKIE}=${encodeURIComponent(`${to.searchParams.get('state')}:/settings`)}`,
    )
  })

  const cb = (query: string, cookie?: string) =>
    callback(new Request(`http://x/api/auth/github/callback?${query}`, { headers: cookie ? { cookie } : {} }))

  it('creates the user and a session, then lands where the sign-in started', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url.startsWith('https://github.com/login/oauth/access_token')
        ? Response.json({ access_token: 'ghu_1', expires_in: 28800, refresh_token: 'ghr_1' })
        : Response.json({ id: 42, login: 'alice', name: null, avatar_url: 'a', email: null }),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(users.upsertUser).mockResolvedValue('u1')
    vi.mocked(sessions.createSession).mockResolvedValue('session-token')
    const res = await cb('code=c&state=s1', `${STATE_COOKIE}=s1:/settings`)
    expect(res.headers.get('location')).toBe('http://x/settings')
    expect(res.headers.get('set-cookie')).toContain(`${COOKIE}=session-token`)
    expect(users.upsertUser).toHaveBeenCalledWith(expect.objectContaining({ id: 42, login: 'alice' }))
    expect(users.saveGitHubTokens).toHaveBeenCalledWith('u1', expect.objectContaining({ refresh_token: 'ghr_1' }))
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ code: 'c', client_secret: 'shh' })
  })
  it('refuses a state that does not match (no session)', async () => {
    const res = await cb('code=c&state=other', `${STATE_COOKIE}=s1:/`)
    expect(res.headers.get('location')).toMatch(/^http:\/\/x\/login\?error=/)
    expect(sessions.createSession).not.toHaveBeenCalled()
  })
  it('restarts sign-in after an install started on github.com (no state)', async () => {
    const res = await cb('code=c&installation_id=9&setup_action=install')
    expect(res.headers.get('location')).toBe('http://x/api/auth/github/login')
  })
  it('shows GitHub errors on the login page', async () => {
    const res = await cb('error=access_denied&error_description=denied')
    expect(res.headers.get('location')).toBe('http://x/login?error=denied')
  })
  it('logout deletes the session and clears the cookie', async () => {
    const res = await logout(new Request('http://x', { method: 'POST', headers: { cookie: `${COOKIE}=tok` } }))
    expect(sessions.destroySession).toHaveBeenCalledWith('tok')
    expect(res.headers.get('set-cookie')!.toLowerCase()).toContain('max-age=0')
  })
})

describe('webhook', () => {
  const sign = (body: string, secret = 'hook') => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  it('checks the signature', async () => {
    expect(validWebhookSignature('{}', sign('{}'), 'hook')).toBe(true)
    expect(validWebhookSignature('{}', sign('{}', 'other'), 'hook')).toBe(false)
    expect(validWebhookSignature('{}', null, 'hook')).toBe(false)
    expect(validWebhookSignature('{}', sign('{}'), '')).toBe(false) // no secret configured: refuse everything
  })
  it('401s unsigned deliveries', async () => {
    vi.stubEnv('GITHUB_WEBHOOK_SECRET', 'hook')
    const req = new Request('http://x', { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': sign('{}', 'x') } })
    expect((await webhook(req)).status).toBe(401)
  })
})
