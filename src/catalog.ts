import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_GENERATE_MAX_TOKENS,
  DEFAULT_MAX_TOKENS,
  type ResolvedConfig,
} from './config.ts'
import { GENERATED_MODELS, type OpenCodeModelMeta, type OpenCodeTransport } from './models.generated.ts'
import { modelsUrlFor } from './routing.ts'
import { describeLimitsShort, limitsFor } from './subscription-limits.ts'

const CATALOG_TTL_MS = 10 * 60 * 1000
const CATALOG_TIMEOUT_MS = 15_000

const catalogCache = new Map<string, { at: number; ids: readonly string[] }>()

const FALLBACK_META: OpenCodeModelMeta = {
  id: '',
  name: '',
  transport: 'openai-chat',
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  maxTokens: DEFAULT_MAX_TOKENS,
  input: ['text'],
  reasoning: [],
  free: false,
  cost: { input: 0, output: 0, cacheRead: 0 },
}

export interface EffectiveModel extends OpenCodeModelMeta {
  readonly transport: OpenCodeTransport
  readonly contextWindow: number
}

export function baseMeta(id: string): OpenCodeModelMeta {
  const generated = GENERATED_MODELS[id]
  return generated === undefined ? { ...FALLBACK_META, id, name: id } : generated
}

export function effectiveModel(id: string, config: ResolvedConfig): EffectiveModel {
  const meta = baseMeta(id)
  const transport = config.modelTransports[id] ?? meta.transport
  const contextWindow = config.contextWindowOverrides[id] ?? config.contextWindow ?? meta.contextWindow
  return { ...meta, transport, contextWindow }
}

/** Effective per-request output default; `0` means "omit the field". */
export function effectiveMaxTokens(meta: OpenCodeModelMeta, config: ResolvedConfig): number | undefined {
  const ceiling = Math.min(meta.maxTokens, DEFAULT_GENERATE_MAX_TOKENS)
  if (config.maxOutputTokens === undefined) return ceiling
  if (config.maxOutputTokens === 0) return undefined
  return Math.min(ceiling, config.maxOutputTokens)
}

export function modelVisible(id: string, config: ResolvedConfig): boolean {
  const override = config.modelVisibility[id]
  if (override !== undefined) return override
  if (config.visibleModels.length === 0) return true
  return config.visibleModels.includes(id)
}

/** Whether the Go route's plan allowance covers this model. */
export function modelInGoPlan(id: string, config: ResolvedConfig): boolean {
  if (!config.filterModelsByPlan) return true
  // A model that only exists in the live catalog has no plan metadata yet;
  // hiding it would make new Go models disappear until the next generated
  // table. Fail open, matching the commandcode provider.
  if (GENERATED_MODELS[id] === undefined) return true
  return effectiveModel(id, config).free || limitsFor(id) !== undefined
}

interface ModelsPayload {
  data?: Array<{ id?: unknown }>
  models?: Record<string, unknown>
}

async function fetchLiveIds(
  provider: string,
  config: ResolvedConfig,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<readonly string[] | undefined> {
  const url = modelsUrlFor(provider, config)
  const cacheKey = `${provider}|${url}`
  const cached = catalogCache.get(cacheKey)
  if (cached !== undefined && Date.now() - cached.at < CATALOG_TTL_MS) return cached.ids

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': config.userAgent,
    ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
  }
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) })
    if (!response.ok) return undefined
    const payload = await response.json() as ModelsPayload
    const ids = Array.isArray(payload.data)
      ? payload.data.map((entry) => entry.id).filter((id): id is string => typeof id === 'string' && id !== '')
      : Object.keys(payload.models ?? {})
    if (ids.length === 0) return undefined
    catalogCache.set(cacheKey, { at: Date.now(), ids })
    return ids
  } catch {
    return undefined
  }
}

/**
 * The ids a picker should offer. The live endpoint is authoritative; the
 * generated models.dev snapshot is the offline fallback and the metadata
 * source for every id the endpoint returns.
 */
export async function discoverModelIds(
  provider: string,
  config: ResolvedConfig,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
  const live = await fetchLiveIds(provider, config, apiKey, fetchImpl)
  if (live !== undefined) return live
  return Object.keys(GENERATED_MODELS)
}

export function sortForPicker(
  ids: readonly string[],
  config: ResolvedConfig,
  unfiltered = false,
  provider?: string,
): string[] {
  return ids
    .filter((id) => unfiltered
      || (modelVisible(id, config)
        && (provider !== 'opencode-go' || modelInGoPlan(id, config))))
    .sort((left, right) => {
      const a = effectiveModel(left, config)
      const b = effectiveModel(right, config)
      if (a.free !== b.free) return a.free ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export function describeModel(meta: EffectiveModel, provider?: string): string {
  const parts = [meta.transport, `${Math.round(meta.contextWindow / 1024)}K context`]
  if (meta.free) parts.unshift('FREE')
  else if (meta.cost.input > 0 || meta.cost.output > 0) {
    parts.push(`$${meta.cost.input}/$${meta.cost.output} per 1M`)
  }
  if (meta.input.includes('image')) parts.push('Image')
  if (meta.reasoning.length > 0) parts.push(`reasoning: ${meta.reasoning.join('/')}`)
  if (provider === 'opencode-go') {
    const limits = limitsFor(meta.id)
    if (!meta.free) parts.unshift(limits === undefined ? 'Console' : 'Go')
    if (limits !== undefined) parts.push(describeLimitsShort(limits))
  }
  return parts.join(' · ')
}

export function clearCatalogCache(): void {
  catalogCache.clear()
}
