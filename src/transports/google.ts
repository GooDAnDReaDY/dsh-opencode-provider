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
import { sseData } from './sse.ts'

function textOnly(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push(offloadPlaceholder(block.attachment))
    else if (block.type === 'file') parts.push('[file omitted: tool-result files are not supported]')
  }
  return parts.join('')
}

function imageParts(block: Extract<ContentBlock, { type: 'image' }>, images: ImageMap | undefined): Array<Record<string, unknown>> {
  if (block.offloaded === true) return [{ text: offloadPlaceholder(block.attachment) }]
  const image = images?.get(block.attachment.attachmentId)
  if (image === undefined) {
    if (images === undefined) {
      throw new LlmError('llm-opencode: image input requires the harness attachment service', 'UNSUPPORTED_CONTENT')
    }
    return [{ text: offloadPlaceholder(block.attachment) }]
  }
  return [{ inlineData: { mimeType: image.mediaType, data: image.base64 } }]
}

function userParts(content: readonly ContentBlock[], images: ImageMap | undefined): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = []
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text !== '') parts.push({ text: block.text })
    } else if (block.type === 'image') {
      parts.push(...imageParts(block, images))
    } else if (block.type === 'file') {
      throw new LlmError('llm-opencode: file attachments are not supported yet.', 'UNSUPPORTED_CONTENT')
    }
  }
  return parts.length === 0 ? [{ text: '' }] : parts
}

function replayMeta(message: Extract<GenerateOptions['messages'][number], { role: 'assistant' }>): Array<Record<string, unknown>> {
  const source = message.source as { replayState?: { blocks?: unknown } }
  const blocks = source.replayState?.blocks
  return Array.isArray(blocks) ? blocks as Array<Record<string, unknown>> : []
}

function buildContents(options: GenerateOptions, images?: ImageMap): {
  system?: string
  contents: Array<Record<string, unknown>>
} {
  const system: string[] = []
  if (options.system !== undefined && options.system !== '') system.push(options.system)
  const contents: Array<Record<string, unknown>> = []
  const toolNames = new Map<string, string>()

  for (const message of options.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOnly(message.content)
      if (text !== '') system.push(text)
      continue
    }
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: userParts(message.content, images) })
      continue
    }
    if (message.role === 'tool') {
      const name = toolNames.get(message.toolCallId) ?? 'tool'
      const parts: Array<Record<string, unknown>> = [{
        functionResponse: {
          id: message.toolCallId,
          name,
          response: { result: textOnly(message.content) },
        },
      }]
      for (const block of message.content) {
        if (block.type === 'image') parts.push(...imageParts(block, images))
      }
      contents.push({ role: 'user', parts })
      continue
    }
    const parts: Array<Record<string, unknown>> = []
    const text = textOnly(message.content)
    if (text !== '') parts.push({ text })
    const meta = replayMeta(message)
    let metaIndex = 0
    for (const block of message.content) {
      const blockMeta = meta[metaIndex] ?? {}
      metaIndex += 1
      if (block.type !== 'tool-call') continue
      const callId = typeof blockMeta.id === 'string' && blockMeta.id !== '' ? blockMeta.id : block.id
      const signature = typeof blockMeta.thoughtSignature === 'string' ? blockMeta.thoughtSignature : undefined
      toolNames.set(block.id, block.name)
      toolNames.set(callId, block.name)
      let args: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(block.arguments) as unknown
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>
        }
      } catch {
        args = {}
      }
      parts.push({
        functionCall: { id: callId, name: block.name, args },
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
      })
    }
    if (parts.length > 0) contents.push({ role: 'model', parts })
  }

  return {
    ...(system.length === 0 ? {} : { system: system.join('\n\n') }),
    contents,
  }
}

export function buildGoogleBody(
  options: GenerateOptions,
  model: EffectiveModel,
  config: ResolvedConfig,
  images?: ImageMap,
): Record<string, unknown> {
  const { system, contents } = buildContents(options, images)
  const maxTokens = options.maxTokens ?? effectiveMaxTokens(model, config)
  const declarations = options.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))

  return {
    contents,
    ...(system === undefined ? {} : { systemInstruction: { parts: [{ text: system }] } }),
    ...(declarations === undefined || declarations.length === 0
      ? {}
      : { tools: [{ functionDeclarations: declarations }] }),
    generationConfig: {
      ...(maxTokens === undefined ? {} : { maxOutputTokens: maxTokens }),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(options.stop === undefined || options.stop.length === 0 ? {} : { stopSequences: options.stop }),
    },
  }
}

interface GooglePart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> }
}

interface GoogleUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  cachedContentTokenCount?: number
  thoughtsTokenCount?: number
}

interface GoogleChunk {
  candidates?: Array<{
    content?: { parts?: GooglePart[] }
    finishReason?: string
  }>
  usageMetadata?: GoogleUsage
  error?: { code?: number; message?: string; status?: string }
}

function mapUsage(usage: GoogleUsage | undefined): TokenUsage {
  const prompt = usage?.promptTokenCount ?? 0
  const cached = usage?.cachedContentTokenCount ?? 0
  const output = usage?.candidatesTokenCount ?? 0
  const thoughts = usage?.thoughtsTokenCount
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: output,
    ...(usage?.totalTokenCount === undefined ? {} : { totalTokens: usage.totalTokenCount }),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(thoughts === undefined ? {} : { reasoningTokens: thoughts }),
  }
}

function finishReasonOf(raw: string | undefined, hasTools: boolean): FinishReason {
  if (hasTools) return { kind: 'tool-calls' }
  if (raw === 'MAX_TOKENS') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** Parse a Gemini `streamGenerateContent` SSE stream into harness chunks. */
export async function* parseGoogleStream(
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
  let sawContent = false
  let hasTools = false
  let usage: TokenUsage | undefined
  let finishReason: string | undefined
  let toolCounter = 0
  const replay: Array<Record<string, unknown>> = []

  for await (const data of sseData(response.body, idleTimeoutMs, signal)) {
    let chunk: GoogleChunk
    try {
      chunk = JSON.parse(data) as GoogleChunk
    } catch {
      continue
    }
    if (chunk.error !== undefined) {
      throw new LlmError(
        `OpenCode Gemini error: ${chunk.error.message ?? 'request failed'}`,
        'PROVIDER_HTTP_ERROR',
      )
    }
    if (chunk.usageMetadata !== undefined) usage = mapUsage(chunk.usageMetadata)

    for (const candidate of chunk.candidates ?? []) {
      if (typeof candidate.finishReason === 'string') finishReason = candidate.finishReason
      for (const part of candidate.content?.parts ?? []) {
        if (part.functionCall !== undefined) {
          const dshIndex = nextIndex++
          const id = typeof part.functionCall.id === 'string' && part.functionCall.id !== ''
            ? part.functionCall.id
            : `call_${toolCounter++}`
          const name = part.functionCall.name ?? ''
          const args = JSON.stringify(part.functionCall.args ?? {})
          hasTools = true
          sawContent = true
          replay[dshIndex] = {
            type: 'functionCall',
            id,
            ...(typeof part.thoughtSignature === 'string' ? { thoughtSignature: part.thoughtSignature } : {}),
          }
          yield { type: 'block-start', index: dshIndex, blockType: 'tool-call' }
          yield {
            type: 'tool-call-delta',
            index: dshIndex,
            id: ToolCallId(id),
            ...(name === '' ? {} : { name }),
            argumentsDelta: args,
          }
          yield {
            type: 'block-end',
            index: dshIndex,
            block: { type: 'tool-call', id: ToolCallId(id), name, arguments: args },
          }
          continue
        }
        if (typeof part.text !== 'string' || part.text === '') continue
        if (part.thought === true) {
          if (reasoningIndex === undefined) {
            reasoningIndex = nextIndex++
            replay[reasoningIndex] = {}
            yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
          }
          if (typeof part.thoughtSignature === 'string') {
            replay[reasoningIndex] = { thoughtSignature: part.thoughtSignature }
          }
          reasoning += part.text
          sawContent = true
          yield { type: 'reasoning-delta', index: reasoningIndex, text: part.text }
        } else {
          if (textIndex === undefined) {
            textIndex = nextIndex++
            replay[textIndex] = {}
            yield { type: 'block-start', index: textIndex, blockType: 'text' }
          }
          if (typeof part.thoughtSignature === 'string') {
            replay[textIndex] = { thoughtSignature: part.thoughtSignature }
          }
          text += part.text
          sawContent = true
          yield { type: 'text-delta', index: textIndex, text: part.text }
        }
      }
    }
  }

  if (textIndex !== undefined) {
    yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }
  }
  if (reasoningIndex !== undefined) {
    yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
  }
  if (usage !== undefined) yield { type: 'usage', usage }
  if (!sawContent) throw new LlmError('OpenCode completed the request without content', 'EMPTY_RESPONSE')
  const hasReplay = replay.some((entry) => entry !== undefined && Object.keys(entry).length > 0)
  yield {
    type: 'finish',
    reason: finishReasonOf(finishReason, hasTools),
    ...(hasReplay
      ? { replayState: { response: { finishReason }, blocks: replay } }
      : {}),
  }
}
