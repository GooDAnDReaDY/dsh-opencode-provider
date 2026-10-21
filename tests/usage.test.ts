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
