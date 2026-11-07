import { LlmError } from '@deepseek-ai/dsh-llm'

export const MAX_SSE_EVENT_BYTES = 4 * 1024 * 1024

async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal?.aborted === true) throw signal.reason
  return await new Promise((resolve, reject) => {
    let settled = false
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      action()
    }
    const timer = setTimeout(() => {
      reader.cancel().catch(() => {})
      finish(() => reject(new LlmError(
        `OpenCode stream went idle for ${idleTimeoutMs}ms`,
        'TIMEOUT',
      )))
    }, idleTimeoutMs)
    const onAbort = () => {
      reader.cancel().catch(() => {})
      finish(() => reject(signal?.reason ?? new DOMException('aborted', 'AbortError')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    reader.read().then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

function appendDecoded(buffer: string, decoded: string): string {
  // Normalize CRLF/CR line endings across chunk boundaries. A trailing CR is
  // held because the following chunk may begin with LF.
  let text = buffer + decoded
  const trailingCR = text.endsWith('\r')
  if (trailingCR) text = text.slice(0, -1)
  return text.replace(/\r\n?/g, '\n') + (trailingCR ? '\r' : '')
}

/** Yield the `data:` payload of every SSE event, honoring cancellation and idle timeouts. */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  try {
    for (;;) {
      const result = await readWithIdleTimeout(reader, idleTimeoutMs, signal)
      if (result.done) {
        completed = true
        break
      }
      buffer = appendDecoded(buffer, decoder.decode(result.value, { stream: true }))
      if (buffer.length > MAX_SSE_EVENT_BYTES) {
        throw new LlmError(`OpenCode stream event exceeded buffer limit (${MAX_SSE_EVENT_BYTES} bytes)`, 'TRANSPORT')
      }
      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary < 0) break
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data !== '') yield data
      }
    }
    const tail = buffer.trim()
    if (tail !== '') {
      const data = tail
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data !== '') yield data
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Read one SSE event with its `event:` name, for protocols that dispatch on it. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  try {
    for (;;) {
      const result = await readWithIdleTimeout(reader, idleTimeoutMs, signal)
      if (result.done) {
        completed = true
        break
      }
      buffer = appendDecoded(buffer, decoder.decode(result.value, { stream: true }))
      if (buffer.length > MAX_SSE_EVENT_BYTES) {
        throw new LlmError(`OpenCode stream event exceeded buffer limit (${MAX_SSE_EVENT_BYTES} bytes)`, 'TRANSPORT')
      }
      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary < 0) break
        const raw = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        let event = ''
        const data: string[] = []
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
        }
        if (data.length > 0) yield { event, data: data.join('\n') }
      }
    }
    if (buffer.trim() !== '') {
      let event = ''
      const data: string[] = []
      for (const line of buffer.trim().split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (data.length > 0) yield { event, data: data.join('\n') }
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
