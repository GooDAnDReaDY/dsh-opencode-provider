import { createHash } from 'node:crypto'

import type { ResolvedConfig } from './config.ts'
import type { KeyResolver } from './credentials.ts'
import { GO_PROVIDER, LEGACY_GO_PROVIDER } from './provider-ids.ts'

export interface UsageWindow {
  readonly percentUsed: number
  readonly resetsAt?: string
  readonly status?: string
}

export interface UsageReport {
  readonly windows: {
    readonly fiveHour?: UsageWindow
    readonly weekly?: UsageWindow
    readonly monthly?: UsageWindow
  }
}

export type UsageKeyStatus = 'ok' | 'invalid' | 'expired' | 'missing' | 'unavailable'

export interface UsageResult {
  readonly report?: UsageReport
  readonly error?: string
  readonly keyStatus?: UsageKeyStatus
  readonly latencyMs?: number
  readonly checkedAt: number
  /** True when `report` is the last successful reading after a failed refresh. */
  readonly stale?: boolean
  readonly lastSuccessAt?: number
}

interface UsageWindowPayload {
  status?: string
  percent?: number
  resetsAt?: string
}

interface UsagePayload {
  usage?: {
    rolling?: UsageWindowPayload
    weekly?: UsageWindowPayload
    monthly?: UsageWindowPayload
  }
}

const SUCCESS_TTL_MS = 5 * 60 * 1000
const FAILURE_TTL_MS = 45 * 1000
const USAGE_TIMEOUT_MS = 20_000
const RETRY_DELAY_MS = 250

function windowOf(raw: UsageWindowPayload | undefined): UsageWindow | undefined {
  if (raw === undefined) return undefined
  if (typeof raw.percent !== 'number' || !Number.isFinite(raw.percent)) return undefined
  return {
    percentUsed: Math.max(0, Math.min(100, raw.percent)),
    ...(typeof raw.status === 'string' ? { status: raw.status } : {}),
    ...(typeof raw.resetsAt === 'string' ? { resetsAt: raw.resetsAt } : {}),
  }
}

export function normalizeUsage(payload: UsagePayload): UsageReport {
  const usage = payload.usage
  const fiveHour = windowOf(usage?.rolling)
  const weekly = windowOf(usage?.weekly)
  const monthly = windowOf(usage?.monthly)
  return {
    windows: {
      ...(fiveHour === undefined ? {} : { fiveHour }),
      ...(weekly === undefined ? {} : { weekly }),
      ...(monthly === undefined ? {} : { monthly }),
    },
  }
}

export interface UsageReader {
  (provider: string, key?: string): Promise<UsageResult | undefined>
  /** Drop the cache so the next read hits the endpoint. */
  clear(): void
}

function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/** Cached reader for the (undocumented) Go usage endpoint. Fail-open by design. */
export function createUsageReader(
  config: () => ResolvedConfig,
  resolveKey: KeyResolver,
  fetchImpl: typeof fetch = fetch,
): UsageReader {
  const cache = new Map<string, UsageResult>()
  /** Last successful reading per key, kept across explicit cache clears. */
  const lastSuccess = new Map<string, UsageResult>()

  const read = async (provider: string, explicitKey?: string): Promise<UsageResult | undefined> => {
    if (provider !== GO_PROVIDER && provider !== LEGACY_GO_PROVIDER) return undefined
    const current = config()
    let key: string
    if (explicitKey !== undefined && explicitKey !== '') {
      key = explicitKey
    } else {
      try {
        key = (await resolveKey(provider)).key
      } catch {
        return { error: 'no credential', keyStatus: 'missing', checkedAt: Date.now() }
      }
    }
    const cacheKey = `${provider}:${fingerprint(key)}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) {
      const ttl = cached.report === undefined || cached.stale === true ? FAILURE_TTL_MS : SUCCESS_TTL_MS
      if (Date.now() - cached.checkedAt < ttl) return cached
    }

    const result = async (): Promise<UsageResult> => {
      const startedAt = Date.now()
      const signal = AbortSignal.timeout(USAGE_TIMEOUT_MS)
      const latency = (): number => Math.max(0, Date.now() - startedAt)
      try {
        let response: Response | undefined
        let lastNetworkError: unknown
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            response = await fetchImpl(current.usageUrl, {
              headers: {
                authorization: `Bearer ${key}`,
                accept: 'application/json',
                'user-agent': current.userAgent,
                'x-opencode-session': 'dsh_usage',
              },
              signal,
            })
            break
          } catch (error) {
            lastNetworkError = error
            if (signal.aborted || attempt === 1) throw error
            // A transient Node/undici connect timeout often clears on retry.
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          }
        }
        if (response === undefined) throw lastNetworkError ?? new Error('usage request failed')
        if (response.status === 401 || response.status === 403) {
          const body = await response.text().catch(() => '')
          return {
            error: 'usage endpoint rejected the key (inference may still work)',
            keyStatus: /expired/i.test(body) ? 'expired' : 'invalid',
            latencyMs: latency(),
            checkedAt: Date.now(),
          }
        }
        if (!response.ok) {
          return {
            error: `usage endpoint returned HTTP ${response.status}`,
            keyStatus: 'unavailable',
            latencyMs: latency(),
            checkedAt: Date.now(),
          }
        }
        const payload = await response.json() as UsagePayload
        return {
          report: normalizeUsage(payload),
          keyStatus: 'ok',
          latencyMs: latency(),
          checkedAt: Date.now(),
        }
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : 'usage request failed',
          keyStatus: 'unavailable',
          latencyMs: latency(),
          checkedAt: Date.now(),
        }
      }
    }

    const fresh = await result()
    const previous = cached?.report !== undefined ? cached : lastSuccess.get(cacheKey)
    if (fresh.report === undefined && previous?.report !== undefined) {
      const stale: UsageResult = {
        ...fresh,
        report: previous.report,
        stale: true,
        lastSuccessAt: previous.lastSuccessAt ?? previous.checkedAt,
      }
      cache.set(cacheKey, stale)
      return stale
    }
    const next = fresh.report === undefined
      ? fresh
      : { ...fresh, stale: false, lastSuccessAt: fresh.checkedAt }
    if (next.report !== undefined) lastSuccess.set(cacheKey, next)
    cache.set(cacheKey, next)
    return next
  }

  read.clear = (): void => { cache.clear() }
  return read
}
