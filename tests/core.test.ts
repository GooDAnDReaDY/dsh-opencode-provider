import assert from 'node:assert/strict'
import test from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import type { HostState } from '../src/client/api.ts'
import { authRefForEntry } from '../src/client/auth-ref.ts'
import { draftOf, patchOf, safeSame } from '../src/client/settings-draft.ts'
import { effectiveModel, effectiveMaxTokens, describeModel } from '../src/catalog.ts'
import { resolveConfig, type Config } from '../src/config.ts'
import { classifyResponseError } from '../src/errors.ts'
import { buildChatBody, buildMessages } from '../src/messages.ts'
import { buildAnthropicBody } from '../src/transports/anthropic.ts'
import { buildGoogleBody } from '../src/transports/google.ts'
import { buildResponsesBody } from '../src/transports/responses.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from '../src/provider-ids.ts'
import { accountRunway, estimateRunway } from '../src/quota-runway.ts'
import { endpointFor } from '../src/routing.ts'
import { openCodeSessionId } from '../src/session-id.ts'
import { normalizeUsage } from '../src/usage.ts'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

const base: Config = {
  apiKeyEnv: 'OPENCODE_API_KEY',
  userAgent: 'dsh-opencode-provider/test',
}

function resolved(overrides: Config = {}) {
  return resolveConfig({ ...base, ...overrides })
}

function options(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    ...overrides,
  } as GenerateOptions
}

test('plugin provider ids do not collide with the built-in pi-ai catalog', () => {
  assert.notEqual(CONSOLE_PROVIDER, 'opencode')
  assert.notEqual(GO_PROVIDER, 'opencode-go')
  assert.notEqual(CONSOLE_PROVIDER, GO_PROVIDER)
  assert.match(CONSOLE_PROVIDER, /^[a-z0-9-]+$/)
  assert.match(GO_PROVIDER, /^[a-z0-9-]+$/)
})

test('apply registers only the unique plugin provider ids', () => {
  const providers: Array<{ provider: string; displayName: string }> = []
  const adapters: string[] = []
  const ctx = {
    llm: {
      registerConfigurableProviders: (entries: typeof providers) => { providers.push(...entries) },
      registerAdapter: (ids: string[]) => { adapters.push(...ids) },
    },
    logger: () => ({ info: () => {}, warn: () => {} }),
    inject: () => {},
    effect: () => () => {},
    get: () => undefined,
  } as unknown as Context
  apply(ctx, { apiKeyEnv: 'OPENCODE_TEST_KEY' } as Config)
  assert.deepEqual(providers.map((entry) => entry.provider), [CONSOLE_PROVIDER, GO_PROVIDER])
  assert.deepEqual(adapters, [CONSOLE_PROVIDER, GO_PROVIDER])
  assert.ok(providers.every((entry) => entry.displayName.endsWith('(plugin)')))
})

test('auth entry refs are collision-free', () => {
  const first = authRefForEntry('opencode-go')
  const second = authRefForEntry('opencode_go')
  assert.notEqual(first, second)
  assert.match(first, /^OPENCODE_AUTH_[0-9a-f]+$/)
  assert.equal(first, authRefForEntry('opencode-go'))
})

test('settings draft and patch keep client edits normalized', () => {
  const state = {
    config: {
      apiKeyEnv: 'OPENCODE_API_KEY',
      apiBase: 'https://a',
      goApiBase: 'https://b',
      goZenBase: 'https://c',
      usageUrl: 'https://u',
      openCodeAuthEntry: 'opencode-go',
      requestTimeoutMs: 300000,
      streamIdleTimeoutMs: 300000,
      maxOutputTokens: null,
      contextWindow: null,
      accounts: [{ label: 'Go #2', apiKeyEnv: 'OPENCODE_API_KEY_2' }],
      modelAccountRules: [{ pattern: '*free*', account: 'Go #2' }],
      quotaFallbackModel: '',
      stickySession: true,
      activeAccount: '',
      showSidebarQuota: true,
      visibleModels: [],
      filterModelsByPlan: true,
      modelTransports: {},
    },
    models: [{ id: 'model-a' }, { id: 'model-b' }],
  } as unknown as HostState
  const draft = draftOf(state)
  assert.deepEqual(draft.visibleModels, ['model-a', 'model-b'])
  assert.equal(draft.showAll, true)
  draft.accounts.push({ label: ' ', apiKeyEnv: ' ' })
  draft.modelAccountRules.push({ pattern: ' ', account: ' ' })
  draft.quotaFallbackModel = ' beam-free '
  draft.visibleModels = ['model-a']
  draft.showAll = false
  const patch = patchOf(draft)
  assert.equal(patch.quotaFallbackModel, 'beam-free')
  assert.deepEqual(patch.accounts, [{ label: 'Go #2', apiKeyEnv: 'OPENCODE_API_KEY_2' }])
  assert.deepEqual(patch.modelAccountRules, [{ pattern: '*free*', account: 'Go #2' }])
  assert.deepEqual(patch.visibleModels, ['model-a'])
  assert.equal(safeSame(draft, draftOf(state)), false)
})

test('session id is stable per conversation and differs across conversations', () => {
  const first = openCodeSessionId(options())
  const again = openCodeSessionId(options())
  const other = openCodeSessionId(options({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'different' }] }],
  }))
  assert.equal(first, again)
  assert.notEqual(first, other)
  assert.match(first, /^dsh_[0-9a-f]{32}$/)
})

test('session id prefers the durable session id', () => {
  const a = openCodeSessionId(options({ sessionId: 'ses_1' as never }))
  const b = openCodeSessionId(options({
    sessionId: 'ses_1' as never,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'other' }] }],
  }))
  assert.equal(a, b)
})

test('messages convert system, tool calls and tool results', () => {
  const messages = buildMessages(options({
    system: 'be brief',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'run it' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' },
        ],
        source: { kind: 'model', provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      },
      {
        role: 'tool',
        content: [{ type: 'text', text: 'file.txt' }],
        toolCallId: 'call_1',
        source: { kind: 'tool', callId: 'call_1' },
      },
    ],
  } as unknown as GenerateOptions))

  assert.equal(messages[0]?.role, 'system')
  assert.equal(messages[0]?.content, 'be brief')
  assert.equal(messages[1]?.role, 'user')
  assert.deepEqual(messages[2]?.tool_calls, [{
    id: 'call_1',
    type: 'function',
    function: { name: 'bash', arguments: '{"command":"ls"}' },
  }])
  assert.equal(messages[2]?.reasoning_content, 'thinking')
  assert.equal(messages[3]?.role, 'tool')
  assert.equal(messages[3]?.tool_call_id, 'call_1')
})

test('images are rendered per transport', () => {
  const attachment = {
    attachmentId: 'img_1',
    mediaType: 'image/png',
    bytes: 4,
    width: 8,
    height: 8,
  } as never
  const image = {
    type: 'image' as const,
    attachment,
  }
  const imageOptions = options({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'look' }, image],
    }],
  } as unknown as GenerateOptions)
  const images = new Map([['img_1', {
    mediaType: 'image/png',
    base64: 'AAAA',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 8,
    height: 8,
  }]])
  const model = effectiveModel('claude-haiku-5-5', resolved())

  const chat = buildChatBody(imageOptions, effectiveModel('deepseek-v4.1-flash', resolved()), resolved(), images)
  const chatContent = (chat.messages as Array<{ content: unknown }>)[0]?.content as Array<Record<string, unknown>>
  assert.equal(chatContent?.[1]?.type, 'image_url')

  const anthropic = buildAnthropicBody(imageOptions, model, resolved(), images)
  const anthropicContent = (anthropic.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content
  assert.equal(anthropicContent?.[1]?.type, 'image')
  assert.deepEqual(anthropicContent?.[1]?.source, {
    type: 'base64',
    media_type: 'image/png',
    data: 'AAAA',
  })

  const responses = buildResponsesBody(imageOptions, effectiveModel('gpt-6-luna', resolved()), resolved(), images)
  const responsesContent = (responses.input as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content
  assert.equal(responsesContent?.[1]?.type, 'input_image')

  const google = buildGoogleBody(imageOptions, effectiveModel('gemini-4-argon-contributor', resolved()), resolved(), images)
  const googleParts = (google.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]?.parts
  assert.deepEqual(googleParts?.[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } })
})

test('estimates quota runway and flags exhaustion before reset', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  const hour = 3_600_000
  const fiveHour = estimateRunway({
    percentUsed: 50,
    resetsAt: new Date(now + 3 * hour).toISOString(),
  }, 5 * hour, now)
  assert.ok(fiveHour)
  assert.equal(Math.round((fiveHour?.etaMs ?? 0) / hour), 2)
  assert.equal(fiveHour?.exhaustsBeforeReset, true)

  const safe = estimateRunway({
    percentUsed: 10,
    resetsAt: new Date(now + 4 * hour).toISOString(),
  }, 5 * hour, now)
  assert.equal(safe?.exhaustsBeforeReset, false)

  const exhausted = estimateRunway({
    percentUsed: 100,
    resetsAt: new Date(now + hour).toISOString(),
  }, 5 * hour, now)
  assert.equal(exhausted?.etaMs, 0)
  assert.equal(exhausted?.exhaustsBeforeReset, true)

  assert.equal(estimateRunway({ percentUsed: 10 }, 5 * hour, now), undefined)
})

test('account runway picks the first window projected to run out', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  const hour = 3_600_000
  const day = 24 * hour
  const summary = accountRunway({
    fiveHour: { percentUsed: 50, resetsAt: new Date(now + 3 * hour).toISOString() },
    weekly: { percentUsed: 20, resetsAt: new Date(now + 3 * day).toISOString() },
  }, now)
  assert.equal(summary.kind, 'eta')
  if (summary.kind === 'eta') {
    assert.equal(summary.window, 'fiveHour')
    assert.equal(Math.round(summary.etaMs / hour), 2)
  }

  assert.deepEqual(accountRunway({}, now), { kind: 'unknown' })
  assert.deepEqual(accountRunway({
    fiveHour: { percentUsed: 10, resetsAt: new Date(now + 4 * hour).toISOString() },
  }, now), { kind: 'safe' })
})

test('file attachments become DSH handle text on every transport', () => {
  const file = {
    type: 'file' as const,
    attachment: {
      attachmentId: 'file-1',
      name: 'notes.txt',
      bytes: 42,
    } as never,
  }
  const fileOptions = options({
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'read this' }, file],
    }],
  } as unknown as GenerateOptions)

  const chat = buildMessages(fileOptions)
  assert.match(String(chat[0]?.content), /notes\.txt/)
  assert.match(String(chat[0]?.content), /42 bytes/)

  const anthropic = buildAnthropicBody(fileOptions, effectiveModel('claude-haiku-5-5', resolved()), resolved())
  const anthropicText = (anthropic.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content?.[1]?.text
  assert.match(String(anthropicText), /notes\.txt/)

  const responses = buildResponsesBody(fileOptions, effectiveModel('gpt-6-luna', resolved()), resolved())
  const responsesText = (responses.input as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content?.[1]?.text
  assert.match(String(responsesText), /notes\.txt/)

  const google = buildGoogleBody(fileOptions, effectiveModel('gemini-4-argon-contributor', resolved()), resolved())
  const googleText = (google.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]?.parts?.[1]?.text
  assert.match(String(googleText), /notes\.txt/)
})

test('inline tool-result images are rendered by supporting transports', () => {
  const attachment = {
    attachmentId: 'img_1',
    mediaType: 'image/png',
    bytes: 4,
    width: 8,
    height: 8,
  } as never
  const images = new Map([['img_1', {
    mediaType: 'image/png',
    base64: 'AAAA',
    dataUrl: 'data:image/png;base64,AAAA',
    width: 8,
    height: 8,
  }]])
  const toolOptions = options({
    messages: [{
      role: 'tool',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: 'shot' }, { type: 'image', attachment }],
    }],
  } as unknown as GenerateOptions)

  const anthropic = buildAnthropicBody(
    toolOptions,
    effectiveModel('claude-haiku-5-5', resolved()),
    resolved(),
    images,
  )
  const anthropicResult = (anthropic.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]?.content?.[0]
  const anthropicContent = anthropicResult?.content as Array<Record<string, unknown>>
  assert.ok(anthropicContent.some((part) => part.type === 'image'))

  const responses = buildResponsesBody(
    toolOptions,
    effectiveModel('gpt-6-luna', resolved()),
    resolved(),
    images,
  )
  const responsesOutput = (responses.input as Array<{ output: unknown }>)[0]?.output
  assert.ok(Array.isArray(responsesOutput))
  assert.ok((responsesOutput as Array<Record<string, unknown>>).some((part) => part.type === 'input_image'))

  const google = buildGoogleBody(
    toolOptions,
    effectiveModel('gemini-4-argon-contributor', resolved()),
    resolved(),
    images,
  )
  const googleParts = (google.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]?.parts
  assert.ok(googleParts?.some((part) => part.inlineData !== undefined))
})

test('tool-result images become a placeholder instead of failing the request', () => {
  const messages = buildMessages(options({
    messages: [{
      role: 'tool',
      toolCallId: 'call-1',
      content: [{ type: 'image', attachment: { attachmentId: 'img-1', name: 'screenshot.png' } as never }],
    }],
  } as unknown as GenerateOptions))
  assert.match(String(messages[0]?.content), /image omitted: screenshot\.png/)
})

test('images are rejected with a clear code', () => {
  assert.throws(
    () => buildMessages(options({
      messages: [{
        role: 'user',
        content: [{ type: 'image', attachment: {} as never }],
      }],
    } as unknown as GenerateOptions)),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === 'UNSUPPORTED_CONTENT',
  )
})

test('chat body maps effort, tools and output cap', () => {
  const config = resolved({ maxOutputTokens: 128 })
  const model = effectiveModel('deepseek-v4.1-flash', config)
  const body = buildChatBody(options({
    tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    reasoningEffort: 'high' as never,
  }), model, config) as Record<string, unknown>

  assert.equal(body.model, 'deepseek-v4.1-flash')
  assert.equal(body.stream, true)
  assert.equal(body.max_tokens, 128)
  assert.equal(body.reasoning_effort, 'high')
  assert.equal(Array.isArray(body.tools), true)
})

test('output cap 0 omits max_tokens', () => {
  const config = resolved({ maxOutputTokens: 0 })
  const model = effectiveModel('deepseek-v4.1-flash', config)
  const body = buildChatBody(options(), model, config) as Record<string, unknown>
  assert.equal('max_tokens' in body, false)
  assert.equal(effectiveMaxTokens(model, config), undefined)
})

test('routing uses the Go unified gateway for chat and native paths for the rest', () => {
  const config = resolved()
  assert.equal(
    endpointFor('opencode-go', 'openai-chat', 'deepseek-v4.1-flash', config),
    'https://opencode.ai/zen/go/v1/chat/completions',
  )
  assert.equal(
    endpointFor('opencode', 'openai-chat', 'deepseek-v4.1-flash', config),
    'https://opencode.ai/inference/openai/v1/chat/completions',
  )
  assert.equal(
    endpointFor('opencode-go', 'openai-responses', 'gpt-6-luna', config),
    'https://opencode.ai/inference/go/openai/v1/responses',
  )
  assert.equal(
    endpointFor('opencode-go', 'google', 'gemini-4-argon-contributor', config),
    'https://opencode.ai/inference/go/google/v1beta/models/gemini-4-argon-contributor:streamGenerateContent?alt=sse',
  )
})

test('model overrides win over generated metadata', () => {
  const config = resolved({
    contextWindowOverrides: { 'deepseek-v4.1-flash': 4096 },
    modelTransports: { 'deepseek-v4.1-flash': 'anthropic' },
  })
  const model = effectiveModel('deepseek-v4.1-flash', config)
  assert.equal(model.contextWindow, 4096)
  assert.equal(model.transport, 'anthropic')
  assert.match(describeModel(model), /anthropic/)
})

test('usage normalization clamps and names windows', () => {
  const report = normalizeUsage({
    usage: {
      rolling: { status: 'ok', percent: 0, resetsAt: '2026-10-19T22:05:21.000Z' },
      weekly: { percent: 142 },
      monthly: { percent: 12.5 },
    },
  })
  assert.equal(report.windows.fiveHour?.percentUsed, 0)
  assert.equal(report.windows.weekly?.percentUsed, 100)
  assert.equal(report.windows.monthly?.percentUsed, 12.5)
})

test('error classification uses the body type, not the status alone', () => {
  const free = classifyResponseError(403, JSON.stringify({
    type: 'error',
    error: { type: 'FreeTierError', message: 'free tier can only be used from within OpenCode' },
  }), new Headers())
  assert.equal(free.code, 'RATE_LIMIT')

  const protocol = classifyResponseError(400, JSON.stringify({
    type: 'error',
    error: { type: 'ModelProtocolUnsupported', message: 'Model does not support this protocol.' },
  }), new Headers())
  assert.equal(protocol.code, 'UNSUPPORTED_MODEL')

  const rate = classifyResponseError(429, '{}', new Headers({ 'retry-after': '2' }))
  assert.equal(rate.code, 'RATE_LIMIT')
  assert.equal(rate.failure.providerRetryAfterMs, 2000)

  const quota = classifyResponseError(400, JSON.stringify({
    error: { type: 'quota_exceeded', message: 'Monthly usage limit reached' },
  }), new Headers())
  assert.equal(quota.code, 'QUOTA')

  const payment = classifyResponseError(402, '{}', new Headers())
  assert.equal(payment.code, 'QUOTA')
})
