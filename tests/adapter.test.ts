import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import type { ToolSchema } from '@deepseek-ai/dsh-llm'

import { OpenCodeAdapter } from '../src/adapter.ts'
import { resolveConfig } from '../src/config.ts'

const testDir = mkdtempSync(join(tmpdir(), 'dsh-opencode-adapter-'))
let cooldownSeq = 0
function testCooldownPath(): string {
  return join(testDir, `cooldowns-${cooldownSeq++}.json`)
}
after(() => { rmSync(testDir, { recursive: true, force: true }) })

function streamOf(text = 'OK'): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }],
  })}\n\ndata: [DONE]\n\n`
}

function adapterWith(
  fetchImpl: typeof fetch,
  recordRequest?: (provider: string, model: string) => void,
  cooldownPath = testCooldownPath(),
  warn?: (message: string) => void,
) {
  const config = resolveConfig({
    apiKeyEnv: 'OPENCODE_TEST_KEY',
    goApiBase: 'https://example.test/go',
    goZenBase: 'https://example.test/zen/go/v1',
    requestTimeoutMs: 5000,
  })
  return new OpenCodeAdapter({
    config: () => config,
    resolveKey: async () => ({ key: 'good', source: 'test' }),
    resolveKeys: async () => [
      { key: 'bad', source: 'test', label: 'bad' },
      { key: 'good', source: 'test', label: 'good' },
    ],
    fetchImpl,
    recordRequest: recordRequest ?? (() => {}),
    cooldownPath,
    ...(warn === undefined ? {} : { warn }),
  })
}

async function collect(
  adapter: OpenCodeAdapter,
  model = 'deepseek-v4.1-flash',
  tools?: ToolSchema[],
) {
  let text = ''
  let finish: unknown
  for await (const chunk of adapter.stream({
    provider: 'opencode-go',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    maxTokens: 8,
    ...(tools === undefined ? {} : { tools }),
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish') finish = chunk.reason
  }
  return { text, finish }
}

test('warns once when the provider tool cap drops declarations', async () => {
  const warnings: string[] = []
  const adapter = adapterWith(
    (async () => new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch,
    undefined,
    testCooldownPath(),
    (message) => warnings.push(message),
  )
  const tools = Array.from({ length: 130 }, (_, index) => ({
    name: `tool-${index}`,
    description: `tool-${index}`,
    parameters: { type: 'object', properties: {} },
  })) as ToolSchema[]

  await collect(adapter, 'deepseek-v4.1-flash', tools)
  await collect(adapter, 'deepseek-v4.1-flash', tools)

  assert.equal(warnings.length, 1)
  assert.match(warnings[0] ?? '', /128/)
})

test('rotates to the next account on a pre-stream quota rejection', async () => {
  const seen: string[] = []
  const adapter = adapterWith((async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    seen.push(headers.authorization ?? '')
    if (headers.authorization === 'Bearer bad') {
      return new Response(JSON.stringify({
        error: { type: 'quota_exceeded', message: 'Monthly usage limit reached' },
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response(streamOf(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch)

  const result = await collect(adapter)
  assert.deepEqual(seen, ['Bearer bad', 'Bearer good'])
  assert.equal(result.text, 'OK')
  assert.deepEqual(result.finish, { kind: 'stop' })
  const health = adapter.accountHealth('bad')
  assert.equal(health?.reason, 'quota')
  assert.ok((health?.coolingUntil ?? 0) > Date.now())
})

test('marks a quota cooldown even when no account remains to rotate to', async () => {
  const adapter = new OpenCodeAdapter({
    config: () => resolveConfig({
      apiKeyEnv: 'OPENCODE_TEST_KEY',
      goApiBase: 'https://example.test/go',
      goZenBase: 'https://example.test/zen/go/v1',
      requestTimeoutMs: 5000,
    }),
    resolveKey: async () => ({ key: 'only', source: 'test' }),
    resolveKeys: async () => [{ key: 'only', source: 'test', label: 'only' }],
    fetchImpl: (async () => new Response(JSON.stringify({
      error: { type: 'quota_exceeded', message: 'Go usage limit exceeded' },
    }), { status: 400, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    recordRequest: () => {},
    cooldownPath: testCooldownPath(),
  })

  await assert.rejects(() => collect(adapter), (error: unknown) => {
    return error instanceof Error && (error as { code?: string }).code === 'QUOTA'
  })
  assert.equal(adapter.accountHealth('only')?.reason, 'quota')
})

test('persists cooldowns across adapter instances', async () => {
  const cooldownPath = testCooldownPath()
  const first = adapterWith((async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    if (headers.authorization === 'Bearer bad') {
      return new Response(JSON.stringify({
        error: { type: 'quota_exceeded', message: 'Go usage limit exceeded' },
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response(streamOf(), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch, undefined, cooldownPath)

  const result = await collect(first)
  assert.equal(result.text, 'OK')
  assert.equal(first.accountHealth('bad')?.reason, 'quota')
  await first.flushCooldowns()

  const second = adapterWith(
    (async () => new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch,
    undefined,
    cooldownPath,
  )
  const health = second.accountHealth('bad')
  assert.equal(health?.reason, 'quota')
  assert.ok((health?.coolingUntil ?? 0) > Date.now())
})

test('records one request per stream call', async () => {
  const recorded: string[] = []
  const adapter = adapterWith(
    (async () => new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch,
    (provider, model) => recorded.push(`${provider}/${model}`),
  )

  await collect(adapter)
  assert.deepEqual(recorded, ['opencode-go/deepseek-v4.1-flash'])
})

test('model-account rules make the matching key serve first', async () => {
  const seen: string[] = []
  const config = resolveConfig({
    apiKeyEnv: 'OPENCODE_TEST_KEY',
    goApiBase: 'https://example.test/go',
    goZenBase: 'https://example.test/zen/go/v1',
    requestTimeoutMs: 5000,
    modelAccountRules: [{ pattern: '*free*', account: 'free' }],
  })
  const adapter = new OpenCodeAdapter({
    config: () => config,
    resolveKey: async () => ({ key: 'default', source: 'test', label: 'default' }),
    resolveKeys: async () => [
      { key: 'default', source: 'test', label: 'default' },
      { key: 'free', source: 'test', label: 'free' },
    ],
    fetchImpl: (async (_url, init) => {
      const headers = init?.headers as Record<string, string>
      seen.push(headers.authorization ?? '')
      return new Response(streamOf(), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch,
    recordRequest: () => {},
    cooldownPath: testCooldownPath(),
  })

  const result = await collect(adapter, 'minimax-m3.1-flash-free')
  assert.equal(result.text, 'OK')
  assert.deepEqual(seen, ['Bearer free'])
})

test('rotates on a usage-limit 429 as well', async () => {
  const seen: string[] = []
  const adapter = adapterWith((async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    seen.push(headers.authorization ?? '')
    if (headers.authorization === 'Bearer bad') {
      return new Response(JSON.stringify({
        error: { type: 'rate_limit', message: 'Monthly usage limit reached' },
      }), { status: 429, headers: { 'content-type': 'application/json' } })
    }
    return new Response(streamOf('OK'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch)

  const result = await collect(adapter)
  assert.deepEqual(seen, ['Bearer bad', 'Bearer good'])
  assert.equal(result.text, 'OK')
})
