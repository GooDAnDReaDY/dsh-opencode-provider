import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveConfig } from '../src/config.ts'
import { createUsageReader } from '../src/usage.ts'

const config = resolveConfig({ usageUrl: 'https://usage.test', userAgent: 'test' })

test('reads usage per key and caches each key separately', async () => {
  const calls: string[] = []
  const fetchImpl = (async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    calls.push(headers.authorization ?? '')
    return new Response(JSON.stringify({
      usage: {
        rolling: { percent: 10 },
        weekly: { percent: 20 },
        monthly: { percent: 30 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  let resolved = 0
  const reader = createUsageReader(
    () => config,
    async () => { resolved += 1; return { key: 'active', source: 'test' } },
    fetchImpl,
  )

  const first = await reader('opencode-go')
  const second = await reader('opencode-go')
  assert.equal(first?.report?.windows.fiveHour?.percentUsed, 10)
  assert.equal(second, first)
  assert.equal(calls.length, 1)

  await reader('opencode-go', 'other')
  assert.equal(calls.length, 2)
  assert.equal(calls[1], 'Bearer other')
  assert.ok(resolved >= 1)
})

test('classifies expired and rejected keys from usage responses', async () => {
  const fetchImpl = (async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    if (headers.authorization === 'Bearer expired') {
      return new Response('{"error":{"message":"This API key has expired"}}', { status: 401 })
    }
    if (headers.authorization === 'Bearer invalid') {
      return new Response('{"error":{"message":"invalid key"}}', { status: 403 })
    }
    return new Response('{"usage":{"rolling":{"percent":1}}}', { status: 200 })
  }) as typeof fetch
  const reader = createUsageReader(
    () => config,
    async () => ({ key: 'active', source: 'test' }),
    fetchImpl,
  )
  assert.equal((await reader('opencode-go', 'expired'))?.keyStatus, 'expired')
  assert.equal((await reader('opencode-go', 'invalid'))?.keyStatus, 'invalid')
  assert.equal((await reader('opencode-go', 'ok'))?.keyStatus, 'ok')
})

test('keeps the last successful report when a later refresh fails', async () => {
  let online = true
  const fetchImpl = (async () => {
    if (!online) throw new Error('offline')
    return new Response(JSON.stringify({
      usage: { rolling: { percent: 11 }, weekly: { percent: 12 }, monthly: { percent: 13 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const reader = createUsageReader(
    () => config,
    async () => ({ key: 'active', source: 'test' }),
    fetchImpl,
  )

  const first = await reader('opencode-go')
  assert.equal(first?.report?.windows.monthly?.percentUsed, 13)
  assert.equal(first?.stale, false)

  online = false
  reader.clear()
  const stale = await reader('opencode-go')
  assert.equal(stale?.report?.windows.monthly?.percentUsed, 13)
  assert.equal(stale?.stale, true)
  assert.equal(stale?.error, 'offline')
  assert.ok((stale?.lastSuccessAt ?? 0) > 0)
})

test('fail-open per key and clear the cache on demand', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    throw new Error('offline')
  }) as typeof fetch
  const reader = createUsageReader(
    () => config,
    async () => ({ key: 'active', source: 'test' }),
    fetchImpl,
  )

  const first = await reader('opencode-go', 'bad')
  const second = await reader('opencode-go', 'bad')
  assert.equal(first?.error, 'offline')
  assert.equal(second?.error, 'offline')
  assert.equal(calls, 2)

  reader.clear()
  await reader('opencode-go', 'bad')
  assert.equal(calls, 4)
})

test('retries one transient network failure before caching the result', async () => {
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    if (calls === 1) throw new TypeError('fetch failed')
    return new Response(JSON.stringify({
      usage: { rolling: { percent: 7 }, weekly: { percent: 8 }, monthly: { percent: 9 } },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const reader = createUsageReader(
    () => config,
    async () => ({ key: 'active', source: 'test' }),
    fetchImpl,
  )

  const result = await reader('opencode-go')
  assert.equal(result?.error, undefined)
  assert.equal(result?.report?.windows.fiveHour?.percentUsed, 7)
  assert.equal(calls, 2)
})

test('ignores providers other than opencode-go', async () => {
  const reader = createUsageReader(
    () => config,
    async () => ({ key: 'active', source: 'test' }),
    (async () => { throw new Error('must not be called') }) as typeof fetch,
  )
  assert.equal(await reader('opencode'), undefined)
})
