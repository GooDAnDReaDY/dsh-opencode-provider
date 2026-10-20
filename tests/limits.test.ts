import assert from 'node:assert/strict'
import test from 'node:test'

import { describeModel, effectiveModel } from '../src/catalog.ts'
import { resolveConfig } from '../src/config.ts'
import { GENERATED_MODELS } from '../src/models.generated.ts'
import {
  GO_LIMITS,
  describeLimitsFull,
  describeLimitsShort,
  formatRequests,
  limitsFor,
} from '../src/subscription-limits.ts'

test('every limit row names a model in the generated catalog', () => {
  for (const id of Object.keys(GO_LIMITS)) {
    assert.ok(GENERATED_MODELS[id], `unknown model in GO_LIMITS: ${id}`)
  }
})

test('DeepSeek limits match the published table', () => {
  const limits = limitsFor('deepseek-v4.1-flash')
  assert.ok(limits)
  assert.equal(limits.go.monthlyUsd, 80)
  assert.equal(limits.go.fiveHour, 34_670)
  assert.equal(limits.go.weekly, 86_670)
  assert.equal(limits.go.monthly, 173_330)
  assert.equal(limits.goPlus.monthlyUsd, 160)
  assert.equal(limits.goPlus.fiveHour, 69_330)
  assert.match(describeLimitsFull(limits), /Go: \$80\/mo/)
  assert.match(describeLimitsFull(limits), /Go Plus: \$160\/mo/)
})

test('free models are unlimited', () => {
  const limits = limitsFor('minimax-m3.1-flash-free')
  assert.ok(limits)
  assert.equal(limits.go.monthlyUsd, 'unlimited')
  assert.equal(formatRequests(limits.go.fiveHour), '∞')
})

test('formatting stays compact', () => {
  assert.equal(formatRequests(169), '169')
  assert.equal(formatRequests(6_320), '6.3K')
  assert.equal(formatRequests(226_600), '226.6K')
  assert.equal(formatRequests('unlimited'), '∞')
})

test('the model description carries Go limits only on the Go route', () => {
  const config = resolveConfig({})
  const model = effectiveModel('deepseek-v4.1-flash', config)
  const go = describeModel(model, 'opencode-go')
  const console = describeModel(model, 'opencode')
  assert.match(go, /Go 34\.7K\/5h/)
  assert.match(go, /86\.7K\/wk/)
  assert.equal(console.includes('Go 34.7K'), false)
  assert.equal(describeLimitsShort(limitsFor('deepseek-v4.1-flash')!).startsWith('Go '), true)
})
