import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/client'

afterEach(() => vi.unstubAllGlobals())

const reply = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('api.githubAccess', () => {
  it('returns what the server says', async () => {
    reply(200, { connected: true, repos: [] })
    expect(await api.githubAccess()).toEqual({ connected: true, repos: [] })
  })

  it('reads expired GitHub access (401) as not connected, without leaving the page', async () => {
    reply(401, { detail: 'GitHub access expired; sign in again' })
    const location = { href: '/projects/p1' }
    vi.stubGlobal('window', { location })
    expect(await api.githubAccess()).toEqual({ connected: false, repos: [] })
    expect(location.href).toBe('/projects/p1') // no redirect to /login
  })

  it('still reports other failures', async () => {
    reply(502, { detail: 'GitHub API 502 on /user/installations' })
    await expect(api.githubAccess()).rejects.toThrow('GitHub API 502')
  })
})

describe('api.detectRepo', () => {
  it('turns a 401 into something to read, without leaving the page', async () => {
    reply(401, { detail: 'GitHub access expired; sign in again' })
    const location = { href: '/projects/p1/repos/r1' }
    vi.stubGlobal('window', { location })
    await expect(api.detectRepo('r1')).rejects.toThrow('GitHub access expired; sign in again')
    expect(location.href).toBe('/projects/p1/repos/r1')
  })
  it('returns what was detected', async () => {
    reply(200, { ok: true, dockerfile: true })
    expect(await api.detectRepo('r1')).toEqual({ ok: true, dockerfile: true })
  })
  it('passes other errors on with their message', async () => {
    reply(404, { detail: 'acme/api (branch nope) was not found, or the Mogo App cannot read it' })
    await expect(api.detectRepo('r1')).rejects.toThrow(/branch nope/)
  })
})
