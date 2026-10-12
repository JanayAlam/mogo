import type * as Auth from '@/lib/auth'

export const USER = { id: 'u1', login: 'alice', name: 'Alice', avatar_url: '' }

/** For vi.mock('@/lib/auth'): every request is signed in as USER (tests/auth.test.ts covers the real check). */
export function signedIn(actual: typeof Auth): typeof Auth {
  const authed: typeof Auth.authed = (handler) => (req, ...rest) => handler(USER, req, ...rest)
  return { ...actual, authed }
}
