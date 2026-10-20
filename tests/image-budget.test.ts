import assert from 'node:assert/strict'
import test from 'node:test'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

import { selectRequestImages } from '../src/images.ts'

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
  assert.deepEqual(selected.dropped.map((entry) => entry.attachmentId), ['old'])
  assert.deepEqual(selected.kept.map((entry) => entry.attachmentId), ['middle', 'new'])
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
