import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyStreamError } from '../src/errors.ts'

import { parseAnthropicStream } from '../src/transports/anthropic.ts'
import { parseGoogleStream } from '../src/transports/google.ts'
import { parseChatStream } from '../src/transports/openai-chat.ts'
import { parseResponsesStream } from '../src/transports/responses.ts'

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of source) result.push(value)
  return result
}

function sse(...events: unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

const hasNonStringId = (id: unknown): boolean => typeof id !== 'string' || id === ''

test('chat rejects numeric/null tool ids and names by falling back to strings', async () => {
  const chunks = await collect(parseChatStream(sse(
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: null, function: { name: null, arguments: '{}' } }],
        },
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{ index: 0, id: 123, function: { name: 42, arguments: '{"a":1}' } }],
        },
      }],
    },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ), 5000, undefined))

  const deltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
  assert.equal(deltas.length, 3)
  for (const delta of deltas) {
    if (delta.type !== 'tool-call-delta') continue
    assert.equal(delta.id, 'call_0')
    assert.ok(delta.name === undefined || typeof delta.name === 'string')
  }
  const block = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.ok(block?.type === 'block-end' && block.block.type === 'tool-call')
  assert.equal(block.block.id, 'call_0')
  assert.equal(block.block.name, '')
})

test('chat keeps a string id when a continuation repeats id:null', async () => {
  const chunks = await collect(parseChatStream(sse(
    {
      choices: [{
        delta: { tool_calls: [{ index: 0, id: 'call-real', function: { name: 'echo', arguments: '{"a":' } }] },
      }],
    },
    {
      choices: [{
        delta: { tool_calls: [{ index: 0, id: null, function: { name: null, arguments: '1}' } }] },
      }],
    },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    '[DONE]',
  ), 5000, undefined))

  const ids = chunks
    .filter((chunk) => chunk.type === 'tool-call-delta')
    .map((chunk) => chunk.type === 'tool-call-delta' ? chunk.id : '')
  assert.deepEqual(ids, ['call-real', 'call-real'])
})

test('non-streaming chat completion normalizes numeric tool id and name', async () => {
  const chunks = await collect(parseChatStream(new Response(JSON.stringify({
    choices: [{
      message: {
        tool_calls: [{ id: 123, function: { name: 42, arguments: '{}' } }],
      },
      finish_reason: 'tool_calls',
    }],
  }), { headers: { 'content-type': 'application/json' } }), 5000, undefined))

  const delta = chunks.find((chunk) => chunk.type === 'tool-call-delta')
  assert.ok(delta?.type === 'tool-call-delta')
  assert.equal(delta.id, 'call_0')
  assert.equal(delta.name, undefined)
  const block = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.ok(block?.type === 'block-end' && block.block.type === 'tool-call')
  assert.equal(block.block.id, 'call_0')
  assert.equal(block.block.name, '')
})

test('anthropic normalizes numeric tool id and name', async () => {
  const chunks = await collect(parseAnthropicStream(sse(
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 123, name: 42 },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_stop' },
  ), 5000, undefined))

  const delta = chunks.find((chunk) => chunk.type === 'tool-call-delta')
  assert.ok(delta?.type === 'tool-call-delta')
  assert.equal(delta.id, 'call_0')
  assert.equal(delta.name, undefined)
  const block = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.ok(block?.type === 'block-end' && block.block.type === 'tool-call')
  assert.equal(block.block.id, 'call_0')
  assert.equal(block.block.name, '')
})

test('responses normalizes numeric/null tool id and name', async () => {
  const chunks = await collect(parseResponsesStream(sse(
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', id: 123, call_id: null, name: 42, arguments: '{}' },
    },
    { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } },
  ), 5000, undefined))

  const delta = chunks.find((chunk) => chunk.type === 'tool-call-delta')
  assert.ok(delta?.type === 'tool-call-delta')
  assert.equal(delta.id, 'call_0')
  assert.equal(delta.name, undefined)
  const block = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.ok(block?.type === 'block-end' && block.block.type === 'tool-call')
  assert.equal(block.block.id, 'call_0')
  assert.equal(block.block.name, '')
})

test('stream error:null is not treated as a provider failure', () => {
  assert.equal(classifyStreamError({ choices: [], error: null }), undefined)
  assert.equal(classifyStreamError({ error: { message: 'bad' } })?.code, 'PROVIDER_HTTP_ERROR')
})

test('responses response.incomplete finishes with max-tokens', async () => {
  const chunks = await collect(parseResponsesStream(sse(
    { type: 'response.output_text.delta', delta: 'partial' },
    {
      type: 'response.incomplete',
      response: {
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
    },
  ), 5000, undefined))
  const finish = chunks.find((chunk) => chunk.type === 'finish')
  assert.ok(finish?.type === 'finish')
  assert.deepEqual(finish.reason, { kind: 'max-tokens' })
})

test('google normalizes numeric tool name', async () => {
  const chunks = await collect(parseGoogleStream(sse({
    candidates: [{
      content: { parts: [{ functionCall: { id: 123, name: 42, args: {} } }] },
      finishReason: 'STOP',
    }],
  }), 5000, undefined))

  const delta = chunks.find((chunk) => chunk.type === 'tool-call-delta')
  assert.ok(delta?.type === 'tool-call-delta')
  assert.equal(delta.id, 'call_0')
  assert.equal(delta.name, undefined)
  const block = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.ok(block?.type === 'block-end' && block.block.type === 'tool-call')
  assert.equal(block.block.name, '')
  assert.equal(hasNonStringId(block.block.id), false)
})

test('anthropic finishes with max-tokens when truncated inside tool call', async () => {
  const chunks = await collect(parseAnthropicStream(sse(
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'read_file' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a' } },
    { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
    { type: 'message_stop' },
  ), 5000, undefined))
  const finish = chunks.find((chunk) => chunk.type === 'finish')
  assert.ok(finish?.type === 'finish')
  assert.deepEqual(finish.reason, { kind: 'max-tokens' })
})

test('responses finishes with max-tokens when truncated inside tool call', async () => {
  const chunks = await collect(parseResponsesStream(sse(
    { type: 'response.output_item.added', item: { type: 'function_call', call_id: 'call_1', name: 'read_file' } },
    { type: 'response.function_call_arguments.delta', delta: '{"path":"a' },
    {
      type: 'response.incomplete',
      response: {
        incomplete_details: { reason: 'max_output_tokens' },
      },
    },
  ), 5000, undefined))
  const finish = chunks.find((chunk) => chunk.type === 'finish')
  assert.ok(finish?.type === 'finish')
  assert.deepEqual(finish.reason, { kind: 'max-tokens' })
})

test('google finishes with max-tokens when truncated inside tool call', async () => {
  const chunks = await collect(parseGoogleStream(sse({
    candidates: [{
      content: { parts: [{ functionCall: { id: 'call_1', name: 'read_file', args: { path: 'a' } } }] },
      finishReason: 'MAX_TOKENS',
    }],
  }), 5000, undefined))
  const finish = chunks.find((chunk) => chunk.type === 'finish')
  assert.ok(finish?.type === 'finish')
  assert.deepEqual(finish.reason, { kind: 'max-tokens' })
})
