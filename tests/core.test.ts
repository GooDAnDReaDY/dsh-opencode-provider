import assert from 'node:assert/strict'
import test from 'node:test'

import { effectiveModel, effectiveMaxTokens, describeModel } from '../src/catalog.ts'
import { resolveConfig, type Config } from '../src/config.ts'
import { classifyResponseError } from '../src/errors.ts'
import { buildChatBody, buildMessages } from '../src/messages.ts'
import { buildAnthropicBody } from '../src/transports/anthropic.ts'
import { buildGoogleBody } from '../src/transports/google.ts'
import { buildResponsesBody } from '../src/transports/responses.ts'
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
  assert.equal(free.code, 'INVALID_CREDENTIAL')

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
