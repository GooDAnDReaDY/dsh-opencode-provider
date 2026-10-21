import type { HostState, TransportId } from './api.ts'

export interface Draft {
  apiKeyEnv: string
  apiBase: string
  goApiBase: string
  goZenBase: string
  usageUrl: string
  openCodeAuthEntry: string
  requestTimeoutMs: string
  streamIdleTimeoutMs: string
  maxOutputTokens: string
  contextWindow: string
  showSidebarQuota: boolean
  activeAccount: string
  accounts: Array<{ label: string; apiKeyEnv: string }>
  modelAccountRules: Array<{ pattern: string; account: string }>
  quotaFallbackModel: string
  stickySession: boolean
  visibleModels: string[]
  filterModelsByPlan: boolean
  showAll: boolean
  modelTransports: Record<string, TransportId | ''>
}

export function draftOf(state: HostState): Draft {
  const allIds = state.models.map((model) => model.id)
  return {
    apiKeyEnv: state.config.apiKeyEnv,
    apiBase: state.config.apiBase,
    goApiBase: state.config.goApiBase,
    goZenBase: state.config.goZenBase,
    usageUrl: state.config.usageUrl,
    openCodeAuthEntry: state.config.openCodeAuthEntry,
    requestTimeoutMs: String(state.config.requestTimeoutMs),
    streamIdleTimeoutMs: String(state.config.streamIdleTimeoutMs),
    maxOutputTokens: state.config.maxOutputTokens === null ? '' : String(state.config.maxOutputTokens),
    contextWindow: state.config.contextWindow === null ? '' : String(state.config.contextWindow),
    showSidebarQuota: state.config.showSidebarQuota,
    activeAccount: state.config.activeAccount,
    accounts: state.config.accounts.map((account) => ({ ...account })),
    modelAccountRules: state.config.modelAccountRules.map((rule) => ({ ...rule })),
    quotaFallbackModel: state.config.quotaFallbackModel,
    stickySession: state.config.stickySession,
    visibleModels: state.config.visibleModels.length === 0 ? allIds : [...state.config.visibleModels],
    filterModelsByPlan: state.config.filterModelsByPlan,
    showAll: state.config.visibleModels.length === 0,
    modelTransports: { ...state.config.modelTransports },
  }
}

export function numberOrNull(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid number: ${text}`)
  return value
}

export function patchOf(draft: Draft): Record<string, unknown> {
  return {
    apiKeyEnv: draft.apiKeyEnv.trim(),
    apiBase: draft.apiBase.trim(),
    goApiBase: draft.goApiBase.trim(),
    goZenBase: draft.goZenBase.trim(),
    usageUrl: draft.usageUrl.trim(),
    openCodeAuthEntry: draft.openCodeAuthEntry.trim(),
    requestTimeoutMs: numberOrNull(draft.requestTimeoutMs) ?? 300000,
    streamIdleTimeoutMs: numberOrNull(draft.streamIdleTimeoutMs) ?? 300000,
    maxOutputTokens: numberOrNull(draft.maxOutputTokens),
    contextWindow: numberOrNull(draft.contextWindow),
    showSidebarQuota: draft.showSidebarQuota,
    activeAccount: draft.activeAccount.trim(),
    accounts: draft.accounts
      .map((account) => ({ label: account.label.trim(), apiKeyEnv: account.apiKeyEnv.trim() }))
      .filter((account) => account.label !== '' || account.apiKeyEnv !== ''),
    modelAccountRules: draft.modelAccountRules
      .map((rule) => ({ pattern: rule.pattern.trim(), account: rule.account.trim() }))
      .filter((rule) => rule.pattern !== '' && rule.account !== ''),
    quotaFallbackModel: draft.quotaFallbackModel.trim(),
    stickySession: draft.stickySession,
    visibleModels: draft.showAll ? [] : draft.visibleModels,
    filterModelsByPlan: draft.filterModelsByPlan,
    modelTransports: Object.fromEntries(
      Object.entries(draft.modelTransports).filter(([, value]) => value !== ''),
    ),
  }
}

export function same(a: Draft, b: Draft): boolean {
  return JSON.stringify(patchOf(a)) === JSON.stringify(patchOf(b))
}

export function safeSame(a: Draft, b: Draft): boolean {
  try {
    return same(a, b)
  } catch {
    return false
  }
}
