import { LlmError } from '@deepseek-ai/dsh-llm'

interface ProviderErrorBody {
  type?: string
  message?: string
}

function parseErrorBody(text: string): ProviderErrorBody {
  try {
    const body = JSON.parse(text) as unknown
    if (typeof body !== 'object' || body === null) return {}
    const outer = body as Record<string, unknown>
    const nested = outer.error
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
      const error = nested as Record<string, unknown>
      return {
        ...(typeof error.type === 'string' ? { type: error.type } : {}),
        ...(typeof error.message === 'string' ? { message: error.message } : {}),
      }
    }
    return {
      ...(typeof outer.type === 'string' ? { type: outer.type } : {}),
      ...(typeof outer.message === 'string' ? { message: outer.message } : {}),
    }
  } catch {
    return {}
  }
}

function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after')
  if (raw === null || raw.trim() === '') return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds * 1000)
  const at = Date.parse(raw)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

/**
 * Translate an OpenCode HTTP failure into the harness failure taxonomy.
 * OpenCode reports several distinct conditions as 400/401, so the body type
 * and message decide the code — never the status alone.
 */
export function classifyResponseError(status: number, text: string, headers: Headers): LlmError {
  const body = parseErrorBody(text)
  const type = body.type ?? ''
  const message = body.message ?? (text.trim() === '' ? `HTTP ${status}` : text.trim().slice(0, 500))
  const detail = `${type} ${message}`.toLowerCase()
  const retry = retryAfterMs(headers)
  const options = { status, ...(retry === undefined ? {} : { providerRetryAfterMs: retry }) }
  const quota = /\bquota\b/.test(detail)
    || detail.includes('usage limit')
    || detail.includes('usage_limit')
    || detail.includes('monthly limit')
    || detail.includes('weekly limit')
    || detail.includes('5-hour limit')
    || detail.includes('limit reached')
    || detail.includes('insufficient credit')
    || detail.includes('insufficient balance')
    || detail.includes('insufficient funds')
    || detail.includes('credit balance')
    || detail.includes('out of credit')

  if (type === 'MissingSessionID' || detail.includes('missing x-opencode-session')) {
    return new LlmError(
      `OpenCode rejected the request: ${message}. The plugin always sends a stable`
      + ' x-opencode-session; a proxy in front of it may be stripping the header.',
      'PROVIDER_HTTP_ERROR',
      options,
    )
  }
  if (type === 'FreeTierError' || detail.includes('free tier can only be used')) {
    return new LlmError(
      `OpenCode refused the free tier: ${message}. Free models require a Go/paid key;`
      + ' an anonymous free key is only accepted inside the OpenCode client.',
      'INVALID_CREDENTIAL',
      options,
    )
  }
  if (type === 'ModelProtocolUnsupported' || detail.includes('does not support this protocol')) {
    return new LlmError(
      `OpenCode model does not support the selected protocol: ${message}. Set`
      + ' config.modelTransports[model] to the protocol named in the model catalog.',
      'UNSUPPORTED_MODEL',
      options,
    )
  }
  if (status === 402 || quota) {
    return new LlmError(`OpenCode quota is exhausted: ${message}`, 'QUOTA', options)
  }
  if (status === 401 || status === 403 || detail.includes('invalid credential') || detail.includes('unauthorized')) {
    return new LlmError(
      `OpenCode rejected the credential: ${message}. Check the key, the selected`
      + ` auth.json entry, or whether the account has an active subscription.`,
      'INVALID_CREDENTIAL',
      options,
    )
  }
  if (status === 429) {
    return new LlmError(`OpenCode rate-limited the request: ${message}`, 'RATE_LIMIT', options)
  }
  if (status >= 500) {
    return new LlmError(`OpenCode gateway error (HTTP ${status}): ${message}`, 'SERVER', options)
  }
  return new LlmError(`OpenCode request failed (HTTP ${status}): ${message}`, 'PROVIDER_HTTP_ERROR', options)
}

/** Parse an in-band SSE error object, when a stream reports one. */
export function classifyStreamError(value: unknown, status = 200): LlmError | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.error === undefined) return undefined
  return classifyResponseError(status, JSON.stringify(value), new Headers())
}
