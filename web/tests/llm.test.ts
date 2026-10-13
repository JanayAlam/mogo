import { describe, expect, it, vi } from 'vitest'

import { checkConnection, ConnectionCheckError, type ConnectionTarget } from '@/lib/llm'
import { isInternalHost, isPrivateAddress } from '@/lib/net-guard'
import { validateLlmCreate, validateLlmOrder, validateLlmPatch } from '@/lib/validate'

describe('validateLlmCreate', () => {
  it('accepts a hosted provider and pins its base URL', () => {
    expect(validateLlmCreate({ provider: 'openai', model: 'gpt-4.1', api_key: 'sk-abc', base_url: 'https://evil.example' })).toEqual({
      provider: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1', api_key: 'sk-abc', active: true,
    })
  })
  it('accepts a custom https endpoint without a key and strips the trailing slash', () => {
    expect(validateLlmCreate({ provider: 'custom', name: 'ignored', base_url: 'https://x.trycloudflare.com/v1/', model: 'qwen' })).toEqual({
      provider: 'custom', name: 'Local / Custom', base_url: 'https://x.trycloudflare.com/v1', model: 'qwen', api_key: null, active: true,
    })
  })
  it.each([
    [{ provider: 'nope', model: 'm' }],
    [{ provider: 'openai', model: 'm' }], // key required
    [{ provider: 'openai', model: 'm', api_key: 'bad' }], // wrong prefix
    [{ provider: 'anthropic', model: 'm', api_key: 'sk-abc' }], // OpenAI-style key for Claude
    [{ provider: 'openrouter', model: 'm', api_key: 'sk-abc' }],
    [{ provider: 'openai', model: 'm', api_key: 'sk-a b' }],
    [{ provider: 'openai', api_key: 'sk-abc' }], // model required
    [{ provider: 'custom', model: 'm' }], // base_url required
    [{ provider: 'custom', model: 'm', base_url: 'http://x.example.com/v1' }], // not https
    [{ provider: 'custom', model: 'm', base_url: 'https://u:p@x.example.com/v1' }],
    [{ provider: 'custom', model: 'm', base_url: 'https://x.example.com/v1?k=1' }],
    [{ provider: 'custom', model: 'm', base_url: 'https://localhost/v1' }],
    [{ provider: 'custom', model: 'm', base_url: 'https://169.254.169.254/v1' }],
    [{ provider: 'custom', model: 'm', base_url: 'https://192.168.1.5/v1' }],
    [{ provider: 'custom', model: 'm', base_url: 'https://[::1]/v1' }],
    [{ provider: 'custom', model: 'm', base_url: 'not a url' }],
  ])('rejects %j', (body) => {
    expect(typeof validateLlmCreate(body)).toBe('string')
  })
})

describe('validateLlmCreate active', () => {
  const body = { provider: 'openai', model: 'm', api_key: 'sk-abc' }
  it('is on unless the body says otherwise', () => {
    expect(validateLlmCreate(body)).toMatchObject({ active: true })
    expect(validateLlmCreate({ ...body, active: false })).toMatchObject({ active: false })
    expect(typeof validateLlmCreate({ ...body, active: 'no' })).toBe('string')
  })
})

describe('validateLlmOrder', () => {
  it('accepts a list of ids', () => expect(validateLlmOrder({ ids: ['a', 'b'] })).toEqual(['a', 'b']))
  it.each([[null], [{}], [{ ids: 'a' }], [{ ids: [1] }], [{ ids: [''] }], [{ ids: ['a', 'a'] }]])('rejects %j', (b) =>
    expect(typeof validateLlmOrder(b)).toBe('string'))
})

describe('validateLlmPatch', () => {
  it('accepts a partial change', () => {
    expect(validateLlmPatch({ active: true }, 'openai')).toEqual({ active: true })
    expect(validateLlmPatch({ model: 'gpt-5', api_key: 'sk-new' }, 'openai')).toEqual({ model: 'gpt-5', api_key: 'sk-new' })
    expect(validateLlmPatch({ api_key: null }, 'custom')).toEqual({ api_key: null })
  })
  it.each([
    [{ base_url: 'https://other.example/v1' }, 'openai'], // hosted: fixed
    [{ api_key: null }, 'openai'], // hosted: needed
    [{ api_key: '' }, 'custom'],
    [{ api_key: 'x' }, 'anthropic'],
    [{ model: '' }, 'custom'],
    [{ active: 'yes' }, 'custom'],
  ])('rejects %j for %s', (body, provider) => {
    expect(typeof validateLlmPatch(body, provider as 'openai')).toBe('string')
  })
})

describe('net guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    '%s is private', (ip) => expect(isPrivateAddress(ip)).toBe(true))
  it.each(['8.8.8.8', '172.32.0.1', '104.16.0.1', '2606:4700::1111'])('%s is public', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false))
  it('spots internal host names', () => {
    expect(isInternalHost('localhost')).toBe(true)
    expect(isInternalHost('printer.local')).toBe(true)
    expect(isInternalHost('db')).toBe(true)
    expect(isInternalHost('abc.trycloudflare.com')).toBe(false)
  })
})

describe('checkConnection', () => {
  const target: ConnectionTarget = { provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4.1', api_key: 'sk-x' }
  const reply = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))

  it('passes when the key works and the model is listed', async () => {
    const f = reply(200, { data: [{ id: 'gpt-4.1' }, { id: 'other' }] })
    await expect(checkConnection(target, f)).resolves.toBeUndefined()
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe('https://api.openai.com/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
    expect(init.redirect).toBe('manual')
  })
  it('sends the Anthropic headers too', async () => {
    const f = reply(200, { data: [{ id: 'claude-x' }] })
    await checkConnection({ ...target, provider: 'anthropic', base_url: 'https://api.anthropic.com/v1', model: 'claude-x' }, f)
    const headers = (f.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-x')
    expect(headers['anthropic-version']).toBeTruthy()
  })
  it('accepts a server that answers /models with something else', async () => {
    await expect(checkConnection(target, vi.fn(async () => new Response('ok', { status: 200 })))).resolves.toBeUndefined()
  })
  it.each([
    [reply(401), /rejected the API key/],
    [reply(403), /rejected the API key/],
    [reply(404), /ends in \/v1/],
    [reply(302), /redirects/],
    [reply(500), /HTTP 500/],
    [reply(200, { data: [{ id: 'a' }] }), /model "gpt-4.1" is not offered/],
    [vi.fn(async () => { throw new TypeError('fetch failed') }), /cannot reach/],
  ])('fails with a useful message', async (f, message) => {
    await expect(checkConnection(target, f)).rejects.toThrow(message)
    await expect(checkConnection(target, f)).rejects.toBeInstanceOf(ConnectionCheckError)
  })
  it('never calls out to a custom host that is private', async () => {
    const f = reply(200, {})
    await expect(
      checkConnection({ provider: 'custom', base_url: 'https://127.0.0.1:11434/v1', model: 'm', api_key: '' }, f),
    ).rejects.toThrow(/private address/)
    expect(f).not.toHaveBeenCalled()
  })
})
