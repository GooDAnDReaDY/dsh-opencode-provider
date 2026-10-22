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
import { filePlaceholder } from '../files.ts'
import { offloadPlaceholder, type ImageMap } from '../images.ts'
import { sseEvents } from './sse.ts'

interface AnthropicBlockMeta {
  type?: string
  signature?: string
  data?: string
}

interface AnthropicReplay {
  response?: unknown
  blocks?: unknown
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: Array<Record<string, unknown>>
}

const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'max'])

function textOnly(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push(offloadPlaceholder(block.attachment))
    else if (block.type === 'file') parts.push(filePlaceholder(block.attachment))
  }
  return parts.join('')
}

function contentParts(content: readonly ContentBlock[], images: ImageMap | undefined): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text !== '') parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (block.offloaded === true) {
        parts.push({ type: 'text', text: offloadPlaceholder(block.attachment) })
        continue
      }
      const image = images?.get(block.attachment.attachmentId)
      if (image === undefined) {
        if (images === undefined) {
          throw new LlmError('llm-opencode: image input requires the harness attachment service', 'UNSUPPORTED_CONTENT')
        }
        parts.push({ type: 'text', text: offloadPlaceholder(block.attachment) })
        continue
      }
      parts.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
      })
    } else if (block.type === 'file') {
      parts.push({ type: 'text', text: filePlaceholder(block.attachment) })
    }
  }
  return parts.length === 0 ? [{ type: 'text', text: '' }] : parts
}

function replayMeta(message: Extract<GenerateOptions['messages'][number], { role: 'assistant' }>): AnthropicBlockMeta[] {
  const source = message.source as { replayState?: AnthropicReplay }
  const blocks = source.replayState?.blocks
  return Array.isArray(blocks) ? blocks as AnthropicBlockMeta[] : []
}

function toolInput(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function buildAnthropicMessages(
  options: GenerateOptions,
  images?: ImageMap,
): { system?: string; messages: AnthropicMessage[] } {
  const system: string[] = []
  if (options.system !== undefined && options.system !== '') system.push(options.system)
  const messages: AnthropicMessage[] = []

  for (const message of options.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOnly(message.content)
      if (text !== '') system.push(text)
      continue
    }

    if (message.role === 'user') {
      messages.push({ role: 'user', content: contentParts(message.content, images) })
      continue
    }

    if (message.role === 'tool') {
      const result = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: contentParts(message.content, images),
        ...(message.isError === true ? { is_error: true } : {}),
      }
      const previous = messages.at(-1)
      if (previous?.role === 'user' && previous.content.every((block) => block.type === 'tool_result')) {
        previous.content.push(result)
      } else {
        messages.push({ role: 'user', content: [result] })
      }
      continue
    }

    // assistant
    const meta = replayMeta(message)
    const content: Array<Record<string, unknown>> = []
    let metaIndex = 0
    for (const block of message.content) {
      const blockMeta = meta[metaIndex] ?? {}
      metaIndex += 1
      if (block.type === 'text') {
        if (block.text !== '') content.push({ type: 'text', text: block.text })
      } else if (block.type === 'reasoning') {
        if (blockMeta.type === 'thinking' && typeof blockMeta.signature === 'string' && blockMeta.signature !== '') {
          content.push({ type: 'thinking', thinking: block.text, signature: blockMeta.signature })
        } else if (blockMeta.type === 'redacted_thinking' && typeof blockMeta.data === 'string') {
          content.push({ type: 'redacted_thinking', data: blockMeta.data })
        }
      } else if (block.type === 'tool-call') {
        content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: toolInput(block.arguments),
        })
      }
    }
    if (content.length > 0) messages.push({ role: 'assistant', content })
  }

  return {
    ...(system.length === 0 ? {} : { system: system.join('\n\n') }),
    messages,
  }
}

export function buildAnthropicBody(
  options: GenerateOptions,
  model: EffectiveModel,
  config: ResolvedConfig,
  images?: ImageMap,
): Record<string, unknown> {
  const { system, messages } = buildAnthropicMessages(options, images)
  const maxTokens = options.maxTokens ?? effectiveMaxTokens(model, config) ?? 32_768
  const effort = options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort)
  const outputEffort = model.id.startsWith('claude')
    && effort !== undefined
    && EFFORT_LEVELS.has(effort)
    && model.reasoning.includes(effort)
    ? effort
    : undefined
  const tools = options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))

  return {
    model: options.model,
    max_tokens: maxTokens,
    messages,
    stream: true,
    ...(system === undefined ? {} : { system }),
    ...(tools === undefined || tools.length === 0 ? {} : { tools }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.stop === undefined || options.stop.length === 0 ? {} : { stop_sequences: options.stop }),
    ...(outputEffort === undefined ? {} : { output_config: { effort: outputEffort } }),
  }
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface AnthropicEvent {
  type?: string
  index?: number
  message?: { usage?: AnthropicUsage }
  content_block?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    data?: string
    id?: string
    name?: string
  }
  delta?: {
    type?: string
    text?: string
    thinking?: string
    signature?: string
    partial_json?: string
    stop_reason?: string
  }
  usage?: { output_tokens?: number }
  error?: { type?: string; message?: string }
}

interface LiveBlock {
  dshIndex: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  id: string
  name: string
  args: string
  signature?: string
  data?: string
}

function usageOf(input: AnthropicUsage | undefined, outputTokens: number | undefined): TokenUsage {
  const prompt = input?.input_tokens ?? 0
  const cacheRead = input?.cache_read_input_tokens ?? 0
  const cacheWrite = input?.cache_creation_input_tokens ?? 0
  const output = outputTokens ?? input?.output_tokens ?? 0
  return {
    inputTokens: prompt,
    outputTokens: output,
    totalTokens: prompt + cacheRead + cacheWrite + output,
    ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
  }
}

function finishReasonOf(stopReason: string | undefined, hasTools: boolean): FinishReason {
  if (stopReason === 'tool_use' || hasTools) return { kind: 'tool-calls' }
  if (stopReason === 'max_tokens') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** Parse an Anthropic Messages SSE stream into harness chunks. */
export async function* parseAnthropicStream(
  response: Response,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): AsyncIterable<StreamChunk> {
  if (response.body === null) throw new LlmError('OpenCode returned an empty response body', 'EMPTY_RESPONSE')

  const blocks = new Map<number, LiveBlock>()
  const replay: AnthropicBlockMeta[] = []
  let nextIndex = 0
  let sawContent = false
  let sawToolUse = false
  let stopReason: string | undefined
  let inputUsage: AnthropicUsage | undefined
  let outputTokens: number | undefined

  for await (const { data } of sseEvents(response.body, idleTimeoutMs, signal)) {
    let event: AnthropicEvent
    try {
      event = JSON.parse(data) as AnthropicEvent
    } catch {
      continue
    }
    if (event.type === 'error') {
      throw new LlmError(
        `OpenCode Anthropic error: ${event.error?.message ?? 'unknown error'}`,
        'PROVIDER_HTTP_ERROR',
      )
    }
    if (event.type === 'message_start') {
      inputUsage = event.message?.usage
      continue
    }
    if (event.type === 'content_block_start' && event.index !== undefined) {
      const source = event.content_block ?? {}
      const dshIndex = nextIndex++
      let block: LiveBlock
      if (source.type === 'tool_use') {
        block = {
          dshIndex,
          kind: 'tool-call',
          text: '',
          id: source.id ?? `call_${dshIndex}`,
          name: source.name ?? '',
          args: '',
        }
        sawContent = true
        sawToolUse = true
        yield { type: 'block-start', index: dshIndex, blockType: 'tool-call' }
        replay[dshIndex] = {}
      } else if (source.type === 'thinking' || source.type === 'redacted_thinking') {
        block = {
          dshIndex,
          kind: 'reasoning',
          text: source.thinking ?? '',
          id: '',
          name: '',
          args: '',
          ...(source.signature === undefined ? {} : { signature: source.signature }),
          ...(source.data === undefined ? {} : { data: source.data }),
        }
        yield { type: 'block-start', index: dshIndex, blockType: 'reasoning' }
        if (block.text !== '') {
          sawContent = true
          yield { type: 'reasoning-delta', index: dshIndex, text: block.text }
        }
        replay[dshIndex] = {
          type: source.type,
          ...(source.signature === undefined ? {} : { signature: source.signature }),
          ...(source.data === undefined ? {} : { data: source.data }),
        }
      } else {
        block = { dshIndex, kind: 'text', text: source.text ?? '', id: '', name: '', args: '' }
        yield { type: 'block-start', index: dshIndex, blockType: 'text' }
        if (block.text !== '') {
          sawContent = true
          yield { type: 'text-delta', index: dshIndex, text: block.text }
        }
        replay[dshIndex] = {}
      }
      blocks.set(event.index, block)
      continue
    }
    if (event.type === 'content_block_delta' && event.index !== undefined) {
      const block = blocks.get(event.index)
      const delta = event.delta
      if (block === undefined || delta === undefined) continue
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '') {
        block.text += delta.text
        sawContent = true
        yield { type: 'text-delta', index: block.dshIndex, text: delta.text }
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking !== '') {
        block.text += delta.thinking
        sawContent = true
        yield { type: 'reasoning-delta', index: block.dshIndex, text: delta.thinking }
      } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
        block.signature = delta.signature
        replay[block.dshIndex] = { type: 'thinking', signature: delta.signature }
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string' && delta.partial_json !== '') {
        block.args += delta.partial_json
        sawContent = true
        yield {
          type: 'tool-call-delta',
          index: block.dshIndex,
          id: ToolCallId(block.id),
          ...(block.name === '' ? {} : { name: block.name }),
          argumentsDelta: delta.partial_json,
        }
      }
      continue
    }
    if (event.type === 'content_block_stop' && event.index !== undefined) {
      const block = blocks.get(event.index)
      if (block === undefined) continue
      if (block.kind === 'text') {
        yield { type: 'block-end', index: block.dshIndex, block: { type: 'text', text: block.text } }
      } else if (block.kind === 'reasoning') {
        yield { type: 'block-end', index: block.dshIndex, block: { type: 'reasoning', text: block.text } }
      } else {
        yield {
          type: 'block-end',
          index: block.dshIndex,
          block: {
            type: 'tool-call',
            id: ToolCallId(block.id),
            name: block.name,
            arguments: block.args === '' ? '{}' : block.args,
          },
        }
      }
      blocks.delete(event.index)
      continue
    }
    if (event.type === 'message_delta') {
      if (typeof event.delta?.stop_reason === 'string') stopReason = event.delta.stop_reason
      if (typeof event.usage?.output_tokens === 'number') outputTokens = event.usage.output_tokens
      continue
    }
    if (event.type === 'message_stop') break
  }

  const toolBlocks = [...blocks.values()].filter((block) => block.kind === 'tool-call')
  if (toolBlocks.length > 0) {
    for (const block of toolBlocks) {
      yield {
        type: 'block-end',
        index: block.dshIndex,
        block: {
          type: 'tool-call',
          id: ToolCallId(block.id),
          name: block.name,
          arguments: block.args === '' ? '{}' : block.args,
        },
      }
    }
    blocks.clear()
  }

  if (!sawContent) throw new LlmError('OpenCode completed the request without content', 'EMPTY_RESPONSE')

  yield { type: 'usage', usage: usageOf(inputUsage, outputTokens) }
  const hasReplay = replay.some((entry) => entry !== undefined && Object.keys(entry).length > 0)
  yield {
    type: 'finish',
    reason: finishReasonOf(stopReason, sawToolUse || toolBlocks.length > 0),
    ...(hasReplay
      ? { replayState: { response: { stopReason }, blocks: replay } }
      : {}),
  }
}
