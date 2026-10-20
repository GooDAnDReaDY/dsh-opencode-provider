import assert from 'node:assert/strict'
import test from 'node:test'

import { createOpenCodeCostProjection } from '../src/cost-projection.ts'

type State = ReturnType<ReturnType<typeof createOpenCodeCostProjection>['init']> extends infer T ? T : never
type Projection = ReturnType<typeof createOpenCodeCostProjection>

function usageEvent(turn: number, step: number, input: number, output: number) {
  return {
    type: 'assistant/chunk',
    time: 1000,
    data: {
      turn,
      step,
      chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: output } },
    },
  }
}

function header(provider: string, model: string) {
  return {
    type: 'request/header',
    time: 900,
    data: { header: { config: { provider, model } } },
  }
}

test('folds usage into per-model groups and replaces a retried step', () => {
  const projection: Projection = createOpenCodeCostProjection()
  let state: State = projection.init()
  state = projection.apply(state, header('opencode-go', 'deepseek-v4.1-flash'))
  state = projection.apply(state, usageEvent(1, 1, 1000, 100))
  assert.deepEqual(state.facts.groups[0]?.tokens, {
    uncachedInputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  })

  state = projection.apply(state, usageEvent(1, 1, 600, 60))
  assert.equal(state.facts.groups.length, 1)
  assert.deepEqual(state.facts.groups[0]?.tokens, {
    uncachedInputTokens: 600,
    outputTokens: 60,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  })
})

test('keeps separate groups when the model changes', () => {
  const projection: Projection = createOpenCodeCostProjection()
  let state: State = projection.init()
  state = projection.apply(state, header('opencode-go', 'deepseek-v4.1-flash'))
  state = projection.apply(state, usageEvent(1, 1, 100, 10))
  state = projection.apply(state, header('opencode-go', 'beam-free'))
  state = projection.apply(state, usageEvent(2, 1, 200, 20))
  assert.deepEqual(state.facts.groups.map((group) => group.model), ['deepseek-v4.1-flash', 'beam-free'])
})

test('accepts uncachedInputTokens from a v2 usage chunk', () => {
  const projection: Projection = createOpenCodeCostProjection()
  let state: State = projection.init()
  state = projection.apply(state, header('opencode-go', 'deepseek-v4.1-flash'))
  state = projection.apply(state, {
    type: 'assistant/chunk',
    time: 1000,
    data: {
      turn: 1,
      step: 1,
      chunk: { type: 'usage', usage: { uncachedInputTokens: 42, outputTokens: 7 } },
    },
  })
  assert.equal(state.facts.groups[0]?.tokens.uncachedInputTokens, 42)
  assert.equal(state.facts.groups[0]?.tokens.outputTokens, 7)
})
