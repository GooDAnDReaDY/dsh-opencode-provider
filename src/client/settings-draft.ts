import type { HostState, TransportId } from './api.ts'

export interface Draft {
  revision: number
  apiKeyEnv: string
  apiBase: string
  goApiBase: string
  goZenBase: string
  usageUrl: string
  openCodeAuthEntry: string
  requestTimeoutMs: string
  streamIdleTimeoutMs: string
  proxyUrl: string
  maxOutputTokens: string
  contextWindow: string
  contextWindowOverrides: Record<string, string>
  maxOutputTokensOverrides: Record<string, string>
  showSidebarQuota: boolean
  activeAccount: string
  accounts: Array<{ label: string; apiKeyEnv: string }>
  modelAccountRules: Array<{ pattern: string; account: string }>
  quotaFallbackModel: string
  autoSwitch: boolean
  stickySession: boolean
  visibleModels: string[]
  filterModelsByPlan: boolean
  showAll: boolean
  modelTransports: Record<string, TransportId | ''>
}

export function draftOf(state: HostState): Draft {
  const allIds = state.models.map((model) => model.id)
  return {
    revision: state.revision ?? 0,
    apiKeyEnv: state.config.apiKeyEnv,
    apiBase: state.config.apiBase,
    goApiBase: state.config.goApiBase,
    goZenBase: state.config.goZenBase,
    usageUrl: state.config.usageUrl,
    openCodeAuthEntry: state.config.openCodeAuthEntry,
    requestTimeoutMs: String(state.config.requestTimeoutMs),
    streamIdleTimeoutMs: String(state.config.streamIdleTimeoutMs),
    proxyUrl: state.config.proxyUrl,
    maxOutputTokens: state.config.maxOutputTokens === null ? '' : String(state.config.maxOutputTokens),
    contextWindow: state.config.contextWindow === null ? '' : String(state.config.contextWindow),
    contextWindowOverrides: Object.fromEntries(
      Object.entries(state.config.contextWindowOverrides).map(([id, value]) => [id, String(value)]),
    ),
    maxOutputTokensOverrides: Object.fromEntries(
      Object.entries(state.config.maxOutputTokensOverrides).map(([id, value]) => [id, String(value)]),
    ),
    showSidebarQuota: state.config.showSidebarQuota,
    activeAccount: state.config.activeAccount,
    accounts: state.config.accounts.map((account) => ({ ...account })),
    modelAccountRules: state.config.modelAccountRules.map((rule) => ({ ...rule })),
    quotaFallbackModel: state.config.quotaFallbackModel,
    autoSwitch: state.config.autoSwitch !== false,
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

function numberRecordOrNull(record: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, text] of Object.entries(record)) {
    const trimmed = text.trim()
    if (trimmed === '') continue
    const value = Number(trimmed)
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid number: ${text}`)
    out[id] = value
  }
  return out
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
    proxyUrl: draft.proxyUrl.trim(),
    maxOutputTokens: numberOrNull(draft.maxOutputTokens),
    contextWindow: numberOrNull(draft.contextWindow),
    contextWindowOverrides: numberRecordOrNull(draft.contextWindowOverrides),
    maxOutputTokensOverrides: numberRecordOrNull(draft.maxOutputTokensOverrides),
    showSidebarQuota: draft.showSidebarQuota,
    activeAccount: draft.activeAccount.trim(),
    accounts: draft.accounts
      .map((account) => ({ label: account.label.trim(), apiKeyEnv: account.apiKeyEnv.trim() }))
      .filter((account) => account.label !== '' || account.apiKeyEnv !== ''),
    modelAccountRules: draft.modelAccountRules
      .map((rule) => ({ pattern: rule.pattern.trim(), account: rule.account.trim() }))
      .filter((rule) => rule.pattern !== '' && rule.account !== ''),
    quotaFallbackModel: draft.quotaFallbackModel.trim(),
    autoSwitch: draft.autoSwitch,
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
