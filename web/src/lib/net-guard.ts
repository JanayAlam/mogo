import { isIP } from 'node:net'

/**
 * The server calls URLs that users type in (testing a custom LLM). Those must not reach the server's own network:
 * loopback, private ranges, link-local (cloud metadata at 169.254.169.254) and the like.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return isPrivateV4(ip)
  if (v === 6) return isPrivateV6(ip.toLowerCase())
  return false
}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  )
}

function isPrivateV6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4 inside IPv6
  if (mapped) return isPrivateV4(mapped[1])
  if (ip.startsWith('::ffff:')) return true // the hex form of the same; not worth parsing
  return /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('ff') // unique-local, link-local, multicast
}

/** A host name that is plainly internal, or an IP literal in a private range. Resolved addresses are checked later. */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(h)) return isPrivateAddress(h)
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')
}
