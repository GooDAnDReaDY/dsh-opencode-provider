import assert from 'node:assert/strict'
import test from 'node:test'

import { sseData, sseEvents } from '../src/transports/sse.ts'

function stream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of source) result.push(value)
  return result
}

test('sseData handles CRLF split between chunks', async () => {
  const body = stream(['data: one\r', '\n\r\ndata: two\r\n\r', '\ndata: three\r\n\r\n'])
  assert.deepEqual(await collect(sseData(body, 5000, undefined)), ['one', 'two', 'three'])
})

test('sseData handles LF, CR and CRLF event separators', async () => {
  assert.deepEqual(
    await collect(sseData(stream(['data: a\n\n', 'data: b\r\r', 'data: c\r\n\r\n']), 5000, undefined)),
    ['a', 'b', 'c'],
  )
})

test('sseEvents preserves event names across split boundaries', async () => {
  const body = stream(['event: message\r', '\ndata: one\r', '\n\r', '\nevent: done\n', 'data: two\n\n'])
  assert.deepEqual(await collect(sseEvents(body, 5000, undefined)), [
    { event: 'message', data: 'one' },
    { event: 'done', data: 'two' },
  ])
})

test('sseData handles multibyte UTF-8 split between chunks', async () => {
  const encoded = new TextEncoder().encode('data: привет\r\n\r\n')
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, 9))
      controller.enqueue(encoded.slice(9))
      controller.close()
    },
  })
  assert.deepEqual(await collect(sseData(body, 5000, undefined)), ['привет'])
})

test('sseData aborts with error when single event exceeds buffer limit', async () => {
  const hugeChunk = 'data: ' + 'x'.repeat(4 * 1024 * 1024 + 50)
  const body = stream([hugeChunk])
  await assert.rejects(
    async () => { await collect(sseData(body, 5000, undefined)) },
    /exceeded buffer limit/,
  )
})
