import {
  LlmError,
  ToolCallId,
  type ContentBlock,
  type FinishReason,
  type GenerateOptions,
  type StreamChunk,
  type TokenUsage,
} from '@deepseek-ai/dsh-llm'

import type { EffectiveModel } from '../catalog.ts'
import { effectiveMaxTokens } from '../catalog.ts'
import type { ResolvedConfig } from '../config.ts'
import { offloadPlaceholder, type ImageMap } from '../images.ts'
import { sseEvents } from './sse.ts'

const EFFORT_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function textOnly(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push(offloadPlaceholder(block.attachment))
    else if (block.type === 'file') parts.push('[file omitted: tool-result files are not supported]')
  }
  return parts.join('')
}

function userParts(content: readonly ContentBlock[], images: ImageMap | undefined): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text !== '') parts.push({ type: 'input_text', text: block.text })
    } else if (block.type === 'image') {
      if (block.offloaded === true) {
        parts.push({ type: 'input_text', text: offloadPlaceholder(block.attachment) })
        continue
      }
      const image = images?.get(block.attachment.attachmentId)
      if (image === undefined) {
        if (images === undefined) {
          throw new LlmError('llm-opencode: image input requires the harness attachment service', 'UNSUPPORTED_CONTENT')
        }
        parts.push({ type: 'input_text', text: offloadPlaceholder(block.attachment) })
        continue
      }
      parts.push({ type: 'input_image', image_url: image.dataUrl })
    } else if (block.type === 'file') {
      throw new LlmError('llm-opencode: file attachments are not supported yet.', 'UNSUPPORTED_CONTENT')
    }
  }
  return parts.length === 0 ? [{ type: 'input_text', text: '' }] : parts
}

function toolOutput(content: readonly ContentBlock[], images: ImageMap | undefined): string | Array<Record<string, unknown>> {
  const parts = userParts(content, images)
  if (parts.every((part) => part.type === 'input_text')) {
    return parts.map((part) => String(part.text ?? '')).join('')
  }
  return parts
}

function buildInput(
  options: GenerateOptions,
  images?: ImageMap,
): { instructions?: string; input: Array<Record<string, unknown>> } {
  const instructions: string[] = []
  if (options.system !== undefined && options.system !== '') instructions.push(options.system)
  const input: Array<Record<string, unknown>> = []

  for (const message of options.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOnly(message.content)
      if (text !== '') instructions.push(text)
      continue
    }
    if (message.role === 'user') {
      input.push({ role: 'user', content: userParts(message.content, images) })
      continue
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: toolOutput(message.content, images),
      })
      continue
    }
    const text = textOnly(message.content)
    if (text !== '') {
      input.push({ role: 'assistant', content: [{ type: 'output_text', text }] })
    }
    for (const block of message.content) {
      if (block.type === 'tool-call') {
        input.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: block.arguments,
        })
      }
    }
  }

  return {
    ...(instructions.length === 0 ? {} : { instructions: instructions.join('\n\n') }),
    input,
  }
}

export function buildResponsesBody(
  options: GenerateOptions,
  model: EffectiveModel,
  config: ResolvedConfig,
  images?: ImageMap,
): Record<string, unknown> {
  if (options.stop !== undefined && options.stop.length > 0) {
    throw new LlmError('llm-opencode: OpenAI Responses does not support stop sequences', 'UNSUPPORTED_OPTION')
  }
  const { instructions, input } = buildInput(options, images)
  const maxTokens = options.maxTokens ?? effectiveMaxTokens(model, config)
  const effort = options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort)
  const reasoningEffort = effort === 'off'
    ? (model.reasoning.includes('off') ? 'none' : undefined)
    : effort !== undefined && EFFORT_LEVELS.has(effort) && model.reasoning.includes(effort) ? effort : undefined
  const tools = options.tools?.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))

  return {
    model: options.model,
    input,
    stream: true,
    ...(instructions === undefined ? {} : { instructions }),
    ...(tools === undefined || tools.length === 0 ? {} : { tools }),
    ...(maxTokens === undefined ? {} : { max_output_tokens: maxTokens }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(reasoningEffort === undefined ? {} : { reasoning: { effort: reasoningEffort } }),
  }
}

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
  output_tokens_details?: { reasoning_tokens?: number }
}

interface ResponsesItem {
  id?: string
  type?: string
  call_id?: string
  name?: string
  arguments?: string
  encrypted_content?: string
}

interface ResponsesEvent {
  type?: string
  output_index?: number
  item_id?: string
  delta?: string
  item?: ResponsesItem
  response?: {
    usage?: ResponsesUsage
    incomplete_details?: { reason?: string }
    status?: string
  }
  error?: { type?: string; message?: string }
}

interface LiveTool {
  dshIndex: number
  id: string
  name: string
  args: string
}

function mapUsage(usage: ResponsesUsage | undefined): TokenUsage {
  const prompt = usage?.input_tokens ?? 0
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  const reasoning = usage?.output_tokens_details?.reasoning_tokens
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: output,
    ...(usage?.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens }),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  }
}

function finishReasonOf(hasTools: boolean, incomplete: string | undefined): FinishReason {
  if (hasTools) return { kind: 'tool-calls' }
  if (incomplete === 'max_output_tokens') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** Parse an OpenAI Responses SSE stream into harness chunks. */
export async function* parseResponsesStream(
  response: Response,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): AsyncIterable<StreamChunk> {
  if (response.body === null) throw new LlmError('OpenCode returned an empty response body', 'EMPTY_RESPONSE')

  let nextIndex = 0
  let textIndex: number | undefined
  let text = ''
  let reasoningIndex: number | undefined
  let reasoning = ''
  const tools = new Map<string, LiveTool>()
  let sawContent = false
  let hasTools = false
  let usage: TokenUsage | undefined
  let incomplete: string | undefined

  for await (const { event: eventName, data } of sseEvents(response.body, idleTimeoutMs, signal)) {
    let event: ResponsesEvent
    try {
      event = JSON.parse(data) as ResponsesEvent
    } catch {
      continue
    }
    const type = event.type ?? eventName

    if (type === 'error' || type === 'response.failed') {
      throw new LlmError(
        `OpenCode Responses error: ${event.error?.message ?? 'request failed'}`,
        'PROVIDER_HTTP_ERROR',
      )
    }

    if (type === 'response.output_item.added') {
      const item = event.item
      if (item?.type === 'reasoning') {
        if (reasoningIndex === undefined) {
          reasoningIndex = nextIndex++
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
        }
      } else if (item?.type === 'function_call') {
        const key = item.id ?? item.call_id ?? `tool_${event.output_index ?? tools.size}`
        const live: LiveTool = {
          dshIndex: nextIndex++,
          id: item.call_id ?? item.id ?? `call_${tools.size}`,
          name: item.name ?? '',
          args: item.arguments ?? '',
        }
        tools.set(key, live)
        hasTools = true
        sawContent = true
        yield { type: 'block-start', index: live.dshIndex, blockType: 'tool-call' }
        if (live.args !== '') {
          yield {
            type: 'tool-call-delta',
            index: live.dshIndex,
            id: ToolCallId(live.id),
            ...(live.name === '' ? {} : { name: live.name }),
            argumentsDelta: live.args,
          }
        }
      }
      continue
    }

    if (type === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta !== '') {
      if (textIndex === undefined) {
        textIndex = nextIndex++
        yield { type: 'block-start', index: textIndex, blockType: 'text' }
      }
      text += event.delta
      sawContent = true
      yield { type: 'text-delta', index: textIndex, text: event.delta }
      continue
    }

    if ((type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta')
      && typeof event.delta === 'string' && event.delta !== '') {
      if (reasoningIndex === undefined) {
        reasoningIndex = nextIndex++
        yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
      }
      reasoning += event.delta
      sawContent = true
      yield { type: 'reasoning-delta', index: reasoningIndex, text: event.delta }
      continue
    }

    if (type === 'response.function_call_arguments.delta' && typeof event.delta === 'string' && event.delta !== '') {
      const key = event.item_id
      const live = key === undefined ? undefined : tools.get(key)
      if (live !== undefined) {
        live.args += event.delta
        sawContent = true
        yield {
          type: 'tool-call-delta',
          index: live.dshIndex,
          id: ToolCallId(live.id),
          ...(live.name === '' ? {} : { name: live.name }),
          argumentsDelta: event.delta,
        }
      }
      continue
    }

    if (type === 'response.output_item.done') {
      const item = event.item
      if (item?.type === 'function_call') {
        const key = item.id ?? item.call_id
        const live = key === undefined ? undefined : tools.get(key)
        if (live !== undefined) {
          if (item.name !== undefined) live.name = item.name
          if (item.arguments !== undefined) live.args = item.arguments
        }
      }
      continue
    }

    if (type === 'response.completed') {
      usage = mapUsage(event.response?.usage)
      incomplete = event.response?.incomplete_details?.reason
      continue
    }
  }

  if (textIndex !== undefined) {
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
  }
  if (reasoningIndex !== undefined) {
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
  }
  for (const live of tools.values()) {
    yield {
      type: 'block-end',
      index: live.dshIndex,
      block: {
        type: 'tool-call',
        id: ToolCallId(live.id),
        name: live.name,
        arguments: live.args === '' ? '{}' : live.args,
      },
    }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  if (!sawContent) throw new LlmError('OpenCode completed the request without content', 'EMPTY_RESPONSE')
  yield { type: 'finish', reason: finishReasonOf(hasTools, incomplete) }
}
