import {
  LlmError,
  ToolCallId,
  type FinishReason,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'

import { classifyStreamError } from '../errors.ts'
import { sseData } from './sse.ts'

interface ChatToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface ChatDelta {
  role?: string
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
  tool_calls?: ChatToolCallDelta[]
}

interface ChatChoice {
  index?: number
  delta?: ChatDelta
  message?: ChatDelta
  finish_reason?: string | null
}

interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface ChatChunk {
  choices?: ChatChoice[]
  usage?: ChatUsage | null
  error?: unknown
}

function mapUsage(usage: ChatUsage): TokenUsage {
  const prompt = usage.prompt_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const output = usage.completion_tokens ?? 0
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: output,
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}

function finishReasonOf(raw: string | null | undefined, hasToolCalls: boolean): FinishReason {
  if (raw === 'length') return { kind: 'max-tokens' }
  if (raw === 'tool_calls' || raw === 'function_call') return { kind: 'tool-calls' }
  return hasToolCalls ? { kind: 'tool-calls' } : { kind: 'stop' }
}

/**
 * Parse an OpenAI Chat SSE stream into harness chunks. Handles text,
 * `reasoning_content`/`reasoning`, streamed tool calls, usage, and the
 * terminal finish reason.
 */
export async function* parseChatStream(
  response: Response,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): AsyncIterable<StreamChunk> {
  if (response.body === null) {
    throw new LlmError('OpenCode returned an empty response body', 'EMPTY_RESPONSE')
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    yield* parseCompletion(await response.json() as ChatChunk)
    return
  }

  let nextIndex = 0
  let textIndex: number | undefined
  let text = ''
  let reasoningIndex: number | undefined
  let reasoning = ''
  const toolCalls = new Map<number, {
    dshIndex: number
    id: string
    name: string
    args: string
    started: boolean
  }>()
  let finishReason: string | undefined
  let usage: TokenUsage | undefined
  let sawContent = false

  for await (const data of sseData(response.body, idleTimeoutMs, signal)) {
    if (data === '[DONE]') break
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(data) as ChatChunk
    } catch {
      continue
    }
    const streamError = classifyStreamError(chunk)
    if (streamError !== undefined) throw streamError
    if (chunk.usage !== undefined && chunk.usage !== null) usage = mapUsage(chunk.usage)

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? choice.message
      if (delta === undefined) continue

      const content = delta.content
      if (typeof content === 'string' && content !== '') {
        if (textIndex === undefined) {
          textIndex = nextIndex++
          yield { type: 'block-start', index: textIndex, blockType: 'text' }
        }
        text += content
        sawContent = true
        yield { type: 'text-delta', index: textIndex, text: content }
      }

      const reasoningDelta = delta.reasoning_content ?? delta.reasoning
      if (typeof reasoningDelta === 'string' && reasoningDelta !== '') {
        if (reasoningIndex === undefined) {
          reasoningIndex = nextIndex++
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
        }
        reasoning += reasoningDelta
        sawContent = true
        yield { type: 'reasoning-delta', index: reasoningIndex, text: reasoningDelta }
      }

      for (const [position, toolCall] of (delta.tool_calls ?? []).entries()) {
        const key = toolCall.index ?? position
        let entry = toolCalls.get(key)
        if (entry === undefined) {
          entry = {
            dshIndex: nextIndex++,
            id: toolCall.id ?? `call_${key}`,
            name: '',
            args: '',
            started: false,
          }
          toolCalls.set(key, entry)
        }
        if (toolCall.id !== undefined && toolCall.id !== '') entry.id = toolCall.id
        if (toolCall.function?.name !== undefined && toolCall.function.name !== '') {
          entry.name = toolCall.function.name
        }
        if (!entry.started) {
          entry.started = true
          yield { type: 'block-start', index: entry.dshIndex, blockType: 'tool-call' }
        }
        const argumentsDelta = toolCall.function?.arguments ?? ''
        if (argumentsDelta !== '') entry.args += argumentsDelta
        sawContent = true
        yield {
          type: 'tool-call-delta',
          index: entry.dshIndex,
          id: ToolCallId(entry.id),
          ...(entry.name === '' ? {} : { name: entry.name }),
          argumentsDelta,
        }
      }

      if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
        finishReason = choice.finish_reason
      }
    }
  }

  if (textIndex !== undefined) {
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
  }
  if (reasoningIndex !== undefined) {
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
  }
  for (const entry of toolCalls.values()) {
    if (!entry.started) continue
    yield {
      type: 'block-end',
      index: entry.dshIndex,
      block: {
        type: 'tool-call',
        id: ToolCallId(entry.id),
        name: entry.name,
        arguments: entry.args === '' ? '{}' : entry.args,
      },
    }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  if (!sawContent) {
    throw new LlmError('OpenCode completed the request without content', 'EMPTY_RESPONSE')
  }
  yield { type: 'finish', reason: finishReasonOf(finishReason, toolCalls.size > 0) }
}

/** Non-SSE fallback: one completed response object. */
async function* parseCompletion(chunk: ChatChunk): AsyncIterable<StreamChunk> {
  const streamError = classifyStreamError(chunk)
  if (streamError !== undefined) throw streamError
  const choice = chunk.choices?.[0]
  const message = choice?.message
  let index = 0
  let sawContent = false

  if (typeof message?.reasoning_content === 'string' && message.reasoning_content !== '') {
    yield { type: 'block-start', index, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index, text: message.reasoning_content }
    yield { type: 'block-end', index, block: { type: 'reasoning', text: message.reasoning_content } }
    index += 1
    sawContent = true
  }
  if (typeof message?.content === 'string' && message.content !== '') {
    yield { type: 'block-start', index, blockType: 'text' }
    yield { type: 'text-delta', index, text: message.content }
    yield { type: 'block-end', index, block: { type: 'text', text: message.content } }
    index += 1
    sawContent = true
  }
  for (const call of message?.tool_calls ?? []) {
    const id = ToolCallId(call.id ?? `call_${index}`)
    const name = call.function?.name ?? ''
    const args = call.function?.arguments ?? '{}'
    yield { type: 'block-start', index, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index, id, ...(name === '' ? {} : { name }), argumentsDelta: args }
    yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
    index += 1
    sawContent = true
  }
  if (chunk.usage !== undefined && chunk.usage !== null) yield { type: 'usage', usage: mapUsage(chunk.usage) }
  if (!sawContent) throw new LlmError('OpenCode completed the request without content', 'EMPTY_RESPONSE')
  yield {
    type: 'finish',
    reason: finishReasonOf(choice?.finish_reason, (message?.tool_calls?.length ?? 0) > 0),
  }
}
