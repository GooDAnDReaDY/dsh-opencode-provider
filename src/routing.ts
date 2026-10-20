import type { ResolvedConfig, TransportId } from './config.ts'
import type { OpenCodeModelMeta } from './models.generated.ts'

export function isGoProvider(provider: string): boolean {
  return provider === 'opencode-go'
}

export function rootFor(provider: string, config: ResolvedConfig): string {
  return isGoProvider(provider) ? config.goApiBase : config.apiBase
}

export function modelsUrlFor(provider: string, config: ResolvedConfig): string {
  return `${rootFor(provider, config).replace(/\/+$/, '')}/v1/models`
}

export function effectiveTransport(
  provider: string,
  meta: OpenCodeModelMeta,
  config: ResolvedConfig,
): TransportId {
  return config.modelTransports[meta.id] ?? meta.transport
}

/**
 * Endpoint for one model. Go OpenAI-compatible and Anthropic models share the
 * unified `/zen/go/v1/chat/completions` gateway (proven live); Responses and
 * Google models keep their native endpoints.
 */
export function endpointFor(
  provider: string,
  transport: TransportId,
  model: string,
  config: ResolvedConfig,
): string {
  const root = rootFor(provider, config).replace(/\/+$/, '')
  switch (transport) {
    case 'openai-chat':
      return isGoProvider(provider)
        ? `${config.goZenBase.replace(/\/+$/, '')}/chat/completions`
        : `${root}/openai/v1/chat/completions`
    case 'openai-responses':
      return `${root}/openai/v1/responses`
    case 'anthropic':
      return `${root}/anthropic/v1/messages`
    case 'google':
      return `${root}/google/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
  }
}
