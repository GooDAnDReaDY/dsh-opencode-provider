import type { SubscriptionLimits } from '../subscription-limits.ts'

export type TransportId = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'

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

export interface RoutingTraceRow {
  at: number
  provider: string
  model: string
  account: string
  reason: 'rule' | 'sticky' | 'pinned' | 'default' | 'rotation' | 'quota-fallback'
  fallback: boolean
  ok: boolean
  error?: string
}

export interface ModelRow {
  id: string
  name: string
  description: string
  transport: TransportId
  contextWindow: number
  maxTokens: number
  free: boolean
  cost: { input: number; output: number; cacheRead: number }
  limits: SubscriptionLimits | null
  input: readonly string[]
  reasoning: readonly string[]
  visible: boolean
}

export interface UsageWindow {
  percentUsed: number
  resetsAt?: string
  status?: string
}

export interface UsageState {
  report?: {
    windows: {
      fiveHour?: UsageWindow
      weekly?: UsageWindow
      monthly?: UsageWindow
    }
  }
  error?: string
  checkedAt: number
}

export interface AccountRow {
  label: string
  ref: string
  default: boolean
  configured: boolean
  source: string
  active: boolean
  coolingUntil: number
  mark: string
  usage: UsageState | null
}

export interface HostState {
  config: PublicConfig
  key: { configured: boolean; writable: boolean; source?: string }
  accounts: AccountRow[]
  models: ModelRow[]
  usage: UsageState | null
  routing: RoutingTraceRow[]
  auth: { entry: string; hasStoredKey: boolean; entries: readonly string[] }
  revision?: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  })
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
  return body as T
}

export function fetchState(): Promise<HostState> {
  return call<HostState>('/dsh-opencode/state')
}

export function refreshState(): Promise<HostState> {
  return call<HostState>('/dsh-opencode/refresh', { method: 'POST', body: '{}' })
}

export function refreshModels(): Promise<HostState> {
  return call<HostState>('/dsh-opencode/models/refresh', { method: 'POST', body: '{}' })
}

export function saveConfig(patch: Record<string, unknown>): Promise<{ ok: true }> {
  return call('/dsh-opencode/config', { method: 'POST', body: JSON.stringify({ patch }) })
}

export interface UpdateStatus {
  packageName: string
  currentVersion: string
  latestVersion?: string
  latestCheckFailed: boolean
  updateAvailable: boolean
  profileName: string
  canAutoUpdate: boolean
  updatedVersion?: string
  restartRequired?: boolean
}

export function fetchUpdate(): Promise<UpdateStatus> {
  return call<UpdateStatus>('/dsh-opencode/update')
}

export function installUpdate(): Promise<UpdateStatus> {
  return call<UpdateStatus>('/dsh-opencode/update', {
    method: 'POST',
    headers: { 'x-dsh-plugin-update': '1' },
    body: '{}',
  })
}

export function saveKey(ref: string, key: string): Promise<{ ok: true }> {
  return call('/dsh-opencode/key', { method: 'POST', body: JSON.stringify({ ref, key }) })
}

export function clearKey(ref: string): Promise<{ ok: true }> {
  return call('/dsh-opencode/key/clear', { method: 'POST', body: JSON.stringify({ ref }) })
}

export function importAuth(entry: string): Promise<{ ok: true }> {
  return call('/dsh-opencode/auth-import', { method: 'POST', body: JSON.stringify({ entry }) })
}

export interface TestResult {
  ok: boolean
  model: string
  provider: string
  latencyMs: number
  text?: string
  finish?: unknown
  error?: string
}

export interface ModelUsageRow {
  provider: string
  model: string
  sessions: number
  turns: number
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  llmMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
}

export interface AnalyticsSummary {
  sessions: number
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  avgTtftMs: number | null
  avgLatencyMs: number | null
  errors: number | null
  successRate: number | null
}

export interface DayUsageRow {
  date: string
  sessions: number
  requests: number
  tokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  avgTtftMs: number | null
}

export interface SessionUsageRow {
  id: string
  provider: string
  model: string
  at: number
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  avgTtftMs: number | null
  avgLatencyMs: number | null
}

export interface ModelRequestHeatmap {
  provider: string
  model: string
  total: number
  hours: number[]
  grid: number[][]
}

export interface AccountRequestHeatmap {
  account: string
  total: number
  hours: number[]
  grid: number[][]
}

export interface RequestHeatmap {
  since: number
  total: number
  hours: number[]
  grid: number[][]
  firstAt: number | null
  lastAt: number | null
  models: ModelRequestHeatmap[]
  accounts: AccountRequestHeatmap[]
}

export interface AnalyticsReport {
  since: number
  scannedSessions: number
  matchedSessions: number
  models: ModelUsageRow[]
  summary: AnalyticsSummary
  days: DayUsageRow[]
  sessions: SessionUsageRow[]
  heatmap?: RequestHeatmap
}

export function fetchAnalytics(days = 30): Promise<AnalyticsReport> {
  return call(`/dsh-opencode/analytics?days=${encodeURIComponent(String(days))}`)
}

export function testConnection(
  model: string,
  provider: 'opencode-go' | 'opencode' = 'opencode-go',
): Promise<TestResult> {
  return call('/dsh-opencode/test', { method: 'POST', body: JSON.stringify({ model, provider }) })
}
