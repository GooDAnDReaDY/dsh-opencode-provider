import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'

import { TUI_ACCOUNT_AUTO, applyOpenCodeTuiSettings, buildOpenCodeTuiSection, type OpenCodeTuiSettingsDeps } from '../src/tui-settings.ts'

function deps(): OpenCodeTuiSettingsDeps {
  return {
    ns: 'llm-opencode',
    apiKeyRef: () => 'OPENCODE_API_KEY',
    accountSlots: () => [{ id: 'Go #2', label: 'Go #2' }],
    visibleModels: () => ['deepseek-v4.1-flash'],
    activeAccount: () => '',
    filterModelsByPlan: () => true,
    quotaFallbackModel: () => '',
    stickySession: () => true,
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

test('refreshes the section when settings change outside the TUI', async () => {
  let apiKeyRef = 'FIRST_REF'
  let registrations = 0
  let cleanup: (() => void) | undefined
  const service = {
    register: () => {
      registrations += 1
      return () => {}
    },
  }
  const ctx = {
    get: (name: string) => name === 'tuiSettingsSections' ? service : undefined,
    effect: (factory: () => () => void) => { cleanup = factory() },
  } as unknown as Context

  const refresh = applyOpenCodeTuiSettings(ctx, {
    ...deps(),
    apiKeyRef: () => apiKeyRef,
    refreshMs: 5,
  })
  assert.ok(refresh)
  assert.equal(registrations, 1)

  apiKeyRef = 'SECOND_REF'
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(registrations >= 2)
  cleanup?.()
})

test('exposes quota fallback and sticky routing settings', () => {
  const section = buildOpenCodeTuiSection({
    ...deps(),
    quotaFallbackModel: () => 'beam-free',
    stickySession: () => false,
  })
  const fallback = section.fields.find((entry) => entry.path[0] === 'quotaFallbackModel')
  const sticky = section.fields.find((entry) => entry.path[0] === 'stickySession')
  assert.ok(fallback)
  assert.equal(fallback.format?.('ignored'), 'beam-free')
  assert.deepEqual(fallback.parse?.(''), { kind: 'clear' })
  assert.ok(sticky)
  assert.equal(sticky.format?.(false), 'false')
  assert.deepEqual(sticky.parse?.('true'), { kind: 'set', value: true })
})

test('invalid timeouts are rejected', () => {
  const field = buildOpenCodeTuiSection(deps()).fields.find((entry) => entry.path[0] === 'requestTimeoutMs')
  assert.ok(field)
  assert.equal(field.parse?.('0'), undefined)
  assert.equal(field.parse?.('abc'), undefined)
  assert.deepEqual(field.parse?.(''), { kind: 'clear' })
  assert.deepEqual(field.parse?.('5000'), { kind: 'set', value: 5000 })
})
