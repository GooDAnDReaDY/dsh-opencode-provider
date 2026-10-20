import assert from 'node:assert/strict'
import test from 'node:test'

import { describeModel, effectiveModel, modelInGoPlan, sortForPicker } from '../src/catalog.ts'
import { resolveConfig } from '../src/config.ts'

const on = resolveConfig({ filterModelsByPlan: true })
const off = resolveConfig({ filterModelsByPlan: false })

test('defaults to hiding models outside the Go allowance', () => {
  assert.equal(resolveConfig({}).filterModelsByPlan, true)
})

test('Go and free models stay visible; a known Console model does not', () => {
  assert.equal(modelInGoPlan('deepseek-v4.1-flash', on), true)
  assert.equal(modelInGoPlan('beam-free', on), true)
  assert.equal(modelInGoPlan('minimax-m2.7', on), false)
  assert.equal(modelInGoPlan('minimax-m2.7', off), true)
})

test('unknown live models fail open under plan filtering', () => {
  assert.equal(modelInGoPlan('a-live-model-not-in-the-generated-table', on), true)
})

test('the Go picker filters out-of-plan models but unfiltered keeps them', () => {
  const ids = ['deepseek-v4.1-flash', 'beam-free', 'minimax-m2.7']
  const filtered = sortForPicker(ids, on, false, 'opencode-go')
  assert.ok(filtered.includes('deepseek-v4.1-flash'))
  assert.ok(filtered.includes('beam-free'))
  assert.ok(!filtered.includes('minimax-m2.7'))
  assert.deepEqual(sortForPicker(ids, on, true, 'opencode-go').sort(), [...ids].sort())
})

test('descriptions mark Go, Console and FREE', () => {
  assert.match(describeModel(effectiveModel('deepseek-v4.1-flash', on), 'opencode-go'), /\bGo\b/)
  assert.match(describeModel(effectiveModel('minimax-m2.7', on), 'opencode-go'), /\bConsole\b/)
  assert.match(describeModel(effectiveModel('beam-free', on), 'opencode-go'), /\bFREE\b/)
})
