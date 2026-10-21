import z from '@deepseek-ai/schemastery'

export const NS = 'llm-opencode'
export const DEFAULT_API_KEY_ENV = 'OPENCODE_API_KEY'
export const DEFAULT_API_BASE = 'https://opencode.ai/inference'
export const DEFAULT_GO_API_BASE = 'https://opencode.ai/inference/go'
export const DEFAULT_GO_ZEN_BASE = 'https://opencode.ai/zen/go/v1'
export const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
export const DEFAULT_AUTH_ENTRY = 'opencode-go'
export const DEFAULT_USER_AGENT = 'dsh-opencode-provider/0.5.4'
export const DEFAULT_CONTEXT_WINDOW = 262_144
export const DEFAULT_MAX_TOKENS = 32_768
export const DEFAULT_GENERATE_MAX_TOKENS = 32_768

export type TransportId = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'

export interface AccountConfig {
  label?: string
  apiKeyEnv?: string
  apiKey?: string
}

export interface ModelAccountRule {
  pattern: string
  account: string
}

/**
 * Plugin configuration. Every field except the literal `apiKey` is volatile:
 * the harness projects settings forms from schema fields carrying that marker.
 */
export interface Config {
  /** Credential reference resolved per request; defaults to `OPENCODE_API_KEY`. */
  apiKeyEnv?: string
  /** Literal key for composition config only; stripped from settings reads by `role('secret')`. */
  apiKey?: string
  /** Console/Zen inference root; defaults to `https://opencode.ai/inference`. */
  apiBase?: string
  /** Go inference root; defaults to `https://opencode.ai/inference/go`. */
  goApiBase?: string
  /** Go unified gateway root; defaults to `https://opencode.ai/zen/go/v1`. */
  goZenBase?: string
  /** Go usage endpoint; defaults to `https://opencode.ai/zen/go/v1/usage`. */
  usageUrl?: string
  /** Entry in OpenCode's `auth.json` to import; defaults to `opencode-go`. */
  openCodeAuthEntry?: string
  /** Milliseconds to wait for response headers; defaults to 300s. */
  requestTimeoutMs?: number
  /** Milliseconds a stream may stall; defaults to 300s. */
  streamIdleTimeoutMs?: number
  /** Visible-model allowlist; an empty list means "show everything". */
  visibleModels?: string[]
  /** Per-model visibility overrides; wins over `visibleModels`. */
  modelVisibility?: Record<string, boolean>
  /** Hide models outside the Go allowance on the Go route; defaults to true. */
  filterModelsByPlan?: boolean
  /** Per-model transport overrides; wins over the generated metadata. */
  modelTransports?: Record<string, TransportId>
  /** Global context-window override. */
  contextWindow?: number
  /** Per-model context-window overrides. */
  contextWindowOverrides?: Record<string, number>
  /** Per-turn output cap; `0` omits `max_tokens`. */
  maxOutputTokens?: number
  /** Extra accounts for rotation (parsed now, used by the account pool later). */
  accounts?: AccountConfig[]
  /** Preferred account per model glob; other accounts remain fallbacks. */
  modelAccountRules?: ModelAccountRule[]
  /** Free model used once when the Go quota rejects a request; empty disables it. */
  quotaFallbackModel?: string
  /** Prefer the last successful account for a conversation. */
  stickySession?: boolean
  /** Pinned account id; empty means automatic. */
  activeAccount?: string
  /** Show the quota card in the sidebar. */
  showSidebarQuota?: boolean
  /** Product user agent sent to OpenCode. */
  userAgent?: string
}

function markVolatile<T>(schema: T): T {
  const mark = (schema as { volatile?: () => T }).volatile
  return typeof mark === 'function' ? mark.call(schema) : schema
}

export const Config: z<Config> = z.object({
  apiKeyEnv: markVolatile(z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV)),
  apiKey: z.string().role('secret'),
  apiBase: markVolatile(z.string().default(DEFAULT_API_BASE)),
  goApiBase: markVolatile(z.string().default(DEFAULT_GO_API_BASE)),
  goZenBase: markVolatile(z.string().default(DEFAULT_GO_ZEN_BASE)),
  usageUrl: markVolatile(z.string().default(DEFAULT_USAGE_URL)),
  openCodeAuthEntry: markVolatile(z.string().default(DEFAULT_AUTH_ENTRY)),
  requestTimeoutMs: markVolatile(z.number().min(1).max(2_147_483_647).default(300_000)),
  streamIdleTimeoutMs: markVolatile(z.number().min(1).max(2_147_483_647).default(300_000)),
  visibleModels: markVolatile(z.array(z.string()).default([])),
  modelVisibility: markVolatile(z.dict(z.boolean()).default({})),
  filterModelsByPlan: markVolatile(z.boolean().default(true)),
  modelTransports: markVolatile(
    z.dict(z.union(['openai-chat', 'openai-responses', 'anthropic', 'google'])).default({}),
  ),
  contextWindow: markVolatile(z.number().min(1).max(10_000_000).step(1)),
  contextWindowOverrides: markVolatile(z.dict(z.number().min(1).max(10_000_000).step(1)).default({})),
  maxOutputTokens: markVolatile(z.number().min(0).max(10_000_000).step(1)),
  accounts: markVolatile(z.array(z.object({
    label: z.string(),
    apiKeyEnv: z.string().role('credential-ref'),
    apiKey: z.string().role('secret'),
  })).default([])),
  modelAccountRules: markVolatile(z.array(z.object({
    pattern: z.string(),
    account: z.string(),
  })).default([])),
  quotaFallbackModel: markVolatile(z.string().default('')),
  stickySession: markVolatile(z.boolean().default(true)),
  activeAccount: markVolatile(z.string().default('')),
  showSidebarQuota: markVolatile(z.boolean().default(false)),
  userAgent: markVolatile(z.string().default(DEFAULT_USER_AGENT)),
})

export interface ResolvedConfig {
  apiKeyEnv: string
  apiKey?: string
  apiBase: string
  goApiBase: string
  goZenBase: string
  usageUrl: string
  openCodeAuthEntry: string
  requestTimeoutMs: number
  streamIdleTimeoutMs: number
  visibleModels: readonly string[]
  modelVisibility: Readonly<Record<string, boolean>>
  filterModelsByPlan: boolean
  modelTransports: Readonly<Record<string, TransportId>>
  contextWindow?: number
  contextWindowOverrides: Readonly<Record<string, number>>
  maxOutputTokens?: number
  accounts: readonly AccountConfig[]
  modelAccountRules: readonly ModelAccountRule[]
  quotaFallbackModel: string
  stickySession: boolean
  activeAccount: string
  showSidebarQuota: boolean
  userAgent: string
}

/** Read each volatile field through its live reference, if the loader installed one. */
export function unwrapVolatileConfig(config: Config): Config {
  const source = config as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    const value = source[key]
    out[key] = value !== null
      && typeof value === 'object'
      && typeof (value as { get?: unknown }).get === 'function'
      ? (value as { get: () => unknown }).get()
      : value
  }
  return out as Config
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback
}

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry !== '') out[key] = entry
  }
  return out
}

function numberRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry > 0) out[key] = entry
  }
  return out
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'boolean') out[key] = entry
  }
  return out
}

const TRANSPORTS = new Set<TransportId>(['openai-chat', 'openai-responses', 'anthropic', 'google'])

function transportRecord(value: unknown): Record<string, TransportId> {
  const raw = stringRecord(value)
  const out: Record<string, TransportId> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (TRANSPORTS.has(entry as TransportId)) out[key] = entry as TransportId
  }
  return out
}

function modelAccountRuleList(value: unknown): ModelAccountRule[] {
  if (!Array.isArray(value)) return []
  const out: ModelAccountRule[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : ''
    const account = typeof record.account === 'string' ? record.account.trim() : ''
    if (pattern === '' || account === '') continue
    out.push({ pattern, account })
  }
  return out
}

/** Normalize a raw config (possibly bypassing schemastery) into request facts. */
export function resolveConfig(config: Config): ResolvedConfig {
  const apiKey = typeof config.apiKey === 'string' && config.apiKey.trim() !== '' ? config.apiKey.trim() : undefined
  return {
    apiKeyEnv: typeof config.apiKeyEnv === 'string' && config.apiKeyEnv.trim() !== ''
      ? config.apiKeyEnv.trim()
      : DEFAULT_API_KEY_ENV,
    ...(apiKey === undefined ? {} : { apiKey }),
    apiBase: typeof config.apiBase === 'string' && config.apiBase !== '' ? config.apiBase : DEFAULT_API_BASE,
    goApiBase: typeof config.goApiBase === 'string' && config.goApiBase !== '' ? config.goApiBase : DEFAULT_GO_API_BASE,
    goZenBase: typeof config.goZenBase === 'string' && config.goZenBase !== '' ? config.goZenBase : DEFAULT_GO_ZEN_BASE,
    usageUrl: typeof config.usageUrl === 'string' && config.usageUrl !== '' ? config.usageUrl : DEFAULT_USAGE_URL,
    openCodeAuthEntry: typeof config.openCodeAuthEntry === 'string' && config.openCodeAuthEntry !== ''
      ? config.openCodeAuthEntry
      : DEFAULT_AUTH_ENTRY,
    requestTimeoutMs: positiveInt(config.requestTimeoutMs, 300_000),
    streamIdleTimeoutMs: positiveInt(config.streamIdleTimeoutMs, 300_000),
    visibleModels: Array.isArray(config.visibleModels)
      ? config.visibleModels.filter((id): id is string => typeof id === 'string' && id !== '')
      : [],
    modelVisibility: booleanRecord(config.modelVisibility),
    filterModelsByPlan: config.filterModelsByPlan !== false,
    modelTransports: transportRecord(config.modelTransports),
    ...(typeof config.contextWindow === 'number' && Number.isInteger(config.contextWindow) && config.contextWindow > 0
      ? { contextWindow: config.contextWindow }
      : {}),
    contextWindowOverrides: numberRecord(config.contextWindowOverrides),
    ...(typeof config.maxOutputTokens === 'number' && Number.isInteger(config.maxOutputTokens) && config.maxOutputTokens >= 0
      ? { maxOutputTokens: config.maxOutputTokens }
      : {}),
    accounts: Array.isArray(config.accounts) ? config.accounts : [],
    modelAccountRules: modelAccountRuleList(config.modelAccountRules),
    quotaFallbackModel: typeof config.quotaFallbackModel === 'string' ? config.quotaFallbackModel.trim() : '',
    stickySession: config.stickySession !== false,
    activeAccount: typeof config.activeAccount === 'string' ? config.activeAccount : '',
    showSidebarQuota: config.showSidebarQuota === true,
    userAgent: typeof config.userAgent === 'string' && config.userAgent !== '' ? config.userAgent : DEFAULT_USER_AGENT,
  }
}
