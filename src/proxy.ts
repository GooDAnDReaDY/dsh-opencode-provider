import { ProxyAgent, Socks5ProxyAgent, type Dispatcher } from 'undici'

/**
 * Proxy addresses stay credential-free: the settings API returns the configured
 * address to the browser. Authentication is supplied separately from the
 * credential service and is only assembled in memory.
 */
export function normalizeProxyUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (value === '') return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('proxy address must be a valid URL')
  }
  if (!['http:', 'https:', 'socks5:'].includes(url.protocol)) {
    throw new Error('proxy address must use http://, https:// or socks5://')
  }
  if (url.hostname === '' || url.port === '0'
    || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    throw new Error('proxy address must contain a host and optional port, without a path, query or fragment')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('proxy credentials must be set through the proxy username and password fields')
  }
  return url.href
}

/** Validate a proxy username; the password lives in the credential service. */
export function normalizeProxyUsername(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (value === '') return ''
  if (value.length > 256 || value.includes(':') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('proxy username must be 1–256 characters without a colon or control characters')
  }
  return value
}

/** Assemble the authenticated proxy URL in memory; never persist or return it. */
export function buildProxyUrl(address: string | undefined, username: string | undefined, password: string | undefined): string {
  const base = normalizeProxyUrl(address)
  const user = normalizeProxyUsername(username)
  if (base === '' || user === '') return base
  const url = new URL(base)
  url.username = encodeURIComponent(user)
  url.password = encodeURIComponent(password ?? '')
  return url.href
}

export interface ProxyFetch {
  readonly fetch: typeof fetch
  dispose(): Promise<void>
}

/**
 * One fetch wrapper for inference, catalog and usage. Dispatchers are shared by
 * address so a live settings change reuses pools instead of leaking them.
 */
export function createProxyFetch(
  address: () => string | Promise<string>,
  baseFetch: typeof fetch = fetch,
): ProxyFetch {
  const agents = new Map<string, Dispatcher>()
  let disposed = false

  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (disposed) throw new Error('proxy transport is disposed')
    const proxy = normalizeProxyUrl(await address())
    if (proxy === '') return baseFetch(input, init)
    let agent = agents.get(proxy)
    if (agent === undefined) {
      const url = new URL(proxy)
      agent = url.protocol === 'socks5:' ? new Socks5ProxyAgent(proxy) : new ProxyAgent(proxy)
      agents.set(proxy, agent)
      if (agents.size > 8) {
        const oldest = agents.keys().next().value
        if (oldest !== undefined && oldest !== proxy) {
          const retired = agents.get(oldest)
          agents.delete(oldest)
          void retired?.close().catch(() => retired?.destroy())
        }
      }
    }
    return baseFetch(input, { ...init, dispatcher: agent } as RequestInit)
  }) as typeof fetch

  return {
    fetch: wrapped,
    async dispose() {
      disposed = true
      const open = [...agents.values()]
      agents.clear()
      await Promise.all(open.map((agent) => agent.close().catch(() => agent.destroy())))
    },
  }
}
