/** JSON-only per-request cost facts shared by the Host projection and the client. */

export interface CostTokens {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface CostGroup {
  provider: string
  model: string
  tokens: CostTokens
}

export interface OpenCodeCostFacts {
  groups: CostGroup[]
}

export const COST_TOKEN_KEYS = [
  'uncachedInputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
] as const

export function zeroCostTokens(): CostTokens {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}
