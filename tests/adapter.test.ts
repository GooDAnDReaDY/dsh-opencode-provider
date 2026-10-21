import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import type { ToolSchema } from '@deepseek-ai/dsh-llm'

import { OpenCodeAdapter } from '../src/adapter.ts'
import { resolveConfig, type Config } from '../src/config.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from '../src/provider-ids.ts'
import type { RequestOutcome } from '../src/request-log.ts'

const testDir = mkdtempSync(join(tmpdir(), 'dsh-opencode-adapter-'))
process.env.DSH_HOME = testDir
let cooldownSeq = 0
function testCooldownPath(): string {
  return join(testDir, `cooldowns-${cooldownSeq++}.json`)
}
function testStickyPath(): string {
  return join(testDir, `sticky-${cooldownSeq++}.json`)
}
after(() => { rmSync(testDir, { recursive: true, force: true }) })

function streamOf(text = 'OK'): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }],
  })}\n\ndata: [DONE]\n\n`
}

function adapterWith(
  fetchImpl: typeof fetch,
  recordRequest?: (
    provider: string,
    model: string,
    purpose?: string,
    account?: string,
    reason?: string,
    outcome?: RequestOutcome,
  ) => void,
  cooldownPath = testCooldownPath(),
  warn?: (message: string) => void,
  overrides: Partial<Config> = {},
  stickyPath = testStickyPath(),
) {
  const config = resolveConfig({
    apiKeyEnv: 'OPENCODE_TEST_KEY',
    apiBase: 'https://example.test/console',
    goApiBase: 'https://example.test/go',
    goZenBase: 'https://example.test/zen/go/v1',
    requestTimeoutMs: 5000,
    ...overrides,
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
    stickyPath,
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
    provider: GO_PROVIDER,
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
  assert.deepEqual(recorded, [`${GO_PROVIDER}/deepseek-v4.1-flash`])
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

test('falls back once to the configured free model on a Go quota error', async () => {
  const recorded: string[] = []
  const calls: Array<{ url: string; model: string }> = []
  const adapter = adapterWith(
    (async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string }
      const text = String(url)
      calls.push({ url: text, model: body.model ?? '' })
      if (text.includes('/go')) {
        return new Response(JSON.stringify({
          error: { type: 'quota_exceeded', message: 'Go usage limit exceeded' },
        }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return new Response(streamOf('fallback-ok'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch,
    (provider, model) => recorded.push(`${provider}/${model}`),
    testCooldownPath(),
    undefined,
    { quotaFallbackModel: 'beam-free' },
  )

  const result = await collect(adapter)
  assert.equal(result.text, 'fallback-ok')
  assert.ok(calls.some((call) => call.url.includes('/console') && call.model === 'beam-free'))
  assert.ok(recorded.includes(`${CONSOLE_PROVIDER}/beam-free`))
  const trace = adapter.routingTrace()
  assert.ok(trace.some((entry) => entry.reason === 'quota-fallback' && entry.ok))
  assert.ok(trace.some((entry) => !entry.ok && entry.error === 'QUOTA'))
})

test('persists the sticky account across adapter instances', async () => {
  const seen: string[] = []
  const stickyPath = testStickyPath()
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>
    const auth = headers.authorization ?? ''
    seen.push(auth)
    if (auth === 'Bearer bad') {
      return new Response(JSON.stringify({
        error: { type: 'quota_exceeded', message: 'Monthly usage limit reached' },
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch

  const first = adapterWith(
    fetchImpl,
    undefined,
    testCooldownPath(),
    undefined,
    {},
    stickyPath,
  )
  await collect(first)
  await first.flushSticky()

  const second = adapterWith(
    fetchImpl,
    undefined,
    testCooldownPath(),
    undefined,
    {},
    stickyPath,
  )
  await collect(second)
  assert.deepEqual(seen, ['Bearer bad', 'Bearer good', 'Bearer good'])
})

test('records success latency and TTFT for the request log', async () => {
  const outcomes: RequestOutcome[] = []
  const adapter = adapterWith(
    (async () => new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as typeof fetch,
    (_provider, _model, _purpose, _account, _reason, outcome) => {
      if (outcome !== undefined) outcomes.push(outcome)
    },
  )
  await collect(adapter)
  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0]?.ok, true)
  assert.ok((outcomes[0]?.latencyMs ?? -1) >= 0)
  assert.ok((outcomes[0]?.ttftMs ?? -1) >= 0)
  assert.equal(outcomes[0]?.error, undefined)
})

test('prefers the last successful account for the same conversation', async () => {
  const seen: string[] = []
  const adapter = adapterWith((async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    const auth = headers.authorization ?? ''
    seen.push(auth)
    if (auth === 'Bearer bad') {
      return new Response(JSON.stringify({
        error: { type: 'quota_exceeded', message: 'Monthly usage limit reached' },
      }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch, undefined, testCooldownPath(), undefined, { stickySession: true })

  await collect(adapter)
  await collect(adapter)
  assert.deepEqual(seen, ['Bearer bad', 'Bearer good', 'Bearer good'])
  const trace = adapter.routingTrace()
  assert.ok(trace.some((entry) => entry.reason === 'rotation' && entry.ok))
  assert.ok(trace.some((entry) => entry.reason === 'sticky' && entry.ok))
})

test('treats a free-tier rejection as a short rate-limit and rotates', async () => {
  const seen: string[] = []
  const adapter = adapterWith((async (_url, init) => {
    const headers = init?.headers as Record<string, string>
    const auth = headers.authorization ?? ''
    seen.push(auth)
    if (auth === 'Bearer bad') {
      return new Response(JSON.stringify({
        error: { type: 'FreeTierError', message: 'free tier can only be used from within OpenCode' },
      }), { status: 403, headers: { 'content-type': 'application/json' } })
    }
    return new Response(streamOf(), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }) as typeof fetch)

  const result = await collect(adapter)
  assert.equal(result.text, 'OK')
  assert.deepEqual(seen, ['Bearer bad', 'Bearer good'])
  const health = adapter.accountHealth('bad')
  assert.equal(health?.reason, 'rate-limit')
  assert.ok((health?.coolingUntil ?? 0) < Date.now() + 2 * 60 * 1000)
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
