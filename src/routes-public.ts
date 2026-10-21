import type { ResolvedConfig, TransportId } from './config.ts'

export interface PublicConfig {
  apiKeyEnv: string
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
  contextWindow: number | null
  contextWindowOverrides: Readonly<Record<string, number>>
  maxOutputTokens: number | null
  accounts: ReadonlyArray<{ label: string; apiKeyEnv: string }>
  modelAccountRules: ReadonlyArray<{ pattern: string; account: string }>
  quotaFallbackModel: string
  stickySession: boolean
  activeAccount: string
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
    visibleModels: config.visibleModels,
    modelVisibility: config.modelVisibility,
    filterModelsByPlan: config.filterModelsByPlan,
    modelTransports: config.modelTransports,
    contextWindow: config.contextWindow ?? null,
    contextWindowOverrides: config.contextWindowOverrides,
    maxOutputTokens: config.maxOutputTokens ?? null,
    accounts: config.accounts.map((account) => ({
      label: typeof account.label === 'string' ? account.label : '',
      apiKeyEnv: typeof account.apiKeyEnv === 'string' ? account.apiKeyEnv : '',
    })),
    modelAccountRules: config.modelAccountRules.map((rule) => ({
      pattern: rule.pattern,
      account: rule.account,
    })),
    quotaFallbackModel: config.quotaFallbackModel,
    stickySession: config.stickySession,
    activeAccount: config.activeAccount,
    showSidebarQuota: config.showSidebarQuota,
    userAgent: config.userAgent,
  }
}
