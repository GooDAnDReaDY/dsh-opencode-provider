import assert from 'node:assert/strict'
import test from 'node:test'

import { TUI_ACCOUNT_AUTO, buildOpenCodeTuiSection, type OpenCodeTuiSettingsDeps } from '../src/tui-settings.ts'

function deps(): OpenCodeTuiSettingsDeps {
  return {
    ns: 'llm-opencode',
    apiKeyRef: () => 'OPENCODE_API_KEY',
    accountSlots: () => [{ id: 'Go #2', label: 'Go #2' }],
    visibleModels: () => ['deepseek-v4.1-flash'],
    activeAccount: () => '',
    filterModelsByPlan: () => true,
  }
}

test('builds a secret API-key field bound to the credential ref', () => {
  const section = buildOpenCodeTuiSection(deps())
  assert.equal(section.ns, 'llm-opencode')
  assert.equal(section.title, 'OpenCode')
  const field = section.fields.find((entry) => entry.path[0] === 'apiKey')
  assert.ok(field)
  assert.deepEqual(field.secret, { ref: 'OPENCODE_API_KEY' })
  assert.equal(field.group, 'connection')
})

test('formats and parses the visible-model allowlist', () => {
  const field = buildOpenCodeTuiSection(deps()).fields.find((entry) => entry.path[0] === 'visibleModels')
  assert.ok(field)
  assert.equal(field.format?.('ignored'), 'deepseek-v4.1-flash')
  assert.deepEqual(field.parse?.('beat-free, deepseek-v4.1-flash'), {
    kind: 'set',
    value: ['beat-free', 'deepseek-v4.1-flash'],
  })
  assert.deepEqual(field.parse?.('  '), { kind: 'clear' })
})

test('active account supports auto and explicit labels', () => {
  const field = buildOpenCodeTuiSection(deps()).fields.find((entry) => entry.path[0] === 'activeAccount')
  assert.ok(field)
  assert.equal(field.format?.(''), TUI_ACCOUNT_AUTO)
  assert.ok(field.options?.some((option) => option.value === 'Go #2'))
  assert.deepEqual(field.parse?.('auto'), { kind: 'clear' })
  assert.deepEqual(field.parse?.('Go #2'), { kind: 'set', value: 'Go #2' })
})

test('invalid timeouts are rejected', () => {
  const field = buildOpenCodeTuiSection(deps()).fields.find((entry) => entry.path[0] === 'requestTimeoutMs')
  assert.ok(field)
  assert.equal(field.parse?.('0'), undefined)
  assert.equal(field.parse?.('abc'), undefined)
  assert.deepEqual(field.parse?.(''), { kind: 'clear' })
  assert.deepEqual(field.parse?.('5000'), { kind: 'set', value: 5000 })
})
