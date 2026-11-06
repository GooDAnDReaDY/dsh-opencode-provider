import { createHash, timingSafeEqual } from 'node:crypto'

interface AuthRequest {
  readonly headers: Record<string, string | string[] | undefined>
  readonly socket?: { readonly remoteAddress?: string | undefined }
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function isLoopbackPeer(request: AuthRequest): boolean {
  const address = request.socket?.remoteAddress?.toLowerCase().replace(/^\[|\]$/g, '')
  return address === 'localhost' || address === 'localhost.' || address === '::1'
    || address?.startsWith('127.') === true
    || address?.startsWith('::ffff:127.') === true
}

export function adminAllowed(request: AuthRequest, expected: string): boolean {
  if (expected === '') return isLoopbackPeer(request)
  const provided = first(request.headers['x-opencode-token']) !== ''
    ? first(request.headers['x-opencode-token'])
    : first(request.headers.authorization).startsWith('Bearer ')
      ? first(request.headers.authorization).slice(7).trim()
      : ''
  if (provided === '') return false
  const left = createHash('sha256').update(expected).digest()
  const right = createHash('sha256').update(provided).digest()
  return timingSafeEqual(left, right)
}
