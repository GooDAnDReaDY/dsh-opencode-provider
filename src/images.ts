import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'

export interface ResolvedImage {
  readonly mediaType: string
  readonly base64: string
  readonly dataUrl: string
  readonly width: number
  readonly height: number
}

export type ImageMap = ReadonlyMap<string, ResolvedImage>

const MAX_LONG_EDGE = 1568
const MAX_BYTES = 1_048_576
/** Total base64 image budget for one request; leaves room under the gateway cap. */
const MAX_REQUEST_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_REQUEST_IMAGES = 50

export interface SelectedRequestImages {
  readonly kept: readonly ImageAttachmentRef[]
  readonly dropped: readonly ImageAttachmentRef[]
}

/**
 * Keep the newest images under one request-wide budget. The oldest images are
 * dropped first; the transports render them as an "image omitted" placeholder
 * instead of failing the whole request.
 */
export function selectRequestImages(refs: readonly ImageAttachmentRef[]): SelectedRequestImages {
  const unique: ImageAttachmentRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.attachmentId)) continue
    seen.add(ref.attachmentId)
    unique.push(ref)
  }

  let start = 0
  let bytes = unique.reduce((sum, ref) => sum + Math.max(0, ref.bytes), 0)
  while (start < unique.length
    && (unique.length - start > MAX_REQUEST_IMAGES || bytes > MAX_REQUEST_IMAGE_BYTES)) {
    const dropped = unique[start]
    if (dropped !== undefined) bytes -= Math.max(0, dropped.bytes)
    start += 1
  }

  const kept = unique.slice(start)
  // The normalized per-image target keeps a single image small; if a malformed
  // reference still exceeds the budget, keep the newest one rather than sending
  // no image at all.
  if (kept.length === 0 && unique.length > 0) {
    return { kept: unique.slice(-1), dropped: unique.slice(0, -1) }
  }
  return { kept, dropped: unique.slice(0, start) }
}

function targetOf(ref: ImageAttachmentRef): { width: number; height: number; maxBytes: number } {
  const longEdge = Math.max(ref.width, ref.height)
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1
  return {
    width: Math.max(1, Math.round(ref.width * scale)),
    height: Math.max(1, Math.round(ref.height * scale)),
    maxBytes: MAX_BYTES,
  }
}

export function hasImages(options: GenerateOptions): boolean {
  return options.messages.some((message) =>
    message.content.some((block) => block.type === 'image'))
}

/** Decode the distinct request images that fit the request-wide budget. */
export async function resolveImages(
  options: GenerateOptions,
  store: AttachmentStore,
  signal: AbortSignal | undefined,
): Promise<ImageMap> {
  const refs: ImageAttachmentRef[] = []
  const seen = new Set<string>()
  for (const message of options.messages) {
    for (const block of message.content) {
      if (block.type !== 'image' || block.offloaded === true) continue
      const ref = block.attachment
      if (seen.has(ref.attachmentId)) continue
      seen.add(ref.attachmentId)
      refs.push(ref)
    }
  }

  const images = new Map<string, ResolvedImage>()
  for (const ref of selectRequestImages(refs).kept) {
    const request = await store.readImageRequest(ref, targetOf(ref), signal)
    const base64 = Buffer.from(request.data).toString('base64')
    images.set(ref.attachmentId, {
      mediaType: request.mediaType,
      base64,
      dataUrl: `data:${request.mediaType};base64,${base64}`,
      width: request.width,
      height: request.height,
    })
  }
  return images
}

export function offloadPlaceholder(ref: ImageAttachmentRef): string {
  return `[image omitted: ${ref.name ?? ref.attachmentId}]`
}
