import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanAccounts } from '../src/routes-values.ts'
import { createProxyFetch, normalizeProxyUrl } from '../src/proxy.ts'

test('normalizes supported proxy addresses and rejects unsafe shapes', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890/')
  assert.equal(normalizeProxyUrl('socks5://proxy.local:1080'), 'socks5://proxy.local:1080')
  assert.equal(normalizeProxyUrl('  '), '')
  assert.throws(() => normalizeProxyUrl('ftp://proxy.local:21'), /http:\/\//)
  assert.throws(() => normalizeProxyUrl('http://proxy.local:8080/path'), /without a path/)
  assert.throws(() => normalizeProxyUrl('http://user:pass@proxy.local:8080'), /credentials/)
})

test('proxy fetch adds a dispatcher and disposes cleanly', async () => {
  const seen: Array<RequestInit & { dispatcher?: unknown }> = []
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init as RequestInit & { dispatcher?: unknown })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const proxy = createProxyFetch(() => 'http://127.0.0.1:7890', base)

  await proxy.fetch('https://example.test/v1/models')
  assert.equal(seen.length, 1)
  assert.notEqual(seen[0]?.dispatcher, undefined)

  await proxy.dispose()
  await assert.rejects(() => proxy.fetch('https://example.test'), /disposed/)
})

test('account normalization enforces the 20-slot cap', () => {
  const accounts = Array.from({ length: 25 }, (_, index) => ({
    label: `account-${index}`,
    apiKeyEnv: `KEY_${index}`,
  }))
  assert.equal(cleanAccounts(accounts).length, 20)
})
