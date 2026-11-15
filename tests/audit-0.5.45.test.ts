import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

import { OpenCodeAdapter } from '../src/adapter.ts'
import { effectiveModel } from '../src/catalog.ts'
import { DEFAULT_USER_AGENT, resolveConfig, type Config } from '../src/config.ts'
import { classifyResponseError } from '../src/errors.ts'
import { selectRequestImages } from '../src/images.ts'
import { isLocalHostname, isLoopbackHostname } from '../src/local-host.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from '../src/provider-ids.ts'
import { buildAnthropicBody } from '../src/transports/anthropic.ts'
import { buildGoogleBody } from '../src/transports/google.ts'
import { buildResponsesBody } from '../src/transports/responses.ts'

const testDir = mkdtempSync(join(tmpdir(), 'dsh-opencode-audit-'))
process.env.DSH_HOME = testDir
let pathSeq = 0
function cooldownPath(): string {
  return join(testDir, `cooldowns-${pathSeq++}.json`)
}
function stickyPath(): string {
  return join(testDir, `sticky-${pathSeq++}.json`)
}
after(() => { rmSync(testDir, { recursive: true, force: true }) })

function resolved(overrides: Config = {}) {
  return resolveConfig({
    apiKeyEnv: 'OPENCODE_TEST_KEY',
    apiBase: 'https://example.test/console',
    goApiBase: 'https://example.test/go',
    goZenBase: 'https://example.test/zen/go/v1',
    requestTimeoutMs: 5000,
    ...overrides,
  })
}

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: GO_PROVIDER,
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ...overrides,
  } as GenerateOptions
}

function imageRef(id: string, bytes: number): ImageAttachmentRef {
  return {
    attachmentId: id,
    mediaType: 'image/png',
    bytes,
    width: 100,
    height: 100,
  } as ImageAttachmentRef
}

function chatStream(text = 'OK'): string {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }],
  })}\n\ndata: [DONE]\n\n`
}

function adapterWith(
  fetchImpl: typeof fetch,
  paths: { cooldowns: string; sticky: string },
  record?: (provider: string, model: string, purpose?: string, account?: string, reason?: string) => void,
  overrides: Config = {},
): OpenCodeAdapter {
  return new OpenCodeAdapter({
    config: () => resolved(overrides),
    resolveKey: async () => ({ key: 'good', source: 'test' }),
    resolveKeys: async () => [
      { key: 'bad', source: 'test', label: 'bad' },
      { key: 'good', source: 'test', label: 'good' },
    ],
    fetchImpl,
    recordRequest: record ?? (() => {}),
    cooldownPath: paths.cooldowns,
    stickyPath: paths.sticky,
  })
}

async function collect(adapter: OpenCodeAdapter, sessionId: string): Promise<void> {
  for await (const _chunk of adapter.stream(options({ sessionId: sessionId as never }))) {
    // Drain the stream.
  }
}

test('a 127.* hostname that is not a literal IP is not local', () => {
  assert.equal(isLoopbackHostname('127.0.0.1.attacker.example'), false)
  assert.equal(isLocalHostname('127.0.0.1.attacker.example'), false)
  assert.equal(isLocalHostname('127.0.0.1'), true)
  assert.equal(isLocalHostname('127.1.2.3'), true)
  assert.equal(isLocalHostname('::1'), true)
  assert.equal(isLocalHostname('localhost'), true)
})

test('in-band rate-limit errors classify as RATE_LIMIT', () => {
  const error = classifyResponseError(
    200,
    JSON.stringify({ error: { type: 'rate_limit', message: 'Rate limited' } }),
    new Headers(),
  )
  assert.equal(error.code, 'RATE_LIMIT')
})

test('Anthropic falls back to the model cap when maxOutputTokens is 0', () => {
  const config = resolved({ maxOutputTokens: 0 })
  const model = effectiveModel('claude-haiku-5-5', config)
  const body = buildAnthropicBody(options(), model, config)
  assert.equal(body.max_tokens, model.maxTokens)
})

test('every transport normalizes an object-root tool schema', () => {
  const config = resolved()
  const tool = {
    name: 'probe',
    description: 'probe',
    parameters: { properties: { query: { type: 'string' } } },
  } as unknown as ToolSchema

  const anthropic = buildAnthropicBody(options({ tools: [tool] }), effectiveModel('claude-haiku-5-5', config), config)
  assert.equal((anthropic.tools as Array<Record<string, any>>)[0]?.input_schema.type, 'object')

  const responses = buildResponsesBody(options({ tools: [tool] }), effectiveModel('gpt-6-luna', config), config)
  assert.equal((responses.tools as Array<Record<string, any>>)[0]?.parameters.type, 'object')

  const google = buildGoogleBody(options({ tools: [tool] }), effectiveModel('gemini-4-argon-contributor', config), config)
  const declarations = (google.tools as Array<{ functionDeclarations: Array<Record<string, any>> }>)[0]?.functionDeclarations
  assert.equal(declarations?.[0]?.parameters.type, 'object')
})

test('reasoning efforts are advertised only where the transport honors them', async () => {
  const adapter = adapterWith(
    (async () => new Response(chatStream())) as typeof fetch,
    { cooldowns: cooldownPath(), sticky: stickyPath() },
  )
  assert.equal((await adapter.resolveModel(GO_PROVIDER, 'gemini-4-argon-contributor')).reasoning, undefined)
  assert.equal((await adapter.resolveModel(GO_PROVIDER, 'minimax-m2.7')).reasoning, undefined)
  assert.notEqual((await adapter.resolveModel(GO_PROVIDER, 'claude-haiku-5-5')).reasoning, undefined)
  assert.notEqual((await adapter.resolveModel(CONSOLE_PROVIDER, 'deepseek-v4.1-flash')).reasoning, undefined)
})

test('quota cooldowns are visible and survive a restart', async () => {
  const paths = { cooldowns: cooldownPath(), sticky: stickyPath() }
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
    if (authorization.endsWith('bad')) {
      return new Response(JSON.stringify({ error: { type: 'quota', message: 'quota exhausted' } }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(chatStream(), { headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch

  const adapter = adapterWith(fetchImpl, paths)
  await collect(adapter, 'session-quota')
  await adapter.flushCooldowns()
  assert.equal(adapter.accountHealth('bad')?.reason, 'quota')

  const restored = adapterWith(fetchImpl, paths)
  assert.equal(restored.accountHealth('bad')?.reason, 'quota')
})

test('the last successful account is promoted for a new conversation', async () => {
  const reasons: string[] = []
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
    if (authorization.endsWith('bad')) {
      return new Response(JSON.stringify({ error: { type: 'rate_limit', message: 'slow down' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '1' },
      })
    }
    return new Response(chatStream(), { headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch

  const adapter = adapterWith(
    fetchImpl,
    { cooldowns: cooldownPath(), sticky: stickyPath() },
    (_provider, _model, _purpose, _account, reason) => { if (reason !== undefined) reasons.push(reason) },
  )
  await collect(adapter, 'session-one')
  await collect(adapter, 'session-two')
  assert.ok(reasons.includes('promoted'), `expected promoted in ${reasons.join(',')}`)
})

test('large screenshots that fit after normalization are kept', () => {
  const policy = {
    maxImages: 50,
    maxRequestImageBytes: 24 * 1024 * 1024,
    requestImageMaxBytes: 1024 * 1024,
    requestImagePixelBudget: 1568 * 1568,
  }
  const refs = Array.from({ length: 7 }, (_, index) => imageRef(`shot-${index}`, 3 * 1024 * 1024))
  const selected = selectRequestImages(refs, undefined, policy)
  assert.equal(selected.dropped.length, 0)
  assert.equal(selected.kept.length, 7)
})

test('the product user agent tracks the package version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  assert.equal(DEFAULT_USER_AGENT, `dsh-opencode-provider/${manifest.version}`)
})
