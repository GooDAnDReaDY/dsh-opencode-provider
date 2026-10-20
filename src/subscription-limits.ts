/**
 * OpenCode Go subscription limits, transcribed from the official Go pricing
 * table. Values are ESTIMATES published by OpenCode, not quotas this plugin
 * enforces; the gateway remains the authority.
 *
 * Each plan publishes a monthly dollar allowance and an estimated request
 * count for the 5-hour, weekly and monthly windows. `unlimited` is used where
 * the table says so (the short-lived free models).
 */
export type LimitValue = number | 'unlimited'

export interface PlanLimits {
  /** Monthly allowance in USD, or unlimited. */
  readonly monthlyUsd: LimitValue
  /** Estimated requests per 5-hour window. */
  readonly fiveHour: LimitValue
  /** Estimated requests per week. */
  readonly weekly: LimitValue
  /** Estimated requests per month. */
  readonly monthly: LimitValue
}

export interface SubscriptionLimits {
  readonly go: PlanLimits
  readonly goPlus: PlanLimits
}

const UNLIMITED: PlanLimits = {
  monthlyUsd: 'unlimited',
  fiveHour: 'unlimited',
  weekly: 'unlimited',
  monthly: 'unlimited',
}

function plan(monthlyUsd: number, fiveHour: number, weekly: number, monthly: number): PlanLimits {
  return { monthlyUsd, fiveHour, weekly, monthly }
}

export const GO_LIMITS: Record<string, SubscriptionLimits> = {
  'glm-5.3-flash': { go: plan(60, 6_320, 15_790, 31_580), goPlus: plan(180, 18_960, 47_370, 94_740) },
  'glm-5.3': { go: plan(15, 220, 540, 1_080), goPlus: plan(120, 1_760, 4_320, 8_640) },
  'glm-5.2': { go: plan(60, 880, 2_150, 4_300), goPlus: plan(180, 2_640, 6_450, 12_900) },
  'kimi-k3': { go: plan(15, 110, 250, 490), goPlus: plan(60, 440, 1_000, 1_960) },
  'kimi-k2.7-code': { go: plan(60, 1_350, 3_380, 6_750), goPlus: plan(180, 4_050, 10_140, 20_250) },
  'longcat-2.0': { go: plan(60, 11_400, 28_600, 57_200), goPlus: plan(240, 45_600, 114_400, 228_800) },
  'longcat-2.5-preview-free': { go: UNLIMITED, goPlus: UNLIMITED },
  'step-5-preview': { go: plan(60, 1_720, 4_280, 8_520), goPlus: plan(240, 6_880, 17_120, 34_080) },
  'beam-free': { go: UNLIMITED, goPlus: UNLIMITED },
  'mimo-v2.6-flash': { go: plan(60, 30_100, 75_200, 150_400), goPlus: plan(120, 60_200, 150_400, 300_800) },
  'mimo-v2.6-pro': { go: plan(15, 3_250, 8_150, 16_300), goPlus: plan(60, 13_000, 32_600, 65_200) },
  'mimo-v2.5': { go: plan(60, 30_100, 75_200, 150_400), goPlus: plan(120, 60_200, 150_400, 300_800) },
  'mimo-v2.5-pro': { go: plan(15, 3_250, 8_150, 16_300), goPlus: plan(60, 13_000, 32_600, 65_200) },
  'minimax-m3.1-flash-free': { go: UNLIMITED, goPlus: UNLIMITED },
  'minimax-m3': { go: plan(60, 3_200, 8_000, 16_000), goPlus: plan(180, 9_600, 24_000, 48_000) },
  'muse-spark-1.3-contributor': { go: plan(60, 45_300, 113_300, 226_600), goPlus: plan(120, 90_600, 226_600, 453_200) },
  'muse-spark-1.2-contributor': { go: plan(60, 45_300, 113_300, 226_600), goPlus: plan(120, 90_600, 226_600, 453_200) },
  'qwen3.8-max': { go: plan(15, 160, 400, 810), goPlus: plan(60, 640, 1_600, 3_240) },
  'qwen3.8-flash': { go: plan(30, 5_400, 13_500, 27_000), goPlus: plan(90, 16_200, 40_500, 81_000) },
  'qwen3.7-plus': { go: plan(60, 4_300, 10_800, 21_600), goPlus: plan(180, 12_900, 32_400, 64_800) },
  'deepseek-v4.1-flash': { go: plan(80, 34_670, 86_670, 173_330), goPlus: plan(160, 69_330, 173_330, 346_670) },
  'deepseek-v4-pro': { go: plan(15, 1_050, 2_600, 5_200), goPlus: plan(60, 4_200, 10_400, 20_800) },
  'hy4-preview': { go: plan(30, 1_350, 3_380, 6_770), goPlus: plan(120, 5_400, 13_520, 27_080) },
  'hy3': { go: plan(60, 4_300, 10_750, 21_500), goPlus: plan(240, 17_200, 43_000, 86_000) },
  'grok-4.7': { go: plan(15, 169, 423, 845), goPlus: plan(60, 676, 1_692, 3_380) },
  'gpt-6-luna': { go: plan(15, 4_230, 10_560, 21_130), goPlus: plan(60, 16_920, 42_240, 84_520) },
  'gpt-5.6-luna': { go: plan(15, 2_050, 5_100, 10_250), goPlus: plan(60, 8_200, 20_400, 41_000) },
  'claude-haiku-5-5': { go: plan(15, 3_850, 9_620, 19_230), goPlus: plan(60, 15_380, 38_460, 76_920) },
  'gemini-4-argon-contributor': { go: plan(60, 440, 1_080, 2_120), goPlus: plan(240, 1_760, 4_320, 8_480) },
}

export function limitsFor(modelId: string): SubscriptionLimits | undefined {
  return GO_LIMITS[modelId]
}

/** Compact request estimate; `∞` for an unlimited window. */
export function formatRequests(value: LimitValue): string {
  if (value === 'unlimited') return '∞'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function formatUsd(value: LimitValue): string {
  return value === 'unlimited' ? 'unlimited' : `$${value}`
}

function planLine(label: string, limits: PlanLimits): string {
  return `${label}: ${formatUsd(limits.monthlyUsd)}/mo · `
    + `${formatRequests(limits.fiveHour)}/${formatRequests(limits.weekly)}/${formatRequests(limits.monthly)} req (5h/wk/mo)`
}

/** Full tooltip text for the settings row. */
export function describeLimitsFull(limits: SubscriptionLimits): string {
  return `${planLine('Go', limits.go)} · ${planLine('Go Plus', limits.goPlus)}`
}

/** Short model-picker annotation, e.g. `Go 6.3K/5h · 15.8K/wk`. */
export function describeLimitsShort(limits: SubscriptionLimits): string {
  return `Go ${formatRequests(limits.go.fiveHour)}/5h · ${formatRequests(limits.go.weekly)}/wk`
}
