import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanAccounts } from '../src/routes-values.ts'
import { buildProxyUrl, createProxyFetch, normalizeProxyUrl, normalizeProxyUsername } from '../src/proxy.ts'

test('normalizes supported proxy addresses and rejects unsafe shapes', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890/')
  assert.equal(normalizeProxyUrl('socks5://proxy.local:1080'), 'socks5://proxy.local:1080')
  assert.equal(normalizeProxyUrl('  '), '')
  assert.throws(() => normalizeProxyUrl('ftp://proxy.local:21'), /http:\/\//)
  assert.throws(() => normalizeProxyUrl('http://proxy.local:8080/path'), /without a path/)
  assert.throws(() => normalizeProxyUrl('http://user:pass@proxy.local:8080'), /credentials/)
})

test('builds an authenticated proxy URL only in memory', () => {
  assert.equal(
    buildProxyUrl('http://proxy.local:8080', 'alice', 'p@ss:word'),
    'http://alice:p%40ss%3Aword@proxy.local:8080/',
  )
  assert.equal(buildProxyUrl('socks5://proxy.local:1080', '', 'secret'), 'socks5://proxy.local:1080')
  assert.equal(normalizeProxyUsername(' alice '), 'alice')
  assert.throws(() => normalizeProxyUsername('a:b'), /colon/)
  assert.throws(() => normalizeProxyUsername('bad\nname'), /control/)
})

test('proxy fetch adds a dispatcher and disposes cleanly', async () => {
  const seen: Array<RequestInit & { dispatcher?: unknown }> = []
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init as RequestInit & { dispatcher?: unknown })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const proxy = createProxyFetch(() => 'http://127.0.0.1:7890', undefined, base)

  await proxy.fetch('https://example.test/v1/models')
  assert.equal(seen.length, 1)
  assert.notEqual(seen[0]?.dispatcher, undefined)

  const asyncProxy = createProxyFetch(async () => 'http://127.0.0.1:7891', undefined, base)
  await asyncProxy.fetch('https://example.test/v1/models')
  assert.equal(seen.length, 2)
  await asyncProxy.dispose()

  const authed = createProxyFetch(
    () => 'http://proxy.local:8080',
    async () => ({ username: 'alice', password: 'secret' }),
    base,
  )
  await authed.fetch('https://example.test/v1/models')
  assert.equal(seen.length, 3)
  await authed.dispose()

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

test('createProxyFetch late-binds to globalThis.fetch dynamically when proxy is off', async () => {
  const originalFetch = globalThis.fetch
  let intercepted = false
  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      intercepted = true
      return new Response('{"ok":true}', { status: 200 })
    }) as typeof fetch

    const proxy = createProxyFetch(() => '')
    const response = await proxy.fetch('https://opencode.ai/zen/go/v1/models')
    assert.equal(intercepted, true)
    assert.equal(response.status, 200)
    await proxy.dispose()
  } finally {
    globalThis.fetch = originalFetch
  }
})
