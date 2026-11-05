export interface PriceRates {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
}

export interface PriceTier {
  /** Billed input threshold (inclusive). */
  readonly at: number
  readonly rates: PriceRates
}

export interface PriceMultiplier {
  readonly when: PriceCondition
  readonly factor: number
}

export interface PriceCondition {
  readonly all?: readonly PriceCondition[]
  readonly any?: readonly PriceCondition[]
  readonly utc_days?: Readonly<Record<string, string | readonly string[]>>
  readonly utc_hours?: Readonly<Record<string, string>>
  readonly date?: Readonly<Record<string, string | readonly string[]>>
  readonly context?: { readonly gt?: number; readonly gte?: number; readonly lt?: number; readonly lte?: number }
}

export interface Pricing {
  readonly base: PriceRates
  readonly tiers: readonly PriceTier[]
  readonly multipliers: readonly PriceMultiplier[]
}

export interface TokenCounts {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const HOURS = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function rate(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function comparison(value: unknown, validate: (text: string) => boolean): Readonly<Record<string, string | readonly string[]>> | undefined {
  const raw = record(value)
  if (raw === undefined) return undefined
  const out: Record<string, string | readonly string[]> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (key === 'in') {
      if (!Array.isArray(entry) || entry.length === 0 || !entry.every((item) => typeof item === 'string' && validate(item))) return undefined
      out.in = entry as string[]
    } else {
      if (typeof entry !== 'string' || !validate(entry)) return undefined
      out[key] = entry
    }
  }
  return out
}

function conditionOf(value: unknown, depth = 0): PriceCondition | undefined {
  if (depth > 12) return undefined
  const raw = record(value)
  if (raw === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (key === 'all' || key === 'any') {
      if (!Array.isArray(entry) || entry.length === 0 || entry.length > 64) return undefined
      const nested = entry.map((item) => conditionOf(item, depth + 1))
      if (nested.some((item) => item === undefined)) return undefined
      out[key] = nested
    } else if (key === 'utc_days') {
      const value = comparison(entry, (text) => DAYS.includes(text))
      if (value === undefined) return undefined
      out[key] = value
    } else if (key === 'utc_hours') {
      const value = comparison(entry, (text) => HOURS.test(text))
      if (value === undefined) return undefined
      out[key] = value
    } else if (key === 'date') {
      const value = comparison(entry, (text) => DATE.test(text))
      if (value === undefined) return undefined
      out[key] = value
    } else if (key === 'context') {
      const context = record(entry)
      if (context === undefined) return undefined
      const bounds: Record<string, number> = {}
      for (const [op, size] of Object.entries(context)) {
        if (!['gt', 'gte', 'lt', 'lte'].includes(op) || typeof size !== 'number' || !Number.isFinite(size)) return undefined
        bounds[op] = size
      }
      out[key] = bounds
    } else {
      return undefined
    }
  }
  return Object.keys(out).length === 0 ? undefined : out as PriceCondition
}

function compare(actual: string, rule: Readonly<Record<string, string | readonly string[]>>): boolean {
  return Object.entries(rule).every(([op, expected]) => {
    if (op === 'in') return Array.isArray(expected) && expected.includes(actual)
    if (op === 'eq') return actual === expected
    if (op === 'gt') return actual > String(expected)
    if (op === 'gte') return actual >= String(expected)
    if (op === 'lt') return actual < String(expected)
    if (op === 'lte') return actual <= String(expected)
    return false
  })
}

function matches(condition: PriceCondition, at: number, context: number): boolean {
  if (condition.all !== undefined && !condition.all.every((entry) => matches(entry, at, context))) return false
  if (condition.any !== undefined && !condition.any.some((entry) => matches(entry, at, context))) return false
  const date = new Date(at)
  if (condition.utc_days !== undefined && !compare(DAYS[date.getUTCDay()]!, condition.utc_days)) return false
  if (condition.utc_hours !== undefined) {
    const hour = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
    if (!compare(hour, condition.utc_hours)) return false
  }
  if (condition.date !== undefined && !compare(date.toISOString().slice(0, 10), condition.date)) return false
  if (condition.context !== undefined) {
    if (condition.context.gt !== undefined && !(context > condition.context.gt)) return false
    if (condition.context.gte !== undefined && !(context >= condition.context.gte)) return false
    if (condition.context.lt !== undefined && !(context < condition.context.lt)) return false
    if (condition.context.lte !== undefined && !(context <= condition.context.lte)) return false
  }
  return true
}

export function billingContext(tokens: TokenCounts): number {
  return tokens.input + tokens.cacheRead
}

/** Estimate USD from gateway cost metadata, including context tiers and UTC multipliers. */
export function priceUsage(pricing: Pricing, tokens: TokenCounts, at: number): number {
  const context = billingContext(tokens)
  let rates = pricing.base
  for (const tier of pricing.tiers) {
    if (tier.at <= context) rates = tier.rates
    else break
  }
  const factor = pricing.multipliers.reduce(
    (value, entry) => matches(entry.when, at, context) ? value * entry.factor : value,
    1,
  )
  return (tokens.input * rates.input + tokens.output * rates.output + tokens.cacheRead * rates.cacheRead) / 1_000_000 * factor
}

interface Override {
  readonly at: number
  readonly input?: number
  readonly cacheRead?: number
  readonly output?: number
}

function overridesOf(raw: unknown, field: 'input' | 'output'): Override[] {
  if (!Array.isArray(raw)) return []
  const out: Override[] = []
  for (const entry of raw) {
    const value = record(entry)
    const when = record(value?.when)
    const context = record(when?.context)
    const at = rate(context?.gt) ?? rate(context?.gte)
    const price = rate(value?.price)
    const cache = record(value?.cache)
    const cacheRead = field === 'input' ? rate(cache?.read) : undefined
    if (at === undefined || (price === undefined && cacheRead === undefined)) continue
    out.push({
      at,
      ...(price === undefined ? {} : { [field]: price }),
      ...(cacheRead === undefined ? {} : { cacheRead }),
    })
  }
  return out.sort((left, right) => left.at - right.at)
}

/** Normalize the gateway's `cost` object; malformed metadata is ignored. */
export function parseGatewayPricing(raw: unknown): Pricing | undefined {
  const cost = record(raw)
  const text = record(cost?.text)
  const input = record(text?.input)
  const output = record(text?.output)
  const cache = record(input?.cache)
  const baseInput = rate(input?.price)
  const baseOutput = rate(output?.price)
  if (baseInput === undefined || baseOutput === undefined) return undefined
  const base: PriceRates = {
    input: baseInput,
    output: baseOutput,
    cacheRead: rate(cache?.read) ?? 0,
  }
  const inputOverrides = overridesOf(input?.overrides, 'input')
  const outputOverrides = overridesOf(output?.overrides, 'output')
  const thresholds = [...new Set([
    ...inputOverrides.map((entry) => entry.at),
    ...outputOverrides.map((entry) => entry.at),
  ])].sort((left, right) => left - right)
  const tiers: PriceTier[] = []
  for (const at of thresholds) {
    const inputOverride = inputOverrides.filter((entry) => entry.at <= at).at(-1)
    const outputOverride = outputOverrides.filter((entry) => entry.at <= at).at(-1)
    tiers.push({
      at,
      rates: {
        input: inputOverride?.input ?? base.input,
        output: outputOverride?.output ?? base.output,
        cacheRead: inputOverride?.cacheRead ?? base.cacheRead,
      },
    })
  }
  const multipliers: PriceMultiplier[] = []
  if (Array.isArray(cost?.multipliers)) {
    for (const entry of cost.multipliers) {
      const value = record(entry)
      const factor = rate(value?.factor)
      const when = conditionOf(value?.when)
      if (factor !== undefined && factor > 0 && when !== undefined) multipliers.push({ when, factor })
    }
  }
  return { base, tiers, multipliers }
}
