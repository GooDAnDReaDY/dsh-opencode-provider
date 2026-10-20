import { GENERATED_MODELS } from '../models.generated.ts'
import type { CostGroup, OpenCodeCostFacts } from '../cost-facts.ts'

export interface SessionUsageBuckets {
  readonly uncachedInputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

export interface SessionModelSelection {
  readonly provider: string
  readonly model: string
}

export interface SessionSelectionProjection {
  readonly lastUsed: SessionModelSelection | null
  readonly next: SessionModelSelection | null
}

export interface SessionCostView {
  readonly total: number
  readonly value: string
  readonly title: string
  readonly free: boolean
  readonly partial: boolean
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

export function formatMoney(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '$0.00'
  if (total < 0.0001) return '<$0.0001'
  return total < 0.01 ? `$${total.toFixed(4)}` : `$${total.toFixed(2)}`
}

/**
 * Estimate the session cost from the composer's durable token buckets and the
 * selection that produced them. Cumulative buckets span every request in the
 * session, so a model switch makes this an approximation — the `≈`/`≥` marker
 * says so. Usage from another provider is never priced here.
 */
export function buildSessionCost(
  usage: SessionUsageBuckets | undefined,
  selection: SessionSelectionProjection | undefined,
): SessionCostView | undefined {
  if (usage === undefined) return undefined
  const used = selection?.lastUsed ?? selection?.next
  if (used === null || used === undefined) return undefined
  if (used.provider !== 'opencode' && used.provider !== 'opencode-go') return undefined
  const meta = GENERATED_MODELS[used.model]
  if (meta === undefined) return undefined

  const input = count(usage.uncachedInputTokens)
  const output = count(usage.outputTokens)
  const cacheRead = count(usage.cacheReadTokens)
  const cacheWrite = count(usage.cacheWriteTokens)
  if (input + output + cacheRead + cacheWrite === 0) return undefined

  const total = (
    input * meta.cost.input
    + output * meta.cost.output
    + cacheRead * meta.cost.cacheRead
  ) / 1_000_000
  const free = meta.free
  const partial = cacheWrite > 0
  if (!free && total <= 0) return undefined

  const value = free ? 'Free' : `${partial ? '≥' : '≈'}${formatMoney(total)}`
  const title = [
    `Session cost ${value}`,
    input > 0 ? `uncached input ${compact(input)}` : undefined,
    output > 0 ? `output ${compact(output)}` : undefined,
    cacheRead > 0 ? `cache read ${compact(cacheRead)}` : undefined,
    cacheWrite > 0 ? `cache write ${compact(cacheWrite)} (unpriced)` : undefined,
    'estimate from published rates, not the provider invoice',
  ].filter((part): part is string => part !== undefined).join(' · ')

  return { total, value, title, free, partial }
}

/** Price the durable per-request groups, each group by its own model. */
export function buildFactsCost(facts: OpenCodeCostFacts | undefined): SessionCostView | undefined {
  const raw = facts as unknown as {
    groups?: CostGroup[]
    facts?: { groups?: CostGroup[] }
  } | undefined
  const groups = Array.isArray(raw?.groups)
    ? raw.groups
    : Array.isArray(raw?.facts?.groups) ? raw.facts.groups : []
  if (groups.length === 0) return undefined
  let total = 0
  let free = true
  let partial = false
  let priced = false
  const rows: string[] = []

  for (const group of groups) {
    if (group.provider !== 'opencode' && group.provider !== 'opencode-go') continue
    const input = count(group.tokens.uncachedInputTokens)
    const output = count(group.tokens.outputTokens)
    const cacheRead = count(group.tokens.cacheReadTokens)
    const cacheWrite = count(group.tokens.cacheWriteTokens)
    if (input + output + cacheRead + cacheWrite === 0) continue
    const meta = GENERATED_MODELS[group.model]
    if (meta === undefined) {
      partial = true
      rows.push(`${group.model}: unpriced`)
      continue
    }
    priced = true
    if (cacheWrite > 0) partial = true
    total += (
      input * meta.cost.input
      + output * meta.cost.output
      + cacheRead * meta.cost.cacheRead
    ) / 1_000_000
    if (!meta.free) free = false
    rows.push([
      group.model,
      `${compact(input)} in`,
      `${compact(output)} out`,
      cacheRead > 0 ? `${compact(cacheRead)} cache` : undefined,
    ].filter((part): part is string => part !== undefined).join(' / '))
  }

  if (!priced) return undefined
  const value = free ? 'Free' : `${partial ? '≥' : '≈'}${formatMoney(total)}`
  const title = [
    `Session cost ${value}`,
    ...rows,
    'estimate from published rates, not the provider invoice',
  ].join(' · ')
  return { total, value, title, free, partial }
}
