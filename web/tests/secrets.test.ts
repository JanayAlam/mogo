import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/projects', () => ({ getRepo: vi.fn() }))
vi.mock('@/lib/secrets', async (orig) => ({
  ...(await orig<typeof import('@/lib/secrets')>()),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  listSecrets: vi.fn(),
  importSecrets: vi.fn(),
}))

import { DELETE, PUT } from '@/app/api/repos/[id]/secrets/[name]/route'
import { GET, POST as importFile } from '@/app/api/repos/[id]/secrets/route'
import * as projects from '@/lib/projects'
import * as secrets from '@/lib/secrets'
import { encryptSecret, SecretKeyError, secretKey } from '@/lib/secrets'

// Same vector as backend/tests/test_secrets.py: the runner must decrypt what the web app writes.
const KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
const TOKEN = 'v1:AQEBAQEBAQEBAQEBBo76w/fNiX3r+/NUSkezlduIY5tq83t3Oh470rmxICyxyR4c1nGnqI+mwg=='

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('encryptSecret', () => {
  it('matches the shared test vector', () => {
    const iv = Buffer.alloc(12, 1)
    expect(encryptSecret(secretKey(KEY), 'repo-1', 'DATABASE_URL', 'postgres://u:pässword@db/x', iv)).toBe(TOKEN)
  })
  it('uses a fresh iv every time', () => {
    const k = secretKey(KEY)
    expect(encryptSecret(k, 'r', 'A', 'same')).not.toBe(encryptSecret(k, 'r', 'A', 'same'))
  })
  it('rejects a missing or short key', () => {
    expect(() => secretKey('')).toThrow(SecretKeyError)
    expect(() => secretKey(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes')
  })
})

describe('secrets routes', () => {
  const ctx = (id: string, name = 'API_KEY') => ({ params: Promise.resolve({ id, name }) })
  const put = (body: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(body) })

  it('stores a value and never returns it', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    const res = await PUT(put({ value: 'value must be kept as is' }), ctx('r1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(secrets.setSecret).toHaveBeenCalledWith('r1', 'API_KEY', 'value must be kept as is')
  })
  it.each([
    ['bad name', { value: 'x' }, 'BAD NAME', 422],
    ['empty value', { value: '' }, 'API_KEY', 422],
  ])('%s -> %i', async (_n, body, name, status) => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    expect((await PUT(put(body), ctx('r1', name))).status).toBe(status)
    expect(secrets.setSecret).not.toHaveBeenCalled()
  })
  it('503s without MOGO_SECRET_KEY, 404s for an unknown repo', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(secrets.setSecret).mockRejectedValueOnce(new SecretKeyError('MOGO_SECRET_KEY is not set'))
    expect((await PUT(put({ value: 'x' }), ctx('r1'))).status).toBe(503)
    vi.mocked(projects.getRepo).mockResolvedValue(null)
    expect((await PUT(put({ value: 'x' }), ctx('nope'))).status).toBe(404)
  })
  it('lists names and whether a key is configured', async () => {
    vi.stubEnv('MOGO_SECRET_KEY', KEY)
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(secrets.listSecrets).mockResolvedValue([{ name: 'API_KEY', updated_at: 't' }])
    expect(await (await GET(new Request('http://x'), ctx('r1'))).json()).toEqual({
      secrets: [{ name: 'API_KEY', updated_at: 't' }],
      key_configured: true,
    })
  })
  it('deletes', async () => {
    vi.mocked(secrets.deleteSecret).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await DELETE(new Request('http://x'), ctx('r1'))).status).toBe(200)
    expect((await DELETE(new Request('http://x'), ctx('r1'))).status).toBe(404)
  })
})

describe('POST /api/repos/:id/secrets (import a .env file)', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

  it('imports every NAME=value and reports names and skipped lines only', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(secrets.importSecrets).mockResolvedValue({ added: ['B'], replaced: ['A'] })
    const res = await importFile(post({ content: 'A=new-a\nB="new b"\nbroken\n' }), ctx('r1'))
    expect(res.status).toBe(200)
    expect(secrets.importSecrets).toHaveBeenCalledWith('r1', [
      { name: 'A', value: 'new-a', line: 1 },
      { name: 'B', value: 'new b', line: 2 },
    ])
    const body = await res.json()
    expect(body).toEqual({ added: ['B'], replaced: ['A'], skipped: [{ line: 3, reason: 'not NAME=value' }] })
    expect(JSON.stringify(body)).not.toContain('new-a')
  })
  it('422s on an empty or value-less file, 404s for an unknown repo, 503s without a key', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    expect((await importFile(post({ content: '' }), ctx('r1'))).status).toBe(422)
    expect((await importFile(post({ content: '# only comments\n' }), ctx('r1'))).status).toBe(422)
    vi.mocked(secrets.importSecrets).mockRejectedValueOnce(new SecretKeyError('MOGO_SECRET_KEY is not set'))
    expect((await importFile(post({ content: 'A=1' }), ctx('r1'))).status).toBe(503)
    vi.mocked(projects.getRepo).mockResolvedValue(null)
    expect((await importFile(post({ content: 'A=1' }), ctx('x'))).status).toBe(404)
    expect(secrets.importSecrets).toHaveBeenCalledTimes(1)
  })
})
