import { lookup } from 'node:dns/promises'

import { db } from '@/lib/db'
import { decryptSecret, encryptSecret, secretKey } from '@/lib/env'
import { PROVIDER_INFO, type Provider } from '@/lib/llm-providers'
import { isPrivateAddress } from '@/lib/net-guard'
import type { LlmCreateInput, LlmPatchInput } from '@/lib/validate'

/**
 * A user's LLM connections (table llm_connections). The API key is encrypted like the other user secrets, additional
 * data "user:<user id>:llm_api_key"; the runner (backend/mogo/llm/provider.py) decrypts it. It is never sent back:
 * `has_key` says whether one is stored. The connections are an ordered chain (`position`): a run tries the active
 * ones in that order and falls back to the next when one fails.
 */
export interface LlmConnection {
  id: string
  provider: Provider
  name: string
  base_url: string
  model: string
  has_key: boolean
  active: boolean // in the chain; inactive connections are kept but never used
  position: number
  updated_at: string
}

const LIST_ORDER = [{ position: 'asc' as const }, { created_at: 'asc' as const }, { id: 'asc' as const }]
const aad = (userId: string) => `user:${userId}`
const seal = (userId: string, key: string) => encryptSecret(secretKey(), aad(userId), 'llm_api_key', key)
const open = (userId: string, enc: string) => decryptSecret(secretKey(), aad(userId), 'llm_api_key', enc)

type Row = NonNullable<Awaited<ReturnType<typeof findRow>>>
const findRow = (userId: string, id: string) => db().llmConnection.findFirst({ where: { id, user_id: userId } })

const toPublic = (r: Row): LlmConnection => ({
  id: r.id,
  provider: r.provider as Provider,
  name: r.name,
  base_url: r.base_url,
  model: r.model,
  has_key: !!r.api_key_enc,
  active: r.active,
  position: r.position,
  updated_at: r.updated_at.toISOString(),
})

export async function listLlmConnections(userId: string): Promise<LlmConnection[]> {
  const rows = await db().llmConnection.findMany({ where: { user_id: userId }, orderBy: LIST_ORDER })
  return rows.map(toPublic)
}

export async function getLlmConnection(userId: string, id: string): Promise<LlmConnection | null> {
  const r = await findRow(userId, id)
  return r && toPublic(r)
}

/** The model a run starts with (the first active connection), or null when none is switched on: runs cannot start. */
export async function activeLlmModel(userId: string): Promise<string | null> {
  const r = await db().llmConnection.findFirst({
    where: { user_id: userId, active: true },
    orderBy: LIST_ORDER,
    select: { model: true },
  })
  return r?.model ?? null
}

/** A new connection joins the end of the chain, switched on unless `active` says otherwise. */
export async function createLlmConnection(userId: string, input: LlmCreateInput): Promise<LlmConnection> {
  const api_key_enc = input.api_key ? seal(userId, input.api_key) : null
  const row = await db().$transaction(async (tx) => {
    const last = await tx.llmConnection.aggregate({ where: { user_id: userId }, _max: { position: true } })
    return tx.llmConnection.create({
      data: {
        user_id: userId, provider: input.provider, name: input.name, base_url: input.base_url, model: input.model,
        api_key_enc, active: input.active, position: (last._max.position ?? 0) + 1,
      },
    })
  })
  return toPublic(row)
}

/** Null when the connection does not exist (or is not the user's). */
export async function updateLlmConnection(
  userId: string,
  id: string,
  patch: LlmPatchInput,
): Promise<LlmConnection | null> {
  const cur = await findRow(userId, id)
  if (!cur) return null
  const row = await db().llmConnection.update({
    where: { id },
    data: {
      base_url: patch.base_url,
      model: patch.model,
      active: patch.active,
      ...(patch.api_key === undefined ? {} : { api_key_enc: patch.api_key ? seal(userId, patch.api_key) : null }),
      updated_at: new Date(),
    },
  })
  return toPublic(row)
}

export class OrderError extends Error {}

/** `ids` is the new order of ALL the user's connections. A list that is stale (a connection added or deleted meanwhile) is refused. */
export async function reorderLlmConnections(userId: string, ids: string[]): Promise<LlmConnection[]> {
  await db().$transaction(async (tx) => {
    const own = await tx.llmConnection.findMany({ where: { user_id: userId }, select: { id: true } })
    const same = own.length === ids.length && own.every((r) => ids.includes(r.id))
    if (!same) throw new OrderError('the list of connections changed; reload and try again')
    for (const [i, id] of ids.entries()) {
      await tx.llmConnection.update({ where: { id }, data: { position: i + 1 } })
    }
  })
  return listLlmConnections(userId)
}

export async function deleteLlmConnection(userId: string, id: string): Promise<boolean> {
  return (await db().llmConnection.deleteMany({ where: { id, user_id: userId } })).count > 0
}

/** What a stored connection looks like once the patch is applied: the thing to check before saving. */
export async function resolveForCheck(
  userId: string,
  id: string,
  patch: LlmPatchInput,
): Promise<ConnectionTarget | null> {
  const cur = await findRow(userId, id)
  if (!cur) return null
  const stored = cur.api_key_enc ? open(userId, cur.api_key_enc) : ''
  return {
    provider: cur.provider as Provider,
    base_url: patch.base_url ?? cur.base_url,
    model: patch.model ?? cur.model,
    api_key: patch.api_key === undefined ? stored : (patch.api_key ?? ''),
  }
}

// --- checking a connection

export interface ConnectionTarget {
  provider: Provider
  base_url: string
  model: string
  api_key: string
}

export class ConnectionCheckError extends Error {}

const CHECK_TIMEOUT_MS = 10_000

/**
 * Asks the server for its model list (GET <base_url>/models), which costs nothing: that proves the address is
 * reachable, the key is accepted and, when the server lists models, that the model exists. Throws
 * ConnectionCheckError with something the user can act on.
 */
export async function checkConnection(t: ConnectionTarget, fetchImpl: typeof fetch = fetch): Promise<void> {
  const label = PROVIDER_INFO[t.provider].label
  const url = new URL(`${t.base_url.replace(/\/+$/, '')}/models`)
  if (t.provider === 'custom') await assertPublicHost(url.hostname)

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (t.api_key) headers.Authorization = `Bearer ${t.api_key}`
  if (t.provider === 'anthropic') {
    headers['x-api-key'] = t.api_key
    headers['anthropic-version'] = '2023-06-01'
  }

  let res: Response
  try {
    // no redirects: a public host could otherwise bounce us to an internal address
    res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
    throw new ConnectionCheckError(
      timeout
        ? `${label} did not answer within ${CHECK_TIMEOUT_MS / 1000}s${t.provider === 'custom' ? '; is the server and its tunnel running?' : ''}`
        : `cannot reach ${url.host}${t.provider === 'custom' ? '; is the server and its tunnel running?' : ''}`,
    )
  }

  if (res.status === 401 || res.status === 403) throw new ConnectionCheckError(`${label} rejected the API key`)
  if (res.status >= 300 && res.status < 400) {
    throw new ConnectionCheckError(`${url.host} redirects; use the final address as the base URL`)
  }
  if (res.status === 404) {
    throw new ConnectionCheckError(`${url.href} was not found; the base URL usually ends in /v1`)
  }
  if (!res.ok) throw new ConnectionCheckError(`${label} answered HTTP ${res.status}`)

  const ids = await modelIds(res)
  if (ids && ids.length > 0 && !ids.includes(t.model)) {
    const some = ids.slice(0, 5).join(', ')
    throw new ConnectionCheckError(`model "${t.model}" is not offered by ${url.host}${some ? ` (it lists: ${some}${ids.length > 5 ? ', …' : ''})` : ''}`)
  }
}

async function modelIds(res: Response): Promise<string[] | null> {
  try {
    const body: unknown = await res.json()
    const data = (body as { data?: unknown }).data
    if (!Array.isArray(data)) return null
    return data.flatMap((m) => (typeof m?.id === 'string' ? [m.id] : []))
  } catch {
    return null // a server that answers /models with something else is still reachable
  }
}

/** Resolves the host and refuses addresses inside the server's own network. */
async function assertPublicHost(hostname: string): Promise<void> {
  let addrs: { address: string }[]
  try {
    addrs = await lookup(hostname.replace(/^\[|\]$/g, ''), { all: true })
  } catch {
    throw new ConnectionCheckError(`${hostname} does not resolve; check the address`)
  }
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new ConnectionCheckError(`${hostname} points to a private address; use the public tunnel address`)
  }
}
