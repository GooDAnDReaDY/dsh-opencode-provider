import assert from 'node:assert/strict'
import test from 'node:test'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

import { hasImages, selectRequestImages } from '../src/images.ts'

function ref(id: string, bytes: number): ImageAttachmentRef {
  return {
    attachmentId: id,
    mediaType: 'image/png',
    bytes,
    width: 100,
    height: 100,
  } as ImageAttachmentRef
}

test('keeps the newest images under the byte budget', () => {
  const selected = selectRequestImages([
    ref('old', 10 * 1024 * 1024),
    ref('middle', 10 * 1024 * 1024),
    ref('new', 10 * 1024 * 1024),
  ])
  assert.deepEqual(selected.dropped.map((entry) => entry.attachmentId), ['old', 'middle'])
  assert.deepEqual(selected.kept.map((entry) => entry.attachmentId), ['new'])
})

test('keeps the newest image when a single attachment exceeds the budget', () => {
  const selected = selectRequestImages([
    ref('old', 25 * 1024 * 1024),
    ref('new', 25 * 1024 * 1024),
  ])
  assert.deepEqual(selected.kept.map((entry) => entry.attachmentId), ['new'])
  assert.deepEqual(selected.dropped.map((entry) => entry.attachmentId), ['old'])
})

test('deduplicates repeated attachment ids', () => {
  const selected = selectRequestImages([ref('same', 1), ref('same', 1), ref('new', 1)])
  assert.deepEqual(selected.kept.map((entry) => entry.attachmentId), ['same', 'new'])
})

test('counts repeated occurrences and base64 overhead in the budget', () => {
  const selected = selectRequestImages(
    [ref('a', 8 * 1024 * 1024), ref('b', 8 * 1024 * 1024)],
    new Map([['a', 3], ['b', 1]]),
  )
  assert.deepEqual(selected.dropped.map((entry) => entry.attachmentId), ['a'])
  assert.deepEqual(selected.kept.map((entry) => entry.attachmentId), ['b'])
})

test('offloaded images do not require a live attachment read', () => {
  const offloaded = { ...ref('a', 1), offloaded: true }
  const options = {
    messages: [{ role: 'user', content: [{ type: 'image', attachment: offloaded, offloaded: true }] }],
  } as never
  assert.equal(hasImages(options), false)
})
