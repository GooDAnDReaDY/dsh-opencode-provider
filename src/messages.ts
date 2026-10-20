import {
  LlmError,
  type ContentBlock,
  type GenerateOptions,
  type ToolSchema,
} from '@deepseek-ai/dsh-llm'

import type { EffectiveModel } from './catalog.ts'
import { effectiveMaxTokens } from './catalog.ts'
import type { ResolvedConfig } from './config.ts'
import { offloadPlaceholder, type ImageMap } from './images.ts'
import { normalizeToolParameters } from './tool-schema.ts'

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | OpenAIContentPart[]
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
  reasoning_content?: string
}

function textOnly(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push(offloadPlaceholder(block.attachment))
    else if (block.type === 'file') parts.push('[file omitted: tool-result files are not supported]')
  }
  return parts.join('')
}

function userContent(content: readonly ContentBlock[], images: ImageMap | undefined): string | OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = []
  let hasImage = false
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      if (block.offloaded === true) {
        parts.push({ type: 'text', text: offloadPlaceholder(block.attachment) })
        continue
      }
      const image = images?.get(block.attachment.attachmentId)
      if (image === undefined) {
        if (images === undefined) {
          throw new LlmError(
            'llm-opencode: image input requires the harness attachment service',
            'UNSUPPORTED_CONTENT',
          )
        }
        parts.push({ type: 'text', text: offloadPlaceholder(block.attachment) })
        continue
      }
      hasImage = true
      parts.push({ type: 'image_url', image_url: { url: image.dataUrl } })
    } else if (block.type === 'file') {
      throw new LlmError('llm-opencode: file attachments are not supported yet.', 'UNSUPPORTED_CONTENT')
    }
  }
  if (!hasImage) return parts.map((part) => part.type === 'text' ? part.text : '').join('')
  return parts
}

function reasoningOf(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'reasoning' }> => block.type === 'reasoning')
    .map((block) => block.text)
    .join('')
}

function assistantToolCalls(content: readonly ContentBlock[]): OpenAIToolCall[] {
  const calls: OpenAIToolCall[] = []
  for (const block of content) {
    if (block.type !== 'tool-call') continue
    calls.push({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    })
  }
  return calls
}

function buildTools(tools: readonly ToolSchema[] | undefined): unknown[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeToolParameters(tool.parameters),
    },
  }))
}

/** Convert the harness conversation into OpenAI Chat messages. */
export function buildMessages(options: GenerateOptions, images?: ImageMap): OpenAIMessage[] {
  const system: string[] = []
  if (options.system !== undefined && options.system !== '') system.push(options.system)

  const messages: OpenAIMessage[] = []
  for (const message of options.messages) {
    switch (message.role) {
      case 'system':
      case 'developer': {
        const text = textOnly(message.content)
        if (text !== '') system.push(text)
        break
      }
      case 'user': {
        messages.push({ role: 'user', content: userContent(message.content, images) })
        break
      }
      case 'assistant': {
        const text = textOnly(message.content)
        const reasoning = reasoningOf(message.content)
        const toolCalls = assistantToolCalls(message.content)
        messages.push({
          role: 'assistant',
          content: text !== '' ? text : toolCalls.length > 0 ? null : '',
          ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
          ...(reasoning === '' ? {} : { reasoning_content: reasoning }),
        })
        break
      }
      case 'tool': {
        messages.push({
          role: 'tool',
          content: textOnly(message.content),
          tool_call_id: message.toolCallId,
        })
        break
      }
    }
  }

  if (system.length > 0) {
    messages.unshift({ role: 'system', content: system.join('\n\n') })
  }
  return messages
}

const EFFORT_LADDER = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function reasoningEffortWire(
  effort: string | undefined,
  supported: readonly string[],
): string | undefined {
  if (effort === undefined || effort === '') return undefined
  if (effort === 'off') return supported.includes('off') ? 'none' : undefined
  return EFFORT_LADDER.has(effort) && supported.includes(effort) ? effort : undefined
}

/** Build the OpenAI Chat request body for one model. */
export function buildChatBody(
  options: GenerateOptions,
  model: EffectiveModel,
  config: ResolvedConfig,
  images?: ImageMap,
): Record<string, unknown> {
  const tools = buildTools(options.tools)
  const effort = reasoningEffortWire(
    options.reasoningEffort === undefined ? undefined : String(options.reasoningEffort),
    model.reasoning,
  )
  const maxTokens = options.maxTokens ?? effectiveMaxTokens(model, config)

  return {
    model: options.model,
    messages: buildMessages(options, images),
    stream: true,
    stream_options: { include_usage: true },
    ...(tools === undefined ? {} : { tools, tool_choice: 'auto' }),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(maxTokens === undefined || maxTokens <= 0 ? {} : { max_tokens: maxTokens }),
    ...(effort === undefined ? {} : { reasoning_effort: effort }),
    ...(options.stop === undefined || options.stop.length === 0 ? {} : { stop: options.stop }),
  }
}
