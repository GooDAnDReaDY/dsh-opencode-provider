import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'

const LOOPBACK = new Set(['localhost', 'localhost.', '::1', '[::1]'])

function normalize(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.+$/, '')
}

export function isLoopbackHostname(value: string): boolean {
  const hostname = normalize(value)
  return LOOPBACK.has(hostname) || hostname.startsWith('127.') || hostname.startsWith('::ffff:127.')
}

function localAddresses(): Set<string> {
  const addresses = new Set<string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      addresses.add(normalize(entry.address))
    }
  }
  return addresses
}

export function isLocalHostname(value: string): boolean {
  const hostname = normalize(value)
  if (isLoopbackHostname(hostname)) return true
  if (isIP(hostname) === 0) return false
  return localAddresses().has(hostname)
}

export function authorityHostname(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined
  try {
    return normalize(new URL(`http://${value}`).hostname)
  } catch {
    return undefined
  }
}

export function sameOrigin(authority: string, origin: string): boolean {
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host.toLowerCase() === authority.toLowerCase()
  } catch {
    return false
  }
}
