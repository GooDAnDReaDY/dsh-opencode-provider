import type { ResolvedConfig, TransportId, UsageDisplay } from './config.ts'

export interface PublicConfig {
  apiKeyEnv: string
  apiBase: string
  goApiBase: string
  goZenBase: string
  usageUrl: string
  openCodeAuthEntry: string
  requestTimeoutMs: number
  streamIdleTimeoutMs: number
  requestPreparationTimeoutMs: number
  maxImages: number
  maxRequestImageBytes: number
  requestImagePixelBudget: number
  requestImageMaxBytes: number
  proxyUrl: string
  visibleModels: readonly string[]
  modelVisibility: Readonly<Record<string, boolean>>
  filterModelsByPlan: boolean
  modelTransports: Readonly<Record<string, TransportId>>
  contextWindow: number | null
  contextWindowOverrides: Readonly<Record<string, number>>
  maxOutputTokens: number | null
  maxOutputTokensOverrides: Readonly<Record<string, number>>
  accounts: ReadonlyArray<{ label: string; apiKeyEnv: string }>
  modelAccountRules: ReadonlyArray<{ pattern: string; account: string }>
  quotaFallbackModel: string
  autoSwitch: boolean
  stickySession: boolean
  activeAccount: string
  usageDisplay: UsageDisplay
  showSidebarQuota: boolean
  userAgent: string
}

export function publicConfig(config: ResolvedConfig): PublicConfig {
  return {
    apiKeyEnv: config.apiKeyEnv,
    apiBase: config.apiBase,
    goApiBase: config.goApiBase,
    goZenBase: config.goZenBase,
    usageUrl: config.usageUrl,
    openCodeAuthEntry: config.openCodeAuthEntry,
    requestTimeoutMs: config.requestTimeoutMs,
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
    requestPreparationTimeoutMs: config.requestPreparationTimeoutMs,
    maxImages: config.maxImages,
    maxRequestImageBytes: config.maxRequestImageBytes,
    requestImagePixelBudget: config.requestImagePixelBudget,
    requestImageMaxBytes: config.requestImageMaxBytes,
    proxyUrl: config.proxyUrl,
    visibleModels: config.visibleModels,
    modelVisibility: config.modelVisibility,
    filterModelsByPlan: config.filterModelsByPlan,
    modelTransports: config.modelTransports,
    contextWindow: config.contextWindow ?? null,
    contextWindowOverrides: config.contextWindowOverrides,
    maxOutputTokens: config.maxOutputTokens ?? null,
    maxOutputTokensOverrides: config.maxOutputTokensOverrides,
    accounts: config.accounts.map((account) => ({
      label: typeof account.label === 'string' ? account.label : '',
      apiKeyEnv: typeof account.apiKeyEnv === 'string' ? account.apiKeyEnv : '',
    })),
    modelAccountRules: config.modelAccountRules.map((rule) => ({
      pattern: rule.pattern,
      account: rule.account,
    })),
    quotaFallbackModel: config.quotaFallbackModel,
    autoSwitch: config.autoSwitch,
    stickySession: config.stickySession,
    activeAccount: config.activeAccount,
    usageDisplay: config.usageDisplay,
    showSidebarQuota: config.showSidebarQuota,
    userAgent: config.userAgent,
  }
}
