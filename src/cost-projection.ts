/**
 * Per-request cost facts as a session projection. The client prices each
 * group by its own model, so a model switch or a later session view does not
 * reprice earlier requests. Mirrors the Provider's retry/replacement rule:
 * a repeated turn/step usage replaces the previous one instead of adding to it.
 */
import type { Context } from '@deepseek-ai/cordis'

import {
  COST_TOKEN_KEYS,
  zeroCostTokens,
  type CostGroup,
  type CostTokens,
  type OpenCodeCostFacts,
} from './cost-facts.ts'

interface CostState {
  selection: { provider: string; model: string } | null
  last: { turn: number; step: number; group: CostGroup } | null
  facts: OpenCodeCostFacts
}

interface LogEvent {
  type: string
  time: number
  data: unknown
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function tokensOf(value: unknown): CostTokens | undefined {
  const usage = record(value)
  if (usage === undefined) return undefined
  const input = finite(usage.inputTokens)
    ? usage.inputTokens
    : finite(usage.uncachedInputTokens) ? usage.uncachedInputTokens : undefined
  if (input === undefined || !finite(usage.outputTokens)) return undefined
  if (usage.cacheReadTokens !== undefined && !finite(usage.cacheReadTokens)) return undefined
  if (usage.cacheWriteTokens !== undefined && !finite(usage.cacheWriteTokens)) return undefined
  return {
    uncachedInputTokens: input,
    outputTokens: usage.outputTokens,
    cacheReadTokens: finite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0,
    cacheWriteTokens: finite(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0,
  }
}

function usageOf(type: string, data: Record<string, unknown>): CostTokens | undefined {
  if (type === 'assistant/chunk') {
    const chunk = record(data.chunk)
    return chunk?.type === 'usage' ? tokensOf(chunk.usage) : undefined
  }
  if (type !== 'assistant/message' && type !== 'assistant/attempt') return undefined
  const direct = tokensOf(data.usage)
  if (direct !== undefined) return direct
  if (!Array.isArray(data.stream)) return undefined
  for (let index = data.stream.length - 1; index >= 0; index -= 1) {
    const item = record(data.stream[index])
    const chunk = item?.type === 'chunk' ? record(item.chunk) : undefined
    if (chunk?.type === 'usage') return tokensOf(chunk.usage)
  }
  return undefined
}

function groupKey(group: CostGroup): string {
  return JSON.stringify([group.provider, group.model])
}

function parseState(value: unknown): CostState {
  const state = record(value)
  const facts = record(state?.facts)
  if (state === undefined || facts === undefined || !Array.isArray(facts.groups)) {
    throw new TypeError('invalid opencodeCost state')
  }
  const validGroup = (value: unknown): boolean => {
    const group = record(value)
    const tokens = record(group?.tokens)
    return group !== undefined
      && typeof group.provider === 'string'
      && typeof group.model === 'string'
      && tokens !== undefined
      && COST_TOKEN_KEYS.every((key) => finite(tokens[key]))
  }
  if (!facts.groups.every(validGroup)) throw new TypeError('invalid opencodeCost group')
  return value as CostState
}

export function createOpenCodeCostProjection() {
  return {
    key: 'opencodeCost',
    stateVersion: 1,
    stateSchema: { parse: parseState },
    init: (): CostState => ({
      selection: null,
      last: null,
      facts: { groups: [] },
    }),
    apply(state: CostState, event: LogEvent): CostState {
      const data = record(event.data)
      if (data === undefined) return state

      if (event.type === 'request/header') {
        const config = record(record(data.header)?.config)
        const selection = config !== undefined
          && typeof config.provider === 'string'
          && typeof config.model === 'string'
          ? { provider: config.provider, model: config.model }
          : null
        return { ...state, selection }
      }
      if (event.type === 'step/start' || event.type === 'llm/retry-started') return state

      const tokens = usageOf(event.type, data)
      if (tokens === undefined || !finite(data.turn) || !finite(data.step)) return state
      const group: CostGroup = {
        provider: state.selection?.provider ?? '',
        model: state.selection?.model ?? '',
        tokens,
      }
      const previous = state.last?.turn === data.turn && state.last.step === data.step
        ? state.last.group
        : undefined
      if (previous !== undefined && groupKey(previous) === groupKey(group)
        && JSON.stringify(previous.tokens) === JSON.stringify(group.tokens)) {
        return state
      }

      const groups = state.facts.groups.map((entry) => ({ ...entry, tokens: { ...entry.tokens } }))
      if (previous !== undefined) {
        const old = groups.find((entry) => groupKey(entry) === groupKey(previous))
        if (old !== undefined) {
          for (const key of COST_TOKEN_KEYS) old.tokens[key] -= previous.tokens[key]
        }
      }
      let target = groups.find((entry) => groupKey(entry) === groupKey(group))
      if (target === undefined) {
        target = { ...group, tokens: zeroCostTokens() }
        groups.push(target)
      }
      for (const key of COST_TOKEN_KEYS) target.tokens[key] += tokens[key]
      return {
        ...state,
        last: { turn: data.turn, step: data.step, group },
        facts: {
          groups: groups.filter((entry) => COST_TOKEN_KEYS.some((key) => entry.tokens[key] > 0)),
        },
      }
    },
    wire: {
      view: (state: CostState) => state.facts,
      viewSchema: {
        parse(value: unknown): OpenCodeCostFacts {
          return parseState({ selection: null, last: null, facts: value }).facts
        },
      },
    },
  }
}

export function installOpenCodeCostProjection(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    const registry = projectionCtx.get('sessionProjections') as {
      register(definition: ReturnType<typeof createOpenCodeCostProjection>): () => void
    } | undefined
    if (typeof registry?.register === 'function') {
      projectionCtx.effect(
        () => registry.register(createOpenCodeCostProjection()),
        'dsh-opencode-provider: cost projection',
      )
    }
  })
}
