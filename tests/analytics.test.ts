import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregateSessions, metadataOf } from '../src/analytics.ts'
import { GENERATED_MODELS } from '../src/models.generated.ts'
import { GO_PROVIDER } from '../src/provider-ids.ts'

const now = 1_792_500_000_000

test('aggregates OpenCode sessions by model and prices them', () => {
  const meta = GENERATED_MODELS['deepseek-v4.1-flash']
  assert.ok(meta)
  const report = aggregateSessions([{
    lastPromptAt: now - 1000,
    lastUsed: { provider: GO_PROVIDER, model: 'deepseek-v4.1-flash' },
    usage: { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stats: { turns: 2, steps: 4, llmMs: 1000, ttftMs: 100, decodeMs: 500 },
  }], 30, now)

  assert.equal(report.matchedSessions, 1)
  assert.equal(report.models.length, 1)
  const row = report.models[0]
  assert.ok(row)
  assert.equal(row.sessions, 1)
  assert.equal(row.turns, 2)
  assert.equal(row.steps, 4)
  assert.equal(row.cost, meta.cost.input + meta.cost.output)
  assert.equal(row.priced, true)
  assert.equal(row.partial, false)
})

test('free models report Free pricing and zero cost', () => {
  const report = aggregateSessions([{
    lastPromptAt: now - 1000,
    lastUsed: { provider: GO_PROVIDER, model: 'minimax-m3.1-flash-free' },
    usage: { uncachedInputTokens: 1000, outputTokens: 100 },
  }], 30, now)
  const row = report.models[0]
  assert.ok(row)
  assert.equal(row.free, true)
  assert.equal(row.cost, 0)
})

test('summarizes requests, days and sessions', () => {
  const report = aggregateSessions([{
    id: 'session-test',
    lastPromptAt: now - 1000,
    lastUsed: { provider: GO_PROVIDER, model: 'deepseek-v4.1-flash' },
    usage: { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000 },
    stats: { turns: 1, steps: 2, llmMs: 1000, ttftMs: 200, ttftSteps: 2 },
  }], 30, now)

  assert.equal(report.summary.sessions, 1)
  assert.equal(report.summary.requests, 2)
  assert.equal(report.summary.tokens, 2_000_000)
  assert.equal(report.summary.avgTtftMs, 100)
  assert.equal(report.summary.avgLatencyMs, 500)
  assert.equal(report.summary.errors, null)
  assert.equal(report.summary.successRate, null)
  assert.equal(report.days.length, 1)
  assert.equal(report.days[0]?.requests, 2)
  assert.equal(report.sessions.length, 1)
  assert.equal(report.sessions[0]?.id, 'session-test')
  assert.equal(report.sessions[0]?.requests, 2)
})

test('skips other providers and sessions outside the window', () => {
  const report = aggregateSessions([
    {
      lastPromptAt: now - 1000,
      lastUsed: { provider: 'deepseek-official', model: 'deepseek-flash' },
      usage: { uncachedInputTokens: 1_000_000, outputTokens: 100 },
    },
    {
      lastPromptAt: now - 1000,
      lastUsed: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      usage: { uncachedInputTokens: 1_000_000, outputTokens: 100 },
    },
    {
      lastPromptAt: now - 40 * 86_400_000,
      lastUsed: { provider: GO_PROVIDER, model: 'deepseek-v4.1-flash' },
      usage: { uncachedInputTokens: 1_000_000, outputTokens: 100 },
    },
  ], 30, now)
  assert.equal(report.scannedSessions, 3)
  assert.equal(report.matchedSessions, 0)
  assert.equal(report.models.length, 0)
})

test('reads only numeric metadata from a projection file', () => {
  const meta = metadataOf({
    record: {
      identity: { createdAt: now },
      rows: {
        tokenUsage: { val: { totals: { uncachedInputTokens: 10, outputTokens: 2 } } },
        modelSelection: { val: { lastUsed: { provider: GO_PROVIDER, model: 'm' } } },
        sessionStats: { val: { turns: 1, steps: 3 } },
        sessionListMetadata: { val: { lastPromptAt: now } },
      },
    },
  })
  assert.ok(meta)
  assert.equal(meta.usage?.uncachedInputTokens, 10)
  assert.equal(meta.usage?.outputTokens, 2)
  assert.equal(meta.lastUsed?.provider, GO_PROVIDER)
  assert.equal(meta.stats?.steps, 3)
  assert.equal(meta.lastPromptAt, now)
})
