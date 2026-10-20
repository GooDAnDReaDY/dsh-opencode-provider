import assert from 'node:assert/strict'
import test from 'node:test'

import { matchModelAccount, orderKeysForModel } from '../src/account-rules.ts'
import { resolveConfig } from '../src/config.ts'
import type { ResolvedKey } from '../src/credentials.ts'

const keys: ResolvedKey[] = [
  { key: 'default', source: 'test', label: 'default' },
  { key: 'free', source: 'test', label: 'free' },
  { key: 'go', source: 'test', label: 'go' },
]

test('matches the first glob case-insensitively', () => {
  assert.equal(matchModelAccount('minimax-m3.1-flash-free', [
    { pattern: '*FREE*', account: 'free' },
    { pattern: '*', account: 'go' },
  ]), 'free')
  assert.equal(matchModelAccount('deepseek-v4.1-flash', [
    { pattern: '*free*', account: 'free' },
    { pattern: 'deepseek-*', account: 'go' },
  ]), 'go')
  assert.equal(matchModelAccount('deepseek-v4.1-flash', []), undefined)
})

test('pins the matching account and keeps fallbacks', () => {
  assert.deepEqual(
    orderKeysForModel(keys, 'minimax-free', [{ pattern: '*free*', account: 'free' }]).map((entry) => entry.label),
    ['free', 'default', 'go'],
  )
  assert.deepEqual(
    orderKeysForModel(keys, 'minimax-free', [{ pattern: '*free*', account: 'missing' }]).map((entry) => entry.label),
    ['default', 'free', 'go'],
  )
  assert.deepEqual(
    orderKeysForModel(keys, 'deepseek-v4.1-flash', [{ pattern: '*free*', account: 'free' }]).map((entry) => entry.label),
    ['default', 'free', 'go'],
  )
})

test('resolves and normalizes model-account rules', () => {
  const config = resolveConfig({
    modelAccountRules: [
      { pattern: ' *free* ', account: ' free ' },
      { pattern: '', account: 'x' },
    ],
  })
  assert.deepEqual(config.modelAccountRules, [{ pattern: '*free*', account: 'free' }])
})
