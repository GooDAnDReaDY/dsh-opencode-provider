import assert from 'node:assert/strict'
import test from 'node:test'

import { GENERATED_MODELS } from '../src/models.generated.ts'
import { buildFactsCost, buildSessionCost } from '../src/client/session-cost.ts'

test('prices a paid OpenCode session from the snapshot', () => {
  const model = 'deepseek-v4.1-flash'
  const meta = GENERATED_MODELS[model]
  assert.ok(meta)
  const view = buildSessionCost(
    { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000 },
    { lastUsed: { provider: 'opencode-go', model }, next: null },
  )
  assert.ok(view)
  assert.equal(view.free, false)
  assert.equal(view.partial, false)
  assert.equal(view.total, meta.cost.input + meta.cost.output)
  assert.match(view.value, /^≈\$/)
})

test('reports a free model as Free', () => {
  const view = buildSessionCost(
    { uncachedInputTokens: 1000, outputTokens: 100 },
    { lastUsed: { provider: 'opencode-go', model: 'minimax-m3.1-flash-free' }, next: null },
  )
  assert.ok(view)
  assert.equal(view.free, true)
  assert.equal(view.value, 'Free')
})

test('marks unpriced cache-write tokens as a lower bound', () => {
  const view = buildSessionCost(
    { uncachedInputTokens: 1000, cacheWriteTokens: 500 },
    { lastUsed: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, next: null },
  )
  assert.ok(view)
  assert.equal(view.partial, true)
  assert.match(view.value, /^≥\$/)
})

test('never prices usage from another provider', () => {
  const view = buildSessionCost(
    { uncachedInputTokens: 1000 },
    { lastUsed: { provider: 'commandcode', model: 'deepseek-v4.1-flash' }, next: null },
  )
  assert.equal(view, undefined)
})

test('renders nothing without usage or a known model', () => {
  assert.equal(buildSessionCost(undefined, { lastUsed: null, next: null }), undefined)
  assert.equal(buildSessionCost({}, { lastUsed: null, next: null }), undefined)
  assert.equal(buildSessionCost(
    { uncachedInputTokens: 10 },
    { lastUsed: { provider: 'opencode-go', model: 'not-a-model' }, next: null },
  ), undefined)
})

test('prices per-request groups by their own model', () => {
  const meta = GENERATED_MODELS['deepseek-v4.1-flash']
  assert.ok(meta)
  const view = buildFactsCost({
    groups: [
      {
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        tokens: { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      {
        provider: 'opencode-go',
        model: 'beam-free',
        tokens: { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ],
  })
  assert.ok(view)
  assert.equal(view.total, meta.cost.input + meta.cost.output)
  assert.equal(view.free, false)
  assert.match(view.value, /^≈\$/)
  assert.match(view.title, /beam-free/)
})

test('reports a free-only per-request session as Free', () => {
  const view = buildFactsCost({
    groups: [{
      provider: 'opencode-go',
      model: 'beam-free',
      tokens: { uncachedInputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }],
  })
  assert.ok(view)
  assert.equal(view.value, 'Free')
})

test('accepts the projection internal state as well as the wire view', () => {
  const group = {
    provider: 'opencode-go',
    model: 'beam-free',
    tokens: { uncachedInputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }
  const view = buildFactsCost({
    facts: { groups: [group] },
  } as unknown as Parameters<typeof buildFactsCost>[0])
  assert.ok(view)
  assert.equal(view.value, 'Free')
})
