/**
 * Scheme/host policy for configurable endpoints. Used by every settings write
 * path, not only the HTTP route, so `allowCustomEndpoints` is not the sole gate.
 */
export function isSafeEndpoint(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return false
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return false
  }
  const local = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '::1'
  return url.protocol === 'https:' || (local && url.protocol === 'http:')
}

/** Keep an endpoint write only when it is safe; empty clears the field. */
export function parseEndpoint(text: string): { kind: 'set'; value: string } | { kind: 'clear' } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }
  return isSafeEndpoint(trimmed) ? { kind: 'set', value: trimmed } : undefined
}
