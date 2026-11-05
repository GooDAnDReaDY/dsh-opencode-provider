import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error plain .mjs script module
import { validateManifest } from '../scripts/test-engines.mjs'

const files = [
  'package/package.json',
  'package/lib/index.js',
  'package/lib/index.d.ts',
  'package/lib/client.js',
]

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: '@goodandready/dsh-opencode-provider',
    version: '0.5.34',
    engines: { node: '>=22', dsh: '>=0.2.1-rc.2 <0.2.3-0' },
    dsh: { compatibility: { dshReleases: { '0.2.2-rc.1': 'compatible' } } },
    ...overrides,
  }
}

test('accepts a production-only candidate with a declared DSH matrix', () => {
  const result = validateManifest(manifest(), files)
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.range, '>=0.2.1-rc.2 <0.2.3-0')
})

test('rejects a candidate without a DSH range or releases', () => {
  const result = validateManifest(manifest({ engines: { node: '>=22' }, dsh: {} }), files)
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /engines\.dsh/)
  assert.match(result.errors.join('\n'), /dshReleases/)
})

test('rejects test and worktree content in a candidate', () => {
  const result = validateManifest(manifest(), [...files, 'package/tests/core.test.ts', 'package/src/index.ts'])
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /forbidden package content package\/tests/)
  assert.match(result.errors.join('\n'), /forbidden package content package\/src/)
})

test('reports every missing production entry point', () => {
  const result = validateManifest(manifest(), ['package/package.json'])
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /missing package\/lib\/index\.js/)
  assert.match(result.errors.join('\n'), /missing package\/lib\/client\.js/)
})
