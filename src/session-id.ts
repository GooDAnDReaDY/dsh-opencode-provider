import { createHash } from 'node:crypto'

import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function conversationSeed(options: GenerateOptions): string {
  if (options.sessionId !== undefined && String(options.sessionId) !== '') {
    return `session:${String(options.sessionId)}`
  }
  for (const message of options.messages) {
    if (message.role === 'user') {
      return `first:${JSON.stringify(message.content).slice(0, 4096)}`
    }
  }
  return `model:${options.model}`
}

/**
 * A stable, opaque session id for `x-opencode-session`. The header must stay
 * identical across every turn and retry of one conversation; deriving it from
 * the durable session id (or, for hand-built calls, the first user turn) gives
 * that stability without storing state. OpenCode only treats it as an opaque
 * routing key, so the `dsh_` prefix is safe.
 */
export function openCodeSessionId(options: GenerateOptions): string {
  return `dsh_${sha256(conversationSeed(options)).slice(0, 32)}`
}
