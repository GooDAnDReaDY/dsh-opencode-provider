import assert from 'node:assert/strict'
import test from 'node:test'

import { catalogReleaseDate, clearCatalogCache, describeModel, discoverModelIds, effectiveModel, isNewRelease, modelInGoPlan, sortForPicker } from '../src/catalog.ts'
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

test('identifies releases from the last seven UTC days', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  assert.equal(isNewRelease('2026-11-04', now), true)
  assert.equal(isNewRelease('2026-10-30', now), true)
  assert.equal(isNewRelease('2026-10-28', now), false)
  assert.equal(isNewRelease('2026-11-06', now), false)
  assert.equal(isNewRelease(undefined, now), false)
})

test('learns release dates from the live catalog', async () => {
  clearCatalogCache()
  const config = resolveConfig({ apiBase: 'https://catalog.test' })
  const fetchImpl = (async () => new Response(JSON.stringify({
    data: [
      { id: 'fresh-model', release_date: '2026-11-04' },
      { id: 'created-model', created: 1793740016 },
      { id: 'plain-model' },
      { id: 42, release_date: '2026-11-04' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const ids = await discoverModelIds('opencode', config, undefined, fetchImpl)
  assert.deepEqual(ids, ['fresh-model', 'created-model', 'plain-model'])
  assert.equal(catalogReleaseDate('opencode', 'fresh-model', config), '2026-11-04')
  assert.ok(catalogReleaseDate('opencode', 'created-model', config) !== undefined)
  assert.equal(catalogReleaseDate('opencode', 'plain-model', config), undefined)
  clearCatalogCache()
})

test('descriptions mark Go, Console and FREE', () => {
  assert.match(describeModel(effectiveModel('deepseek-v4.1-flash', on), 'opencode-go'), /\bGo\b/)
  assert.match(describeModel(effectiveModel('minimax-m2.7', on), 'opencode-go'), /\bConsole\b/)
  assert.match(describeModel(effectiveModel('beam-free', on), 'opencode-go'), /\bFREE\b/)
})
