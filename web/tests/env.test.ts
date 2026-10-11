import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/projects', () => ({ getRepo: vi.fn() }))
vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<typeof import('@/lib/env')>()),
  setEnvVar: vi.fn(),
  deleteEnvVar: vi.fn(),
  listEnv: vi.fn(),
  importEnv: vi.fn(),
}))

import { DELETE, PUT } from '@/app/api/repos/[id]/env/[name]/route'
import { GET, POST as importFile } from '@/app/api/repos/[id]/env/route'
import { looksSensitive } from '@/lib/dotenv'
import * as env from '@/lib/env'
import { encryptSecret, EnvRuleError, SecretKeyError, secretKey } from '@/lib/env'
import * as projects from '@/lib/projects'

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
  it('uses a fresh iv every time and rejects bad keys', () => {
    const k = secretKey(KEY)
    expect(encryptSecret(k, 'r', 'A', 'same')).not.toBe(encryptSecret(k, 'r', 'A', 'same'))
    expect(() => secretKey('')).toThrow(SecretKeyError)
    expect(() => secretKey(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes')
  })
})

describe('looksSensitive', () => {
  it.each([
    'DATABASE_URL', 'REDIS_URL', 'JWT_ACCESS_TOKEN_SECRET', 'SUPER_ADMIN_PASSWORD', 'LLM_API_KEY', 'GOOGLE_MAPS_API_KEY',
    'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'SENTRY_DSN', 'GITHUB_TOKEN',
  ])('%s is sensitive', (n) => expect(looksSensitive(n)).toBe(true))
  it.each([
    'PORT', 'NODE_ENV', 'SERVER_BASE_URL', 'SMTP_HOST', 'GOOGLE_CLIENT_ID', 'JWT_ACCESS_TOKEN_VALIDITY_MINUTES',
    'OTP_LENGTH', 'KEYCLOAK_URL', 'MONKEY_MODE',
  ])('%s is plain', (n) => expect(looksSensitive(n)).toBe(false))
})

describe('env routes', () => {
  const ctx = (id: string, name = 'API_KEY') => ({ params: Promise.resolve({ id, name }) })
  const put = (body: unknown) => new Request('http://x', { method: 'PUT', body: JSON.stringify(body) })

  it('sets a value with its sensitivity', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    expect((await PUT(put({ value: 'value must be kept', sensitive: true }), ctx('r1'))).status).toBe(200)
    expect(env.setEnvVar).toHaveBeenCalledWith('r1', 'API_KEY', { value: 'value must be kept', sensitive: true })
  })
  it('can change only the sensitivity', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    await PUT(put({ sensitive: true }), ctx('r1'))
    expect(env.setEnvVar).toHaveBeenCalledWith('r1', 'API_KEY', { sensitive: true })
  })
  it.each([
    ['bad name', { value: 'x', sensitive: false }, 'BAD NAME', 422],
    ['no sensitive flag', { value: 'x' }, 'API_KEY', 422],
    ['empty value', { value: '', sensitive: false }, 'API_KEY', 422],
  ])('%s -> %i', async (_n, body, name, status) => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    expect((await PUT(put(body), ctx('r1', name))).status).toBe(status)
    expect(env.setEnvVar).not.toHaveBeenCalled()
  })
  it('maps rule and key errors, 404s for an unknown repo', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(env.setEnvVar).mockRejectedValueOnce(new EnvRuleError('enter a new value'))
    expect((await PUT(put({ sensitive: false }), ctx('r1'))).status).toBe(422)
    vi.mocked(env.setEnvVar).mockRejectedValueOnce(new SecretKeyError('MOGO_SECRET_KEY is not set'))
    expect((await PUT(put({ value: 'x', sensitive: true }), ctx('r1'))).status).toBe(503)
    vi.mocked(projects.getRepo).mockResolvedValue(null)
    expect((await PUT(put({ value: 'x', sensitive: false }), ctx('nope'))).status).toBe(404)
  })
  it('lists variables and whether a key is configured', async () => {
    vi.stubEnv('MOGO_SECRET_KEY', KEY)
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    const vars = [{ name: 'PORT', sensitive: false, value: '8000', updated_at: 't' }]
    vi.mocked(env.listEnv).mockResolvedValue(vars)
    expect(await (await GET(new Request('http://x'), ctx('r1'))).json()).toEqual({ vars, key_configured: true })
  })
  it('deletes', async () => {
    vi.mocked(env.deleteEnvVar).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    expect((await DELETE(new Request('http://x'), ctx('r1'))).status).toBe(200)
    expect((await DELETE(new Request('http://x'), ctx('r1'))).status).toBe(404)
  })
})

describe('POST /api/repos/:id/env (import a .env file)', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) })

  it('imports every NAME=value and reports names and skipped lines only', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(env.importEnv).mockResolvedValue({ added: ['B'], replaced: ['A'], sensitive: ['A'] })
    const res = await importFile(post({ content: 'A=new-a\nB="new b"\nbroken\n' }), ctx('r1'))
    expect(res.status).toBe(200)
    expect(env.importEnv).toHaveBeenCalledWith('r1', [
      { name: 'A', value: 'new-a', line: 1 },
      { name: 'B', value: 'new b', line: 2 },
    ])
    const body = await res.json()
    expect(body).toEqual({ added: ['B'], replaced: ['A'], sensitive: ['A'], skipped: [{ line: 3, reason: 'not NAME=value' }] })
    expect(JSON.stringify(body)).not.toContain('new-a')
  })
  it('422s on an empty file, 404s for an unknown repo, 503s without a key', async () => {
    vi.mocked(projects.getRepo).mockResolvedValue({ id: 'r1' } as never)
    expect((await importFile(post({ content: '' }), ctx('r1'))).status).toBe(422)
    expect((await importFile(post({ content: '# only comments\n' }), ctx('r1'))).status).toBe(422)
    vi.mocked(env.importEnv).mockRejectedValueOnce(new SecretKeyError('MOGO_SECRET_KEY is not set'))
    expect((await importFile(post({ content: 'API_KEY=1' }), ctx('r1'))).status).toBe(503)
    vi.mocked(projects.getRepo).mockResolvedValue(null)
    expect((await importFile(post({ content: 'A=1' }), ctx('x'))).status).toBe(404)
  })
})
