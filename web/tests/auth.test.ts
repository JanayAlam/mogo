import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST as login } from '@/app/api/login/route'
import { COOKIE, isAuthorized, sessionToken } from '@/lib/auth'
import { proxy } from '@/proxy'

afterEach(() => vi.unstubAllEnvs())

describe('isAuthorized', () => {
  it('requires the derived session cookie when a password is set', async () => {
    vi.stubEnv('APP_PASSWORD', 'hunter2')
    expect(await isAuthorized(undefined)).toBe(false)
    expect(await isAuthorized('guess')).toBe(false)
    expect(await isAuthorized(await sessionToken('hunter2'))).toBe(true)
  })
  it('fails closed in production without a password, open in dev', async () => {
    vi.stubEnv('APP_PASSWORD', '')
    vi.stubEnv('NODE_ENV', 'production')
    expect(await isAuthorized(undefined)).toBe(false)
    vi.stubEnv('NODE_ENV', 'development')
    expect(await isAuthorized(undefined)).toBe(true)
  })
})

describe('login route', () => {
  const req = (password: string) =>
    new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ password }) })

  it('rejects a wrong password', async () => {
    vi.stubEnv('APP_PASSWORD', 'hunter2')
    expect((await login(req('nope'))).status).toBe(401)
  })
  it('sets an httpOnly session cookie on success', async () => {
    vi.stubEnv('APP_PASSWORD', 'hunter2')
    const res = await login(req('hunter2'))
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie')!
    expect(cookie).toContain(`${COOKIE}=${await sessionToken('hunter2')}`)
    expect(cookie.toLowerCase()).toContain('httponly')
  })
})

describe('proxy', () => {
  it('blocks the API with 401 and redirects pages to /login', async () => {
    vi.stubEnv('APP_PASSWORD', 'hunter2')
    expect((await proxy(new NextRequest('http://x/api/runs'))).status).toBe(401)
    const page = await proxy(new NextRequest('http://x/'))
    expect(page.status).toBe(307)
    expect(page.headers.get('location')).toBe('http://x/login')
  })
  it('lets the login routes and authenticated requests through', async () => {
    vi.stubEnv('APP_PASSWORD', 'hunter2')
    expect((await proxy(new NextRequest('http://x/api/login'))).headers.get('x-middleware-next')).toBe('1')
    const authed = new NextRequest('http://x/api/runs', { headers: { cookie: `${COOKIE}=${await sessionToken('hunter2')}` } })
    expect((await proxy(authed)).headers.get('x-middleware-next')).toBe('1')
  })
})
